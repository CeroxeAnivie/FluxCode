//! Git mutations are typed operations with explicit argv; no shell interpolation.
use crate::{editor, workspace};
use serde::{Deserialize, Serialize};
use std::{
    path::{Component, Path},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GitAction {
    Checkpoint {
        label: String,
    },
    RestoreCheckpoint {
        revision: String,
        path: String,
    },
    Stage {
        path: String,
    },
    Unstage {
        path: String,
    },
    Hunk {
        path: String,
        expected: String,
        index: usize,
        staged: bool,
    },
    Lines {
        path: String,
        expected: String,
        index: usize,
        selected: Vec<usize>,
        staged: bool,
    },
    Commit {
        message: String,
    },
    CreateBranch {
        name: String,
    },
    SwitchBranch {
        name: String,
    },
    CreateWorktree {
        path: String,
        branch: String,
    },
    Merge {
        branch: String,
    },
    Rebase {
        branch: String,
    },
    ContinueOperation,
    AbortOperation,
    ResolveConflict {
        path: String,
        version: String,
    },
    ResolveEdited {
        path: String,
        expected: Option<String>,
        content: String,
    },
}
#[derive(Serialize)]
pub struct GitBranches {
    pub current: String,
    pub branches: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOperation {
    pub kind: Option<String>,
    pub conflicts: Vec<String>,
    pub dirty: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub base: Option<String>,
    pub current: Option<String>,
    pub incoming: Option<String>,
    pub working: Option<String>,
}

fn has_unresolved_markers(content: &str) -> bool {
    content.lines().any(|line| {
        let line = line.trim_end_matches('\r');
        line.starts_with("<<<<<<< ")
            || line.starts_with("||||||| ")
            || line == "======="
            || line.starts_with(">>>>>>> ")
    })
}

async fn check_conflict_markers(root: &str, proxy: &str, path: &str) -> Result<(), String> {
    if !operation(root, proxy)
        .await?
        .conflicts
        .iter()
        .any(|conflict| conflict == path)
    {
        return Ok(());
    }
    let content = workspace::read(root, path).await?;
    if has_unresolved_markers(&content) {
        return Err("文件仍含 Git 冲突标记；请完成编辑后再标记已解决".into());
    }
    Ok(())
}

pub async fn conflict_versions(
    root: &str,
    proxy: &str,
    path: &str,
) -> Result<ConflictVersions, String> {
    relative(path)?;
    let state = operation(root, proxy).await?;
    if !state.conflicts.iter().any(|item| item == path) {
        return Err("文件不在当前冲突列表中，请刷新".into());
    }
    async fn stage(
        root: &str,
        proxy: &str,
        number: u8,
        path: &str,
    ) -> Result<Option<String>, String> {
        let reference = format!(":{number}:{path}");
        let oid = match run(root, proxy, &["rev-parse", "--verify", &reference]).await {
            Ok(oid) => oid,
            Err(_) => return Ok(None),
        };
        let size: u64 = run(root, proxy, &["cat-file", "-s", &oid])
            .await?
            .parse()
            .map_err(|_| "冲突版本大小无效")?;
        if size > 1_048_576 {
            return Err("冲突版本过大，请在外部工具处理".into());
        }
        let cwd = workspace::scoped_path(root, "")?;
        let mut command = Command::new("git");
        command
            .current_dir(cwd)
            .args(["cat-file", "blob", &oid])
            .env("GIT_TERMINAL_PROMPT", "0");
        apply_proxy(&mut command, proxy);
        let output = tokio::time::timeout(Duration::from_secs(10), command.output())
            .await
            .map_err(|_| "读取冲突版本超时")?
            .map_err(|cause| format!("无法读取冲突版本：{cause}"))?;
        if !output.status.success() || output.stdout.len() as u64 != size {
            return Err("冲突版本读取失败，请刷新".into());
        }
        let value = String::from_utf8(output.stdout).map_err(|_| "冲突版本不是 UTF-8 文本")?;
        if value.contains('\0') {
            return Err("冲突版本包含非文本内容，请在外部工具处理".into());
        }
        Ok(Some(value))
    }
    let working_path = workspace::scoped_path(root, "")?.join(path);
    let working = match tokio::fs::symlink_metadata(&working_path).await {
        Ok(_) => Some(workspace::read(root, path).await?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法读取冲突文件状态：{error}")),
    };
    Ok(ConflictVersions {
        base: stage(root, proxy, 1, path).await?,
        current: stage(root, proxy, 2, path).await?,
        incoming: stage(root, proxy, 3, path).await?,
        working,
    })
}

async fn resolve_edited(
    root: &str,
    proxy: &str,
    path: &str,
    expected: Option<&str>,
    content: &str,
) -> Result<String, String> {
    relative(path)?;
    if !operation(root, proxy)
        .await?
        .conflicts
        .iter()
        .any(|item| item == path)
    {
        return Err("文件不在当前冲突列表中，请刷新".into());
    }
    if content.len() > 1_048_576 || content.contains('\0') {
        return Err("合并结果超过编辑限制或包含非文本内容".into());
    }
    if has_unresolved_markers(content) {
        return Err("文件仍含 Git 冲突标记；请完成编辑后再标记已解决".into());
    }
    match expected {
        Some(original) => editor::save(root, path, original, content).await?,
        None => {
            let root_path = workspace::scoped_path(root, "")?;
            let relative_path = Path::new(path);
            let parent = root_path
                .join(relative_path)
                .parent()
                .ok_or("无效的冲突文件路径")?
                .to_owned();
            let resolved_parent = parent.canonicalize().map_err(|e| e.to_string())?;
            if !resolved_parent.starts_with(&root_path) {
                return Err("不能访问项目目录之外的文件".into());
            }
            let name = relative_path
                .file_name()
                .ok_or("无效的冲突文件路径")?
                .to_owned();
            let content = content.to_owned();
            tokio::task::spawn_blocking(move || {
                let destination = resolved_parent.join(name);
                let mut temporary = tempfile::NamedTempFile::new_in(&resolved_parent)
                    .map_err(|e| format!("无法创建冲突文件暂存副本：{e}"))?;
                std::io::Write::write_all(&mut temporary, content.as_bytes())
                    .map_err(|e| format!("无法写入冲突文件暂存副本：{e}"))?;
                temporary
                    .as_file()
                    .sync_all()
                    .map_err(|e| format!("无法同步冲突文件暂存副本：{e}"))?;
                temporary
                    .persist_noclobber(&destination)
                    .map_err(|e| format!("冲突文件已变化或无法创建，请刷新后重试：{e}"))?;
                Ok::<(), String>(())
            })
            .await
            .map_err(|e| format!("创建冲突文件任务失败：{e}"))??;
        }
    }
    if workspace::read(root, path).await? != content {
        return Err("合并结果保存后已被外部修改，未暂存；请刷新冲突文件".into());
    }
    run(root, proxy, &["add", "--", path])
        .await
        .map_err(|error| format!("合并结果已保存，但未能暂存：{error}"))
}

pub async fn operation(root: &str, proxy: &str) -> Result<GitOperation, String> {
    let git_dir = run(root, proxy, &["rev-parse", "--absolute-git-dir"]).await?;
    let git_dir = Path::new(&git_dir);
    let kind = if git_dir.join("MERGE_HEAD").is_file() {
        Some("merge".to_owned())
    } else if git_dir.join("rebase-merge").is_dir() || git_dir.join("rebase-apply").is_dir() {
        Some("rebase".to_owned())
    } else {
        None
    };
    let conflicts = run(
        root,
        proxy,
        &["diff", "--name-only", "-z", "--diff-filter=U"],
    )
    .await?
    .split('\0')
    .filter(|path| !path.is_empty())
    .map(str::to_owned)
    .collect();
    let dirty = !run(root, proxy, &["status", "--porcelain=v1", "-z"])
        .await?
        .is_empty();
    Ok(GitOperation {
        kind,
        conflicts,
        dirty,
    })
}

async fn begin_operation(
    root: &str,
    proxy: &str,
    branch: &str,
    rebase: bool,
) -> Result<String, String> {
    let state = operation(root, proxy).await?;
    if state.kind.is_some() {
        return Err("请先完成或中止当前 Git 操作".into());
    }
    if state.dirty {
        return Err("工作区有未提交变更；请先提交、贮藏或使用独立工作树".into());
    }
    let current = run(root, proxy, &["branch", "--show-current"]).await?;
    if current.is_empty() || current == branch {
        return Err("请选择与当前分支不同的目标分支".into());
    }
    run(root, proxy, &["check-ref-format", "--branch", branch]).await?;
    run(
        root,
        proxy,
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .await?;
    checkpoint(
        root,
        proxy,
        if rebase {
            "Before rebase"
        } else {
            "Before merge"
        },
    )
    .await?;
    if rebase {
        run(root, proxy, &["rebase", "--", branch]).await
    } else {
        run(
            root,
            proxy,
            &["merge", "--no-ff", "--no-edit", "--", branch],
        )
        .await
    }
}
fn relative(path: &str) -> Result<(), String> {
    if path.is_empty()
        || Path::new(path).is_absolute()
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        Err("Invalid relative Git path".into())
    } else {
        Ok(())
    }
}
async fn run(root: &str, proxy: &str, args: &[&str]) -> Result<String, String> {
    run_env(root, proxy, args, &[]).await
}
async fn staged_rename_source(
    root: &str,
    proxy: &str,
    destination: &str,
) -> Result<Option<String>, String> {
    let output = run(
        root,
        proxy,
        &["diff", "--cached", "--name-status", "-z", "--find-renames"],
    )
    .await?;
    let mut fields = output.split('\0');
    while let Some(status) = fields.next().filter(|value| !value.is_empty()) {
        let source = fields.next().ok_or("Git 暂存记录格式无效，请刷新状态")?;
        if status.starts_with('R') {
            let target = fields.next().ok_or("Git 重命名记录格式无效，请刷新状态")?;
            if target == destination {
                return Ok(Some(source.to_owned()));
            }
        }
    }
    Ok(None)
}
fn apply_proxy(command: &mut Command, proxy: &str) {
    if !proxy.trim().is_empty() {
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(name, proxy);
        }
        command.env("NO_PROXY", "").env("no_proxy", "");
    }
}
fn git_failure(stderr: &[u8], code: Option<i32>) -> String {
    let detail = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    let guidance = if detail.contains("not a git repository") {
        "所选文件夹不是 Git 仓库，请确认项目路径"
    } else if detail.contains("nothing to commit") {
        "没有可提交的变更"
    } else if detail.contains("would be overwritten") || detail.contains("local changes") {
        "工作区有未保存的变更，请先提交、贮藏或使用独立工作树"
    } else if detail.contains("authentication failed") || detail.contains("could not read username")
    {
        "Git 身份验证失败，请检查系统凭据与远端权限"
    } else if detail.contains("could not resolve host") {
        "无法解析 Git 远端地址，请检查网络设置"
    } else if detail.contains("permission denied") {
        "Git 无法访问所需文件或远端，请检查权限"
    } else if detail.contains("conflict") {
        "Git 操作遇到冲突，请检查冲突列表"
    } else {
        "Git 操作失败，请检查仓库状态后重试"
    };
    format!(
        "{guidance}（退出码 {}；原始错误可能包含敏感信息，未显示）",
        code.unwrap_or(-1)
    )
}
async fn run_env(
    root: &str,
    proxy: &str,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<String, String> {
    run_input(root, proxy, args, env, None).await
}
async fn run_input(
    root: &str,
    proxy: &str,
    args: &[&str],
    env: &[(&str, &str)],
    input: Option<&str>,
) -> Result<String, String> {
    let cwd = workspace::scoped_path(root, "")?;
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        .args(["--no-pager", "-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .envs(env.iter().copied())
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_proxy(&mut cmd, proxy);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    let mut child = cmd.spawn().map_err(|e| format!("Git unavailable: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("Git stdout unavailable")?
        .take(2_097_153);
    let mut stderr = child
        .stderr
        .take()
        .ok_or("Git stderr unavailable")?
        .take(65_537);
    let mut out = Vec::new();
    let mut err = Vec::new();
    let stdin = child.stdin.take();
    let status = tokio::time::timeout(Duration::from_secs(120), async {
        let write = async {
            if let (Some(mut stdin), Some(input)) = (stdin, input) {
                stdin.write_all(input.as_bytes()).await?;
                stdin.shutdown().await?;
            }
            Ok::<_, std::io::Error>(())
        };
        let (a, b, c) = tokio::join!(
            stdout.read_to_end(&mut out),
            stderr.read_to_end(&mut err),
            write
        );
        a?;
        b?;
        c?;
        child.wait().await
    })
    .await
    .map_err(|_| "Git operation timed out; inspect repository state before retrying")?
    .map_err(|e| e.to_string())?;
    if out.len() > 2_097_152 || err.len() > 65_536 {
        return Err("Git output exceeded limit".into());
    }
    if !status.success() {
        return Err(git_failure(&err, status.code()));
    }
    Ok(String::from_utf8_lossy(&out).trim().to_owned())
}
pub async fn branches(root: &str, proxy: &str) -> Result<GitBranches, String> {
    Ok(GitBranches {
        current: run(root, proxy, &["branch", "--show-current"]).await?,
        branches: run(
            root,
            proxy,
            &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
        )
        .await?
        .lines()
        .map(str::to_owned)
        .collect(),
    })
}
pub async fn apply(root: &str, proxy: &str, action: GitAction) -> Result<String, String> {
    match action {
        GitAction::Hunk {
            path,
            expected,
            index,
            staged,
        } => {
            relative(&path)?;
            if expected.len() > 2_097_152 {
                return Err("差异内容过大，请使用文件级暂存。".into());
            }
            let current = workspace::diff(root, &path, staged).await?;
            if current != expected {
                return Err("文件差异已变化，请刷新后重试。".into());
            }
            let patch = selected_hunk(&current, index)?;
            let mut args = vec!["apply", "--cached", "--whitespace=nowarn"];
            if staged {
                args.push("--reverse");
            }
            args.push("-");
            run_input(root, proxy, &args, &[], Some(&patch)).await
        }
        GitAction::Lines {
            path,
            expected,
            index,
            selected,
            staged,
        } => {
            relative(&path)?;
            if expected.len() > 2_097_152 {
                return Err("差异内容过大，请使用文件级暂存。".into());
            }
            let current = workspace::diff(root, &path, staged).await?;
            if current != expected {
                return Err("文件差异已变化，请刷新后重试。".into());
            }
            let patch = selected_lines(&current, index, &selected, staged)?;
            let mut args = vec!["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn"];
            if staged {
                args.push("--reverse");
            }
            args.push("-");
            run_input(root, proxy, &args, &[], Some(&patch)).await
        }
        GitAction::Checkpoint { label } => checkpoint(root, proxy, &label).await,
        GitAction::RestoreCheckpoint { revision, path } => {
            relative(&path)?;
            if !revision.starts_with("refs/fluxcode/checkpoints/")
                || !revision["refs/fluxcode/checkpoints/".len()..]
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == '-')
            {
                return Err("Invalid checkpoint reference".into());
            }
            run(root, proxy, &["rev-parse", "--verify", &revision]).await?;
            checkpoint(root, proxy, "Before selective restore").await?;
            run(
                root,
                proxy,
                &["restore", "--source", &revision, "--worktree", "--", &path],
            )
            .await
        }
        GitAction::Stage { path } => {
            relative(&path)?;
            check_conflict_markers(root, proxy, &path).await?;
            run(root, proxy, &["add", "--", &path]).await
        }
        GitAction::Unstage { path } => {
            relative(&path)?;
            let head = run(root, proxy, &["rev-parse", "--verify", "HEAD"]).await;
            if head.is_ok() {
                if let Some(source) = staged_rename_source(root, proxy, &path).await? {
                    run(
                        root,
                        proxy,
                        &["reset", "--quiet", "HEAD", "--", &source, &path],
                    )
                    .await
                } else {
                    run(root, proxy, &["restore", "--staged", "--", &path]).await
                }
            } else {
                run(root, proxy, &["rm", "--cached", "--", &path]).await
            }
        }
        GitAction::Commit { message } => {
            if message.trim().is_empty() || message.len() > 10000 {
                return Err("Invalid commit message".into());
            }
            run(root, proxy, &["commit", "-m", &message]).await
        }
        GitAction::CreateBranch { name } => {
            run(root, proxy, &["check-ref-format", "--branch", &name]).await?;
            run(root, proxy, &["switch", "-c", &name]).await
        }
        GitAction::SwitchBranch { name } => {
            run(root, proxy, &["check-ref-format", "--branch", &name]).await?;
            run(root, proxy, &["switch", &name]).await
        }
        GitAction::CreateWorktree { path, branch } => {
            if !Path::new(&path).is_absolute() || Path::new(&path).exists() {
                return Err("Choose a new absolute worktree path".into());
            }
            run(root, proxy, &["check-ref-format", "--branch", &branch]).await?;
            run(
                root,
                proxy,
                &["worktree", "add", "-b", &branch, "--", &path],
            )
            .await
        }
        GitAction::Merge { branch } => begin_operation(root, proxy, &branch, false).await,
        GitAction::Rebase { branch } => begin_operation(root, proxy, &branch, true).await,
        GitAction::ContinueOperation => {
            let state = operation(root, proxy).await?;
            if !state.conflicts.is_empty() {
                return Err("仍有未解决的冲突文件".into());
            }
            match state.kind.as_deref() {
                Some("merge") => {
                    run(
                        root,
                        proxy,
                        &["-c", "core.editor=true", "merge", "--continue"],
                    )
                    .await
                }
                Some("rebase") => {
                    run(
                        root,
                        proxy,
                        &["-c", "core.editor=true", "rebase", "--continue"],
                    )
                    .await
                }
                _ => Err("当前没有可继续的合并或变基".into()),
            }
        }
        GitAction::AbortOperation => {
            let state = operation(root, proxy).await?;
            let command = match state.kind.as_deref() {
                Some("merge") => &["merge", "--abort"][..],
                Some("rebase") => &["rebase", "--abort"][..],
                _ => return Err("当前没有可中止的合并或变基".into()),
            };
            let changed = run(root, proxy, &["diff", "--name-only", "-z", "--"]).await?;
            let unrelated: Vec<_> = changed
                .split('\0')
                .filter(|path| !path.is_empty() && !state.conflicts.iter().any(|c| c == path))
                .collect();
            if !unrelated.is_empty() {
                return Err(format!(
                    "中止已暂停：{} 有新的未暂存修改。请先另存这些文件，再重试；当前操作和修改均未改变。",
                    unrelated.join("、")
                ));
            }
            checkpoint(root, proxy, "Before aborting Git operation").await?;
            run(root, proxy, command).await
        }
        GitAction::ResolveConflict { path, version } => {
            relative(&path)?;
            let state = operation(root, proxy).await?;
            if !state.conflicts.iter().any(|conflict| conflict == &path) {
                return Err("文件不在当前冲突列表中，请刷新".into());
            }
            if version != "ours" && version != "theirs" {
                return Err("无效的冲突版本".into());
            }
            let versions = conflict_versions(root, proxy, &path).await?;
            let chosen = if version == "ours" {
                versions.current
            } else {
                versions.incoming
            };
            if chosen.is_none() {
                return run(root, proxy, &["rm", "--", &path]).await;
            }
            run(
                root,
                proxy,
                &["checkout", &format!("--{version}"), "--", &path],
            )
            .await?;
            run(root, proxy, &["add", "--", &path]).await
        }
        GitAction::ResolveEdited {
            path,
            expected,
            content,
        } => resolve_edited(root, proxy, &path, expected.as_deref(), &content).await,
    }
}
/// Select an intact Git-generated hunk. Git remains the parser and atomic index writer.
fn selected_hunk(diff: &str, index: usize) -> Result<String, String> {
    let lines: Vec<_> = diff.split_inclusive('\n').collect();
    let starts: Vec<_> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| line.starts_with("@@ ").then_some(i))
        .collect();
    let first = *starts.first().ok_or("没有可暂存的文本差异块。")?;
    let start = *starts.get(index).ok_or("无效的差异块。")?;
    let end = starts.get(index + 1).copied().unwrap_or(lines.len());
    let header = lines[..first].concat();
    if diff.matches("diff --git ").count() != 1
        || [
            "new file mode ",
            "deleted file mode ",
            "old mode ",
            "new mode ",
            "rename from ",
            "copy from ",
        ]
        .iter()
        .any(|prefix| lines[..first].iter().any(|line| line.starts_with(prefix)))
    {
        return Err("新增、删除、重命名或权限变更请使用文件级暂存。".into());
    }
    Ok(header + &lines[start..end].concat())
}

fn selected_lines(
    diff: &str,
    index: usize,
    selected: &[usize],
    staged: bool,
) -> Result<String, String> {
    if selected.is_empty() || selected.len() > 1000 {
        return Err("请选择要暂存的差异行。".into());
    }
    let hunk = selected_hunk(diff, index)?;
    let header_at = hunk
        .find("\n@@ ")
        .map(|position| position + 1)
        .or_else(|| hunk.starts_with("@@ ").then_some(0))
        .ok_or("差异块格式无效")?;
    let (file_header, body) = hunk.split_at(header_at);
    let (hunk_header, changes) = body.split_once('\n').ok_or("差异块格式无效")?;
    let ranges = hunk_header
        .strip_prefix("@@ -")
        .and_then(|value| value.split_once(" +"))
        .and_then(|(old, rest)| rest.split_once(" @@").map(|(new, _)| (old, new)))
        .ok_or("差异块范围无效")?;
    let start = |value: &str| -> Result<usize, String> {
        value
            .split(',')
            .next()
            .ok_or("差异块范围无效")?
            .parse::<usize>()
            .map_err(|_| "差异块范围无效".into())
    };
    let old_start = start(ranges.0)?;
    let new_start = start(ranges.1)?;
    let mut positions = std::collections::HashSet::new();
    if selected.iter().any(|position| !positions.insert(*position)) {
        return Err("差异行选择包含重复项".into());
    }
    let mut change_index = 0usize;
    let mut old_count = 0usize;
    let mut new_count = 0usize;
    let mut output = String::new();
    let mut previous_included = false;
    for line in changes.split_inclusive('\n') {
        let prefix = line.as_bytes().first().copied().ok_or("差异行为空")?;
        let mapped = match prefix {
            b' ' => Some(' '),
            b'+' | b'-' => {
                let included = positions.contains(&change_index);
                change_index += 1;
                if included {
                    Some(prefix as char)
                } else if (prefix == b'-' && !staged) || (prefix == b'+' && staged) {
                    Some(' ')
                } else {
                    None
                }
            }
            b'\\' if previous_included => {
                output.push_str(line);
                continue;
            }
            b'\\' => None,
            _ => return Err("差异行格式无效".into()),
        };
        previous_included = mapped.is_some();
        if let Some(kind) = mapped {
            old_count += usize::from(kind != '+');
            new_count += usize::from(kind != '-');
            output.push(kind);
            output.push_str(&line[1..]);
        }
    }
    if positions.iter().any(|position| *position >= change_index) {
        return Err("差异行选择已过期，请刷新后重试。".into());
    }
    Ok(format!(
        "{file_header}@@ -{old_start},{old_count} +{new_start},{new_count} @@\n{output}"
    ))
}
#[derive(Serialize)]
pub struct Checkpoint {
    pub revision: String,
    pub label: String,
}
pub async fn checkpoints(root: &str, proxy: &str) -> Result<Vec<Checkpoint>, String> {
    let rows = run(
        root,
        proxy,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--count=100",
            "--format=%(refname)%09%(subject)",
            "refs/fluxcode/checkpoints/",
        ],
    )
    .await?;
    Ok(rows
        .lines()
        .filter_map(|row| {
            row.split_once('\t').map(|(revision, label)| Checkpoint {
                revision: revision.into(),
                label: label.into(),
            })
        })
        .collect())
}
async fn checkpoint(root: &str, proxy: &str, label: &str) -> Result<String, String> {
    if label.trim().is_empty() || label.len() > 200 || label.contains(['\n', '\r']) {
        return Err("Invalid checkpoint label".into());
    }
    let git_dir = run(root, proxy, &["rev-parse", "--absolute-git-dir"]).await?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let index = Path::new(&git_dir).join(format!("fluxcode-index-{stamp}"));
    let index_text = index.to_str().ok_or("Invalid repository path")?;
    let env = [
        ("GIT_INDEX_FILE", index_text),
        ("GIT_AUTHOR_NAME", "FluxCode"),
        ("GIT_AUTHOR_EMAIL", "checkpoint@fluxcode.local"),
        ("GIT_COMMITTER_NAME", "FluxCode"),
        ("GIT_COMMITTER_EMAIL", "checkpoint@fluxcode.local"),
    ];
    let result = async {
        run_env(root, proxy, &["add", "-A", "--", "."], &env).await?;
        let tree = run_env(root, proxy, &["write-tree"], &env).await?;
        let commit = run_env(root, proxy, &["commit-tree", &tree, "-m", label], &env).await?;
        let reference = format!("refs/fluxcode/checkpoints/{stamp}");
        run(root, proxy, &["update-ref", &reference, &commit]).await?;
        Ok(reference)
    }
    .await;
    match tokio::fs::remove_file(&index).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => tracing::warn!("checkpoint_index_cleanup_failed"),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_errors_are_actionable_without_echoing_remote_secrets() {
        let raw = b"fatal: Authentication failed for 'https://account:secret@example.com/repo?token=private'";
        let message = git_failure(raw, Some(128));
        assert!(message.contains("身份验证失败"));
        assert!(message.contains("128"));
        assert!(!message.contains("secret"));
        assert!(!message.contains("private"));
        assert!(!message.contains("example.com"));
        assert!(git_failure(b"fatal: not a git repository", Some(128)).contains("不是 Git 仓库"));
        assert!(git_failure(b"unexpected remote text", None).contains("检查仓库状态"));
    }

    #[tokio::test]
    async fn unstaging_a_rename_restores_both_index_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("old.txt"), "original\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "old.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        run(root, proxy, &["mv", "old.txt", "new.txt"])
            .await
            .unwrap();
        apply(
            root,
            proxy,
            GitAction::Unstage {
                path: "new.txt".into(),
            },
        )
        .await
        .unwrap();
        assert!(
            run(root, proxy, &["diff", "--cached", "--name-only"])
                .await
                .unwrap()
                .is_empty()
        );
        assert!(dir.path().join("new.txt").is_file());
    }

    #[tokio::test]
    async fn merge_rejects_non_repo_empty_repo_detached_head_and_dirty_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        assert!(
            operation(root, proxy)
                .await
                .err()
                .expect("not a repository")
                .contains("Git")
        );
        run(root, proxy, &["init"]).await.unwrap();
        let empty = apply(
            root,
            proxy,
            GitAction::Merge {
                branch: "feature".into(),
            },
        )
        .await
        .unwrap_err();
        assert!(empty.contains("Git") || empty.contains("分支"));
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "base\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        run(root, proxy, &["branch", "feature"]).await.unwrap();
        run(root, proxy, &["switch", "--detach", "HEAD"])
            .await
            .unwrap();
        let detached = apply(
            root,
            proxy,
            GitAction::Merge {
                branch: "feature".into(),
            },
        )
        .await
        .unwrap_err();
        assert!(detached.contains("当前分支"));
        run(root, proxy, &["switch", "-"]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "changed\n")
            .await
            .unwrap();
        let dirty = apply(
            root,
            proxy,
            GitAction::Merge {
                branch: "feature".into(),
            },
        )
        .await
        .unwrap_err();
        assert!(dirty.contains("未提交变更"));
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("file.txt"))
                .await
                .unwrap(),
            "changed\n"
        );
    }

    #[tokio::test]
    async fn hunk_staging_preserves_other_changes_and_rejects_stale_diff() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        let original = (0..30).map(|i| format!("line {i}\n")).collect::<String>();
        tokio::fs::write(dir.path().join("file.txt"), &original)
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(
            root,
            proxy,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@local",
                "commit",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        let edited = original
            .replace("line 1\n", "first change\n")
            .replace("line 25\n", "second change\n");
        tokio::fs::write(dir.path().join("file.txt"), &edited)
            .await
            .unwrap();
        let expected = workspace::diff(root, "file.txt", false).await.unwrap();
        assert_eq!(
            expected
                .lines()
                .filter(|line| line.starts_with("@@ "))
                .count(),
            2
        );
        apply(
            root,
            proxy,
            GitAction::Hunk {
                path: "file.txt".into(),
                expected: expected.clone(),
                index: 0,
                staged: false,
            },
        )
        .await
        .unwrap();
        let staged = workspace::diff(root, "file.txt", true).await.unwrap();
        assert!(staged.contains("+first change"));
        assert!(!staged.contains("+second change"));
        assert!(
            apply(
                root,
                proxy,
                GitAction::Hunk {
                    path: "file.txt".into(),
                    expected,
                    index: 1,
                    staged: false
                }
            )
            .await
            .is_err()
        );
        apply(
            root,
            proxy,
            GitAction::Hunk {
                path: "file.txt".into(),
                expected: staged,
                index: 0,
                staged: true,
            },
        )
        .await
        .unwrap();
        assert!(
            workspace::diff(root, "file.txt", true)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("file.txt"))
                .await
                .unwrap(),
            edited
        );
        assert!(
            selected_hunk(
                "diff --git a/a b/a\nnew file mode 100644\n@@ -0,0 +1 @@\n+new\n",
                0
            )
            .is_err()
        );
        assert!(selected_hunk("", 0).is_err());
    }
    #[tokio::test]
    async fn line_staging_handles_mixed_replacements_and_reverse_selection() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "alpha\nbeta\ngamma\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(
            root,
            proxy,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@local",
                "commit",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "alpha\nBETA\ngamma\n")
            .await
            .unwrap();
        let expected = workspace::diff(root, "file.txt", false).await.unwrap();
        assert!(selected_lines(&expected, 0, &[2], false).is_err());
        assert!(selected_lines(&expected, 0, &[0, 0], false).is_err());
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "file.txt".into(),
                expected: expected.clone(),
                index: 0,
                selected: vec![1],
                staged: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            run(root, proxy, &["show", ":file.txt"]).await.unwrap(),
            "alpha\nbeta\nBETA\ngamma"
        );
        assert!(
            apply(
                root,
                proxy,
                GitAction::Lines {
                    path: "file.txt".into(),
                    expected,
                    index: 0,
                    selected: vec![0],
                    staged: false,
                }
            )
            .await
            .is_err()
        );
        let remaining = workspace::diff(root, "file.txt", false).await.unwrap();
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "file.txt".into(),
                expected: remaining,
                index: 0,
                selected: vec![0],
                staged: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            run(root, proxy, &["show", ":file.txt"]).await.unwrap(),
            "alpha\nBETA\ngamma"
        );
        let staged = workspace::diff(root, "file.txt", true).await.unwrap();
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "file.txt".into(),
                expected: staged,
                index: 0,
                selected: vec![1],
                staged: true,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            run(root, proxy, &["show", ":file.txt"]).await.unwrap(),
            "alpha\ngamma"
        );
        let staged = workspace::diff(root, "file.txt", true).await.unwrap();
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "file.txt".into(),
                expected: staged,
                index: 0,
                selected: vec![0],
                staged: true,
            },
        )
        .await
        .unwrap();
        assert!(
            workspace::diff(root, "file.txt", true)
                .await
                .unwrap()
                .is_empty()
        );
    }
    #[tokio::test]
    async fn line_staging_handles_crlf_and_unicode_without_touching_other_lines() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "core.autocrlf", "false"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("中文 file.txt"), "甲\r\n乙\r\n丙\r\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "中文 file.txt"]).await.unwrap();
        run(
            root,
            proxy,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@local",
                "commit",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        tokio::fs::write(dir.path().join("中文 file.txt"), "甲\r\n新的乙\r\n丙\r\n")
            .await
            .unwrap();
        let expected = workspace::diff(root, "中文 file.txt", false).await.unwrap();
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "中文 file.txt".into(),
                expected,
                index: 0,
                selected: vec![0, 1],
                staged: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            run(root, proxy, &["show", ":中文 file.txt"]).await.unwrap(),
            "甲\r\n新的乙\r\n丙"
        );
    }
    #[tokio::test]
    async fn line_staging_preserves_missing_final_newline() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "before")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(
            root,
            proxy,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@local",
                "commit",
                "-m",
                "initial",
            ],
        )
        .await
        .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "after")
            .await
            .unwrap();
        let expected = workspace::diff(root, "file.txt", false).await.unwrap();
        apply(
            root,
            proxy,
            GitAction::Lines {
                path: "file.txt".into(),
                expected,
                index: 0,
                selected: vec![0, 1],
                staged: false,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            run(root, proxy, &["show", ":file.txt"]).await.unwrap(),
            "after"
        );
        assert!(
            workspace::diff(root, "file.txt", false)
                .await
                .unwrap()
                .is_empty()
        );
    }
    #[tokio::test]
    async fn merge_conflict_can_be_resolved_and_completed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "base\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        let main = run(root, proxy, &["branch", "--show-current"])
            .await
            .unwrap();
        run(root, proxy, &["switch", "-c", "feature"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "feature\n")
            .await
            .unwrap();
        run(root, proxy, &["commit", "-am", "feature"])
            .await
            .unwrap();
        run(root, proxy, &["switch", &main]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "main\n")
            .await
            .unwrap();
        assert!(
            apply(
                root,
                proxy,
                GitAction::Merge {
                    branch: "feature".into()
                }
            )
            .await
            .is_err()
        );
        run(root, proxy, &["commit", "-am", "main"]).await.unwrap();
        assert!(
            apply(
                root,
                proxy,
                GitAction::Merge {
                    branch: "feature".into()
                }
            )
            .await
            .is_err()
        );
        let state = operation(root, proxy).await.unwrap();
        assert_eq!(state.kind.as_deref(), Some("merge"));
        assert_eq!(state.conflicts, vec!["file.txt"]);
        let versions = conflict_versions(root, proxy, "file.txt").await.unwrap();
        assert_eq!(versions.base.as_deref(), Some("base\n"));
        assert_eq!(versions.current.as_deref(), Some("main\n"));
        assert_eq!(
            versions
                .incoming
                .as_deref()
                .map(|value| value.replace("\r\n", "\n")),
            Some("feature\n".to_owned())
        );
        assert!(
            apply(
                root,
                proxy,
                GitAction::Stage {
                    path: "file.txt".into()
                }
            )
            .await
            .unwrap_err()
            .contains("冲突标记")
        );
        assert_eq!(
            operation(root, proxy).await.unwrap().conflicts,
            vec!["file.txt"]
        );
        apply(
            root,
            proxy,
            GitAction::ResolveConflict {
                path: "file.txt".into(),
                version: "ours".into(),
            },
        )
        .await
        .unwrap();
        assert!(operation(root, proxy).await.unwrap().conflicts.is_empty());
        apply(root, proxy, GitAction::ContinueOperation)
            .await
            .unwrap();
        assert!(operation(root, proxy).await.unwrap().kind.is_none());
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("file.txt"))
                .await
                .unwrap()
                .replace("\r\n", "\n"),
            "main\n"
        );
    }

    #[test]
    fn conflict_marker_check_ignores_plain_separator_text() {
        assert!(has_unresolved_markers(
            "<<<<<<< HEAD\r\nleft\r\n=======\r\nright\r\n>>>>>>> branch\r\n"
        ));
        assert!(!has_unresolved_markers(
            "normal text\n======= extra text\nvalue >>>>>>> branch\n"
        ));
    }

    #[tokio::test]
    async fn rebase_abort_refuses_to_discard_unrelated_tracked_work() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "base\n")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("unrelated.txt"), "original\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt", "unrelated.txt"])
            .await
            .unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        let main = run(root, proxy, &["branch", "--show-current"])
            .await
            .unwrap();
        run(root, proxy, &["switch", "-c", "feature"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "feature\n")
            .await
            .unwrap();
        run(root, proxy, &["commit", "-am", "feature"])
            .await
            .unwrap();
        run(root, proxy, &["switch", &main]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "main\n")
            .await
            .unwrap();
        run(root, proxy, &["commit", "-am", "main"]).await.unwrap();
        run(root, proxy, &["switch", "feature"]).await.unwrap();
        let before = run(root, proxy, &["rev-parse", "HEAD"]).await.unwrap();
        assert!(
            apply(root, proxy, GitAction::Rebase { branch: main })
                .await
                .is_err()
        );
        assert_eq!(
            operation(root, proxy).await.unwrap().kind.as_deref(),
            Some("rebase")
        );
        tokio::fs::write(dir.path().join("untracked.txt"), "preserve")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("unrelated.txt"), "new work\n")
            .await
            .unwrap();
        let refusal = apply(root, proxy, GitAction::AbortOperation)
            .await
            .unwrap_err();
        assert!(refusal.contains("unrelated.txt"));
        assert_eq!(
            operation(root, proxy).await.unwrap().kind.as_deref(),
            Some("rebase")
        );
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("unrelated.txt"))
                .await
                .unwrap(),
            "new work\n"
        );
        tokio::fs::write(dir.path().join("unrelated.txt"), "original\n")
            .await
            .unwrap();
        apply(root, proxy, GitAction::AbortOperation).await.unwrap();
        assert!(operation(root, proxy).await.unwrap().kind.is_none());
        assert!(
            checkpoints(root, proxy)
                .await
                .unwrap()
                .iter()
                .any(|checkpoint| checkpoint.label == "Before aborting Git operation")
        );
        assert_eq!(
            run(root, proxy, &["rev-parse", "HEAD"]).await.unwrap(),
            before
        );
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("untracked.txt"))
                .await
                .unwrap(),
            "preserve"
        );
    }
    #[tokio::test]
    async fn deleted_conflict_side_can_be_selected() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "base\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        let main = run(root, proxy, &["branch", "--show-current"])
            .await
            .unwrap();
        run(root, proxy, &["switch", "-c", "deletion"])
            .await
            .unwrap();
        run(root, proxy, &["rm", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "delete"]).await.unwrap();
        run(root, proxy, &["switch", &main]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "modified\n")
            .await
            .unwrap();
        run(root, proxy, &["commit", "-am", "modify"])
            .await
            .unwrap();
        assert!(
            apply(
                root,
                proxy,
                GitAction::Merge {
                    branch: "deletion".into()
                }
            )
            .await
            .is_err()
        );
        let versions = conflict_versions(root, proxy, "file.txt").await.unwrap();
        assert_eq!(versions.current.as_deref(), Some("modified\n"));
        assert_eq!(versions.incoming, None);
        apply(
            root,
            proxy,
            GitAction::ResolveConflict {
                path: "file.txt".into(),
                version: "theirs".into(),
            },
        )
        .await
        .unwrap();
        assert!(!dir.path().join("file.txt").exists());
        assert!(operation(root, proxy).await.unwrap().conflicts.is_empty());
        apply(root, proxy, GitAction::ContinueOperation)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn manual_resolution_recreates_deleted_working_file_and_rejects_stale_edits() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        run(root, proxy, &["config", "user.name", "Fixture"])
            .await
            .unwrap();
        run(root, proxy, &["config", "user.email", "fixture@local"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "base\n")
            .await
            .unwrap();
        run(root, proxy, &["add", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "base"]).await.unwrap();
        let main = run(root, proxy, &["branch", "--show-current"])
            .await
            .unwrap();
        run(root, proxy, &["switch", "-c", "feature"])
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "feature\n")
            .await
            .unwrap();
        run(root, proxy, &["commit", "-am", "feature"])
            .await
            .unwrap();
        run(root, proxy, &["switch", &main]).await.unwrap();
        run(root, proxy, &["rm", "file.txt"]).await.unwrap();
        run(root, proxy, &["commit", "-m", "delete"]).await.unwrap();
        assert!(
            apply(
                root,
                proxy,
                GitAction::Merge {
                    branch: "feature".into()
                }
            )
            .await
            .is_err()
        );
        tokio::fs::remove_file(dir.path().join("file.txt"))
            .await
            .unwrap();
        let versions = conflict_versions(root, proxy, "file.txt").await.unwrap();
        assert_eq!(versions.working, None);
        assert_eq!(
            versions
                .incoming
                .as_deref()
                .map(|value| value.replace("\r\n", "\n")),
            Some("feature\n".to_owned())
        );
        assert!(
            apply(
                root,
                proxy,
                GitAction::ResolveEdited {
                    path: "file.txt".into(),
                    expected: Some("stale".into()),
                    content: "merged\n".into(),
                }
            )
            .await
            .is_err()
        );
        assert!(!dir.path().join("file.txt").exists());
        apply(
            root,
            proxy,
            GitAction::ResolveEdited {
                path: "file.txt".into(),
                expected: None,
                content: "merged\n".into(),
            },
        )
        .await
        .unwrap();
        assert!(operation(root, proxy).await.unwrap().conflicts.is_empty());
        assert_eq!(
            run(root, proxy, &["show", ":file.txt"]).await.unwrap(),
            "merged"
        );
        apply(root, proxy, GitAction::ContinueOperation)
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn checkpoints_preserve_index_and_restore_one_file_with_backup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let proxy = "";
        run(root, proxy, &["init"]).await.unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "初始内容")
            .await
            .unwrap();
        apply(
            root,
            proxy,
            GitAction::Stage {
                path: "file.txt".into(),
            },
        )
        .await
        .unwrap();
        apply(
            root,
            proxy,
            GitAction::Unstage {
                path: "file.txt".into(),
            },
        )
        .await
        .unwrap();
        assert!(dir.path().join("file.txt").exists());
        apply(
            root,
            proxy,
            GitAction::Stage {
                path: "file.txt".into(),
            },
        )
        .await
        .unwrap();
        let index = tokio::fs::read(dir.path().join(".git/index"))
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("file.txt"), "检查点内容")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("new.txt"), "untracked")
            .await
            .unwrap();
        let reference = checkpoint(root, proxy, "Test checkpoint").await.unwrap();
        assert_eq!(
            index,
            tokio::fs::read(dir.path().join(".git/index"))
                .await
                .unwrap()
        );
        tokio::fs::write(dir.path().join("file.txt"), "later edit")
            .await
            .unwrap();
        apply(
            root,
            proxy,
            GitAction::RestoreCheckpoint {
                revision: reference,
                path: "file.txt".into(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("file.txt"))
                .await
                .unwrap(),
            "检查点内容"
        );
        assert_eq!(
            tokio::fs::read_to_string(dir.path().join("new.txt"))
                .await
                .unwrap(),
            "untracked"
        );
        assert_eq!(checkpoints(root, proxy).await.unwrap().len(), 2);
        assert_eq!(
            index,
            tokio::fs::read(dir.path().join(".git/index"))
                .await
                .unwrap()
        );
        assert!(
            apply(
                root,
                proxy,
                GitAction::RestoreCheckpoint {
                    revision: "HEAD".into(),
                    path: "file.txt".into()
                }
            )
            .await
            .is_err()
        );
    }

    #[test]
    fn paths_reject_escape_and_allow_spaces() {
        assert!(relative("src/a b.ts").is_ok());
        for p in ["", "../a", "/a", "D:\\a"] {
            assert!(relative(p).is_err());
        }
    }
}

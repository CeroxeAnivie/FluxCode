use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    directory: bool,
}
#[derive(Serialize)]
pub struct Change {
    path: String,
    status: String,
}
#[derive(Serialize)]
pub struct RepoStatus {
    branch: String,
    changes: Vec<Change>,
    git: bool,
}

pub fn scoped_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root = Path::new(root)
        .canonicalize()
        .map_err(|_| "项目目录不存在")?;
    if !root.is_dir() {
        return Err("项目路径不是目录".into());
    }
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "文件或目录不存在")?;
    if !target.starts_with(&root) {
        return Err("不能访问项目目录之外的文件".into());
    }
    Ok(target)
}

pub async fn list(root: &str, relative: &str) -> Result<Vec<Entry>, String> {
    let path = scoped_path(root, relative)?;
    let canonical_root = scoped_path(root, "")?;
    let mut dir = tokio::fs::read_dir(path).await.map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    while let Some(entry) = dir.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(
            name.as_str(),
            ".git" | "node_modules" | "target" | ".toolchains"
        ) {
            continue;
        }
        let Ok(resolved) = entry.path().canonicalize() else {
            continue;
        };
        if !resolved.starts_with(&canonical_root) {
            continue;
        }
        let directory = resolved.is_dir();
        let entry_path = entry.path();
        let path = entry_path
            .strip_prefix(&canonical_root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(Entry {
            name,
            path,
            directory,
        });
        if entries.len() > 3000 {
            return Err("目录条目超过 3000，请打开更具体的子目录".into());
        }
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub async fn read(root: &str, relative: &str) -> Result<String, String> {
    let path = scoped_path(root, relative)?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1_048_576 {
        return Err("文件超过 1 MiB，暂不提供预览".into());
    }
    if bytes.contains(&0) {
        return Err("此文件为二进制，暂不提供预览".into());
    }
    String::from_utf8(bytes).map_err(|_| "文件不是有效 UTF-8，未尝试转换或修改".into())
}

async fn git(root: &str, args: &[&str]) -> Result<(bool, Vec<u8>), String> {
    let path = scoped_path(root, "")?;
    let mut command = Command::new("git");
    command
        .current_dir(path)
        .args(["--no-optional-locks", "-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|e| format!("Git 不可用：{e}"))?;
    let stdout = child.stdout.take().ok_or("Git 输出不可用")?;
    let mut bytes = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(10),
        stdout.take(2_097_153).read_to_end(&mut bytes),
    )
    .await
    .map_err(|_| "Git 查询超时")?
    .map_err(|e| e.to_string())?;
    if bytes.len() > 2_097_152 {
        return Err("Git 输出超过 2 MiB，请在终端查看".into());
    }
    let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .map_err(|_| "Git 查询超时")?
        .map_err(|e| e.to_string())?;
    Ok((status.success(), bytes))
}

pub async fn status(root: &str) -> Result<RepoStatus, String> {
    let (ok, bytes) = git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )
    .await?;
    if !ok {
        return Ok(RepoStatus {
            branch: "无 Git 仓库".into(),
            changes: vec![],
            git: false,
        });
    }
    let changes = parse_status(&bytes);
    let (_, branch) = git(root, &["branch", "--show-current"]).await?;
    Ok(RepoStatus {
        branch: String::from_utf8_lossy(&branch).trim().to_string(),
        changes,
        git: true,
    })
}

fn parse_status(bytes: &[u8]) -> Vec<Change> {
    let mut records = bytes.split(|b| *b == 0);
    let mut changes = Vec::new();
    while let Some(row) = records.next() {
        if row.len() < 4 {
            continue;
        }
        changes.push(Change {
            status: String::from_utf8_lossy(&row[..2]).to_string(),
            path: String::from_utf8_lossy(&row[3..]).to_string(),
        });
        if row[..2].iter().any(|b| *b == b'R' || *b == b'C') {
            records.next();
        }
    }
    changes
}

pub async fn diff(root: &str, relative: &str, staged: bool) -> Result<String, String> {
    // Deleted paths need not exist; forbid traversal lexically before passing argv to Git.
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("无效的项目相对路径".into());
    }
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", relative]);
    let (ok, bytes) = git(root, &args).await?;
    if !ok {
        return Err("无法读取 Git 差异".into());
    }
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[derive(serde::Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub preview: String,
}
#[derive(serde::Serialize)]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}
pub async fn search(root: &str, query: &str, contents: bool) -> Result<SearchResults, String> {
    if query.trim().is_empty() || query.len() > 200 {
        return Err("搜索内容为空或过长".into());
    }
    let root_path = scoped_path(root, "")?;
    let walk_root = root_path.clone();
    let (mut paths, mut truncated) = tokio::task::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        let mut paths = Vec::new();
        let mut truncated = false;
        let walker = ignore::WalkBuilder::new(&walk_root)
            .hidden(false)
            .follow_links(false)
            .max_depth(Some(64))
            .filter_entry(|entry| {
                !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "node_modules" | "target" | ".toolchains")
                )
            })
            .build();
        for entry in walker {
            if paths.len() >= 100_000 || std::time::Instant::now() >= deadline {
                truncated = true;
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    truncated = true;
                    continue;
                }
            };
            if entry.file_type().is_some_and(|kind| kind.is_file())
                && let Ok(relative) = entry.path().strip_prefix(&walk_root)
            {
                paths.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
        (paths, truncated)
    })
    .await
    .map_err(|_| "搜索目录失败")?;
    paths.sort();
    paths.dedup();
    let mut hits = vec![];
    let lowercase_query = query.to_lowercase();
    let mut scanned_bytes = 0_u64;
    for path in paths {
        if !contents {
            if path.to_lowercase().contains(&lowercase_query) {
                hits.push(SearchHit {
                    path,
                    line: 0,
                    preview: String::new(),
                });
            }
        } else {
            let Ok(resolved) = scoped_path(root, &path) else {
                continue;
            };
            let Ok(metadata) = tokio::fs::metadata(&resolved).await else {
                continue;
            };
            if metadata.len() > 1_048_576 || !metadata.is_file() {
                continue;
            }
            scanned_bytes += metadata.len();
            if scanned_bytes > 128 * 1024 * 1024 {
                truncated = true;
                break;
            }
            let Ok(file) = tokio::fs::File::open(resolved).await else {
                continue;
            };
            let mut bytes = Vec::new();
            if file.take(1_048_577).read_to_end(&mut bytes).await.is_err()
                || bytes.len() > 1_048_576
            {
                continue;
            }
            let Ok(text) = String::from_utf8(bytes) else {
                continue;
            };
            if text.contains('\0') {
                continue;
            }
            for (index, line) in text.lines().enumerate() {
                if line.contains(query) {
                    hits.push(SearchHit {
                        path: path.clone(),
                        line: index + 1,
                        preview: line.chars().take(240).collect(),
                    });
                    if hits.len() >= 100 {
                        break;
                    }
                }
            }
        }
        if hits.len() >= 100 {
            truncated = true;
            break;
        }
    }
    Ok(SearchResults { hits, truncated })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn search_respects_ignore_and_finds_files_past_old_limit() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        tokio::fs::create_dir(dir.path().join(".git"))
            .await
            .unwrap();
        tokio::fs::write(dir.path().join(".gitignore"), "ignored.txt\n")
            .await
            .unwrap();
        tokio::fs::write(dir.path().join("ignored.txt"), "needle")
            .await
            .unwrap();
        for index in 0..5100 {
            std::fs::write(dir.path().join(format!("file-{index:05}.txt")), "").unwrap();
        }
        tokio::fs::write(dir.path().join("z-needle.txt"), "needle")
            .await
            .unwrap();
        let found = search(root, "z-needle", false).await.unwrap();
        assert_eq!(found.hits.len(), 1);
        assert!(!found.truncated);
        let contents = search(root, "needle", true).await.unwrap();
        assert_eq!(contents.hits.len(), 1);
        assert_eq!(contents.hits[0].path, "z-needle.txt");
    }
    #[test]
    fn traversal_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(scoped_path(dir.path().to_str().unwrap(), "..").is_err());
        assert!(scoped_path(dir.path().to_str().unwrap(), "missing").is_err());
    }
    #[test]
    fn porcelain_handles_spaces_and_renames() {
        let entries = parse_status(b" M hello world.rs\0R  new.rs\0old.rs\0?? test.rs\0");
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "hello world.rs");
        assert_eq!(entries[1].path, "new.rs");
    }
    #[tokio::test]
    async fn text_preview_rejects_binary_and_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        tokio::fs::write(dir.path().join("good"), "中文")
            .await
            .unwrap();
        assert_eq!(read(root, "good").await.unwrap(), "中文");
        tokio::fs::write(dir.path().join("bad"), [255, 254])
            .await
            .unwrap();
        assert!(read(root, "bad").await.is_err());
        tokio::fs::write(dir.path().join("binary"), [0, 1])
            .await
            .unwrap();
        assert!(read(root, "binary").await.is_err());
    }
}

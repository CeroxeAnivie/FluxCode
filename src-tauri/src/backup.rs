//! Bounded, verified snapshots of application-owned data. WebView state is supplied by the UI.
use rusqlite::{Connection, OpenFlags, backup::Backup};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_FILES: usize = 100_000;
const MAX_BYTES: u64 = 5 * 1024 * 1024 * 1024;
const MAX_UI_BYTES: usize = 16 * 1024 * 1024;
const MAX_DEPTH: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub id: String,
    pub created_at: u64,
    pub size_bytes: u64,
    pub file_count: usize,
    pub automatic: bool,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackupStage {
    Preparing,
    Copying,
    Publishing,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub stage: BackupStage,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDetail {
    pub summary: BackupSummary,
    pub files: Vec<BackupFile>,
    pub total_files: usize,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    id: String,
    created_at: u64,
    automatic: bool,
    files: Vec<Entry>,
}

impl Manifest {
    fn summary(&self) -> BackupSummary {
        BackupSummary {
            id: self.id.clone(),
            created_at: self.created_at,
            size_bytes: self.files.iter().map(|file| file.size).sum(),
            file_count: self.files.len(),
            automatic: self.automatic,
            error: None,
        }
    }
}

fn error(context: &str, cause: impl std::fmt::Display) -> String {
    format!("{context}: {cause}")
}

fn now() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|cause| error("系统时间无效", cause))?
        .as_millis() as u64)
}

fn valid_id(id: &str) -> bool {
    id.len() >= 13 && id.len() <= 48 && id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-')
}

fn plain_file(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|cause| error("无法读取备份文件", cause))?;
    #[cfg(windows)]
    if is_reparse(&metadata) {
        return Err("备份包含链接文件，操作已停止".into());
    }
    if !metadata.file_type().is_file() {
        return Err("备份包含非普通文件或链接，操作已停止".into());
    }
    Ok(metadata)
}

fn plain_dir(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|cause| error("无法读取备份目录", cause))?;
    #[cfg(windows)]
    if is_reparse(&metadata) {
        return Err("备份包含链接目录，操作已停止".into());
    }
    if !metadata.file_type().is_dir() {
        return Err("备份包含非普通目录或链接，操作已停止".into());
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

fn safe_relative(path: &str) -> Result<PathBuf, String> {
    let value = Path::new(path);
    if value.as_os_str().is_empty()
        || !value
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("备份文件路径无效".into());
    }
    Ok(value.to_path_buf())
}

fn hash(path: &Path) -> Result<(u64, String), String> {
    let mut file = File::open(path).map_err(|cause| error("无法读取备份文件", cause))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut size = 0u64;
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|cause| error("备份文件读取失败", cause))?;
        if count == 0 {
            break;
        }
        size = size.checked_add(count as u64).ok_or("备份容量超限")?;
        if size > MAX_BYTES {
            return Err("备份容量超限".into());
        }
        digest.update(&buffer[..count]);
    }
    Ok((size, format!("{:x}", digest.finalize())))
}

fn verify_sqlite(path: &Path) -> Result<(), String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|cause| error("无法打开数据库快照", cause))?;
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|cause| error("数据库快照校验失败", cause))?;
    if result != "ok" {
        return Err(format!("数据库快照校验失败：{result}"));
    }
    Ok(())
}

fn record(
    stage: &Path,
    relative: &Path,
    files: &mut Vec<Entry>,
    total: &mut u64,
) -> Result<(), String> {
    if files.len() >= MAX_FILES {
        return Err("备份文件数量超限".into());
    }
    let name = relative
        .to_str()
        .ok_or("备份路径必须使用 Unicode")?
        .to_owned();
    safe_relative(&name)?;
    let (size, sha256) = hash(&stage.join(relative))
        .map_err(|cause| error(&format!("无法校验备份文件 {}", relative.display()), cause))?;
    *total = total.checked_add(size).ok_or("备份容量超限")?;
    if *total > MAX_BYTES {
        return Err("备份容量超限".into());
    }
    files.push(Entry {
        path: name,
        size,
        sha256,
    });
    Ok(())
}

fn copy_data(
    root: &Path,
    stage: &Path,
    relative: &Path,
    depth: usize,
    files: &mut Vec<Entry>,
    total: &mut u64,
    report: &mut dyn FnMut(BackupProgress) -> Result<(), String>,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("数据目录层级过深".into());
    }
    let source = root.join(relative);
    plain_dir(&source)?;
    for item in fs::read_dir(source).map_err(|cause| error("无法遍历数据目录", cause))? {
        report(BackupProgress {
            stage: BackupStage::Copying,
            files: files.len(),
            bytes: *total,
        })?;
        let item = item.map_err(|cause| error("无法遍历数据目录", cause))?;
        let next = relative.join(item.file_name());
        if depth == 0
            && matches!(
                item.file_name().to_str(),
                Some(
                    "backups"
                        | "webview"
                        | "logs"
                        | "pending-restore.toml"
                        | "restore-ui.json"
                        | "restore-unconfirmed.toml"
                )
            )
        {
            continue;
        }
        if depth == 1
            && relative == Path::new("engine-home")
            && matches!(
                item.file_name().to_str(),
                Some(".tmp" | "tmp" | "thread-writer-locks")
            )
        {
            continue;
        }
        let source = root.join(&next);
        let metadata =
            fs::symlink_metadata(&source).map_err(|cause| error("无法读取数据文件", cause))?;
        #[cfg(windows)]
        if is_reparse(&metadata) {
            return Err("数据目录包含链接，备份已停止".into());
        }
        if metadata.file_type().is_dir() {
            fs::create_dir(stage.join(&next)).map_err(|cause| error("无法创建备份目录", cause))?;
            copy_data(root, stage, &next, depth + 1, files, total, report)?;
        } else if metadata.file_type().is_file() {
            let name = item.file_name();
            let name = name.to_string_lossy();
            if name.ends_with("-wal")
                || name.ends_with("-shm")
                || name.ends_with(".tmp")
                || name == "auth.json"
            {
                continue;
            }
            let destination = stage.join(&next);
            if name.ends_with(".sqlite") {
                let source = Connection::open_with_flags(&source, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|cause| error("无法打开会话数据库", cause))?;
                source
                    .busy_timeout(Duration::from_secs(5))
                    .map_err(|cause| error("数据库等待失败", cause))?;
                let mut target = Connection::open(&destination)
                    .map_err(|cause| error("无法创建数据库快照", cause))?;
                Backup::new(&source, &mut target)
                    .and_then(|backup| {
                        backup.run_to_completion(100, Duration::from_millis(25), None)
                    })
                    .map_err(|cause| error("数据库快照失败", cause))?;
                target
                    .pragma_update(None, "journal_mode", "DELETE")
                    .map_err(|cause| error("数据库快照日志模式切换失败", cause))?;
                let mode: String = target
                    .pragma_query_value(None, "journal_mode", |row| row.get(0))
                    .map_err(|cause| error("数据库快照日志模式检查失败", cause))?;
                if !mode.eq_ignore_ascii_case("delete") {
                    return Err("数据库快照未能关闭 WAL 日志模式".into());
                }
                drop(target);
                verify_sqlite(&destination)?;
            } else {
                if metadata.len() > MAX_BYTES {
                    return Err("备份容量超限".into());
                }
                fs::copy(&source, &destination).map_err(|cause| {
                    error(&format!("无法复制数据文件 {}", next.display()), cause)
                })?;
                if plain_file(&source)
                    .map_err(|cause| error(&format!("无法检查数据文件 {}", next.display()), cause))?
                    .len()
                    != metadata.len()
                    || hash(&source).map_err(|cause| {
                        error(&format!("无法校验源文件 {}", next.display()), cause)
                    })? != hash(&destination).map_err(|cause| {
                        error(&format!("无法校验备份文件 {}", next.display()), cause)
                    })?
                {
                    return Err("数据文件在备份时发生变化，请稍后重试".into());
                }
            }
            record(stage, &next, files, total)?;
            report(BackupProgress {
                stage: BackupStage::Copying,
                files: files.len(),
                bytes: *total,
            })?;
        } else {
            return Err("数据目录包含链接或特殊文件，备份已停止".into());
        }
    }
    Ok(())
}

fn manifest_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("备份编号无效".into());
    }
    Ok(root.join("backups").join(id).join("manifest.toml"))
}

fn read_manifest(root: &Path, id: &str) -> Result<Manifest, String> {
    let path = manifest_path(root, id)?;
    plain_dir(path.parent().ok_or("备份目录无效")?)?;
    if plain_file(&path)?.len() > 16 * 1024 * 1024 {
        return Err("备份清单过大".into());
    }
    let text = fs::read_to_string(path).map_err(|cause| error("无法读取备份清单", cause))?;
    let manifest: Manifest = toml_edit::de::from_str(&text).map_err(|_| "备份清单格式无效")?;
    if manifest.schema_version != 1 || manifest.id != id || manifest.files.len() > MAX_FILES {
        return Err("备份版本或编号不匹配".into());
    }
    let mut total = 0u64;
    for entry in &manifest.files {
        total = total.checked_add(entry.size).ok_or("备份清单容量超限")?;
        if total > MAX_BYTES {
            return Err("备份清单容量超限".into());
        }
    }
    Ok(manifest)
}

pub fn list(root: &Path) -> Result<Vec<BackupSummary>, String> {
    let directory = root.join("backups");
    if !directory.exists() {
        return Ok(vec![]);
    }
    plain_dir(&directory)?;
    let mut result = Vec::new();
    for item in fs::read_dir(directory).map_err(|cause| error("无法读取备份列表", cause))? {
        let item = item.map_err(|cause| error("无法读取备份列表", cause))?;
        if let Some(id) = item.file_name().to_str().filter(|id| valid_id(id)) {
            result.push(match read_manifest(root, id) {
                Ok(manifest) => manifest.summary(),
                Err(cause) => BackupSummary {
                    id: id.to_owned(),
                    created_at: 0,
                    size_bytes: 0,
                    file_count: 0,
                    automatic: false,
                    error: Some(cause),
                },
            });
        }
    }
    result.sort_by_key(|item| std::cmp::Reverse(item.created_at));
    Ok(result)
}

pub fn detail(root: &Path, id: &str, offset: usize, limit: usize) -> Result<BackupDetail, String> {
    if limit == 0 || limit > 100 {
        return Err("备份详情分页大小无效".into());
    }
    let manifest = read_manifest(root, id)?;
    let mut unique = HashSet::new();
    for entry in &manifest.files {
        if !unique.insert(safe_relative(&entry.path)?) {
            return Err("备份清单包含重复文件".into());
        }
    }
    let total_files = manifest.files.len();
    let files = manifest
        .files
        .iter()
        .skip(offset)
        .take(limit)
        .map(|entry| BackupFile {
            path: entry.path.clone(),
            size_bytes: entry.size,
            sha256: entry.sha256.clone(),
        })
        .collect();
    Ok(BackupDetail {
        summary: manifest.summary(),
        files,
        total_files,
    })
}

pub fn location(root: &Path) -> Result<PathBuf, String> {
    let path = root.join("backups");
    fs::create_dir_all(&path).map_err(|cause| error("无法创建备份目录", cause))?;
    plain_dir(&path)?;
    Ok(path)
}

pub fn validate_restore_ui_state(ui_state: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(raw) = ui_state.get("fluxcode.queue.v1") {
        let queue: serde_json::Value =
            serde_json::from_str(raw).map_err(|_| "待发送队列无法读取，请先修复本地队列数据。")?;
        match queue {
            serde_json::Value::Array(rows) if rows.is_empty() => {}
            serde_json::Value::Array(_) => {
                return Err("仍有待发送消息，请先处理或移除队列后再恢复。".into());
            }
            _ => return Err("待发送队列无法读取，请先修复本地队列数据。".into()),
        }
    }
    if let Some(raw) = ui_state.get("fluxcode.editor-drafts.v1") {
        let drafts: serde_json::Value = serde_json::from_str(raw)
            .map_err(|_| "文件编辑草稿无法读取，请先修复本地草稿数据。")?;
        match drafts {
            serde_json::Value::Object(rows) if rows.is_empty() => {}
            serde_json::Value::Object(_) => {
                return Err("仍有未保存的文件编辑，请先保存或放弃草稿后再恢复。".into());
            }
            _ => return Err("文件编辑草稿无法读取，请先修复本地草稿数据。".into()),
        }
    }
    Ok(())
}

pub fn create(
    root: &Path,
    ui_state: &BTreeMap<String, String>,
    automatic: bool,
) -> Result<BackupSummary, String> {
    create_with_progress(root, ui_state, automatic, &mut |_| Ok(()))
}

pub fn create_with_progress(
    root: &Path,
    ui_state: &BTreeMap<String, String>,
    automatic: bool,
    report: &mut dyn FnMut(BackupProgress) -> Result<(), String>,
) -> Result<BackupSummary, String> {
    report(BackupProgress {
        stage: BackupStage::Preparing,
        files: 0,
        bytes: 0,
    })?;
    for (key, value) in ui_state {
        if !key.starts_with("fluxcode.") || key.len() > 200 || value.len() > MAX_UI_BYTES {
            return Err("界面状态格式无效".into());
        }
    }
    let ui = serde_json::to_vec(ui_state).map_err(|cause| error("界面状态编码失败", cause))?;
    if ui.len() > MAX_UI_BYTES {
        return Err("界面状态超过备份上限".into());
    }
    let backups = root.join("backups");
    fs::create_dir_all(&backups).map_err(|cause| error("无法创建备份目录", cause))?;
    plain_dir(&backups)?;
    if automatic
        && let Some(latest) = list(root)?.into_iter().find(|item| item.automatic)
        && now()?.saturating_sub(latest.created_at) < 24 * 3600 * 1000
    {
        return Ok(latest);
    }
    let created_at = now()?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|cause| error("系统时间无效", cause))?
        .as_nanos();
    let id = format!("{nanos}-{}", std::process::id());
    let stage = backups.join(format!(".creating-{id}"));
    let final_path = backups.join(&id);
    if stage.exists() || final_path.exists() {
        return Err("备份编号冲突，请重试".into());
    }
    fs::create_dir(&stage).map_err(|cause| error("无法创建备份暂存目录", cause))?;
    let result: Result<BackupSummary, String> = (|| {
        let payload = stage.join("payload");
        fs::create_dir(&payload).map_err(|cause| error("无法创建备份内容目录", cause))?;
        let mut files = Vec::new();
        let mut total = 0;
        report(BackupProgress {
            stage: BackupStage::Copying,
            files: 0,
            bytes: 0,
        })?;
        copy_data(
            root,
            &payload,
            Path::new(""),
            0,
            &mut files,
            &mut total,
            report,
        )?;
        fs::write(payload.join("ui-state.json"), ui)
            .map_err(|cause| error("无法保存界面状态", cause))?;
        record(&payload, Path::new("ui-state.json"), &mut files, &mut total)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let manifest = Manifest {
            schema_version: 1,
            id: id.clone(),
            created_at,
            automatic,
            files,
        };
        let text = toml_edit::ser::to_string_pretty(&manifest)
            .map_err(|cause| error("备份清单编码失败", cause))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(stage.join("manifest.toml"))
            .map_err(|cause| error("无法创建备份清单", cause))?;
        output
            .write_all(text.as_bytes())
            .and_then(|()| output.sync_all())
            .map_err(|cause| error("无法保存备份清单", cause))?;
        drop(output);
        report(BackupProgress {
            stage: BackupStage::Publishing,
            files: manifest.files.len(),
            bytes: total,
        })?;
        fs::rename(&stage, &final_path).map_err(|cause| error("无法发布备份", cause))?;
        Ok(manifest.summary())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    let summary = result?;
    if automatic {
        prune_automatic(root)?;
    }
    Ok(summary)
}

fn prune_automatic(root: &Path) -> Result<(), String> {
    let mut automatic: Vec<_> = list(root)?
        .into_iter()
        .filter(|item| item.automatic)
        .collect();
    automatic.sort_by_key(|item| std::cmp::Reverse(item.created_at));
    let mut total = 0u64;
    let now = now()?;
    for (position, item) in automatic.iter().enumerate() {
        total = total.saturating_add(item.size_bytes);
        if position >= 7
            || total > 10 * 1024 * 1024 * 1024
            || now.saturating_sub(item.created_at) > 30 * 24 * 3600 * 1000
        {
            remove(root, &item.id)?;
        }
    }
    Ok(())
}

pub fn verify(root: &Path, id: &str) -> Result<BackupSummary, String> {
    let manifest = read_manifest(root, id)?;
    let payload = root.join("backups").join(id).join("payload");
    verify_payload(&manifest, &payload)?;
    Ok(manifest.summary())
}

fn verify_payload(manifest: &Manifest, payload: &Path) -> Result<(), String> {
    plain_dir(payload)?;
    let mut total = 0u64;
    let mut names = HashSet::new();
    for entry in &manifest.files {
        let relative = safe_relative(&entry.path)?;
        if !names.insert(relative.clone()) {
            return Err("备份清单包含重复文件".into());
        }
        let path = payload.join(relative);
        plain_file(&path)?;
        let (size, checksum) = hash(&path)?;
        total = total.checked_add(size).ok_or("备份容量超限")?;
        if total > MAX_BYTES || size != entry.size || checksum != entry.sha256 {
            return Err(format!("备份文件校验失败：{}", entry.path));
        }
        if entry.path.ends_with(".sqlite") {
            verify_sqlite(&path)?;
        }
    }
    if !names.contains(Path::new("ui-state.json")) {
        return Err("备份缺少界面状态".into());
    }
    verify_inventory(payload, payload, &names, 0)?;
    read_ui_state(&payload.join("ui-state.json"))?;
    Ok(())
}

fn read_ui_state(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if plain_file(path)?.len() > MAX_UI_BYTES as u64 {
        return Err("界面恢复数据过大".into());
    }
    let bytes = fs::read(path).map_err(|cause| error("无法读取界面恢复数据", cause))?;
    let values: BTreeMap<String, String> =
        serde_json::from_slice(&bytes).map_err(|_| "界面恢复数据格式无效")?;
    if values.iter().any(|(key, value)| {
        !key.starts_with("fluxcode.") || key.len() > 200 || value.len() > MAX_UI_BYTES
    }) {
        return Err("界面恢复数据包含无效键或值".into());
    }
    Ok(values)
}

fn verify_inventory(
    root: &Path,
    directory: &Path,
    names: &HashSet<PathBuf>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("备份目录层级过深".into());
    }
    plain_dir(directory)?;
    for item in fs::read_dir(directory).map_err(|cause| error("无法读取备份内容", cause))? {
        let item = item.map_err(|cause| error("无法读取备份内容", cause))?;
        let path = item.path();
        let metadata =
            fs::symlink_metadata(&path).map_err(|cause| error("无法读取备份内容", cause))?;
        #[cfg(windows)]
        if is_reparse(&metadata) {
            return Err("备份包含链接，操作已停止".into());
        }
        if metadata.file_type().is_dir() {
            verify_inventory(root, &path, names, depth + 1)?;
        } else if metadata.file_type().is_file() {
            let relative = path.strip_prefix(root).map_err(|_| "备份路径无效")?;
            if !names.contains(relative) {
                return Err("备份包含未记录的文件".into());
            }
        } else {
            return Err("备份包含特殊文件".into());
        }
    }
    Ok(())
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let path = manifest_path(root, id)?;
    plain_dir(path.parent().ok_or("备份目录无效")?)?;
    fs::remove_dir_all(path.parent().ok_or("备份目录无效")?)
        .map_err(|cause| error("无法删除备份", cause))
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PendingRestore {
    id: String,
}

pub fn schedule_restore(root: &Path, id: &str) -> Result<(), String> {
    let pending = root.join("pending-restore.toml");
    if pending.exists() {
        return Err("已有待执行的恢复请求，请先重启应用".into());
    }
    verify(root, id)?;
    let text = toml_edit::ser::to_string(&PendingRestore { id: id.to_owned() })
        .map_err(|cause| error("无法记录恢复请求", cause))?;
    let temp = root.join(format!(
        "pending-restore-{}-{}.tmp",
        std::process::id(),
        now()?
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|cause| error("无法创建恢复请求", cause))?;
        file.write_all(text.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|cause| error("无法记录恢复请求", cause))?;
        drop(file);
        fs::rename(&temp, &pending).map_err(|cause| error("无法发布恢复请求", cause))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn copy_tree(source: &Path, target: &Path, depth: usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("备份目录层级过深".into());
    }
    plain_dir(source)?;
    fs::create_dir(target).map_err(|cause| error("无法创建恢复目录", cause))?;
    for item in fs::read_dir(source).map_err(|cause| error("无法读取恢复来源", cause))? {
        let item = item.map_err(|cause| error("无法读取恢复来源", cause))?;
        let from = item.path();
        let to = target.join(item.file_name());
        let kind = fs::symlink_metadata(&from)
            .map_err(|cause| error("无法读取恢复来源", cause))?
            .file_type();
        #[cfg(windows)]
        if is_reparse(
            &fs::symlink_metadata(&from).map_err(|cause| error("无法读取恢复来源", cause))?,
        ) {
            return Err("恢复来源包含链接，操作已停止".into());
        }
        if kind.is_dir() {
            copy_tree(&from, &to, depth + 1)?;
        } else if kind.is_file() {
            fs::copy(&from, &to).map_err(|cause| error("无法复制恢复文件", cause))?;
        } else {
            return Err("恢复来源包含链接或特殊文件".into());
        }
    }
    Ok(())
}

/// Called before creating the WebView. A failed or interrupted swap keeps the old data directory.
pub fn apply_pending(root: &Path) -> Result<(), String> {
    let parent = root.parent().ok_or("数据目录位置无效")?;
    let rollback = parent.join(".fluxcode-restore-rollback");
    if !root.exists() && rollback.exists() {
        fs::rename(&rollback, root).map_err(|cause| error("无法恢复中断前的数据", cause))?;
        let _ = fs::remove_file(root.join("pending-restore.toml"));
        return Err("上次恢复中断，已保留原数据。请重新启动应用。".into());
    }
    if !root.exists() && has_orphaned_stage(parent)? {
        return Err(
            "发现中断的恢复暂存目录，原数据目录缺失；请先检查备份，应用不会创建空数据目录".into(),
        );
    }
    let unconfirmed = root.join("restore-unconfirmed.toml");
    if unconfirmed.exists() {
        plain_dir(root)?;
        plain_file(&unconfirmed)?;
        plain_dir(&rollback)?;
        let failed = parent.join(format!(
            ".fluxcode-restore-unconfirmed-{}-{}",
            now()?,
            std::process::id()
        ));
        if failed.exists() {
            return Err("无法保留未确认的恢复数据，请重新启动应用".into());
        }
        let old_request = rollback.join("pending-restore.toml");
        if old_request.exists() {
            plain_file(&old_request)?;
            fs::remove_file(&old_request)
                .map_err(|cause| error("无法取消中断的恢复请求", cause))?;
        }
        fs::rename(root, &failed).map_err(|cause| error("无法保留未确认的恢复数据", cause))?;
        if let Err(cause) = fs::rename(&rollback, root) {
            fs::rename(&failed, root).map_err(|rollback_error| {
                error("原数据回滚失败且恢复数据无法放回", rollback_error)
            })?;
            return Err(error("无法恢复先前的数据", cause));
        }
        return Err(format!(
            "恢复后的应用未完成启动，先前数据已找回。未确认的数据保留在 {}。请再次启动应用。",
            failed.display()
        ));
    }
    let pending_path = root.join("pending-restore.toml");
    if !pending_path.exists() {
        return Ok(());
    }
    if rollback.exists() {
        return Err("上一次恢复目录仍在，请先检查数据后再恢复".into());
    }
    let text =
        fs::read_to_string(&pending_path).map_err(|cause| error("无法读取恢复请求", cause))?;
    let pending: PendingRestore = toml_edit::de::from_str(&text).map_err(|_| "恢复请求格式无效")?;
    if !valid_id(&pending.id) {
        return Err("恢复请求中的备份编号无效".into());
    }
    let manifest = read_manifest(root, &pending.id)?;
    verify_payload(
        &manifest,
        &root.join("backups").join(&pending.id).join("payload"),
    )?;
    let stage = parent.join(format!(".fluxcode-restore-stage-{}", pending.id));
    if stage.exists() {
        // The old data is still in place, so a prior interrupted copy can be retried.
        remove_restore_stage(&stage, 0)?;
    }
    let result = (|| {
        let snapshot = root.join("backups").join(&pending.id).join("payload");
        copy_tree(&snapshot, &stage, 0)?;
        verify_payload(&manifest, &stage)?;
        fs::rename(stage.join("ui-state.json"), stage.join("restore-ui.json"))
            .map_err(|cause| error("无法准备界面恢复", cause))?;
        for folder in ["backups", "webview", "logs"] {
            if root.join(folder).exists() {
                copy_tree(&root.join(folder), &stage.join(folder), 0)?;
            }
        }
        let mut confirmation = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(stage.join("restore-unconfirmed.toml"))
            .map_err(|cause| error("无法创建恢复确认标记", cause))?;
        confirmation
            .write_all(text.as_bytes())
            .and_then(|()| confirmation.sync_all())
            .map_err(|cause| error("无法保存恢复确认标记", cause))?;
        drop(confirmation);
        fs::rename(root, &rollback).map_err(|cause| error("无法保护当前数据", cause))?;
        if let Err(cause) = fs::rename(&stage, root) {
            fs::rename(&rollback, root)
                .map_err(|rollback_error| error("恢复失败且原数据回滚失败", rollback_error))?;
            return Err(error("无法切换恢复数据", cause));
        }
        Ok(())
    })();
    if result.is_err() && stage.exists() {
        let _ = remove_restore_stage(&stage, 0);
    }
    result
}

fn has_orphaned_stage(parent: &Path) -> Result<bool, String> {
    for entry in fs::read_dir(parent).map_err(|cause| error("无法检查数据目录", cause))? {
        let entry = entry.map_err(|cause| error("无法检查数据目录", cause))?;
        if entry
            .file_name()
            .to_str()
            .and_then(|name| name.strip_prefix(".fluxcode-restore-stage-"))
            .is_some_and(valid_id)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn remove_restore_stage(path: &Path, depth: usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("恢复暂存目录层级过深，请手动检查".into());
    }
    plain_dir(path)?;
    for item in fs::read_dir(path).map_err(|cause| error("无法检查恢复暂存目录", cause))?
    {
        let item = item.map_err(|cause| error("无法检查恢复暂存目录", cause))?;
        let child = item.path();
        let metadata =
            fs::symlink_metadata(&child).map_err(|cause| error("无法检查恢复暂存目录", cause))?;
        #[cfg(windows)]
        if is_reparse(&metadata) {
            return Err("恢复暂存目录包含链接，请手动检查".into());
        }
        if metadata.file_type().is_dir() {
            remove_restore_stage(&child, depth + 1)?;
        } else if metadata.file_type().is_file() {
            fs::remove_file(&child).map_err(|cause| error("无法清理恢复暂存文件", cause))?;
        } else {
            return Err("恢复暂存目录包含特殊文件，请手动检查".into());
        }
    }
    fs::remove_dir(path).map_err(|cause| error("无法清理恢复暂存目录", cause))
}

pub fn restored_ui(root: &Path) -> Result<Option<BTreeMap<String, String>>, String> {
    let path = root.join("restore-ui.json");
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(read_ui_state(&path)?))
}

pub fn finish_ui_restore(root: &Path) -> Result<(), String> {
    let rollback = root
        .parent()
        .ok_or("数据目录位置无效")?
        .join(".fluxcode-restore-rollback");
    let unconfirmed = root.join("restore-unconfirmed.toml");
    if unconfirmed.exists() {
        plain_file(&unconfirmed)?;
        fs::remove_file(&unconfirmed).map_err(|cause| error("无法确认恢复结果", cause))?;
    }
    if rollback.exists() {
        remove_restore_stage(&rollback, 0)?;
    }
    let path = root.join("restore-ui.json");
    if path.exists() {
        fs::remove_file(path).map_err(|cause| error("无法完成界面恢复", cause))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_verifies_and_restores_application_data() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(root.join("engine-home/sessions")).unwrap();
        fs::write(root.join("engine-home/sessions/one.jsonl"), "中文历史\n").unwrap();
        fs::write(root.join("fluxcode.toml"), "version = 1\n").unwrap();
        let original = BTreeMap::from([("fluxcode.catalog.v1".into(), "{\"version\":1}".into())]);
        let first = create(&root, &original, false).unwrap();
        assert_eq!(verify(&root, &first.id).unwrap().file_count, 3);
        fs::write(
            root.join("engine-home/sessions/one.jsonl"),
            "later history\n",
        )
        .unwrap();
        create(&root, &BTreeMap::new(), false).unwrap();
        schedule_restore(&root, &first.id).unwrap();
        apply_pending(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("engine-home/sessions/one.jsonl")).unwrap(),
            "中文历史\n"
        );
        assert_eq!(restored_ui(&root).unwrap().unwrap(), original);
        assert!(root.join("restore-unconfirmed.toml").exists());
        finish_ui_restore(&root).unwrap();
        assert!(!root.join("restore-ui.json").exists());
        assert!(!root.join("restore-unconfirmed.toml").exists());
        assert_eq!(list(&root).unwrap().len(), 2);
    }

    #[test]
    fn snapshot_reports_real_work_and_paginates_validated_file_details() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("first.txt"), "first").unwrap();
        fs::write(root.join("second.txt"), "second").unwrap();
        let mut progress = Vec::new();
        let summary = create_with_progress(&root, &BTreeMap::new(), false, &mut |state| {
            progress.push(state);
            Ok(())
        })
        .unwrap();
        assert_eq!(summary.file_count, 3);
        assert_eq!(progress.first().unwrap().stage, BackupStage::Preparing);
        assert!(
            progress
                .iter()
                .any(|state| state.stage == BackupStage::Copying && state.files == 2)
        );
        let published = progress.last().unwrap();
        assert_eq!(published.stage, BackupStage::Publishing);
        assert_eq!(published.files, 3);
        assert_eq!(published.bytes, summary.size_bytes);

        let first_page = detail(&root, &summary.id, 0, 2).unwrap();
        let second_page = detail(&root, &summary.id, 2, 2).unwrap();
        assert_eq!(first_page.total_files, 3);
        assert_eq!(first_page.files.len(), 2);
        assert_eq!(second_page.files.len(), 1);
        assert_eq!(first_page.files[0].path, "first.txt");
        assert_eq!(second_page.files[0].path, "ui-state.json");
        assert!(detail(&root, &summary.id, 0, 0).is_err());
        assert!(detail(&root, &summary.id, 0, 101).is_err());
    }

    #[test]
    fn cancellation_before_publication_removes_the_staged_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("history.txt"), "history").unwrap();
        let result = create_with_progress(&root, &BTreeMap::new(), false, &mut |progress| {
            if progress.stage == BackupStage::Publishing {
                Err("备份已取消".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(result.unwrap_err(), "备份已取消");
        assert!(list(&root).unwrap().is_empty());
        assert_eq!(fs::read_dir(root.join("backups")).unwrap().count(), 0);
        assert_eq!(
            fs::read_to_string(root.join("history.txt")).unwrap(),
            "history"
        );
    }

    #[test]
    fn snapshot_omits_engine_runtime_locks_but_keeps_history_and_user_skills() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        for directory in [
            "engine-home/.tmp",
            "engine-home/tmp",
            "engine-home/thread-writer-locks",
            "engine-home/sessions",
            "engine-home/skills/custom",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        for file in [
            "engine-home/.tmp/plugins.sync.lock",
            "engine-home/tmp/process.lock",
            "engine-home/thread-writer-locks/current.lock",
            "engine-home/sessions/history.jsonl",
            "engine-home/skills/custom/SKILL.md",
        ] {
            fs::write(root.join(file), file).unwrap();
        }

        let summary = create(&root, &BTreeMap::new(), false).unwrap();
        let paths: HashSet<_> = detail(&root, &summary.id, 0, 100)
            .unwrap()
            .files
            .into_iter()
            .map(|file| file.path.replace('\\', "/"))
            .collect();
        assert!(paths.contains("engine-home/sessions/history.jsonl"));
        assert!(paths.contains("engine-home/skills/custom/SKILL.md"));
        assert!(
            !paths
                .iter()
                .any(|path| path.contains(".tmp") || path.contains(".lock"))
        );
        verify(&root, &summary.id).unwrap();
    }

    #[test]
    fn detail_rejects_manifest_paths_outside_the_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let summary = create(&root, &BTreeMap::new(), false).unwrap();
        let manifest_path = root.join("backups").join(&summary.id).join("manifest.toml");
        let mut manifest = read_manifest(&root, &summary.id).unwrap();
        manifest.files[0].path = "../outside.txt".into();
        fs::write(
            &manifest_path,
            toml_edit::ser::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(detail(&root, &summary.id, 0, 50).is_err());
    }

    #[test]
    fn oversized_manifest_is_reported_as_damaged_instead_of_overflowing() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let summary = create(&root, &BTreeMap::new(), false).unwrap();
        let manifest_path = root.join("backups").join(&summary.id).join("manifest.toml");
        let mut manifest = read_manifest(&root, &summary.id).unwrap();
        manifest.files[0].size = i64::MAX as u64;
        fs::write(
            &manifest_path,
            toml_edit::ser::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let listed = list(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].error.as_deref(), Some("备份清单容量超限"));
        assert_eq!(
            detail(&root, &summary.id, 0, 50).err().unwrap(),
            "备份清单容量超限"
        );
        assert_eq!(verify(&root, &summary.id).unwrap_err(), "备份清单容量超限");
    }

    #[test]
    fn unconfirmed_restore_recovers_old_data_and_preserves_failed_version() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("history.txt"), "snapshot").unwrap();
        let backup = create(&root, &BTreeMap::new(), false).unwrap();
        fs::write(root.join("history.txt"), "current").unwrap();
        schedule_restore(&root, &backup.id).unwrap();
        apply_pending(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("history.txt")).unwrap(),
            "snapshot"
        );

        let recovery = apply_pending(&root).unwrap_err();
        assert!(recovery.contains("先前数据已找回"));
        assert_eq!(
            fs::read_to_string(root.join("history.txt")).unwrap(),
            "current"
        );
        assert!(!root.join("pending-restore.toml").exists());
        assert!(!root.join("restore-ui.json").exists());
        let failed: Vec<_> = fs::read_dir(temp.path())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".fluxcode-restore-unconfirmed-")
            })
            .collect();
        assert_eq!(failed.len(), 1);
        assert_eq!(
            fs::read_to_string(failed[0].join("history.txt")).unwrap(),
            "snapshot"
        );
        apply_pending(&root).unwrap();
    }

    #[test]
    fn damaged_or_unlisted_files_cannot_be_restored() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let item = create(&root, &BTreeMap::new(), false).unwrap();
        let payload = root.join("backups").join(&item.id).join("payload");
        fs::write(payload.join("ui-state.json"), "changed").unwrap();
        assert!(verify(&root, &item.id).is_err());
        assert!(schedule_restore(&root, &item.id).is_err());
        fs::write(payload.join("ui-state.json"), "{}").unwrap();
        fs::write(payload.join("extra.txt"), "unlisted").unwrap();
        assert!(verify(&root, &item.id).is_err());
    }

    #[test]
    fn restore_request_is_complete_and_existing_request_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let snapshot = create(&root, &BTreeMap::new(), false).unwrap();
        schedule_restore(&root, &snapshot.id).unwrap();
        let pending = root.join("pending-restore.toml");
        let before = fs::read(&pending).unwrap();
        let request: PendingRestore =
            toml_edit::de::from_str(std::str::from_utf8(&before).unwrap()).unwrap();
        assert_eq!(request.id, snapshot.id);
        assert!(schedule_restore(&root, &snapshot.id).is_err());
        assert_eq!(fs::read(&pending).unwrap(), before);
        assert!(!fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn invalid_pending_restore_preserves_current_data_and_request() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("history.txt"), "current history").unwrap();
        let pending = root.join("pending-restore.toml");
        fs::write(&pending, "id = [invalid").unwrap();

        assert!(apply_pending(&root).is_err());
        assert_eq!(
            fs::read_to_string(root.join("history.txt")).unwrap(),
            "current history"
        );
        assert_eq!(fs::read_to_string(&pending).unwrap(), "id = [invalid");
        assert!(!temp.path().join(".fluxcode-restore-rollback").exists());
    }

    #[test]
    fn restore_rejects_nonempty_or_damaged_live_ui_state_but_accepts_legacy_missing_keys() {
        assert!(validate_restore_ui_state(&BTreeMap::new()).is_ok());
        let mut state = BTreeMap::from([
            ("fluxcode.queue.v1".into(), "[]".into()),
            ("fluxcode.editor-drafts.v1".into(), "{}".into()),
        ]);
        assert!(validate_restore_ui_state(&state).is_ok());
        state.insert(
            "fluxcode.queue.v1".into(),
            "[{\"text\":\"pending\"}]".into(),
        );
        assert!(
            validate_restore_ui_state(&state)
                .unwrap_err()
                .contains("待发送")
        );
        state.insert("fluxcode.queue.v1".into(), "[]".into());
        state.insert("fluxcode.editor-drafts.v1".into(), "{\"file\":{}}".into());
        assert!(
            validate_restore_ui_state(&state)
                .unwrap_err()
                .contains("未保存")
        );
        state.insert("fluxcode.editor-drafts.v1".into(), "[]".into());
        assert!(validate_restore_ui_state(&state).is_err());
        state.insert("fluxcode.editor-drafts.v1".into(), "{}".into());
        state.insert("fluxcode.queue.v1".into(), "{".into());
        assert!(validate_restore_ui_state(&state).is_err());
    }

    #[test]
    fn failed_rollback_cleanup_keeps_ui_restore_marker_for_retry() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("restore-ui.json"), "{}").unwrap();
        fs::write(root.join("restore-unconfirmed.toml"), "id = '1'").unwrap();
        let rollback = temp.path().join(".fluxcode-restore-rollback");
        fs::write(&rollback, "not a directory").unwrap();
        assert!(finish_ui_restore(&root).is_err());
        assert!(root.join("restore-ui.json").exists());
        assert!(!root.join("restore-unconfirmed.toml").exists());
        assert!(apply_pending(&root).is_ok());
        assert!(root.join("restore-ui.json").exists());
        fs::remove_file(&rollback).unwrap();
        fs::create_dir(&rollback).unwrap();
        fs::write(rollback.join("old-data.txt"), "old").unwrap();
        finish_ui_restore(&root).unwrap();
        assert!(!root.join("restore-ui.json").exists());
        assert!(!rollback.exists());
    }

    #[test]
    fn legacy_ui_restore_without_confirmation_marker_still_finishes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("restore-ui.json"), "{}").unwrap();
        let rollback = temp.path().join(".fluxcode-restore-rollback");
        fs::create_dir(&rollback).unwrap();
        fs::write(rollback.join("old.txt"), "old").unwrap();
        apply_pending(&root).unwrap();
        finish_ui_restore(&root).unwrap();
        assert!(!root.join("restore-ui.json").exists());
        assert!(!rollback.exists());
    }

    #[test]
    fn damaged_manifest_remains_visible_and_invalid_ui_state_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let snapshot = create(&root, &BTreeMap::new(), false).unwrap();
        let backup_dir = root.join("backups").join(&snapshot.id);
        let manifest_path = backup_dir.join("manifest.toml");
        fs::write(&manifest_path, "invalid = [").unwrap();
        let listed = list(&root).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, snapshot.id);
        assert!(listed[0].error.is_some());
        assert!(schedule_restore(&root, &snapshot.id).is_err());

        let second = create(&root, &BTreeMap::new(), false).unwrap();
        let payload = root.join("backups").join(&second.id).join("payload");
        fs::write(payload.join("ui-state.json"), "[]").unwrap();
        let mut manifest = read_manifest(&root, &second.id).unwrap();
        let entry = manifest
            .files
            .iter_mut()
            .find(|file| file.path == "ui-state.json")
            .unwrap();
        (entry.size, entry.sha256) = hash(&payload.join("ui-state.json")).unwrap();
        let encoded = toml_edit::ser::to_string_pretty(&manifest).unwrap();
        fs::write(
            root.join("backups").join(&second.id).join("manifest.toml"),
            encoded,
        )
        .unwrap();
        assert!(verify(&root, &second.id).is_err());
        assert!(schedule_restore(&root, &second.id).is_err());
    }

    #[test]
    fn copied_payload_is_verified_before_restore_switch() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        let snapshot = create(&root, &BTreeMap::new(), false).unwrap();
        let manifest = read_manifest(&root, &snapshot.id).unwrap();
        let source = root.join("backups").join(&snapshot.id).join("payload");
        let copy = temp.path().join("copy");
        copy_tree(&source, &copy, 0).unwrap();
        verify_payload(&manifest, &copy).unwrap();
        fs::write(copy.join("ui-state.json"), "altered").unwrap();
        assert!(verify_payload(&manifest, &copy).is_err());
    }

    #[test]
    fn backup_location_is_application_owned_and_rejects_a_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        assert_eq!(location(&root).unwrap(), root.join("backups"));
        fs::remove_dir(root.join("backups")).unwrap();
        fs::write(root.join("backups"), "occupied").unwrap();
        assert!(location(&root).is_err());
    }

    #[test]
    fn interrupted_restore_copy_retries_without_losing_current_data() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("history.txt"), "before").unwrap();
        let snapshot = create(&root, &BTreeMap::new(), false).unwrap();
        fs::write(root.join("history.txt"), "current").unwrap();
        schedule_restore(&root, &snapshot.id).unwrap();
        let stage = temp
            .path()
            .join(format!(".fluxcode-restore-stage-{}", snapshot.id));
        fs::create_dir(&stage).unwrap();
        fs::write(stage.join("partial.txt"), "interrupted").unwrap();
        apply_pending(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("history.txt")).unwrap(),
            "before"
        );
        assert!(root.join("restore-ui.json").exists());
        assert!(!stage.exists());
        assert_eq!(
            fs::read_to_string(temp.path().join(".fluxcode-restore-rollback/history.txt")).unwrap(),
            "current"
        );
    }

    #[test]
    fn orphaned_restore_stage_never_creates_an_empty_data_directory() {
        let temp = tempfile::tempdir().unwrap();
        let stage = temp.path().join(".fluxcode-restore-stage-1234567890123-1");
        fs::create_dir(&stage).unwrap();
        let root = temp.path().join("data");
        assert!(apply_pending(&root).is_err());
        assert!(!root.exists());
        assert!(stage.exists());
    }

    #[test]
    fn sqlite_snapshot_includes_committed_wal_pages() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(root.join("engine-home")).unwrap();
        let database = Connection::open(root.join("engine-home/state_5.sqlite")).unwrap();
        database.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE messages (text TEXT); INSERT INTO messages VALUES ('history');").unwrap();
        let item = create(&root, &BTreeMap::new(), false).unwrap();
        verify(&root, &item.id).unwrap();
        let snapshot_path = root
            .join("backups")
            .join(item.id)
            .join("payload/engine-home/state_5.sqlite");
        assert!(!snapshot_path.with_file_name("state_5.sqlite-wal").exists());
        assert!(!snapshot_path.with_file_name("state_5.sqlite-shm").exists());
        let snapshot = Connection::open(snapshot_path).unwrap();
        let message: String = snapshot
            .query_row("SELECT text FROM messages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(message, "history");
    }

    #[test]
    fn sqlite_quick_check_rejects_corrupt_snapshot_even_with_updated_hash() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(root.join("engine-home")).unwrap();
        let source = root.join("engine-home/state.sqlite");
        let database = Connection::open(&source).unwrap();
        database
            .execute_batch("CREATE TABLE item (value TEXT); INSERT INTO item VALUES ('ok');")
            .unwrap();
        drop(database);
        let snapshot = create(&root, &BTreeMap::new(), false).unwrap();
        let payload = root.join("backups").join(&snapshot.id).join("payload");
        let copied = payload.join("engine-home/state.sqlite");
        let mut bytes = fs::read(&copied).unwrap();
        bytes[0] = b'X';
        fs::write(&copied, bytes).unwrap();
        let mut manifest = read_manifest(&root, &snapshot.id).unwrap();
        let entry = manifest
            .files
            .iter_mut()
            .find(|file| Path::new(&file.path) == Path::new("engine-home/state.sqlite"))
            .unwrap();
        (entry.size, entry.sha256) = hash(&copied).unwrap();
        fs::write(
            root.join("backups")
                .join(&snapshot.id)
                .join("manifest.toml"),
            toml_edit::ser::to_string_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(verify(&root, &snapshot.id).is_err());
    }
}

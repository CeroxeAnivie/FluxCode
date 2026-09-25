//! Durable UI metadata independent of the WebView2 profile location.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const FILE: &str = "ui-state-mirror.json";
const PREVIOUS: &str = "ui-state-mirror.prev.json";
const MAX_BYTES: u64 = 16 * 1024 * 1024;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub version: u32,
    pub generation: u64,
    pub values: BTreeMap<String, String>,
}

fn plain_file(path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("无法读取本地界面索引：{e}"))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("本地界面索引不是普通文件，请检查数据目录。".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("本地界面索引不能使用链接文件。".into());
        }
    }
    if metadata.len() > MAX_BYTES {
        return Err("本地界面索引超过大小限制。".into());
    }
    Ok(metadata.len())
}

fn read(path: &Path) -> Result<Snapshot, String> {
    let length = plain_file(path)?;
    let mut bytes = Vec::with_capacity(length as usize);
    fs::File::open(path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("无法读取本地界面索引：{e}"))?;
    let snapshot: Snapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "本地界面索引损坏，可从上一份本地索引恢复。原文件已保留。".to_string())?;
    validate(&snapshot)?;
    Ok(snapshot)
}

fn validate(snapshot: &Snapshot) -> Result<(), String> {
    if snapshot.version != 1 || snapshot.generation == 0 {
        return Err("本地界面索引版本无效，原文件已保留。".into());
    }
    for (key, value) in &snapshot.values {
        if !key.starts_with("fluxcode.") || key.len() > 200 || value.len() > MAX_BYTES as usize {
            return Err("本地界面索引包含无效键或超长内容。".into());
        }
    }
    let length = serde_json::to_vec(snapshot)
        .map_err(|e| format!("无法序列化本地界面索引：{e}"))?
        .len() as u64;
    if length > MAX_BYTES {
        return Err("本地界面索引超过大小限制。".into());
    }
    Ok(())
}

pub fn load(root: &Path) -> Result<Option<Snapshot>, String> {
    let path = root.join(FILE);
    match fs::symlink_metadata(&path) {
        Ok(_) => read(&path).map(Some),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法检查本地界面索引：{error}")),
    }
}

fn temporary(root: &Path) -> PathBuf {
    root.join(format!(
        ".ui-state-mirror-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ))
}

fn archive_path(root: &Path, label: &str) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    Ok(root.join(format!(
        "ui-state-mirror.{label}-{timestamp}-{}.json",
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    )))
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("无法暂存本地界面索引：{e}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("无法写入本地界面索引：{e}"))
}

fn replace(root: &Path, destination: &Path, bytes: &[u8]) -> Result<(), String> {
    let stage = temporary(root);
    let result = write_file(&stage, bytes).and_then(|()| {
        fs::rename(&stage, destination).map_err(|e| format!("无法提交本地界面索引：{e}"))
    });
    if result.is_err() {
        let _ = fs::remove_file(stage);
    }
    result
}

pub fn save(
    root: &Path,
    expected_generation: Option<u64>,
    values: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    let current = load(root)?;
    if current.as_ref().map(|s| s.generation) != expected_generation {
        return Err("本地界面索引已被其他窗口更新，请重新加载后重试。".into());
    }
    let generation = expected_generation
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("本地界面索引代际已耗尽")?;
    let next = Snapshot {
        version: 1,
        generation,
        values,
    };
    validate(&next)?;
    let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
    if current.is_some() {
        let previous =
            fs::read(root.join(FILE)).map_err(|e| format!("无法保留上一份本地界面索引：{e}"))?;
        replace(root, &root.join(PREVIOUS), &previous)?;
    }
    replace(root, &root.join(FILE), &bytes)?;
    Ok(next)
}

pub fn restore_previous(root: &Path) -> Result<Snapshot, String> {
    let previous_path = root.join(PREVIOUS);
    let previous = read(&previous_path)?;
    let bytes = fs::read(&previous_path).map_err(|e| format!("无法读取上一份本地界面索引：{e}"))?;
    let current = root.join(FILE);
    if current.exists() {
        let archived = archive_path(root, "corrupt")?;
        fs::rename(&current, &archived).map_err(|e| format!("无法保护损坏的本地界面索引：{e}"))?;
        if let Err(error) = replace(root, &current, &bytes) {
            let _ = fs::rename(archived, &current);
            return Err(error);
        }
    } else {
        replace(root, &current, &bytes)?;
    }
    Ok(previous)
}

pub fn commit_restore(
    root: &Path,
    values: BTreeMap<String, String>,
    confirmed: BTreeMap<String, String>,
) -> Result<Snapshot, String> {
    if confirmed != values {
        return Err("备份恢复内容与待确认的界面状态不一致。".into());
    }
    match load(root) {
        Ok(Some(current)) => save(root, Some(current.generation), values),
        Ok(None) => {
            let generation = read(&root.join(PREVIOUS))
                .map_or(0, |snapshot| snapshot.generation)
                .checked_add(1)
                .ok_or("本地界面索引代际已耗尽")?;
            let next = Snapshot {
                version: 1,
                generation,
                values,
            };
            validate(&next)?;
            let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
            replace(root, &root.join(FILE), &bytes)?;
            Ok(next)
        }
        Err(_) => {
            let generation = read(&root.join(PREVIOUS))
                .map_or(0, |snapshot| snapshot.generation)
                .checked_add(1)
                .ok_or("本地界面索引代际已耗尽")?;
            let next = Snapshot {
                version: 1,
                generation,
                values,
            };
            validate(&next)?;
            let bytes = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
            let current = root.join(FILE);
            let archived = archive_path(root, "pre-restore")?;
            fs::rename(&current, &archived)
                .map_err(|e| format!("无法保护原有本地界面索引：{e}"))?;
            if let Err(error) = replace(root, &current, &bytes) {
                let _ = fs::rename(&archived, &current);
                return Err(error);
            }
            Ok(next)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(key: &str) -> BTreeMap<String, String> {
        BTreeMap::from([("fluxcode.catalog.v1".into(), key.into())])
    }

    #[test]
    fn serializes_generations_and_preserves_previous() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(load(root.path()).unwrap(), None);
        let first = save(root.path(), None, state("first")).unwrap();
        assert_eq!(first.generation, 1);
        assert!(save(root.path(), None, state("stale")).is_err());
        let second = save(root.path(), Some(1), state("second")).unwrap();
        assert_eq!(load(root.path()).unwrap(), Some(second));
        assert_eq!(read(&root.path().join(PREVIOUS)).unwrap(), first);
    }

    #[test]
    fn corrupt_primary_is_kept_until_explicit_recovery() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), None, state("first")).unwrap();
        save(root.path(), Some(1), state("second")).unwrap();
        fs::write(root.path().join(FILE), "not json").unwrap();
        assert!(load(root.path()).unwrap_err().contains("损坏"));
        assert!(save(root.path(), Some(2), state("third")).is_err());
        assert_eq!(
            fs::read_to_string(root.path().join(FILE)).unwrap(),
            "not json"
        );
        assert_eq!(
            restore_previous(root.path()).unwrap().values,
            state("first")
        );
        assert!(root.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("ui-state-mirror.corrupt-")
        }));
    }

    #[test]
    fn rejects_invalid_keys_without_modifying_current_state() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), None, state("kept")).unwrap();
        assert!(
            save(
                root.path(),
                Some(1),
                BTreeMap::from([("other".into(), "bad".into())])
            )
            .is_err()
        );
        assert_eq!(load(root.path()).unwrap().unwrap().values, state("kept"));
    }

    #[test]
    fn confirmed_restore_archives_corrupt_mirror_and_creates_a_new_generation() {
        let root = tempfile::tempdir().unwrap();
        save(root.path(), None, state("original")).unwrap();
        save(root.path(), Some(1), state("later")).unwrap();
        fs::write(root.path().join(FILE), "corrupt").unwrap();
        let restored = state("restored");
        assert!(commit_restore(root.path(), state("wrong"), restored.clone()).is_err());
        let committed = commit_restore(root.path(), restored.clone(), restored.clone()).unwrap();
        assert_eq!(committed.generation, 2);
        assert_eq!(committed.values, restored);
        assert!(root.path().read_dir().unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("ui-state-mirror.pre-restore-")
        }));
    }
}

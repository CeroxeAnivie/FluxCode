use std::{fs, io::Write, path::Path};

const MAX_BYTES: u64 = 16_000_000;

fn file(root: &Path, id: &str) -> Result<std::path::PathBuf, String> {
    if id.len() != 36
        || !id.chars().enumerate().all(|(index, c)| {
            if [8, 13, 18, 23].contains(&index) {
                c == '-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err("导入历史 ID 无效".into());
    }
    Ok(root
        .join("imported-conversations")
        .join(format!("{id}.json")))
}

pub fn save(root: &Path, id: &str, content: &str) -> Result<(), String> {
    if content.len() as u64 > MAX_BYTES {
        return Err("导入的对话超过大小上限".into());
    }
    let path = file(root, id)?;
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|_| "导入的对话内容不是有效 JSON".to_string())?;
    fs::create_dir_all(path.parent().expect("import directory"))
        .map_err(|error| format!("无法创建导入历史目录：{error}"))?;
    if path.exists() {
        return Err("导入历史 ID 已存在".into());
    }
    let pending = path.with_extension("tmp");
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|error| format!("无法创建导入历史暂存文件：{error}"))?;
    let result = (|| {
        output.write_all(content.as_bytes())?;
        output.sync_all()?;
        fs::rename(&pending, &path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&pending);
        return Err(format!("无法保存导入历史：{error}"));
    }
    Ok(())
}

pub fn read(root: &Path, id: &str) -> Result<String, String> {
    let path = file(root, id)?;
    let size = fs::metadata(&path)
        .map_err(|error| format!("无法读取导入历史：{error}"))?
        .len();
    if size > MAX_BYTES {
        return Err("导入历史文件超过大小上限".into());
    }
    fs::read_to_string(path).map_err(|error| format!("无法读取导入历史：{error}"))
}

pub fn remove(root: &Path, id: &str) -> Result<(), String> {
    let path = file(root, id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法清理未完成的导入：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_reads_and_prevents_overwrite_or_path_escape() {
        let root = tempfile::tempdir().unwrap();
        let id = "12345678-1234-1234-1234-123456789abc";
        save(root.path(), id, "{\"messages\":[]}").unwrap();
        assert_eq!(read(root.path(), id).unwrap(), "{\"messages\":[]}");
        assert!(
            !root
                .path()
                .join(format!("imported-conversations/{id}.tmp"))
                .exists()
        );
        assert!(save(root.path(), id, "{}").is_err());
        assert!(read(root.path(), "../../etc/passwd").is_err());
        remove(root.path(), id).unwrap();
        assert!(read(root.path(), id).is_err());
    }

    #[test]
    fn backup_copies_complete_history_and_ignores_in_progress_file() {
        let root = tempfile::tempdir().unwrap();
        let id = "12345678-1234-1234-1234-123456789abc";
        save(root.path(), id, "{\"schemaVersion\":1,\"messages\":[]}").unwrap();
        let directory = root.path().join("imported-conversations");
        fs::write(directory.join("in-progress.tmp"), "partial").unwrap();
        let backup =
            crate::backup::create(root.path(), &std::collections::BTreeMap::new(), false).unwrap();
        let payload = root.path().join("backups").join(backup.id).join("payload");
        assert!(
            payload
                .join(format!("imported-conversations/{id}.json"))
                .exists()
        );
        assert!(
            !payload
                .join("imported-conversations/in-progress.tmp")
                .exists()
        );
    }
}

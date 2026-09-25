//! Export beside the selected target before atomically replacing it.
use std::{io::Write, path::Path};

pub fn save(path: &Path, content: &str) -> Result<(), String> {
    if !path.is_absolute()
        || !matches!(
            path.extension().and_then(|part| part.to_str()),
            Some("md" | "json" | "txt" | "toml")
        )
        || content.len() > 16_777_216
    {
        return Err("导出文件格式或大小无效".into());
    }
    let parent = path.parent().ok_or("导出目录无效")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "无法创建导出文件，请检查目标目录和可用空间")?;
    temporary
        .write_all(content.as_bytes())
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| "无法写入导出文件，原文件未替换")?;
    temporary
        .persist(path)
        .map_err(|_| "无法替换导出文件，请检查权限或文件占用")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_utf8_and_replaces_only_when_complete() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("草稿.txt");
        std::fs::write(&path, "原内容").unwrap();
        save(&path, "新草稿\r\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "新草稿\r\n");
        assert!(save(&path, &"x".repeat(16_777_217)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "新草稿\r\n");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn unavailable_directory_is_reported_without_creating_partial_export() {
        let directory = tempfile::tempdir().unwrap();
        assert!(save(&directory.path().join("missing/draft.txt"), "草稿").is_err());
        assert!(save(Path::new("relative.txt"), "草稿").is_err());
        assert!(save(&directory.path().join("script.exe"), "草稿").is_err());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn locked_destination_keeps_original_and_cleans_temporary_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("locked.txt");
        std::fs::write(&path, "原内容").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(save(&path, "新内容").is_err());
        drop(lock);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "原内容");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        save(&path, "重试").unwrap();
    }
}

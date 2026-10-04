//! Optimistic UTF-8 file saves preserve external edits.
use crate::workspace;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::AsyncWriteExt;
static NEXT_SAVE: AtomicU64 = AtomicU64::new(0);
pub async fn save(root: &str, relative: &str, expected: &str, content: &str) -> Result<(), String> {
    if content.len() > 1_048_576 || content.contains('\0') {
        return Err("File content exceeds editor limits".into());
    }
    let target = workspace::scoped_path(root, relative)?;
    if workspace::read(root, relative).await? != expected {
        return Err(
            "The file changed on disk. Reload it before saving; your edit has been kept.".into(),
        );
    }
    let parent = target.parent().ok_or("Invalid target")?;
    let temp = parent.join(format!(
        ".fluxcode-save-{}-{}",
        std::process::id(),
        NEXT_SAVE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = async {
        let permissions = tokio::fs::metadata(&target)
            .await
            .map_err(|e| e.to_string())?
            .permissions();
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .await
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        file.sync_all().await.map_err(|e| e.to_string())?;
        drop(file);
        tokio::fs::set_permissions(&temp, permissions)
            .await
            .map_err(|e| e.to_string())?;
        if workspace::read(root, relative).await? != expected {
            return Err("The file changed during save. Reload before saving.".into());
        }
        tokio::fs::rename(&temp, &target)
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(temp).await;
    }
    result
}
pub async fn create(root: &str, relative: &str) -> Result<(), String> {
    let normalized = relative.replace(char::from(92), "/");
    if normalized.is_empty()
        || normalized.len() > 4096
        || normalized.split('/').any(|part| {
            let base = part
                .split('.')
                .next()
                .unwrap_or("")
                .trim_end()
                .to_ascii_uppercase();
            let device = matches!(
                base.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) || ["COM", "LPT"].iter().any(|prefix| {
                base.strip_prefix(prefix).is_some_and(|tail| {
                    matches!(
                        tail,
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
            });
            device
                || part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part.chars().any(|c| c < ' ' || "<>:\"|?*".contains(c))
        })
    {
        return Err("请输入项目内有效的文件名".into());
    }
    let relative = std::path::Path::new(&normalized);
    let parent = workspace::scoped_path(
        root,
        relative.parent().and_then(|p| p.to_str()).unwrap_or(""),
    )?;
    let name = relative.file_name().ok_or("文件名无效")?;
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(parent.join(name))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "文件已存在，请选择其他名称".to_string()
            } else {
                format!("无法创建文本文件：{error}")
            }
        })?;
    file.sync_all()
        .await
        .map_err(|_| "文本文件保存失败".to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn creates_only_new_project_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        create(root, "便笺.txt").await.unwrap();
        save(root, "便笺.txt", "", "中文\n").await.unwrap();
        assert!(create(root, "便笺.txt").await.is_err());
        assert_eq!(workspace::read(root, "便笺.txt").await.unwrap(), "中文\n");
        for invalid in [
            "../outside.txt",
            "C:/outside.txt",
            "missing/file.txt",
            "",
            "a.",
            "a//b",
            "CON.txt",
            "notes/LPT1",
        ] {
            assert!(create(root, invalid).await.is_err(), "{invalid}");
        }
        tokio::fs::create_dir(dir.path().join("notes"))
            .await
            .unwrap();
        create(root, "notes/next.md").await.unwrap();
    }
    #[tokio::test]
    async fn saves_utf8_and_rejects_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_str().unwrap();
        let path = dir.path().join("a.txt");
        tokio::fs::write(&path, "旧内容\r\n").await.unwrap();
        save(root, "a.txt", "旧内容\r\n", "新内容\r\n")
            .await
            .unwrap();
        assert_eq!(workspace::read(root, "a.txt").await.unwrap(), "新内容\r\n");
        assert!(save(root, "a.txt", "旧内容\r\n", "bad").await.is_err());
        assert_eq!(workspace::read(root, "a.txt").await.unwrap(), "新内容\r\n");
    }
}

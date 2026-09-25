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
#[cfg(test)]
mod tests {
    use super::*;
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

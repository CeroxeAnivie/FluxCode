//! Validated external links and scoped workspace files.
use std::path::{Component, Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

pub(crate) fn validate(value: &str) -> Result<url::Url, String> {
    if value.len() > 8192 || value.chars().any(char::is_control) {
        return Err("网页链接无效".into());
    }
    let url = url::Url::parse(value).map_err(|_| "网页链接无效")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持不含登录凭据的 HTTP(S) 网页链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn open_external_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = validate(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|_| "无法打开系统默认浏览器".into())
}

fn scoped_regular_file(root: &str, relative: &str) -> Result<PathBuf, String> {
    let requested = Path::new(relative);
    if relative.is_empty()
        || relative.len() > 4096
        || relative.chars().any(char::is_control)
        || relative.contains(':')
        || requested
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("项目文件路径无效".into());
    }
    let mut path = crate::workspace::scoped_path(root, "")?;
    for part in requested.components() {
        path.push(part.as_os_str());
        let metadata = path.symlink_metadata().map_err(|_| "项目文件不存在")?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("不支持打开链接文件或目录".into());
        }
    }
    let path = crate::workspace::scoped_path(root, relative)?;
    if !path.is_file() {
        return Err("项目路径不是文件".into());
    }
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "exe"
                    | "com"
                    | "bat"
                    | "cmd"
                    | "ps1"
                    | "psm1"
                    | "psd1"
                    | "vbs"
                    | "vbe"
                    | "wsf"
                    | "wsh"
                    | "js"
                    | "jse"
                    | "mjs"
                    | "py"
                    | "pyw"
                    | "hta"
                    | "cpl"
                    | "pif"
                    | "reg"
                    | "inf"
                    | "scf"
                    | "jar"
                    | "sh"
                    | "msi"
                    | "msp"
                    | "msix"
                    | "appx"
                    | "msc"
                    | "scr"
                    | "lnk"
                    | "url"
                    | "application"
            )
        })
    {
        return Err("此文件类型不能通过系统默认应用打开".into());
    }
    Ok(path)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[tauri::command]
pub async fn open_workspace_file(
    app: tauri::AppHandle,
    root: String,
    relative: String,
) -> Result<(), String> {
    let path = scoped_regular_file(&root, &relative)?;
    #[cfg(windows)]
    let shell_path = dunce::simplified(&path);
    #[cfg(not(windows))]
    let shell_path = path.as_path();
    let shell_path = shell_path.to_str().ok_or("项目文件路径不是有效 UTF-8")?;
    app.opener()
        .open_path(shell_path, None::<&str>)
        .map_err(|_| "无法使用系统默认应用打开文件".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_web_links_without_credentials_are_allowed() {
        assert!(validate("https://example.com/文档?a=1&b=2#section").is_ok());
        for url in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,hi",
            "mailto:a@example.com",
            "https://user:secret@example.com",
            "https://user@example.com",
            "https://example.com/\n",
            "../README.md",
        ] {
            assert!(validate(url).is_err(), "{url}");
        }
        assert!(validate(&format!("https://example.com/{}", "a".repeat(8192))).is_err());
    }

    #[test]
    fn workspace_files_with_unicode_and_spaces_are_scoped() {
        let root = tempfile::tempdir().unwrap();
        let name = "设计 文档.md";
        std::fs::write(root.path().join(name), "内容").unwrap();
        std::fs::write(root.path().join("run.cmd"), "echo hi").unwrap();
        let root = root.path().to_str().unwrap();
        assert_eq!(
            scoped_regular_file(root, name).unwrap(),
            Path::new(root).join(name).canonicalize().unwrap()
        );
        for path in [
            "../outside.md",
            "./设计 文档.md",
            "readme.md:stream",
            "run.cmd",
            "missing.md",
        ] {
            assert!(scoped_regular_file(root, path).is_err(), "{path}");
        }
    }
}

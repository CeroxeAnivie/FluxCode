use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{ffi::OsStr, fs::File, io::Read, path::Path, process::Stdio, time::Duration};
use tokio::{process::Command, time::timeout};

const ENGINE_SHA256: &str = "70bcb05f9bf1a4e7306edd0cd1b57d02af3267ad02a34b26f45c8c4bb20a3301";
const CODE_MODE_SHA256: &str = "0f83a73dc6d511d43bd3e52cc0a999cb383c19c645ef3fbd8fbdaddde3088138";
const CODEX_LICENSE_SHA256: &str =
    "d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc";
const CODEX_NOTICE_SHA256: &str =
    "9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915";
const MAX_ENGINE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_LEGAL_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub git: &'static str,
    pub webview2: &'static str,
    pub engine: &'static str,
    pub code_mode_host: &'static str,
    pub legal: &'static str,
}

pub async fn inspect(engine: &Path) -> RuntimeHealth {
    let binary = engine.to_path_buf();
    let resources = binary
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf);
    let resource_check = tokio::task::spawn_blocking(move || {
        let Some(root) = resources else {
            return ("missing", "missing", "missing");
        };
        let engine = check_asset(&binary, Some(ENGINE_SHA256), MAX_ENGINE_BYTES);
        let host = check_asset(
            &root.join("engine/codex-code-mode-host.exe"),
            Some(CODE_MODE_SHA256),
            MAX_ENGINE_BYTES,
        );
        let legal = [
            ("CODEX-LICENSE.txt", Some(CODEX_LICENSE_SHA256)),
            ("CODEX-NOTICE.txt", Some(CODEX_NOTICE_SHA256)),
            ("THIRD-PARTY-NOTICES.txt", None),
        ]
        .into_iter()
        .map(|(name, hash)| check_asset(&root.join("legal").join(name), hash, MAX_LEGAL_BYTES))
        .find(|status| *status != "ready")
        .unwrap_or("ready");
        (engine, host, legal)
    });
    let (git, files) = tokio::join!(
        probe_command(OsStr::new("git"), &["--version"]),
        resource_check
    );
    let (engine, code_mode_host, legal) = files.unwrap_or(("failed", "failed", "failed"));
    RuntimeHealth {
        git,
        // This IPC can only be called after the native WebView2 window has loaded.
        webview2: "ready",
        engine,
        code_mode_host,
        legal,
    }
}

async fn probe_command(program: &OsStr, arguments: &[&str]) -> &'static str {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    match timeout(Duration::from_secs(3), command.status()).await {
        Ok(Ok(status)) if status.success() => "ready",
        Ok(Ok(_)) => "failed",
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => "missing",
        Ok(Err(_)) => "failed",
        Err(_) => "timeout",
    }
}

fn check_asset(path: &Path, expected_sha256: Option<&str>, max_bytes: u64) -> &'static str {
    let metadata = match path.symlink_metadata() {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
        Err(_) => return "unreadable",
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return "corrupt";
    }
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return "corrupt";
    }
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return "unreadable",
    };
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut count = 0_u64;
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(length) => {
                count += length as u64;
                if count > max_bytes {
                    return "corrupt";
                }
                digest.update(&buffer[..length]);
            }
            Err(_) => return "unreadable",
        }
    }
    if count == 0 || count != metadata.len() {
        return "corrupt";
    }
    if expected_sha256.is_some_and(|expected| format!("{:x}", digest.finalize()) != expected) {
        return "corrupt";
    }
    "ready"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_missing_corrupt_and_matching_assets_without_exposing_contents() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("resource.txt");
        assert_eq!(check_asset(&file, None, 10), "missing");
        std::fs::write(&file, b"").unwrap();
        assert_eq!(check_asset(&file, None, 10), "corrupt");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(check_asset(&file, None, 2), "corrupt");
        assert_eq!(check_asset(&file, None, 10), "ready");
        assert_eq!(
            check_asset(
                &file,
                Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
                10,
            ),
            "ready"
        );
        assert_eq!(check_asset(&file, Some(ENGINE_SHA256), 10), "corrupt");
    }

    #[tokio::test]
    async fn missing_git_command_is_reported_without_user_workspace_or_output() {
        assert_eq!(
            probe_command(
                OsStr::new("fluxcode-nonexistent-git-command"),
                &["--version"]
            )
            .await,
            "missing"
        );
    }
}

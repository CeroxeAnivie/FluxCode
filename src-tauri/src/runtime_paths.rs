//! Adapt existing directories for native dependencies that still use MAX_PATH.
use std::{
    io,
    path::{Path, PathBuf},
};

/// Keep storage in place. Windows short names are aliases of the same directory,
/// not a second storage location, junction, or persistent drive mapping.
pub fn sqlite_home(home: &Path) -> io::Result<PathBuf> {
    native_directory(home, 48)
}

pub fn webview_home(home: &Path) -> io::Result<PathBuf> {
    native_directory(home, 96)
}

/// Native Windows components inspect the executable path independently of the
/// WebView data path. Relaunch through the same file's short alias before COM
/// initialization; keep the launcher alive so callers can track process exit.
#[cfg(windows)]
pub fn compatible_executable(executable: &Path) -> io::Result<Option<PathBuf>> {
    use std::os::windows::ffi::OsStrExt;
    if executable.as_os_str().encode_wide().count() < 260 {
        return Ok(None);
    }
    let parent = executable
        .parent()
        .ok_or_else(|| io::Error::other("无法定位程序目录"))?;
    let name = executable
        .file_name()
        .ok_or_else(|| io::Error::other("无法定位程序文件"))?;
    let alias = native_directory(parent, name.encode_wide().count() + 1)?.join(name);
    if std::fs::canonicalize(&alias)? != std::fs::canonicalize(executable)? {
        return Err(io::Error::other(
            "程序路径别名验证失败，请将整个程序目录移至较短路径后重试。",
        ));
    }
    Ok(Some(alias))
}

fn native_directory(home: &Path, reserve: usize) -> io::Result<PathBuf> {
    let canonical = std::fs::canonicalize(home)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::{OsStrExt, OsStringExt};
        use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;
        // Reserve space for files created below the native runtime directory.
        let ordinary = dunce::simplified(&canonical);
        if ordinary.as_os_str().encode_wide().count() + reserve < 260 {
            return Ok(ordinary.to_path_buf());
        }
        let input: Vec<u16> = canonical.as_os_str().encode_wide().chain(Some(0)).collect();
        let required = unsafe { GetShortPathNameW(input.as_ptr(), std::ptr::null_mut(), 0) };
        if required == 0 {
            return Err(io::Error::other(
                "引擎数据目录过长，且无法取得 Windows 短路径。请退出后将整个程序目录移至较短路径；原有数据未删除。",
            ));
        }
        let mut output = vec![0u16; required as usize];
        let written = unsafe { GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), required) };
        if written == 0 || written >= required {
            return Err(io::Error::other(
                "无法解析引擎数据目录的 Windows 短路径，请将整个程序目录移至较短路径后重试。",
            ));
        }
        output.truncate(written as usize);
        let short = PathBuf::from(std::ffi::OsString::from_wide(&output));
        let short = dunce::simplified(&short).to_path_buf();
        if short.as_os_str().encode_wide().count() + reserve >= 260 {
            return Err(io::Error::other(
                "此磁盘未提供足够短的目录别名。请退出后将整个程序目录移至较短路径；原有数据未删除。",
            ));
        }
        if std::fs::canonicalize(&short)? != canonical {
            return Err(io::Error::other(
                "引擎数据目录别名验证失败，已停止启动以保护历史数据。",
            ));
        }
        Ok(short)
    }
    #[cfg(not(windows))]
    {
        let _ = reserve;
        Ok(canonical)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_existing_directory_without_creating_storage() {
        let root = tempfile::tempdir().unwrap();
        let resolved = sqlite_home(root.path()).unwrap();
        assert_eq!(
            std::fs::canonicalize(resolved).unwrap(),
            std::fs::canonicalize(root.path()).unwrap()
        );
        assert!(sqlite_home(&root.path().join("missing")).is_err());
        assert!(!root.path().join("missing").exists());
    }

    #[cfg(windows)]
    #[test]
    fn long_directory_uses_same_storage_or_reports_explicit_limitation() {
        let root = tempfile::tempdir().unwrap();
        let long = (0..4).fold(root.path().to_path_buf(), |p, i| {
            p.join(format!("segment-{i}-{}", "a".repeat(55)))
        });
        std::fs::create_dir_all(&long).unwrap();
        let marker = long.join("history.txt");
        std::fs::write(&marker, "保留历史").unwrap();
        match sqlite_home(&long) {
            Ok(short) => {
                assert_eq!(
                    std::fs::read_to_string(short.join("history.txt")).unwrap(),
                    "保留历史"
                );
                let db = rusqlite::Connection::open(short.join("thread_history_1.sqlite")).unwrap();
                db.execute_batch("CREATE TABLE history (body TEXT);")
                    .unwrap();
                assert!(long.join("thread_history_1.sqlite").exists());
            }
            Err(error) => assert!(error.to_string().contains("短")),
        }
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "保留历史");
    }

    #[cfg(windows)]
    #[test]
    fn long_executable_alias_preserves_file_identity() {
        let root = tempfile::tempdir().unwrap();
        let parent = (0..4).fold(root.path().to_path_buf(), |p, i| {
            p.join(format!("segment-{i}-{}", "b".repeat(55)))
        });
        std::fs::create_dir_all(&parent).unwrap();
        let executable = parent.join("FluxCode.exe");
        std::fs::write(&executable, b"fixture executable").unwrap();
        match compatible_executable(&executable) {
            Ok(Some(alias)) => {
                assert_eq!(
                    std::fs::canonicalize(alias).unwrap(),
                    std::fs::canonicalize(executable).unwrap()
                );
            }
            Err(error) => assert!(error.to_string().contains("短")),
            Ok(None) => panic!("Long executable must not bypass compatibility handling"),
        }
        assert!(
            compatible_executable(&root.path().join("FluxCode.exe"))
                .unwrap()
                .is_none()
        );
    }
}

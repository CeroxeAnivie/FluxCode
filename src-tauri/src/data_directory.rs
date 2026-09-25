//! Application-owned storage, resolved before creating the WebView or engine.
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn beside_executable(executable: &Path) -> io::Result<PathBuf> {
    if !executable.is_absolute() {
        return Err(io::Error::other("Executable path must be absolute"));
    }
    Ok(executable
        .parent()
        .ok_or_else(|| io::Error::other("Executable directory unavailable"))?
        .join("data"))
}

/// Copy first, publish by rename, and never delete or merge over user data.
/// The desktop single-instance guard must have run before migration starts.
pub fn prepare(root: &Path, legacy: Option<(&Path, &Path)>) -> io::Result<()> {
    if !root.is_absolute() {
        return Err(io::Error::other("Data directory must be absolute"));
    }
    if root.exists() {
        reject_link(root)?;
        if !root.is_dir() {
            return Err(io::Error::other("Data path is not a directory"));
        }
    } else {
        let parent = root
            .parent()
            .ok_or_else(|| io::Error::other("Missing data parent"))?;
        fs::create_dir_all(parent)?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(io::Error::other)?
            .as_nanos();
        let stage = parent.join(format!(".fluxcode-data-{}-{nonce}", std::process::id()));
        fs::create_dir(&stage)?;
        let result = (|| {
            if let Some((configuration, webview)) = legacy {
                if configuration.exists() {
                    copy_tree(configuration, &stage, 0)?;
                }
                if webview.exists() {
                    let destination = stage.join("webview");
                    if destination.exists() {
                        return Err(io::Error::other(
                            "Legacy data contains a conflicting webview directory",
                        ));
                    }
                    fs::create_dir(&destination)?;
                    copy_tree(webview, &destination, 0)?;
                }
                relocate_history(&stage, configuration, root)?;
            }
            write_layout(&stage, root, legacy)?;
            // Do not replace an independently created data directory.
            if root.exists() {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "Data directory appeared during migration",
                ));
            }
            fs::rename(&stage, root)
        })();
        if let Err(error) = result {
            // Only this invocation's newly-created staging tree is removed.
            let _ = fs::remove_dir_all(&stage);
            return Err(error);
        }
    }
    let probe = root.join(format!(".write-check-{}", std::process::id()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)?;
    let result = file
        .write_all(b"FluxCode storage check")
        .and_then(|()| file.sync_all());
    drop(file);
    let cleanup = fs::remove_file(probe);
    result.and(cleanup)?;
    let previous = read_layout(root)?;
    if let Some(previous) = previous.as_deref() {
        relocate_history(root, previous, root)?;
    }
    if previous.as_deref() != Some(root) {
        write_layout(root, root, None)?;
    }
    let webview = root.join("webview");
    if webview.exists() {
        reject_link(&webview)?;
    }
    fs::create_dir_all(webview)
}

fn read_layout(directory: &Path) -> io::Result<Option<PathBuf>> {
    let path = directory.join("storage-layout.toml");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() => reject_link(&path)?,
        Ok(_) => return Err(io::Error::other("Storage layout is not a regular file")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    }
    let document = fs::read_to_string(path)?
        .parse::<toml_edit::DocumentMut>()
        .map_err(io::Error::other)?;
    if document.get("version").and_then(|value| value.as_integer()) != Some(1) {
        return Err(io::Error::other("Unsupported storage layout version"));
    }
    if document.get("location").and_then(|value| value.as_str()) != Some("application-directory") {
        return Err(io::Error::other("Unsupported storage layout location"));
    }
    let previous = document
        .get("data_root")
        .and_then(|value| value.as_str())
        .ok_or_else(|| io::Error::other("Storage layout is missing its data root"))?;
    let previous = PathBuf::from(previous);
    if !previous.is_absolute() {
        return Err(io::Error::other("Storage layout data root is not absolute"));
    }
    Ok(Some(previous))
}

fn write_layout(
    directory: &Path,
    final_root: &Path,
    legacy: Option<(&Path, &Path)>,
) -> io::Result<()> {
    let path = directory.join("storage-layout.toml");
    let mut document = if read_layout(directory)?.is_some() {
        fs::read_to_string(&path)?
            .parse::<toml_edit::DocumentMut>()
            .map_err(io::Error::other)?
    } else {
        toml_edit::DocumentMut::new()
    };
    document["version"] = toml_edit::value(1);
    document["location"] = toml_edit::value("application-directory");
    document["data_root"] = toml_edit::value(
        final_root
            .to_str()
            .ok_or_else(|| io::Error::other("Data path is not Unicode"))?,
    );
    if let Some((configuration, webview)) = legacy {
        if configuration.exists() {
            document["legacy_configuration"] = toml_edit::value(
                configuration
                    .to_str()
                    .ok_or_else(|| io::Error::other("Legacy data path is not Unicode"))?,
            );
        }
        if webview.exists() {
            document["legacy_webview"] = toml_edit::value(
                webview
                    .to_str()
                    .ok_or_else(|| io::Error::other("Legacy webview path is not Unicode"))?,
            );
        }
    }
    let temporary = directory.join("storage-layout.toml.tmp");
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(document.to_string().as_bytes())?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)
}

/// Codex indexes absolute rollout paths. Rebase only engine-owned files, never project paths.
fn relocate_history(directory: &Path, previous: &Path, next: &Path) -> io::Result<()> {
    if previous == next || !directory.join("engine-home").exists() {
        return Ok(());
    }
    reject_link(&directory.join("engine-home"))?;
    for entry in fs::read_dir(directory.join("engine-home"))? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("state_") || !name.ends_with(".sqlite") {
            continue;
        }
        reject_link(&entry.path())?;
        let mut database = rusqlite::Connection::open_with_flags(
            fs::canonicalize(entry.path())?,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        )
        .map_err(io::Error::other)?;
        database
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(io::Error::other)?;
        let transaction = database.transaction().map_err(io::Error::other)?;
        for table in ["threads", "rollout_migration_skipped_rollouts"] {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [table],
                    |row| row.get(0),
                )
                .map_err(io::Error::other)?;
            if !exists {
                continue;
            }
            // Table identifiers are fixed above, never provided by users.
            let mut statement = transaction
                .prepare(&format!("SELECT DISTINCT rollout_path FROM {table}"))
                .map_err(io::Error::other)?;
            let paths = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(io::Error::other)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(io::Error::other)?;
            drop(statement);
            for path in paths {
                if let Some(relative) =
                    engine_relative_path(Path::new(&path), &previous.join("engine-home"))
                {
                    let target = next.join("engine-home").join(relative);
                    let target = target
                        .to_str()
                        .ok_or_else(|| io::Error::other("Rollout path is not Unicode"))?;
                    transaction
                        .execute(
                            &format!(
                                "UPDATE {table} SET rollout_path = ?1 WHERE rollout_path = ?2"
                            ),
                            [target, path.as_str()],
                        )
                        .map_err(io::Error::other)?;
                }
            }
        }
        transaction.commit().map_err(io::Error::other)?;
        database
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(io::Error::other)?;
    }
    Ok(())
}

fn engine_relative_path(path: &Path, prefix: &Path) -> Option<PathBuf> {
    if let Ok(relative) = path.strip_prefix(prefix) {
        return clean_relative_path(relative);
    }
    #[cfg(windows)]
    {
        let mut path_parts = path.components();
        for expected in prefix.components() {
            let actual = path_parts.next()?;
            if !same_windows_component(actual, expected) {
                return None;
            }
        }
        clean_relative_path(&path_parts.collect::<PathBuf>())
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn same_windows_component(
    actual: std::path::Component<'_>,
    expected: std::path::Component<'_>,
) -> bool {
    use std::path::{Component, Prefix};
    match (actual, expected) {
        (Component::Prefix(actual), Component::Prefix(expected)) => {
            match (actual.kind(), expected.kind()) {
                (
                    Prefix::Disk(a) | Prefix::VerbatimDisk(a),
                    Prefix::Disk(b) | Prefix::VerbatimDisk(b),
                ) => a.eq_ignore_ascii_case(&b),
                (
                    Prefix::UNC(a_server, a_share) | Prefix::VerbatimUNC(a_server, a_share),
                    Prefix::UNC(b_server, b_share) | Prefix::VerbatimUNC(b_server, b_share),
                ) => windows_case_eq(a_server, b_server) && windows_case_eq(a_share, b_share),
                (Prefix::Verbatim(a), Prefix::Verbatim(b))
                | (Prefix::DeviceNS(a), Prefix::DeviceNS(b)) => windows_case_eq(a, b),
                _ => false,
            }
        }
        (Component::Normal(a), Component::Normal(b)) => windows_case_eq(a, b),
        (Component::RootDir, Component::RootDir) => true,
        _ => false,
    }
}

#[cfg(windows)]
fn windows_case_eq(actual: &std::ffi::OsStr, expected: &std::ffi::OsStr) -> bool {
    match (actual.to_str(), expected.to_str()) {
        (Some(actual), Some(expected)) => actual.to_lowercase() == expected.to_lowercase(),
        _ => false,
    }
}

fn clean_relative_path(path: &Path) -> Option<PathBuf> {
    path.components()
        .all(|component| matches!(component, std::path::Component::Normal(_)))
        .then(|| path.to_path_buf())
}

fn reject_link(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(io::Error::other(
                "Linked storage directories are not supported",
            ));
        }
    }
    if metadata.file_type().is_symlink() {
        return Err(io::Error::other(
            "Linked storage directories are not supported",
        ));
    }
    Ok(())
}

fn copy_tree(source: &Path, destination: &Path, depth: usize) -> io::Result<()> {
    if depth > 64 {
        return Err(io::Error::other(
            "Legacy storage exceeds maximum directory depth",
        ));
    }
    reject_link(source)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        reject_link(&from)?;
        let to = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            fs::create_dir(&to)?;
            copy_tree(&from, &to, depth + 1)?;
        } else if entry.file_type()?.is_file() {
            let mut input = fs::File::open(&from)?;
            let mut output = OpenOptions::new().write(true).create_new(true).open(&to)?;
            io::copy(&mut input, &mut output)?;
            output.sync_all()?;
        } else {
            return Err(io::Error::other("Unsupported file in legacy storage"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_executable_directory_not_working_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            beside_executable(&dir.path().join("FluxCode.exe")).unwrap(),
            dir.path().join("data")
        );
        assert!(beside_executable(Path::new("FluxCode.exe")).is_err());
    }

    #[test]
    fn never_rebases_history_paths_containing_parent_components() {
        let prefix = Path::new("C:/FluxCode/data/engine-home");
        assert!(
            engine_relative_path(
                Path::new("C:/FluxCode/data/engine-home/../other/one.jsonl"),
                prefix,
            )
            .is_none()
        );
    }

    #[test]
    fn migrates_engine_and_webview_without_removing_originals() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old");
        let web = dir.path().join("old-web");
        fs::create_dir_all(old.join("engine-home/sessions")).unwrap();
        fs::create_dir_all(web.join("EBWebView/Default/Local Storage")).unwrap();
        fs::write(old.join("engine-home/sessions/history.jsonl"), "中文对话\n").unwrap();
        fs::write(web.join("EBWebView/Default/Local Storage/index"), b"draft").unwrap();
        let root = dir.path().join("app/data");
        prepare(&root, Some((&old, &web))).unwrap();
        assert_eq!(
            fs::read(root.join("engine-home/sessions/history.jsonl")).unwrap(),
            fs::read(old.join("engine-home/sessions/history.jsonl")).unwrap()
        );
        assert_eq!(
            fs::read(root.join("webview/EBWebView/Default/Local Storage/index")).unwrap(),
            b"draft"
        );
        let layout = fs::read_to_string(root.join("storage-layout.toml"))
            .unwrap()
            .parse::<toml_edit::DocumentMut>()
            .unwrap();
        assert_eq!(
            layout
                .get("legacy_configuration")
                .and_then(|value| value.as_str()),
            old.to_str()
        );
        assert_eq!(
            layout
                .get("legacy_webview")
                .and_then(|value| value.as_str()),
            web.to_str()
        );
        fs::write(
            root.join("engine-home/sessions/history.jsonl"),
            "new history",
        )
        .unwrap();
        prepare(&root, Some((&old, &web))).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("engine-home/sessions/history.jsonl")).unwrap(),
            "new history"
        );
    }

    #[test]
    fn failed_migration_never_publishes_partial_data() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old");
        let web = dir.path().join("old-web");
        fs::create_dir_all(old.join("webview")).unwrap();
        fs::create_dir(&web).unwrap();
        let root = dir.path().join("data");
        assert!(prepare(&root, Some((&old, &web))).is_err());
        assert!(!root.exists());
        assert!(old.join("webview").exists());
    }

    #[test]
    fn refuses_a_file_as_data_root_and_never_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("data");
        fs::write(&root, b"keep").unwrap();
        assert!(prepare(&root, None).is_err());
        assert_eq!(fs::read(&root).unwrap(), b"keep");
    }

    #[test]
    fn unsupported_layout_version_is_preserved_without_downgrading() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        fs::create_dir(&root).unwrap();
        let layout = root.join("storage-layout.toml");
        let future = format!(
            "version = 2\nlocation = \"application-directory\"\ndata_root = {:?}\n",
            root.to_str().unwrap()
        );
        fs::write(&layout, &future).unwrap();
        assert!(
            prepare(&root, None)
                .unwrap_err()
                .to_string()
                .contains("Unsupported storage layout version")
        );
        assert_eq!(fs::read_to_string(layout).unwrap(), future);
        assert!(!root.join("webview").exists());
    }

    #[test]
    fn unchanged_layout_is_not_rewritten_on_repeated_startup() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("data");
        prepare(&root, None).unwrap();
        let layout = root.join("storage-layout.toml");
        let original = fs::read_to_string(&layout).unwrap();
        fs::create_dir(root.join("storage-layout.toml.tmp")).unwrap();
        prepare(&root, None).unwrap();
        assert_eq!(fs::read_to_string(layout).unwrap(), original);
    }

    #[test]
    fn interrupted_layout_update_retries_without_losing_rebased_history() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("first/data");
        fs::create_dir_all(first.join("engine-home/sessions")).unwrap();
        let history = first.join("engine-home/sessions/one.jsonl");
        fs::write(&history, "saved history").unwrap();
        let database =
            rusqlite::Connection::open(first.join("engine-home/state_5.sqlite")).unwrap();
        database
            .execute_batch("CREATE TABLE threads (rollout_path TEXT NOT NULL);")
            .unwrap();
        database
            .execute(
                "INSERT INTO threads VALUES (?1)",
                [history.to_str().unwrap()],
            )
            .unwrap();
        drop(database);
        prepare(&first, None).unwrap();
        let layout = first.join("storage-layout.toml");
        let mut text = fs::read_to_string(&layout).unwrap();
        text.push_str("# preserve migration notes\n");
        fs::write(&layout, text).unwrap();

        let moved = temp.path().join("moved/data");
        fs::create_dir_all(moved.parent().unwrap()).unwrap();
        fs::rename(&first, &moved).unwrap();
        fs::create_dir(moved.join("storage-layout.toml.tmp")).unwrap();
        assert!(prepare(&moved, None).is_err());
        assert!(
            fs::read_to_string(moved.join("storage-layout.toml"))
                .unwrap()
                .contains(first.to_str().unwrap())
        );
        fs::remove_dir(moved.join("storage-layout.toml.tmp")).unwrap();
        prepare(&moved, None).unwrap();
        prepare(&moved, None).unwrap();

        let database =
            rusqlite::Connection::open(moved.join("engine-home/state_5.sqlite")).unwrap();
        let indexed: String = database
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&indexed),
            moved.join("engine-home/sessions/one.jsonl")
        );
        assert_eq!(fs::read_to_string(indexed).unwrap(), "saved history");
        let layout = fs::read_to_string(moved.join("storage-layout.toml")).unwrap();
        assert!(layout.contains(moved.to_str().unwrap()));
        assert!(layout.contains("# preserve migration notes"));
    }

    #[test]
    fn sqlite_paths_follow_migration_and_subsequent_directory_move() {
        let temp = tempfile::tempdir().unwrap();
        let old = temp.path().join("legacy");
        fs::create_dir_all(old.join("engine-home/sessions")).unwrap();
        let history = old.join("engine-home/sessions/one.jsonl");
        fs::write(&history, "history").unwrap();
        let database = rusqlite::Connection::open(old.join("engine-home/state_5.sqlite")).unwrap();
        database
            .execute_batch("CREATE TABLE threads (rollout_path TEXT NOT NULL);")
            .unwrap();
        database
            .execute(
                "INSERT INTO threads VALUES (?1)",
                [history.to_str().unwrap()],
            )
            .unwrap();
        drop(database);
        let root = temp.path().join("data");
        prepare(&root, Some((&old, &temp.path().join("absent-webview")))).unwrap();
        let moved = temp.path().join("moved-data");
        fs::rename(&root, &moved).unwrap();
        prepare(&moved, None).unwrap();
        let database =
            rusqlite::Connection::open(moved.join("engine-home/state_5.sqlite")).unwrap();
        let path: String = database
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&path),
            moved.join("engine-home/sessions/one.jsonl")
        );
        let original = rusqlite::Connection::open(old.join("engine-home/state_5.sqlite")).unwrap();
        let path: String = original
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(Path::new(&path), history);
    }

    #[cfg(windows)]
    #[test]
    fn moved_directory_rebases_sqlite_paths_after_a_case_only_rename() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("DATA");
        let second = temp.path().join("data");
        let third = temp.path().join("moved-中文 data");
        fs::create_dir_all(first.join("engine-home/sessions")).unwrap();
        let database =
            rusqlite::Connection::open(first.join("engine-home/state_5.sqlite")).unwrap();
        database
            .execute_batch("CREATE TABLE threads (rollout_path TEXT NOT NULL);")
            .unwrap();
        let initial = first.join("engine-home/sessions/one.jsonl");
        fs::write(&initial, "中文历史").unwrap();
        database
            .execute(
                "INSERT INTO threads VALUES (?1)",
                [initial.to_str().unwrap()],
            )
            .unwrap();
        drop(database);
        prepare(&first, None).unwrap();
        prepare(&second, None).unwrap();
        fs::rename(&second, &third).unwrap();
        prepare(&third, None).unwrap();
        let database =
            rusqlite::Connection::open(third.join("engine-home/state_5.sqlite")).unwrap();
        let saved: String = database
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&saved),
            third.join("engine-home/sessions/one.jsonl")
        );
        assert_eq!(fs::read_to_string(saved).unwrap(), "中文历史");
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_drive_and_unc_paths_match_ordinary_windows_paths() {
        let drive = engine_relative_path(
            Path::new(r"\\?\c:\FLUXCODE\data\ENGINE-HOME\sessions\中文.jsonl"),
            Path::new(r"C:\FluxCode\data\engine-home"),
        );
        assert_eq!(drive, Some(PathBuf::from(r"sessions\中文.jsonl")));
        let unc = engine_relative_path(
            Path::new(r"\\?\UNC\SERVER\Share\FluxCode\data\engine-home\sessions\one.jsonl"),
            Path::new(r"\\server\share\FluxCode\data\engine-home"),
        );
        assert_eq!(unc, Some(PathBuf::from(r"sessions\one.jsonl")));
        assert!(
            engine_relative_path(
                Path::new(r"\\?\c:\FluxCode\data-other\engine-home\sessions\one.jsonl"),
                Path::new(r"C:\FluxCode\data\engine-home"),
            )
            .is_none()
        );
    }

    #[cfg(windows)]
    #[test]
    fn moved_long_path_retains_history_and_rebases_index() {
        let temp = tempfile::tempdir().unwrap();
        let parent = (0..4).fold(temp.path().to_path_buf(), |path, index| {
            path.join(format!("segment-{index}-{}", "a".repeat(55)))
        });
        let first = parent.join("app-one/data");
        fs::create_dir_all(first.join("engine-home/sessions")).unwrap();
        let history = first.join("engine-home/sessions/one.jsonl");
        fs::write(&history, "long-path history").unwrap();
        let database_path = first.join("engine-home/state_5.sqlite");
        fs::write(&database_path, []).unwrap();
        let database =
            rusqlite::Connection::open(fs::canonicalize(database_path).unwrap()).unwrap();
        database
            .execute_batch("CREATE TABLE threads (rollout_path TEXT NOT NULL);")
            .unwrap();
        database
            .execute(
                "INSERT INTO threads VALUES (?1)",
                [history.to_str().unwrap()],
            )
            .unwrap();
        drop(database);
        prepare(&first, None).unwrap();
        let second = parent.join("app-two/data");
        fs::create_dir_all(second.parent().unwrap()).unwrap();
        fs::rename(&first, &second).unwrap();
        prepare(&second, None).unwrap();
        let database = rusqlite::Connection::open(
            fs::canonicalize(second.join("engine-home/state_5.sqlite")).unwrap(),
        )
        .unwrap();
        let saved: String = database
            .query_row("SELECT rollout_path FROM threads", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            Path::new(&saved),
            second.join("engine-home/sessions/one.jsonl")
        );
        assert_eq!(fs::read_to_string(saved).unwrap(), "long-path history");
    }
}

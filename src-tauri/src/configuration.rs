//! Validated configuration snapshots. A malformed edit never replaces the running snapshot.
use crate::config::{self, AppConfig, Appearance, Settings};
use serde::Serialize;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{Emitter, Manager};
use tokio::{io::AsyncReadExt, sync::Mutex};

const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub settings_revision: u64,
    pub settings: Settings,
    pub ui: config::UiConfig,
    pub appearance: Appearance,
    pub appearance_configured: bool,
    pub error: Option<String>,
    pub watching: bool,
}

struct Current {
    config: AppConfig,
    text: String,
    revision: u64,
    settings_revision: u64,
    error: Option<String>,
}

pub struct Configuration {
    root: PathBuf,
    current: Mutex<Current>,
    // Serializes refresh and writes, including read-modify-write operations.
    mutation: Mutex<()>,
    watching: std::sync::atomic::AtomicBool,
}

async fn read(root: &std::path::Path) -> Result<String, String> {
    let file = tokio::fs::File::open(root.join("fluxcode.toml"))
        .await
        .map_err(|_| "无法读取配置文件")?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "无法读取配置文件")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("配置文件超过 1 MiB 上限".into());
    }
    String::from_utf8(bytes).map_err(|_| "配置文件必须使用 UTF-8".into())
}

fn parse(text: &str) -> Result<AppConfig, String> {
    let config: AppConfig =
        toml_edit::de::from_str(text).map_err(|_| "配置格式错误，继续使用上一份有效配置")?;
    config.validate()?;
    Ok(config)
}

impl Configuration {
    pub async fn open(root: PathBuf) -> Result<Arc<Self>, String> {
        // Create defaults only when absent. Never overwrite an invalid user file.
        if !root.join("fluxcode.toml").exists() {
            config::load_config(&root).await?;
        }
        let initial = read(&root)
            .await
            .and_then(|text| parse(&text).map(|config| (config, text)));
        let (config, text, error) = match initial {
            Ok((config, text)) => (config, text, None),
            Err(_) => {
                let backup = tokio::fs::read_to_string(root.join("fluxcode.toml.bak"))
                    .await
                    .ok();
                let recovered = backup
                    .as_deref()
                    .and_then(|text| parse(text).ok().map(|config| (config, text.to_owned())));
                let (config, text) = match recovered {
                    Some(value) => value,
                    None => {
                        let text = include_str!("../../config/fluxcode.example.toml").to_owned();
                        (parse(&text)?, text)
                    }
                };
                (
                    config,
                    text,
                    Some("配置无法加载，已使用备份或默认值；原文件未被覆盖".into()),
                )
            }
        };
        Ok(Arc::new(Self {
            root,
            current: Mutex::new(Current {
                config,
                text,
                revision: 1,
                settings_revision: 1,
                error,
            }),
            mutation: Mutex::new(()),
            watching: std::sync::atomic::AtomicBool::new(true),
        }))
    }

    pub async fn config(&self) -> AppConfig {
        self.current.lock().await.config.clone()
    }

    pub async fn snapshot(&self) -> Snapshot {
        let current = self.current.lock().await;
        Snapshot {
            revision: current.revision,
            settings_revision: current.settings_revision,
            settings: current.config.settings(),
            ui: current.config.ui.clone(),
            appearance: current.config.appearance.clone(),
            appearance_configured: current
                .text
                .parse::<toml_edit::DocumentMut>()
                .ok()
                .is_some_and(|doc| doc.contains_key("appearance")),
            error: current.error.clone(),
            watching: self.watching.load(std::sync::atomic::Ordering::Relaxed),
        }
    }

    async fn refresh_locked(&self) -> bool {
        let result = read(&self.root)
            .await
            .and_then(|text| parse(&text).map(|config| (text, config)));
        let mut current = self.current.lock().await;
        match result {
            Ok((text, config)) => {
                if text == current.text && current.error.is_none() {
                    return false;
                }
                if current.config.settings() != config.settings() {
                    current.settings_revision += 1;
                }
                current.text = text;
                current.config = config;
                current.error = None;
            }
            Err(error) => {
                if current.error.as_ref() == Some(&error) {
                    return false;
                }
                tracing::warn!(
                    event = "configuration_rejected",
                    "Keeping previous valid configuration"
                );
                current.error = Some(error);
            }
        }
        current.revision += 1;
        true
    }

    pub async fn refresh(&self) -> bool {
        let _guard = self.mutation.lock().await;
        self.refresh_locked().await
    }

    async fn watcher_failed(&self, app: &tauri::AppHandle) {
        self.watching
            .store(false, std::sync::atomic::Ordering::Relaxed);
        self.current.lock().await.revision += 1;
        let _ = app.emit("configuration-changed", self.snapshot().await);
    }

    pub async fn save_appearance(
        &self,
        appearance: &Appearance,
        migrate: bool,
    ) -> Result<Snapshot, String> {
        let _guard = self.mutation.lock().await;
        self.refresh_locked().await;
        if self.current.lock().await.error.is_some() {
            return Err("请先修复配置文件，再保存设置".into());
        }
        if !migrate || !self.snapshot().await.appearance_configured {
            config::save_appearance(&self.root, appearance).await?;
            self.refresh_locked().await;
        }
        Ok(self.snapshot().await)
    }

    pub async fn save_font(&self, size: u16) -> Result<(), String> {
        let _guard = self.mutation.lock().await;
        config::save_font_size(&self.root, size).await?;
        self.refresh_locked().await;
        Ok(())
    }
    pub async fn save_panel_width(&self, panel: &str, width: u16) -> Result<(), String> {
        let _guard = self.mutation.lock().await;
        config::save_panel_width(&self.root, panel, width).await?;
        self.refresh_locked().await;
        Ok(())
    }

    pub async fn save_settings(
        &self,
        settings: &Settings,
        expected_revision: Option<u64>,
    ) -> Result<(), String> {
        let _guard = self.mutation.lock().await;
        self.refresh_locked().await;
        let current_revision = self.current.lock().await.settings_revision;
        if expected_revision.is_some_and(|revision| revision != current_revision) {
            return Err("配置已在其他位置更新，请先载入最新设置。当前输入仍保留。".into());
        }
        config::save_settings(&self.root, settings).await?;
        self.refresh_locked().await;
        Ok(())
    }
}

pub async fn serve(app: tauri::AppHandle) {
    use notify::Watcher;
    let (sender, mut events) = tokio::sync::mpsc::channel(1);
    let mut watcher =
        match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if event.as_ref().map_or(true, |event| {
                matches!(
                    event.kind,
                    notify::EventKind::Create(_)
                        | notify::EventKind::Modify(_)
                        | notify::EventKind::Remove(_)
                ) && event
                    .paths
                    .iter()
                    .any(|path| path.file_name().is_some_and(|name| name == "fluxcode.toml"))
            }) {
                let _ = sender.try_send(event.is_ok());
            }
        }) {
            Ok(watcher) => watcher,
            Err(_) => {
                tracing::error!("configuration_watcher_start_failed");
                app.state::<crate::AppState>()
                    .configuration
                    .watcher_failed(&app)
                    .await;
                return;
            }
        };
    let root = app.state::<crate::AppState>().data_dir.clone();
    if watcher
        .watch(&root, notify::RecursiveMode::NonRecursive)
        .is_err()
    {
        tracing::error!("configuration_watch_failed");
        app.state::<crate::AppState>()
            .configuration
            .watcher_failed(&app)
            .await;
        return;
    }
    loop {
        let store = &app.state::<crate::AppState>().configuration;
        store.refresh().await;
        let snapshot = store.snapshot().await;
        // Revision filtering also publishes settings written through the UI.
        let previous = app
            .state::<crate::AppState>()
            .configuration_revision
            .swap(snapshot.revision, std::sync::atomic::Ordering::Relaxed);
        if previous != snapshot.revision {
            let _ = app.emit("configuration-changed", snapshot);
        }
        match events.recv().await {
            None => break,
            Some(false) => {
                store.watcher_failed(&app).await;
                break;
            }
            Some(true) => {}
        }
        // Coalesce editor rename/write bursts in a bounded single-slot channel.
        tokio::time::sleep(Duration::from_millis(250)).await;
        if matches!(events.try_recv(), Ok(false)) {
            store.watcher_failed(&app).await;
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn stale_connection_form_cannot_overwrite_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let store = Configuration::open(dir.path().into()).await.unwrap();
        let initial = store.snapshot().await;
        let changed = read(dir.path())
            .await
            .unwrap()
            .replace("model = \"\"", "model = \"external-model\"");
        tokio::fs::write(dir.path().join("fluxcode.toml"), &changed)
            .await
            .unwrap();
        let mut stale = initial.settings;
        stale.model = "stale-model".into();
        assert!(
            store
                .save_settings(&stale, Some(initial.settings_revision))
                .await
                .is_err()
        );
        assert_eq!(read(dir.path()).await.unwrap(), changed);
        let snapshot = store.snapshot().await;
        store.save_font(16).await.unwrap();
        assert!(
            store
                .save_settings(&stale, Some(snapshot.settings_revision))
                .await
                .is_ok()
        );
        assert_eq!(store.config().await.ui.font_size, 16);
    }

    #[tokio::test]
    async fn concurrent_ui_writes_preserve_both_sections() {
        let dir = tempfile::tempdir().unwrap();
        let store = Configuration::open(dir.path().into()).await.unwrap();
        let appearance = Appearance {
            language: "en".into(),
            theme: "light".into(),
        };
        let (a, b) = tokio::join!(
            store.save_font(18),
            store.save_appearance(&appearance, false)
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(store.config().await.ui.font_size, 18);
        assert_eq!(store.config().await.appearance, appearance);
    }
    #[tokio::test]
    async fn malformed_edits_keep_previous_snapshot_and_recover() {
        let dir = tempfile::tempdir().unwrap();
        let store = Configuration::open(dir.path().into()).await.unwrap();
        store.save_font(17).await.unwrap();
        tokio::fs::write(dir.path().join("fluxcode.toml"), "[broken")
            .await
            .unwrap();
        assert!(store.refresh().await);
        assert_eq!(store.config().await.ui.font_size, 17);
        assert!(store.snapshot().await.error.is_some());
        assert!(!store.refresh().await);
        assert!(
            store
                .save_appearance(&Appearance::default(), false)
                .await
                .is_err()
        );
        tokio::fs::write(
            dir.path().join("fluxcode.toml"),
            include_str!("../../config/fluxcode.example.toml"),
        )
        .await
        .unwrap();
        assert!(store.refresh().await);
        assert!(store.snapshot().await.error.is_none());
    }
    #[tokio::test]
    async fn migration_preserves_explicit_preferences_and_comments() {
        let dir = tempfile::tempdir().unwrap();
        let store = Configuration::open(dir.path().into()).await.unwrap();
        let english = Appearance {
            language: "en".into(),
            theme: "dark".into(),
        };
        store.save_appearance(&english, false).await.unwrap();
        store
            .save_appearance(&Appearance::default(), true)
            .await
            .unwrap();
        assert_eq!(store.config().await.appearance, english);
        let text = read(dir.path()).await.unwrap();
        assert!(text.contains("# FluxCode configuration"));
        assert!(dir.path().join("fluxcode.toml.bak").is_file());
        assert!(store.save_font(100).await.is_err());
        assert_eq!(read(dir.path()).await.unwrap(), text);
    }
    #[tokio::test]
    async fn invalid_startup_is_recoverable_without_overwriting_file() {
        let dir = tempfile::tempdir().unwrap();
        tokio::fs::write(dir.path().join("fluxcode.toml"), "broken")
            .await
            .unwrap();
        let store = Configuration::open(dir.path().into()).await.unwrap();
        assert!(store.snapshot().await.error.is_some());
        assert_eq!(read(dir.path()).await.unwrap(), "broken");
    }
}

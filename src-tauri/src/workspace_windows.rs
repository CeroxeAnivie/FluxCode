//! Trusted local workspace windows. The main renderer owns shared task mutations;
//! the native host owns the engine and each window's durable private UI state.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::{Emitter, Manager, State, WebviewUrl};
use tokio::sync::oneshot;

const MAX_WINDOWS: usize = 8;
const MAX_COMMANDS: usize = 32;
type Reply = oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
pub struct Windows {
    creation: tokio::sync::Mutex<()>,
    pending: Mutex<HashMap<u64, Reply>>,
    next: AtomicU64,
    terminals: Mutex<HashMap<String, String>>,
    closing: Mutex<HashSet<String>>,
    terminal_changed: tokio::sync::Notify,
}

pub struct TerminalRegistration<'a> {
    state: &'a Windows,
    id: String,
}
impl Drop for TerminalRegistration<'_> {
    fn drop(&mut self) {
        self.state
            .terminals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
        self.state.terminal_changed.notify_waiters();
    }
}
impl Windows {
    pub fn resource_status(&self) -> Value {
        serde_json::json!({"terminalSessions": self.terminals.lock().unwrap_or_else(|e| e.into_inner()).len(), "terminalLimit":16, "windowLimit": MAX_WINDOWS, "pendingWindowRequests":self.pending.lock().unwrap_or_else(|e| e.into_inner()).len(), "windowRequestLimit":MAX_COMMANDS})
    }
    pub fn register_terminal(
        &self,
        id: &str,
        owner: &str,
    ) -> Result<TerminalRegistration<'_>, String> {
        let closing = self.closing.lock().unwrap_or_else(|e| e.into_inner());
        if closing.contains(owner) {
            return Err("窗口正在关闭，请稍后重试。".into());
        }
        let mut entries = self.terminals.lock().unwrap_or_else(|e| e.into_inner());
        if entries.contains_key(id) || entries.len() >= 16 {
            return Err("终端数量已达上限，请先结束一个终端。".into());
        }
        entries.insert(id.into(), owner.into());
        Ok(TerminalRegistration {
            state: self,
            id: id.into(),
        })
    }

    async fn wait_for_terminals(&self, owner: &str) -> Result<(), String> {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let changed = self.terminal_changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if !self
                    .terminals
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .values()
                    .any(|label| label == owner)
                {
                    return;
                }
                changed.await;
            }
        })
        .await
        .map_err(|_| "终端仍在退出，请稍后重试关闭窗口。".into())
    }
}

struct ClosingGuard<'a> {
    state: &'a Windows,
    label: String,
}
impl Drop for ClosingGuard<'_> {
    fn drop(&mut self) {
        self.state
            .closing
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.label);
    }
}

#[tauri::command]
pub async fn runtime_resource_usage(app: tauri::AppHandle) -> Value {
    let windows = app.state::<Windows>();
    let mut window_resources = windows.resource_status();
    window_resources["openWorkspaceWindows"] = serde_json::json!(count(&app));
    let engine = app
        .state::<crate::AppState>()
        .engine
        .lock()
        .await
        .as_ref()
        .map(|engine| engine.resource_status());
    serde_json::json!({"engineResources":engine,"windowResources":window_resources})
}

pub fn is_workspace(label: &str) -> bool {
    label
        .strip_prefix("workspace-")
        .and_then(|n| n.parse::<usize>().ok())
        .is_some_and(|n| (1..=MAX_WINDOWS).contains(&n) && label == format!("workspace-{n}"))
}

pub fn trusted(label: &str) -> bool {
    label == "main" || is_workspace(label)
}

pub fn data_root(root: &Path, label: &str) -> Result<PathBuf, String> {
    if label == "main" {
        return Ok(root.to_path_buf());
    }
    if !is_workspace(label) {
        return Err("此页面无权访问本地工作空间".into());
    }
    let path = root.join("windows").join(label);
    std::fs::create_dir_all(&path).map_err(|_| "无法创建窗口数据目录")?;
    Ok(path)
}

pub fn count(app: &tauri::AppHandle) -> usize {
    app.webview_windows()
        .keys()
        .filter(|label| is_workspace(label))
        .count()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandEvent {
    id: u64,
    window: String,
    command: Value,
}

struct PendingGuard<'a> {
    state: &'a Windows,
    id: u64,
}
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.state
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

#[tauri::command]
pub async fn open_workspace_window(
    app: tauri::AppHandle,
    state: State<'_, Windows>,
    project_id: String,
) -> Result<String, String> {
    if std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return Err("请移除 WEBVIEW2_USER_DATA_FOLDER 环境变量后重启，以启用独立窗口存储。".into());
    }
    if project_id.is_empty() || project_id.len() > 200 {
        return Err("项目标识无效".into());
    }
    let _guard = state.creation.lock().await;
    let label = (1..=MAX_WINDOWS)
        .map(|n| format!("workspace-{n}"))
        .find(|label| app.get_webview_window(label).is_none())
        .ok_or("最多同时打开 8 个工作区窗口")?;
    let root = app.state::<crate::AppState>().data_dir.clone();
    data_root(&root, &label)?;
    let profile = root.join("webview").join(&label);
    std::fs::create_dir_all(&profile).map_err(|_| "无法创建窗口网页数据目录")?;
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("workspace", &label)
        .append_pair("project", &project_id)
        .finish();
    let mut config = app.config().app.windows[0].clone();
    config.label = label.clone();
    config.url = WebviewUrl::App(format!("index.html?{query}").into());
    config.title = "FluxCode".into();
    let window = tauri::WebviewWindowBuilder::from_config(&app, &config)
        .map_err(|e| e.to_string())?
        .data_directory(crate::runtime_paths::webview_home(&profile).map_err(|e| e.to_string())?)
        .build()
        .map_err(|e| format!("无法打开工作区窗口：{e}"))?;
    crate::window_placement::ensure_visible(&window)?;
    Ok(label)
}

#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("主窗口尚未就绪")?;
    window
        .unminimize()
        .and_then(|_| window.show())
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn workspace_request(
    app: tauri::AppHandle,
    caller: tauri::Webview,
    state: State<'_, Windows>,
    command: Value,
) -> Result<Value, String> {
    if !is_workspace(caller.label()) {
        return Err("此请求仅用于工作区窗口".into());
    }
    if serde_json::to_vec(&command)
        .map_err(|e| e.to_string())?
        .len()
        > 2_000_000
    {
        return Err("窗口请求过大".into());
    }
    let id = state.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().unwrap_or_else(|e| e.into_inner());
        let capacity = if command.get("kind").and_then(Value::as_str) == Some("stop") {
            MAX_COMMANDS
        } else {
            MAX_COMMANDS - 4
        };
        if pending.len() >= capacity {
            return Err("窗口请求过多，请稍后重试".into());
        }
        pending.insert(id, tx);
    }
    let _pending = PendingGuard { state: &state, id };
    app.emit_to(
        tauri::EventTarget::webview("main"),
        "workspace-command",
        CommandEvent {
            id,
            window: caller.label().into(),
            command,
        },
    )
    .map_err(|_| "无法联系主窗口")?;
    match tokio::time::timeout(Duration::from_secs(90), rx).await {
        Ok(Ok(result)) => result,
        _ => Err("主窗口响应超时；操作可能已执行，请先刷新任务状态，不要重复发送。".into()),
    }
}

#[tauri::command]
pub fn complete_workspace_request(
    caller: tauri::Webview,
    state: State<'_, Windows>,
    id: u64,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("只有主窗口可以处理共享任务".into());
    }
    if let Some(tx) = state
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)
    {
        let _ = tx.send(match error {
            Some(error) => Err(error),
            None => Ok(result.unwrap_or(Value::Null)),
        });
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct Publication {
    window: String,
    snapshot: Value,
}

#[tauri::command]
pub fn publish_workspace_state(
    app: tauri::AppHandle,
    caller: tauri::Webview,
    publications: Vec<Publication>,
) -> Result<(), String> {
    if caller.label() != "main" || publications.len() > MAX_WINDOWS {
        return Err("窗口状态发布无效".into());
    }
    for publication in publications {
        if !is_workspace(&publication.window) {
            return Err("窗口标识无效".into());
        }
        if app.get_webview_window(&publication.window).is_some() {
            app.emit_to(
                tauri::EventTarget::webview(&publication.window),
                "workspace-state",
                publication.snapshot,
            )
            .map_err(|_| "无法同步窗口状态")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn close_workspace_window(
    app: tauri::AppHandle,
    caller: tauri::Webview,
    state: State<'_, Windows>,
) -> Result<(), String> {
    let label = caller.label();
    if label == "main" && count(&app) > 0 {
        return caller.window().hide().map_err(|e| e.to_string());
    }
    let last_hidden_main = is_workspace(label)
        && count(&app) == 1
        && app
            .get_webview_window("main")
            .is_some_and(|main| !main.is_visible().unwrap_or(true));
    let mut closing_guard = None;
    if is_workspace(label) {
        {
            let mut closing = state.closing.lock().unwrap_or_else(|e| e.into_inner());
            if !closing.insert(label.into()) {
                return Err("窗口正在关闭，请稍后重试。".into());
            }
        }
        closing_guard = Some(ClosingGuard {
            state: &state,
            label: label.into(),
        });
        let ids: Vec<String> = state
            .terminals
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|(_, owner)| owner.as_str() == label)
            .map(|(id, _)| id.clone())
            .collect();
        let engine = app.state::<crate::AppState>().engine.lock().await.clone();
        if let Some(engine) = engine {
            for id in ids {
                engine
                    .request(
                        "command/exec/terminate",
                        serde_json::json!({"processId":id}),
                        Duration::from_secs(5),
                    )
                    .await?;
            }
        }
        state.wait_for_terminals(label).await?;
        app.emit_to(
            tauri::EventTarget::webview("main"),
            "workspace-closed",
            label,
        )
        .map_err(|e| e.to_string())?;
    }
    caller.window().destroy().map_err(|e| e.to_string())?;
    drop(closing_guard);
    if last_hidden_main && let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn workspace_host_ready(app: tauri::AppHandle, caller: tauri::Webview) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("只有主窗口可以发布连接状态".into());
    }
    for label in app
        .webview_windows()
        .keys()
        .filter(|label| is_workspace(label))
    {
        app.emit_to(tauri::EventTarget::webview(label), "workspace-refresh", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn workspace_exit_needs_confirmation(
    app: tauri::AppHandle,
    caller: tauri::Webview,
) -> Result<bool, String> {
    if caller.label() != "main" || count(&app) > 0 {
        return Ok(false);
    }
    Ok(app
        .state::<crate::AppState>()
        .engine
        .lock()
        .await
        .as_ref()
        .is_some_and(|engine| engine.has_running_work()))
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn close_waits_for_actual_release_and_rejects_new_terminals() {
        let state = super::Windows::default();
        let registration = state.register_terminal("one", "workspace-1").unwrap();
        state.closing.lock().unwrap().insert("workspace-1".into());
        assert!(state.register_terminal("two", "workspace-1").is_err());
        assert!(state.register_terminal("other", "workspace-2").is_ok());
        let (closed, ()) = tokio::join!(state.wait_for_terminals("workspace-1"), async {
            tokio::task::yield_now().await;
            drop(registration);
        });
        assert!(closed.is_ok());
        assert_eq!(state.resource_status()["terminalSessions"], 0);
    }
    #[test]
    fn terminal_capacity_is_shared_and_released_with_the_owner_registration() {
        let state = super::Windows::default();
        let mut registrations = Vec::new();
        for n in 0..16 {
            registrations.push(
                state
                    .register_terminal(
                        &n.to_string(),
                        if n % 2 == 0 { "main" } else { "workspace-1" },
                    )
                    .unwrap(),
            );
        }
        assert!(state.register_terminal("overflow", "workspace-2").is_err());
        assert!(state.register_terminal("0", "workspace-2").is_err());
        registrations.pop();
        assert!(
            state
                .register_terminal("replacement", "workspace-2")
                .is_ok()
        );
        drop(registrations);
        assert_eq!(state.resource_status()["terminalSessions"], 0);
    }
    #[test]
    fn only_fixed_local_window_labels_are_trusted() {
        assert!(super::trusted("main"));
        assert!(super::trusted("workspace-8"));
        for label in [
            "workspace-0",
            "workspace-9",
            "workspace-01",
            "workspace-../main",
            "restricted-browser-workspace-1",
        ] {
            assert!(!super::trusted(label));
        }
    }
}

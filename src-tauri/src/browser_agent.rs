//! Local named-pipe bridge between the bundled MCP helper and the desktop browser.
use rmcp::schemars;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};

#[derive(Clone, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Open,
    ReadPage,
    Back,
    Forward,
    Reload,
    Close,
    Snapshot,
    Screenshot,
    Click,
    Fill,
    Press,
    SelectOption,
    SetChecked,
    Hover,
    Scroll,
    HandleDialog,
}
#[derive(Clone, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserInput {
    pub action: Action,
    #[schemars(
        description = "Absolute HTTP(S) URL, required only for open. Omit for other actions."
    )]
    pub url: Option<String>,
    #[serde(rename = "snapshotId")]
    pub snapshot_id: Option<String>,
    #[serde(rename = "ref")]
    pub target_ref: Option<String>,
    pub text: Option<String>,
    pub key: Option<String>,
    pub values: Option<Vec<String>>,
    pub checked: Option<bool>,
    #[serde(rename = "deltaX")]
    pub delta_x: Option<i32>,
    #[serde(rename = "deltaY")]
    pub delta_y: Option<i32>,
    pub accept: Option<bool>,
}
struct Pending {
    reply: oneshot::Sender<Result<(), String>>,
}
#[derive(Default)]
pub struct BrowserAgentState {
    pending: Mutex<HashMap<String, Pending>>,
}
struct PendingGuard<'a> {
    state: &'a BrowserAgentState,
    id: String,
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
pub fn complete_browser_agent_request(
    state: tauri::State<'_, BrowserAgentState>,
    caller: tauri::Webview,
    id: String,
    error: Option<String>,
) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("此页面无权控制主窗口浏览器".into());
    }
    if let Some(pending) = state
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)
    {
        let result = if error.is_some() {
            Err("内置浏览器操作未完成，请检查桌面窗口。".into())
        } else {
            Ok(())
        };
        let _ = pending.reply.send(result);
    }
    Ok(())
}
struct ActivityGuard(tauri::AppHandle);
impl Drop for ActivityGuard {
    fn drop(&mut self) {
        let _ = self.0.emit_to(tauri::EventTarget::webview("main"), "browser-agent-state", json!({"active":false, "paused":self.0.state::<crate::browser_automation::Automation>().paused()}));
    }
}
async fn dispatch(app: &tauri::AppHandle, input: BrowserInput) -> Result<Value, String> {
    validate_input(&input)?;
    if app
        .state::<crate::browser_automation::Automation>()
        .paused()
    {
        return Err("浏览器已由用户接管，请等待用户在面板中恢复智能体操作。".into());
    }
    if matches!(input.action, Action::Open) {
        let url = input.url.as_deref().ok_or("open requires a URL")?;
        if url.len() > 8192 {
            return Err("Browser URL is too long".into());
        }
        let origin = app
            .config()
            .build
            .dev_url
            .as_ref()
            .map(|url| url.origin().ascii_serialization());
        crate::browser::remote_url(url, origin.as_deref())?;
    } else if input.url.is_some() {
        return Err("url is accepted only for open".into());
    }
    let state = app.state::<BrowserAgentState>();
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    {
        let mut pending = state.pending.lock().unwrap_or_else(|e| e.into_inner());
        if !pending.is_empty() {
            return Err("The shared browser is busy; wait for the current request".into());
        }
        pending.insert(id.clone(), Pending { reply: tx });
    }
    let _guard = PendingGuard {
        state: &state,
        id: id.clone(),
    };
    let _activity = ActivityGuard(app.clone());
    app.emit_to(
        tauri::EventTarget::webview("main"),
        "browser-agent-state",
        json!({"active":true,"paused":false,"action":input.action}),
    )
    .map_err(|_| "无法显示浏览器操作状态")?;
    app.emit_to(
        tauri::EventTarget::webview("main"),
        "browser-agent-request",
        json!({"id":id,"action":input.action,"url":input.url}),
    )
    .map_err(|_| "Cannot reach the FluxCode browser panel")?;
    tokio::time::timeout(Duration::from_secs(12), rx)
        .await
        .map_err(
            |_| "Browser panel did not acknowledge the request. Do not claim the page opened.",
        )?
        .map_err(|_| "Browser request was cancelled")??;
    if !matches!(
        input.action,
        Action::Open | Action::Back | Action::Forward | Action::Reload | Action::Close
    ) {
        let result = app
            .state::<crate::browser_automation::Automation>()
            .execute(
                app,
                serde_json::to_value(&input).map_err(|_| "浏览器请求无效")?,
            )
            .await?;
        return Ok(json!({"surface":"FluxCode built-in browser", "result":result}));
    }
    Ok(
        json!({"surface":"FluxCode built-in browser", "window":"main", "action":input.action,
        "url":app.get_webview("restricted-browser").and_then(|view|view.url().ok()).map(|url|url.to_string()),
        "accepted":true, "note":"For navigation, use read_page to inspect the actual page; acceptance is not load completion."}),
    )
}
fn validate_input(input: &BrowserInput) -> Result<(), String> {
    if input.text.as_ref().is_some_and(|s| s.len() > 100_000) {
        return Err("Browser text exceeds the size limit".into());
    }
    let needs_target = matches!(
        input.action,
        Action::Click
            | Action::Fill
            | Action::Press
            | Action::SelectOption
            | Action::SetChecked
            | Action::Hover
    );
    if needs_target
        && (input
            .snapshot_id
            .as_ref()
            .is_none_or(|s| uuid::Uuid::parse_str(s).is_err())
            || input.target_ref.as_ref().is_none_or(|s| {
                s.is_empty() || s.len() > 64 || !s.bytes().all(|c| c.is_ascii_alphanumeric())
            }))
    {
        return Err(
            "Use snapshot first, then provide its snapshotId and an exact element ref".into(),
        );
    }
    match input.action {
        Action::Fill if input.text.is_none() => {
            return Err("fill requires text; empty text clears the field".into());
        }
        Action::Press
            if input
                .key
                .as_ref()
                .is_none_or(|s| s.is_empty() || s.len() > 80) =>
        {
            return Err("press requires a valid key".into());
        }
        Action::SetChecked if input.checked.is_none() => {
            return Err("set_checked requires checked".into());
        }
        Action::SelectOption
            if input
                .values
                .as_ref()
                .is_none_or(|v| v.len() > 50 || v.iter().any(|s| s.len() > 1000)) =>
        {
            return Err("select_option requires values".into());
        }
        Action::Scroll
            if input.delta_x.unwrap_or(0).unsigned_abs() > 4000
                || input.delta_y.unwrap_or(0).unsigned_abs() > 4000 =>
        {
            return Err("scroll deltas must be within 4000 pixels".into());
        }
        Action::HandleDialog if input.accept.is_none() => {
            return Err("handle_dialog requires accept".into());
        }
        _ => {}
    }
    Ok(())
}
pub struct Runtime {
    pub pipe: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.task.abort();
    }
}
#[cfg(windows)]
pub fn start(app: tauri::AppHandle) -> Result<Runtime, String> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let pipe = format!(
        r"\\.\pipe\fluxcode-browser-{}",
        uuid::Uuid::new_v4().simple()
    );
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&pipe)
        .map_err(|_| "无法启动内置浏览器工具")?;
    let name = pipe.clone();
    let task = tokio::spawn(async move {
        loop {
            if server.connect().await.is_err() {
                break;
            }
            // Prepare the next pipe instance before replying. Reusing a disconnected
            // instance lets a fast client connect while the old handle is tearing down.
            let next = match ServerOptions::new()
                .reject_remote_clients(true)
                .create(&pipe)
            {
                Ok(next) => next,
                Err(error) => {
                    tracing::error!(%error, "browser_tool_pipe_create_failed");
                    break;
                }
            };
            let mut connection = std::mem::replace(&mut server, next);
            // One bounded request at a time; never queue unbounded page operations.
            let result = tokio::time::timeout(Duration::from_secs(35), async {
                let size = connection
                    .read_u32_le()
                    .await
                    .map_err(|_| "Browser IPC disconnected")?;
                if size > 150_000 {
                    return Err("Browser request exceeds the size limit");
                }
                let mut bytes = vec![0; size as usize];
                connection
                    .read_exact(&mut bytes)
                    .await
                    .map_err(|_| "Browser IPC read failed")?;
                let reply = match serde_json::from_slice::<BrowserInput>(&bytes) {
                    Ok(input) => dispatch(&app, input).await,
                    Err(_) => Err("Invalid browser action".into()),
                };
                let bytes =
                    serde_json::to_vec(&reply).map_err(|_| "Browser result encoding failed")?;
                connection
                    .write_u32_le(bytes.len() as u32)
                    .await
                    .map_err(|_| "Browser IPC write failed")?;
                connection
                    .write_all(&bytes)
                    .await
                    .map_err(|_| "Browser IPC write failed")?;
                connection
                    .flush()
                    .await
                    .map_err(|_| "Browser IPC flush failed")?;
                connection
                    .read_u8()
                    .await
                    .map_err(|_| "Browser IPC acknowledgement missing")?;
                Ok::<(), &str>(())
            })
            .await;
            match result {
                Ok(Ok(())) => {}
                Ok(Err(reason)) => tracing::warn!(reason, "browser_tool_ipc_request_failed"),
                Err(_) => tracing::warn!("browser_tool_ipc_request_timed_out"),
            }
        }
        tracing::info!("browser_tool_ipc_stopped");
    });
    Ok(Runtime { pipe: name, task })
}
#[cfg(not(windows))]
pub fn start(_: tauri::AppHandle) -> Result<Runtime, String> {
    Err("Built-in browser tools currently require Windows".into())
}
#[cfg(windows)]
pub async fn request(pipe: &str, input: &BrowserInput) -> Result<Value, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    let mut client = ClientOptions::new()
        .open(pipe)
        .map_err(|_| "Cannot connect to the FluxCode browser; it may be busy or closed")?;
    tokio::time::timeout(Duration::from_secs(38), async {
        let bytes = serde_json::to_vec(input).map_err(|_| "Invalid browser input")?;
        if bytes.len() > 150_000 {
            return Err("Browser request exceeds the size limit".into());
        }
        client
            .write_u32_le(bytes.len() as u32)
            .await
            .map_err(|_| "Browser IPC write failed")?;
        client
            .write_all(&bytes)
            .await
            .map_err(|_| "Browser IPC write failed")?;
        let size = client
            .read_u32_le()
            .await
            .map_err(|_| "Browser IPC disconnected")?;
        if size > 6 * 1024 * 1024 {
            return Err("Browser response exceeds the size limit".into());
        }
        let mut bytes = vec![0; size as usize];
        client
            .read_exact(&mut bytes)
            .await
            .map_err(|_| "Browser IPC read failed")?;
        client
            .write_u8(1)
            .await
            .map_err(|_| "Browser IPC acknowledgement failed")?;
        serde_json::from_slice::<Result<Value, String>>(&bytes)
            .map_err(|_| "Invalid browser response")?
    })
    .await
    .map_err(|_| "Browser request timed out".to_string())?
}
#[cfg(not(windows))]
pub async fn request(_: &str, _: &BrowserInput) -> Result<Value, String> {
    Err("Built-in browser tools currently require Windows".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_element_actions_and_resource_bounds() {
        let valid = |value| validate_input(&serde_json::from_value::<BrowserInput>(value).unwrap());
        let id = uuid::Uuid::new_v4().to_string();
        assert!(valid(json!({"action":"fill","snapshotId":id,"ref":"f1e3","text":""})).is_ok());
        assert!(
            valid(json!({"action":"select_option","snapshotId":id,"ref":"e3","values":[]})).is_ok()
        );
        for value in [
            json!({"action":"click"}),
            json!({"action":"click","snapshotId":"old","ref":"e3"}),
            json!({"action":"click","snapshotId":id,"ref":"#injected"}),
            json!({"action":"fill","snapshotId":id,"ref":"e3"}),
            json!({"action":"set_checked","snapshotId":id,"ref":"e3"}),
            json!({"action":"press","snapshotId":id,"ref":"e3","key":""}),
            json!({"action":"scroll","deltaY":4001}),
            json!({"action":"handle_dialog"}),
            json!({"action":"fill","snapshotId":id,"ref":"e3","text":"a".repeat(100001)}),
        ] {
            assert!(valid(value).is_err());
        }
    }
    #[test]
    fn rejects_unknown_actions_and_script_inputs() {
        assert!(
            serde_json::from_value::<BrowserInput>(json!({"action":"execute","script":"bad"}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<BrowserInput>(
                json!({"action":"open","url":"https://example.com","script":"bad"})
            )
            .is_err()
        );
        assert!(serde_json::from_value::<BrowserInput>(json!({"action":"read_page"})).is_ok());
    }
}

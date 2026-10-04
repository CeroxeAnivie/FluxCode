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
}
#[derive(Clone, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrowserInput {
    pub action: Action,
    #[schemars(
        description = "Absolute HTTP(S) URL, required only for open. Omit for other actions."
    )]
    pub url: Option<String>,
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
async fn dispatch(app: &tauri::AppHandle, input: BrowserInput) -> Result<Value, String> {
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
    if matches!(input.action, Action::ReadPage) {
        return read_page(app).await;
    }
    Ok(
        json!({"surface":"FluxCode built-in browser", "window":"main", "action":input.action,
        "url":app.get_webview("restricted-browser").and_then(|view|view.url().ok()).map(|url|url.to_string()),
        "accepted":true, "note":"For navigation, use read_page to inspect the actual page; acceptance is not load completion."}),
    )
}
async fn read_page(app: &tauri::AppHandle) -> Result<Value, String> {
    let view = app
        .get_webview("restricted-browser")
        .ok_or("The built-in browser is closed. Use open first.")?;
    let (tx, rx) = oneshot::channel();
    let tx = Mutex::new(Some(tx));
    view.eval_with_callback(include_str!("browser_snapshot.js"), move |result| {
        if let Some(tx) = tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(result);
        }
    })
    .map_err(|_| "Cannot read the built-in browser")?;
    let raw = tokio::time::timeout(Duration::from_secs(8), rx)
        .await
        .map_err(|_| "Browser page read timed out")?
        .map_err(|_| "Browser page read was cancelled")?;
    if raw.len() > 250_000 {
        return Err("Browser page response exceeds the size limit".into());
    }
    let value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid browser page response")?;
    if value.get("url").and_then(Value::as_str).is_none() {
        return Err("Browser page is not ready; retry read_page after loading".into());
    }
    Ok(json!({"surface":"FluxCode built-in browser", "untrustedPageContent":value}))
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
            let result = tokio::time::timeout(Duration::from_secs(20), async {
                let size = connection
                    .read_u32_le()
                    .await
                    .map_err(|_| "Browser IPC disconnected")?;
                if size > 16_384 {
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
    tokio::time::timeout(Duration::from_secs(22), async {
        let bytes = serde_json::to_vec(input).map_err(|_| "Invalid browser input")?;
        if bytes.len() > 16_384 {
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
        if size > 300_000 {
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

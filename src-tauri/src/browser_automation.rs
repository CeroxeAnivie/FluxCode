//! App-owned automation session. Only the isolated remote-page profile exposes CDP.
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{Mutex as AsyncMutex, watch},
};
#[derive(Clone)]
pub struct Surface {
    pub profile: PathBuf,
    pub token: String,
}
struct Driver {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    token: String,
}
pub struct Automation {
    surface: Mutex<Option<Surface>>,
    driver: AsyncMutex<Option<Driver>>,
    paused: AtomicBool,
    cancellation: watch::Sender<u64>,
}
impl Default for Automation {
    fn default() -> Self {
        let (cancellation, _) = watch::channel(0);
        Self {
            surface: Mutex::new(None),
            driver: AsyncMutex::new(None),
            paused: AtomicBool::new(false),
            cancellation,
        }
    }
}
impl Automation {
    pub fn prepare(&self, directory: PathBuf) -> Result<Surface, String> {
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建浏览器数据目录")?;
        let profile =
            crate::runtime_paths::webview_home(&directory).map_err(|_| "无法打开浏览器数据目录")?;
        // WebView2 owns DevToolsActivePort. Keep it when a closed surface reuses
        // the same live browser process; the random page token verifies identity.
        let surface = Surface {
            profile,
            token: uuid::Uuid::new_v4().to_string(),
        };
        *self.surface.lock().unwrap_or_else(|e| e.into_inner()) = Some(surface.clone());
        Ok(surface)
    }
    pub fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
    pub fn pause(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
        if paused {
            self.cancellation
                .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
        }
    }
    pub fn reset(&self) {
        self.cancellation
            .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
        *self.surface.lock().unwrap_or_else(|e| e.into_inner()) = None;
        // An in-flight operation releases the helper in its cancellation branch.
        // An idle closed browser must release it immediately as well.
        if let Ok(mut slot) = self.driver.try_lock() {
            *slot = None;
        }
    }
    pub async fn execute(&self, app: &tauri::AppHandle, input: Value) -> Result<Value, String> {
        let mut cancellation = self.cancellation.subscribe();
        if self.paused() {
            return Err("浏览器已由用户接管，请等待用户在面板中恢复智能体操作。".into());
        }
        let mut slot = self
            .driver
            .try_lock()
            .map_err(|_| "浏览器正在执行另一项操作")?;
        let surface = self
            .surface
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("请先打开内置浏览器")?;
        let operation = async {
            if slot
                .as_ref()
                .is_none_or(|driver| driver.token != surface.token)
            {
                *slot = None;
                *slot = Some(Driver::start(app, &surface).await?);
            }
            slot.as_mut().unwrap().exchange(input).await
        };
        let result = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(18), operation) => result.map_err(|_| "浏览器操作超时，请先检查页面结果再决定是否重试。".to_string()).and_then(|v|v),
            _ = cancellation.changed() => Err("用户已停止浏览器操作。部分操作可能已经生效，请勿自动重复提交。".into()),
        };
        if result.is_err() {
            *slot = None;
        }
        result?
    }
}
impl Driver {
    async fn start(app: &tauri::AppHandle, surface: &Surface) -> Result<Self, String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        let port = loop {
            let mut port = None;
            for file in [
                surface.profile.join("DevToolsActivePort"),
                surface.profile.join("EBWebView/DevToolsActivePort"),
            ] {
                if let Ok(text) = tokio::fs::read_to_string(file).await {
                    port = text
                        .lines()
                        .next()
                        .and_then(|s| s.parse::<u16>().ok())
                        .filter(|v| *v > 0);
                    if port.is_some() {
                        break;
                    }
                }
            }
            if let Some(port) = port {
                break port;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("浏览器自动化连接尚未就绪，请稍后重试。".into());
            }
            tokio::time::sleep(Duration::from_millis(60)).await;
        };
        let resources = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
        } else {
            app.path()
                .resource_dir()
                .map_err(|_| "无法定位浏览器运行时")?
        };
        let runtime = resources.join("browser-runtime");
        let mut command = Command::new(runtime.join("node.exe"));
        command
            .arg(runtime.join("driver.mjs"))
            .current_dir(&runtime)
            .env("NO_PROXY", "127.0.0.1,localhost")
            .env("no_proxy", "127.0.0.1,localhost")
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env_remove("NODE_EXTRA_CA_CERTS")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|_| "无法启动随应用安装的浏览器运行时，请检查安装文件")?;
        let stdin = child.stdin.take().ok_or("浏览器输入通道不可用")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("浏览器输出通道不可用")?);
        let mut driver = Self {
            _child: child,
            stdin,
            stdout,
            token: surface.token.clone(),
        };
        driver.exchange(json!({"action":"connect","endpoint":format!("http://127.0.0.1:{port}"),"surface":surface.token})).await??;
        Ok(driver)
    }
    async fn exchange(&mut self, input: Value) -> Result<Result<Value, String>, String> {
        let mut bytes = serde_json::to_vec(&input).map_err(|_| "浏览器请求无效")?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|_| "浏览器运行时已断开")?;
        self.stdin.flush().await.map_err(|_| "浏览器运行时已断开")?;
        let mut bytes = Vec::new();
        loop {
            let buffer = self
                .stdout
                .fill_buf()
                .await
                .map_err(|_| "浏览器运行时读取失败")?;
            if buffer.is_empty() {
                return Err("浏览器运行时已退出".into());
            }
            let count = buffer
                .iter()
                .position(|b| *b == b'\n')
                .map(|n| n + 1)
                .unwrap_or(buffer.len());
            if bytes.len() + count > 6 * 1024 * 1024 {
                return Err("浏览器结果超出大小限制".into());
            }
            let done = buffer[count - 1] == b'\n';
            bytes.extend_from_slice(&buffer[..count]);
            self.stdout.consume(count);
            if done {
                break;
            }
        }
        let response: Value = serde_json::from_slice(&bytes).map_err(|_| "浏览器返回了无效数据")?;
        if response["ok"] == true {
            Ok(Ok(response["result"].clone()))
        } else {
            Ok(Err(response["error"]
                .as_str()
                .unwrap_or("浏览器操作失败")
                .to_owned()))
        }
    }
}
#[tauri::command]
pub fn browser_agent_control(
    app: tauri::AppHandle,
    caller: tauri::Webview,
    paused: bool,
) -> Result<(), String> {
    if caller.label() != "main" {
        return Err("请在主窗口接管浏览器".into());
    }
    app.state::<Automation>().pause(paused);
    app.emit_to(
        tauri::EventTarget::webview("main"),
        "browser-agent-state",
        json!({"paused":paused,"active":false}),
    )
    .map_err(|_| "无法更新浏览器状态".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_isolated_profile_on_first_open() {
        let directory = tempfile::tempdir().unwrap();
        let state = Automation::default();
        let surface = state.prepare(directory.path().join("browser")).unwrap();
        assert!(surface.profile.is_dir());
        state.pause(true);
        assert!(state.paused());
        state.pause(false);
        assert!(!state.paused());
    }
}

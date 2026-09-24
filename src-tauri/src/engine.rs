use crate::config::Settings;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    process::Stdio,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};
use tauri::Emitter;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex as AsyncMutex, oneshot},
};

const MAX_FRAME: usize = 8 * 1024 * 1024;
type Pending = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

pub struct Engine {
    child: AsyncMutex<Child>,
    stdin: AsyncMutex<ChildStdin>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    alive: AtomicBool,
}

impl Engine {
    pub async fn launch(
        binary: &Path,
        home: &Path,
        settings: &Settings,
        api_key: Option<String>,
        app: tauri::AppHandle,
    ) -> Result<Arc<Self>, String> {
        settings.validate()?;
        if !binary.is_file() {
            return Err("内置执行引擎缺失，请重新安装 FluxCode。".into());
        }
        tokio::fs::create_dir_all(home)
            .await
            .map_err(|e| e.to_string())?;
        let mut command = Command::new(binary);
        command.current_dir(home);
        command.arg("app-server").arg("--listen").arg("stdio://");
        let catalog_path = home.join("model-catalog.json");
        tokio::fs::write(
            &catalog_path,
            include_str!("../../config/engine-models.json"),
        )
        .await
        .map_err(|e| format!("无法准备模型目录：{e}"))?;
        command.arg("-c").arg(format!(
            "model_catalog_json={}",
            serde_json::to_string(&catalog_path).map_err(|e| e.to_string())?
        ));
        for value in settings.overrides() {
            command.arg("-c").arg(value);
        }
        command
            .env("CODEX_HOME", home)
            .env("HTTP_PROXY", &settings.proxy_url)
            .env("HTTPS_PROXY", &settings.proxy_url)
            .env("ALL_PROXY", &settings.proxy_url)
            .env("http_proxy", &settings.proxy_url)
            .env("https_proxy", &settings.proxy_url)
            .env("all_proxy", &settings.proxy_url)
            .env("NO_PROXY", "")
            .env("no_proxy", "")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(key) = api_key.filter(|s| !s.trim().is_empty()) {
            command.env(&settings.api_key_env, key);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动内置引擎：{e}"))?;
        let stdin = child.stdin.take().ok_or("引擎输入管道不可用")?;
        let stdout = child.stdout.take().ok_or("引擎输出管道不可用")?;
        let stderr = child.stderr.take().ok_or("引擎诊断管道不可用")?;
        let engine = Arc::new(Self {
            child: AsyncMutex::new(child),
            stdin: AsyncMutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
        });
        let reader_engine = Arc::clone(&engine);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut frame = Vec::new();
            loop {
                // fill_buf bounds allocation even if a faulty process never emits a newline.
                let bytes = match reader.fill_buf().await {
                    Ok(bytes) if !bytes.is_empty() => bytes,
                    _ => break,
                };
                let len = bytes
                    .iter()
                    .position(|b| *b == b'\n')
                    .map_or(bytes.len(), |n| n + 1);
                if frame.len() + len > MAX_FRAME {
                    tracing::error!("engine_frame_too_large");
                    break;
                }
                frame.extend_from_slice(&bytes[..len]);
                reader.consume(len);
                if frame.last() != Some(&b'\n') {
                    continue;
                }
                match serde_json::from_slice::<Value>(&frame) {
                    Ok(message) => reader_engine.receive(message, &app).await,
                    Err(_) => tracing::warn!("engine_invalid_json_frame"),
                }
                frame.clear();
            }
            let was_alive = reader_engine.alive.swap(false, Ordering::SeqCst);
            reader_engine.fail_pending("执行引擎已断开，重新连接后可恢复任务。");
            if was_alive {
                let _ = app.emit(
                    "engine-event",
                    json!({"method":"engine/disconnected","params":{}}),
                );
                let _ = reader_engine.child.lock().await.kill().await;
            }
        });
        tokio::spawn(async move {
            // Drain diagnostics without copying potentially sensitive prompts or credentials to logs.
            let mut reader = BufReader::new(stderr);
            loop {
                match reader.fill_buf().await {
                    Ok(bytes) if !bytes.is_empty() => {
                        let n = bytes.len();
                        reader.consume(n);
                    }
                    _ => break,
                }
            }
        });
        if let Err(error) = engine.request("initialize", json!({"clientInfo":{"name":"fluxcode","title":"FluxCode","version":"0.1.0"},"capabilities":{"experimentalApi":true}}), Duration::from_secs(30)).await {
            engine.shutdown().await;
            return Err(error);
        }
        engine
            .write(json!({"method":"initialized","params":{}}))
            .await?;
        tracing::info!(engine_version = "0.156.1", "engine_connected");
        Ok(engine)
    }

    async fn receive(&self, message: Value, app: &tauri::AppHandle) {
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            if let Some(id) = message.get("id") {
                // Full access disables terminal approval, not arbitrary interactive protocols.
                // Fail unsupported server requests explicitly instead of leaving a task hanging.
                let _ = self.write(json!({"id":id,"error":{"code":-32601,"message":"This client does not yet support interactive server requests. Ask the user in a normal message."}})).await;
                let _ = app.emit(
                    "engine-event",
                    json!({"method":"engine/unsupportedRequest","params":{"requestMethod":method}}),
                );
            } else if let Err(error) = app.emit("engine-event", &message) {
                tracing::warn!(%error, "event_delivery_failed");
            }
            return;
        }
        if let Some(id) = message.get("id").and_then(Value::as_u64)
            && let Some(tx) = self
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id)
        {
            let result = if let Some(error) = message.get("error") {
                Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("引擎请求失败")
                    .to_owned())
            } else {
                Ok(message.get("result").cloned().unwrap_or(Value::Null))
            };
            let _ = tx.send(result);
        }
    }

    async fn write(&self, value: Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        let mut stdin = self.stdin.lock().await;
        tokio::time::timeout(Duration::from_secs(10), async {
            stdin.write_all(&bytes).await?;
            stdin.flush().await
        })
        .await
        .map_err(|_| "引擎输入超时".to_owned())?
        .map_err(|e| format!("引擎通信失败：{e}"))
    }

    pub async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("执行引擎未连接".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if pending.len() >= 128 {
                return Err("请求过多，请稍后再试".into());
            }
            pending.insert(id, tx);
        }
        if let Err(e) = self
            .write(json!({"id":id,"method":method,"params":params}))
            .await
        {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err(e);
        }
        let result = tokio::time::timeout(timeout, rx).await;
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        match result {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => Err("引擎响应通道已关闭".into()),
            Err(_) => Err(format!(
                "{method} 请求超时；操作可能仍在执行，请刷新状态后再试。"
            )),
        }
    }

    fn fail_pending(&self, message: &str) {
        for (_, tx) in self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain()
        {
            let _ = tx.send(Err(message.into()));
        }
    }

    pub async fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        self.fail_pending("执行引擎已停止");
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

pub fn allowed_method(method: &str) -> bool {
    matches!(
        method,
        "thread/start"
            | "thread/resume"
            | "thread/read"
            | "thread/list"
            | "thread/archive"
            | "thread/name/set"
            | "thread/turns/list"
            | "thread/items/list"
            | "turn/start"
            | "turn/interrupt"
            | "turn/steer"
            | "command/exec"
            | "command/exec/terminate"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn methods_are_explicitly_allowlisted() {
        assert!(allowed_method("turn/start"));
        assert!(!allowed_method("config/value/write"));
        assert!(!allowed_method("account/login/start"));
    }
}

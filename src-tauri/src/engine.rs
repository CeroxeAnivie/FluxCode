use crate::config::Settings;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
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
const MAX_PENDING_REQUESTS: usize = 128;
const RESERVED_CONTROL_REQUESTS: usize = 8;
const MAX_ACTIVE_TURNS: usize = 8;
type Pending = HashMap<u64, oneshot::Sender<Result<Value, String>>>;

fn request_capacity(method: &str) -> usize {
    if matches!(
        method,
        "turn/interrupt"
            | "command/exec/terminate"
            | "command/exec/write"
            | "process/kill"
            | "process/writeStdin"
    ) {
        MAX_PENDING_REQUESTS
    } else {
        MAX_PENDING_REQUESTS - RESERVED_CONTROL_REQUESTS
    }
}

/// A dropped caller must not retain a pending request until the engine exits.
struct PendingRequest<'a> {
    entries: &'a Mutex<Pending>,
    id: u64,
}

struct StartingTurn<'a> {
    entries: &'a Mutex<HashSet<String>>,
    thread: String,
}
impl Drop for StartingTurn<'_> {
    fn drop(&mut self) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.thread);
    }
}
fn reserve_turn<'a>(
    starting: &'a Mutex<HashSet<String>>,
    active: &Mutex<HashMap<String, String>>,
    thread: &str,
) -> Result<StartingTurn<'a>, String> {
    let mut entries = starting.lock().unwrap_or_else(|e| e.into_inner());
    let active = active.lock().unwrap_or_else(|e| e.into_inner());
    if entries.contains(thread) || active.contains_key(thread) {
        return Err("任务仍在运行，请先停止或等待完成。".into());
    }
    if entries
        .iter()
        .chain(active.keys())
        .collect::<HashSet<_>>()
        .len()
        >= MAX_ACTIVE_TURNS
    {
        return Err("同时运行的任务已达 8 个，请先停止或等待一个任务完成。".into());
    }
    entries.insert(thread.into());
    Ok(StartingTurn {
        entries: starting,
        thread: thread.into(),
    })
}

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.id);
    }
}

pub struct Engine {
    #[cfg(windows)]
    job: Mutex<Option<std::os::windows::io::OwnedHandle>>,
    child: AsyncMutex<Child>,
    stdin: AsyncMutex<ChildStdin>,
    pending: Mutex<Pending>,
    next_id: AtomicU64,
    alive: AtomicBool,
    published: AtomicBool,
    active_threads: Mutex<HashMap<String, String>>,
    starting_threads: Mutex<HashSet<String>>,
    reservations: std::sync::atomic::AtomicUsize,
    questions: Mutex<HashMap<String, Value>>,
    completed_turns: Mutex<HashMap<String, String>>,
    turn_changed: tokio::sync::Notify,
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
        let sqlite_home = crate::runtime_paths::sqlite_home(home)
            .map_err(|e| format!("无法解析引擎数据目录：{e}"))?;
        let mut command = Command::new(binary);
        // CreateProcess still rejects some long working directories even when
        // filesystem APIs accept the extended-length path. This alias refers
        // to the exact same validated engine-home directory.
        command.current_dir(&sqlite_home);
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
        command.arg("-c").arg(format!(
            "sqlite_home={}",
            serde_json::to_string(&sqlite_home).map_err(|e| e.to_string())?
        ));
        command
            .env("CODEX_HOME", home)
            .env("CODEX_SQLITE_HOME", &sqlite_home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if !settings.proxy_url.trim().is_empty() {
            for name in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                command.env(name, &settings.proxy_url);
            }
            command.env("NO_PROXY", "").env("no_proxy", "");
        }
        if let Some(key) = api_key.filter(|s| !s.trim().is_empty()) {
            command.env(&settings.api_key_env, key);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|e| format!("无法启动内置引擎：{e}"))?;
        #[cfg(windows)]
        let job = crate::process_job::attach(&child)?;
        let stdin = child.stdin.take().ok_or("引擎输入管道不可用")?;
        let stdout = child.stdout.take().ok_or("引擎输出管道不可用")?;
        let stderr = child.stderr.take().ok_or("引擎诊断管道不可用")?;
        let engine = Arc::new(Self {
            #[cfg(windows)]
            job: Mutex::new(Some(job)),
            child: AsyncMutex::new(child),
            stdin: AsyncMutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            published: AtomicBool::new(false),
            active_threads: Mutex::new(HashMap::new()),
            starting_threads: Mutex::new(HashSet::new()),
            reservations: std::sync::atomic::AtomicUsize::new(0),
            questions: Mutex::new(HashMap::new()),
            completed_turns: Mutex::new(HashMap::new()),
            turn_changed: tokio::sync::Notify::new(),
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
            reader_engine
                .questions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
            let was_alive = reader_engine.alive.swap(false, Ordering::SeqCst);
            reader_engine.fail_pending("执行引擎已断开，重新连接后可恢复任务。");
            #[cfg(windows)]
            reader_engine
                .job
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take();
            if was_alive && reader_engine.published.load(Ordering::Acquire) {
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
        if message["method"] == "turn/started" || message["method"] == "turn/completed" {
            let mut active = self
                .active_threads
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            track_active_turn(&mut active, &message);
        }
        if message["method"] == "turn/completed" {
            if let (Some(thread), Some(turn), Some(status)) = (
                message["params"]["threadId"].as_str(),
                message["params"]["turn"]["id"].as_str(),
                message["params"]["turn"]["status"].as_str(),
            ) {
                let mut completed = self
                    .completed_turns
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if completed.len() >= 256 {
                    completed.clear();
                }
                completed.insert(format!("{thread}/{turn}"), status.to_owned());
                self.turn_changed.notify_one();
            }
            let thread = message["params"]["threadId"].as_str();
            let turn = message["params"]["turn"]["id"].as_str();
            self.questions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .retain(|_, value| !request_matches_turn(value, thread, turn));
        }
        if let Some(method) = message.get("method").and_then(Value::as_str) {
            if let Some(id) = message.get("id") {
                if matches!(
                    method,
                    "item/tool/requestUserInput" | "mcpServer/elicitation/request"
                ) {
                    let key = id.to_string();
                    let accepted = {
                        let mut questions =
                            self.questions.lock().unwrap_or_else(|e| e.into_inner());
                        if questions.len() >= 32 {
                            false
                        } else {
                            let mut request = message["params"].clone();
                            request["requestKind"] = json!(method);
                            questions.insert(key.clone(), request);
                            true
                        }
                    };
                    if accepted {
                        let mut params = message["params"].clone();
                        params["id"] = id.clone();
                        if app
                            .emit(
                                "engine-event",
                                json!({"method":if method=="mcpServer/elicitation/request"{"engine/elicitation"}else{"engine/userInput"},"params":params}),
                            )
                            .is_ok()
                        {
                            return;
                        }
                        self.questions
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove(&key);
                    }
                }
                // Full access disables terminal approval, not arbitrary interactive protocols.
                // Fail unsupported server requests explicitly instead of leaving a task hanging.
                let _ = self.write(json!({"id":id,"error":{"code":-32601,"message":"This client does not yet support interactive server requests. Ask the user in a normal message."}})).await;
                let _ = app.emit(
                    "engine-event",
                    json!({"method":"engine/unsupportedRequest","params":{"requestMethod":method}}),
                );
            } else {
                if method == "serverRequest/resolved" {
                    self.questions
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&message["params"]["requestId"].to_string());
                }
                if let Err(error) = app.emit("engine-event", &message) {
                    tracing::warn!(%error, "event_delivery_failed");
                }
                if method == "turn/completed" && !self.is_busy() {
                    let _ = app.emit("engine-event", json!({"method":"engine/idle","params":{}}));
                }
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
        if !self.is_busy() {
            let _ = app.emit("engine-event", json!({"method":"engine/idle","params":{}}));
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

    pub async fn wait_turn(&self, thread: &str, turn: &str) -> Result<String, String> {
        let key = format!("{thread}/{turn}");
        tokio::time::timeout(Duration::from_secs(1800),async {
            loop {
                if let Some(status)=self.completed_turns.lock().unwrap_or_else(|e|e.into_inner()).remove(&key){return Ok(status);}
                if !self.alive.load(Ordering::SeqCst){return Err("Engine disconnected".into());}
                tokio::select!{_=self.turn_changed.notified()=>{},_=tokio::time::sleep(Duration::from_secs(5))=>{}}
            }
        }).await.map_err(|_|"Scheduled turn timed out".to_owned())?
    }

    pub async fn answer_elicitation(&self, id: Value, result: Value) -> Result<(), String> {
        let key = id.to_string();
        let request = self
            .questions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .cloned()
            .ok_or("Request already resolved")?;
        if request["requestKind"] != "mcpServer/elicitation/request" {
            return Err("Invalid request kind".into());
        }
        crate::elicitation::validate(&request, &result)?;
        self.write(json!({"id":id,"result":result})).await?;
        self.questions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        Ok(())
    }

    pub async fn answer(&self, id: Value, answers: Value) -> Result<(), String> {
        if !id.is_string() && !id.is_number() {
            return Err("Invalid request ID".into());
        }
        let key = id.to_string();
        let request = self
            .questions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
            .cloned()
            .ok_or("Question already resolved")?;
        let questions = request["questions"].as_array().ok_or("Invalid questions")?;
        for question in questions {
            let name = question["id"].as_str().ok_or("Invalid question ID")?;
            let values = answers[name]["answers"]
                .as_array()
                .ok_or("Missing answer")?;
            if values.is_empty()
                || values.len() > 10
                || values
                    .iter()
                    .any(|v| v.as_str().is_none_or(|s| s.len() > 40_000))
            {
                return Err("Invalid answer".into());
            }
        }
        self.write(json!({"id":id,"result":{"answers":answers}}))
            .await?;
        self.questions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        Ok(())
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
        let _starting = if matches!(
            method,
            "turn/start" | "review/start" | "thread/compact/start"
        ) {
            let thread = params
                .get("threadId")
                .and_then(Value::as_str)
                .ok_or("任务标识无效")?;
            Some(reserve_turn(
                &self.starting_threads,
                &self.active_threads,
                thread,
            )?)
        } else {
            None
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            if pending.len() >= request_capacity(method) {
                return Err("请求过多，请稍后再试".into());
            }
            pending.insert(id, tx);
        }
        let _pending = PendingRequest {
            entries: &self.pending,
            id,
        };
        self.write(json!({"id":id,"method":method,"params":params}))
            .await?;
        let result = tokio::time::timeout(timeout, rx).await;
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

    pub fn is_busy(&self) -> bool {
        self.reservations.load(Ordering::Acquire) > 0
            || !self
                .active_threads
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
            || !self
                .pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Acquire)
    }
    pub fn has_running_work(&self) -> bool {
        self.reservations.load(Ordering::Acquire) > 0
            || !self
                .starting_threads
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
            || !self
                .active_threads
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty()
    }

    pub fn resource_status(&self) -> Value {
        json!({
            "alive": self.is_alive(),
            "pendingRequests": self.pending.lock().unwrap_or_else(|e| e.into_inner()).len(),
            "activeTurns": self.active_threads.lock().unwrap_or_else(|e| e.into_inner()).len(),
            "requestLimit": MAX_PENDING_REQUESTS,
            "activeTurnLimit": MAX_ACTIVE_TURNS,
            "reservedControlRequests": RESERVED_CONTROL_REQUESTS,
        })
    }
    pub fn publish(&self) {
        self.published.store(true, Ordering::Release);
    }

    pub fn reserve(self: &Arc<Self>) -> EngineReservation {
        self.reservations.fetch_add(1, Ordering::AcqRel);
        EngineReservation(Arc::clone(self))
    }

    pub async fn shutdown(&self) {
        self.questions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.alive.store(false, Ordering::SeqCst);
        self.fail_pending("执行引擎已停止");
        #[cfg(windows)]
        self.job.lock().unwrap_or_else(|e| e.into_inner()).take();
        let mut child = self.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

pub struct EngineReservation(Arc<Engine>);
fn request_matches_turn(request: &Value, thread: Option<&str>, turn: Option<&str>) -> bool {
    // A standalone MCP request has no turn association. Only its resolved
    // notification (or engine shutdown) ends it; unrelated turns must not.
    matches!((thread, turn), (Some(thread), Some(turn))
        if request["threadId"].as_str() == Some(thread)
            && request["turnId"].as_str() == Some(turn))
}
/// Only the matching turn can release a thread's busy state.
fn track_active_turn(active: &mut HashMap<String, String>, message: &Value) {
    let Some(thread) = message["params"]["threadId"].as_str() else {
        return;
    };
    let turn = message["params"]["turn"]["id"].as_str().unwrap_or_default();
    match message["method"].as_str() {
        Some("turn/started") => {
            active.insert(thread.to_owned(), turn.to_owned());
        }
        Some("turn/completed") if active.get(thread).is_some_and(|current| current == turn) => {
            active.remove(thread);
        }
        _ => {}
    }
}
impl Drop for EngineReservation {
    fn drop(&mut self) {
        self.0.reservations.fetch_sub(1, Ordering::AcqRel);
    }
}

pub fn allowed_method(method: &str) -> bool {
    matches!(
        method,
        "thread/start"
            | "thread/fork"
            | "thread/compact/start"
            | "thread/resume"
            | "thread/read"
            | "thread/list"
            | "thread/archive"
            | "thread/unarchive"
            | "thread/name/set"
            | "thread/turns/list"
            | "thread/items/list"
            | "turn/start"
            | "turn/interrupt"
            | "turn/steer"
            | "command/exec"
            | "command/exec/terminate"
            | "command/exec/write"
            | "command/exec/resize"
            | "review/start"
            | "plugin/list"
            | "plugin/install"
            | "plugin/uninstall"
            | "marketplace/add"
            | "mcpServer/oauth/login"
            | "config/mcpServer/reload"
            | "model/list"
            | "skills/list"
            | "skills/config/write"
            | "mcpServerStatus/list"
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn concurrent_turn_reservations_are_bounded_and_released() {
        use super::*;
        let starting = Mutex::new(HashSet::new());
        let active = Mutex::new(HashMap::new());
        let mut guards = Vec::new();
        for index in 0..8 {
            guards.push(reserve_turn(&starting, &active, &index.to_string()).unwrap());
        }
        assert!(reserve_turn(&starting, &active, "another").is_err());
        assert!(reserve_turn(&starting, &active, "0").is_err());
        guards.pop();
        assert!(reserve_turn(&starting, &active, "another").is_ok());
        drop(guards);
        active
            .lock()
            .unwrap()
            .insert("running".into(), "turn".into());
        assert!(reserve_turn(&starting, &active, "running").is_err());
    }
    #[tokio::test]
    async fn cancelled_waiter_releases_capacity_without_removing_other_requests() {
        use super::*;
        let entries = Arc::new(Mutex::new(Pending::new()));
        let (first, _) = oneshot::channel();
        let (second, _) = oneshot::channel();
        entries.lock().unwrap().insert(1, first);
        entries.lock().unwrap().insert(2, second);
        let shared = entries.clone();
        let (started, ready) = oneshot::channel();
        let task = tokio::spawn(async move {
            let _guard = PendingRequest {
                entries: &shared,
                id: 1,
            };
            started.send(()).unwrap();
            std::future::pending::<()>().await;
        });
        ready.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let remaining = entries.lock().unwrap();
        assert!(!remaining.contains_key(&1));
        assert!(remaining.contains_key(&2));
    }

    #[test]
    fn stop_and_terminal_interrupt_keep_reserved_capacity() {
        assert_eq!(super::request_capacity("turn/start"), 120);
        assert_eq!(super::request_capacity("turn/interrupt"), 128);
        assert_eq!(super::request_capacity("command/exec/write"), 128);
        assert_eq!(super::request_capacity("command/exec/terminate"), 128);
    }
    #[test]
    fn completed_turn_only_clears_its_own_correlated_requests() {
        let request = serde_json::json!({"threadId":"thread-a","turnId":"turn-new"});
        assert!(super::request_matches_turn(
            &request,
            Some("thread-a"),
            Some("turn-new")
        ));
        assert!(!super::request_matches_turn(
            &request,
            Some("thread-a"),
            Some("turn-old")
        ));
        assert!(!super::request_matches_turn(
            &request,
            Some("thread-b"),
            Some("turn-new")
        ));
        assert!(!super::request_matches_turn(
            &request,
            Some("thread-a"),
            None
        ));
        for request in [
            serde_json::json!({"threadId":"thread-a"}),
            serde_json::json!({"threadId":"thread-a","turnId":null}),
        ] {
            assert!(!super::request_matches_turn(
                &request,
                Some("thread-a"),
                Some("turn-new")
            ));
        }
    }
    use super::*;
    #[test]
    fn delayed_completion_does_not_release_another_turn_or_thread() {
        let mut active = HashMap::new();
        for (thread, turn) in [("a", "old"), ("b", "other"), ("a", "new")] {
            track_active_turn(
                &mut active,
                &json!({"method":"turn/started","params":{"threadId":thread,"turn":{"id":turn}}}),
            );
        }
        track_active_turn(
            &mut active,
            &json!({"method":"turn/completed","params":{"threadId":"a","turn":{"id":"old"}}}),
        );
        assert_eq!(active.get("a").map(String::as_str), Some("new"));
        track_active_turn(
            &mut active,
            &json!({"method":"turn/completed","params":{"threadId":"a","turn":{"id":"new"}}}),
        );
        assert!(!active.contains_key("a"));
        assert_eq!(active.get("b").map(String::as_str), Some("other"));
        track_active_turn(
            &mut active,
            &json!({"method":"turn/completed","params":{"threadId":"b","turn":{}}}),
        );
        assert!(active.contains_key("b"));
    }
    #[test]
    fn methods_are_explicitly_allowlisted() {
        assert!(allowed_method("turn/start"));
        assert!(!allowed_method("config/value/write"));
        assert!(!allowed_method("account/login/start"));
    }
}

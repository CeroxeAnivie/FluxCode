mod attachments;
mod backup;
mod browser;
mod config;
mod configuration;
mod context;
mod credentials;
mod data_directory;
mod document_export;
mod editor;
mod elicitation;
mod engine;
mod extensions;
mod external_links;
mod git_service;
mod headless;
mod imported_history;
mod window_placement;
pub use headless::run as run_headless;
mod model_selection;
#[cfg(windows)]
mod process_job;
mod providers;
mod runtime_health;
mod runtime_paths;
mod schedules;
mod terminal;
mod ui_state;
mod workspace;
mod workspace_windows;

use config::Settings;
use engine::Engine;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex;

struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    lifecycle: Mutex<()>,
    backup_jobs: Mutex<HashMap<String, Arc<AtomicU8>>>,
    workspace_mutation: Mutex<()>,
    scheduling: Mutex<()>,
    ui_state_write: Mutex<()>,
    data_dir: PathBuf,
    binary: PathBuf,
    configuration: Arc<configuration::Configuration>,
    configuration_revision: std::sync::atomic::AtomicU64,
    session_credential: Mutex<Option<(String, String, String)>>,
    active_settings: Mutex<Option<Settings>>,
}

async fn reserve_engine(
    state: &AppState,
) -> Result<(Arc<Engine>, engine::EngineReservation), String> {
    let _guard = state.lifecycle.lock().await;
    let engine = state.engine.lock().await.clone().ok_or("执行引擎未连接")?;
    let reservation = engine.reserve();
    Ok((engine, reservation))
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(state.configuration.config().await.settings())
}

#[tauri::command]
async fn load_preferences(state: State<'_, AppState>) -> Result<config::UiConfig, String> {
    Ok(state.configuration.config().await.ui)
}

#[tauri::command]
async fn load_ui_state(
    state: State<'_, AppState>,
    caller: tauri::Webview,
) -> Result<Option<ui_state::Snapshot>, String> {
    let _guard = state.ui_state_write.lock().await;
    let root = workspace_windows::data_root(&state.data_dir, caller.label())?;
    tokio::task::spawn_blocking(move || ui_state::load(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_ui_state(
    state: State<'_, AppState>,
    caller: tauri::Webview,
    expected_generation: Option<u64>,
    values: std::collections::BTreeMap<String, String>,
) -> Result<ui_state::Snapshot, String> {
    let _guard = state.ui_state_write.lock().await;
    let root = workspace_windows::data_root(&state.data_dir, caller.label())?;
    tokio::task::spawn_blocking(move || ui_state::save(&root, expected_generation, values))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_previous_ui_state(
    state: State<'_, AppState>,
    caller: tauri::Webview,
) -> Result<ui_state::Snapshot, String> {
    let _guard = state.ui_state_write.lock().await;
    let root = workspace_windows::data_root(&state.data_dir, caller.label())?;
    tokio::task::spawn_blocking(move || ui_state::restore_previous(&root))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_restored_ui_state(
    state: State<'_, AppState>,
    values: std::collections::BTreeMap<String, String>,
) -> Result<ui_state::Snapshot, String> {
    let _guard = state.ui_state_write.lock().await;
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        let confirmed =
            backup::restored_ui(&root)?.ok_or("没有待确认的备份恢复，不能替换本地界面索引。")?;
        ui_state::commit_restore(&root, values, confirmed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_font_size(state: State<'_, AppState>, size: u16) -> Result<(), String> {
    state.configuration.save_font(size).await
}
#[tauri::command]
async fn save_panel_width(
    state: State<'_, AppState>,
    panel: String,
    width: u16,
) -> Result<(), String> {
    state.configuration.save_panel_width(&panel, width).await
}

#[tauri::command]
async fn configuration_snapshot(
    state: State<'_, AppState>,
) -> Result<configuration::Snapshot, String> {
    state.configuration.refresh().await;
    Ok(state.configuration.snapshot().await)
}

#[tauri::command]
async fn configuration_runtime_idle(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state
        .engine
        .lock()
        .await
        .as_ref()
        .is_none_or(|engine| !engine.is_busy()))
}

#[tauri::command]
async fn save_appearance(
    state: State<'_, AppState>,
    appearance: config::Appearance,
    migrate: bool,
) -> Result<configuration::Snapshot, String> {
    state
        .configuration
        .save_appearance(&appearance, migrate)
        .await
}

#[tauri::command]
async fn open_user_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    kind: String,
) -> Result<(), String> {
    let config = state.configuration.config().await;
    let home = state.data_dir.join("engine-home");
    context::ensure_agent_file(&home).await?;
    let path = match kind.as_str() {
        "config" => state.data_dir.join("fluxcode.toml"),
        "agent" => home.join("AGENTS.md"),
        "environment" => {
            context::write_environment(&home, &config).await?;
            home.join("ENVIRONMENT.md")
        }
        _ => return Err("不支持此配置文件".into()),
    };
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|cause| format!("无法使用系统默认应用打开文件：{cause}"))
}

#[tauri::command]
async fn connect_engine(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
    api_key: Option<String>,
    remember_key: bool,
    expected_revision: Option<u64>,
    force_reconnect: Option<bool>,
) -> Result<Value, String> {
    settings.validate()?;
    let _guard = state.lifecycle.lock().await;
    if !force_reconnect.unwrap_or(false)
        && api_key.as_ref().is_none_or(|key| key.trim().is_empty())
        && state.active_settings.lock().await.as_ref() == Some(&settings)
        && state
            .engine
            .lock()
            .await
            .as_ref()
            .is_some_and(|engine| engine.is_alive())
    {
        return Ok(json!({"version":"0.156.1"}));
    }
    if state
        .engine
        .lock()
        .await
        .as_ref()
        .is_some_and(|engine| engine.is_busy())
    {
        return Err("请先结束正在运行的任务或终端，再切换渠道。".into());
    }
    let previous_configuration = state.configuration.config().await;
    let mut configuration = previous_configuration.clone();
    configuration.provider.base_url = settings.base_url.clone();
    configuration.provider.model = settings.model.clone();
    configuration.provider.api_key_env = settings.api_key_env.clone();
    configuration.network.proxy_url = settings.proxy_url.clone();
    configuration.context.window_tokens = settings.context_window;
    configuration.context.auto_compact_tokens = settings.auto_compact_tokens;
    let home = state.data_dir.join("engine-home");
    context::ensure_agent_file(&home).await?;
    let supplied_key = api_key.filter(|key| !key.trim().is_empty());
    let effective_key = if supplied_key.is_some() {
        supplied_key.clone()
    } else if force_reconnect.unwrap_or(false) && credentials::load(&settings)?.is_some() {
        credentials::load(&settings)?
    } else {
        let cached = state.session_credential.lock().await;
        match cached
            .as_ref()
            .filter(|(base, name, _)| base == &settings.base_url && name == &settings.api_key_env)
        {
            Some((_, _, key)) => Some(key.clone()),
            None => credentials::load(&settings)?,
        }
    };
    let previous_credential = if remember_key && supplied_key.is_some() {
        credentials::load(&settings)?
    } else {
        None
    };
    let engine =
        Engine::launch(&state.binary, &home, &settings, effective_key.clone(), app).await?;
    if remember_key
        && let Some(key) = &supplied_key
        && let Err(error) = credentials::save(&settings, key)
    {
        engine.shutdown().await;
        return Err(error);
    }
    if let Err(error) = state
        .configuration
        .save_settings(&settings, expected_revision)
        .await
    {
        engine.shutdown().await;
        if remember_key && supplied_key.is_some() {
            let rollback = match previous_credential {
                Some(ref key) => credentials::save(&settings, key),
                None => credentials::remove(&settings),
            };
            if rollback.is_err() {
                return Err(
                    "设置保存失败，且无法恢复系统凭据；请检查系统凭据库后重新保存密钥".into(),
                );
            }
        }
        return Err(error);
    }
    if context::write_environment(&home, &configuration)
        .await
        .is_err()
    {
        // Configuration is committed; the generated document is ancillary and can be regenerated.
        tracing::warn!("environment_document_refresh_failed");
    }
    // Commit only after the replacement is ready and persistence succeeds.
    // A failed connection leaves the previous engine available.
    engine.publish();
    if let Some(old) = state.engine.lock().await.replace(engine) {
        old.shutdown().await;
    }
    *state.session_credential.lock().await =
        effective_key.map(|key| (settings.base_url.clone(), settings.api_key_env.clone(), key));
    *state.active_settings.lock().await = Some(settings);
    Ok(json!({"version":"0.156.1"}))
}

#[tauri::command]
async fn forget_api_key(settings: Settings) -> Result<(), String> {
    credentials::remove(&settings)
}

#[tauri::command]
async fn list_backups(state: State<'_, AppState>) -> Result<Vec<backup::BackupSummary>, String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || backup::list(&root))
        .await
        .map_err(|_| "备份列表读取任务中断")?
}

#[tauri::command]
fn open_backup_location(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let path = backup::location(&state.data_dir)?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|cause| format!("无法打开备份目录：{cause}"))
}

#[tauri::command]
async fn create_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ui_state: std::collections::BTreeMap<String, String>,
    automatic: bool,
    progress_id: Option<String>,
) -> Result<backup::BackupSummary, String> {
    if progress_id.as_ref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        return Err("备份进度编号无效".into());
    }
    let cancellation = progress_id.as_ref().map(|_| Arc::new(AtomicU8::new(0)));
    if let (Some(id), Some(flag)) = (&progress_id, &cancellation) {
        let mut jobs = state.backup_jobs.lock().await;
        if jobs.contains_key(id) {
            return Err("备份进度编号已在使用".into());
        }
        jobs.insert(id.clone(), flag.clone());
    }
    let result = async {
        let _guard = state.lifecycle.lock().await;
        if state
            .engine
            .lock()
            .await
            .as_ref()
            .is_some_and(|engine| engine.is_busy())
        {
            return Err("任务或终端正在运行，请结束后再备份".into());
        }
        let root = state.data_dir.clone();
        let cancel = cancellation.clone();
        let job_id = progress_id.clone();
        tokio::task::spawn_blocking(move || {
            let mut last_stage = None;
            let mut last_emit = Instant::now();
            backup::create_with_progress(&root, &ui_state, automatic, &mut |progress| {
                if let Some(flag) = &cancel {
                    if matches!(progress.stage, backup::BackupStage::Publishing) {
                        if flag
                            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
                            .is_err()
                        {
                            return Err("备份已取消".into());
                        }
                    } else if flag.load(Ordering::SeqCst) == 2 {
                        return Err("备份已取消".into());
                    }
                }
                if let Some(ref id) = job_id
                    && (last_stage != Some(progress.stage)
                        || last_emit.elapsed() >= Duration::from_millis(150))
                {
                    if let Err(cause) = app.emit(
                        "backup-progress",
                        json!({
                            "jobId": id,
                            "stage": progress.stage,
                            "files": progress.files,
                            "bytes": progress.bytes,
                        }),
                    ) {
                        tracing::warn!(error = %cause, "backup_progress_emit_failed");
                    }
                    last_stage = Some(progress.stage);
                    last_emit = Instant::now();
                }
                Ok(())
            })
        })
        .await
        .map_err(|_| "备份任务中断")?
    }
    .await;
    if let Some(id) = progress_id {
        state.backup_jobs.lock().await.remove(&id);
    }
    result
}

#[tauri::command]
async fn cancel_backup(state: State<'_, AppState>, progress_id: String) -> Result<bool, String> {
    let jobs = state.backup_jobs.lock().await;
    if let Some(flag) = jobs.get(&progress_id) {
        Ok(flag
            .compare_exchange(0, 2, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok())
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn backup_detail(
    state: State<'_, AppState>,
    id: String,
    offset: usize,
    limit: usize,
) -> Result<backup::BackupDetail, String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || backup::detail(&root, &id, offset, limit))
        .await
        .map_err(|_| "备份详情读取任务中断")?
}

#[tauri::command]
async fn verify_backup(
    state: State<'_, AppState>,
    id: String,
) -> Result<backup::BackupSummary, String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || backup::verify(&root, &id))
        .await
        .map_err(|_| "备份校验任务中断")?
}

#[tauri::command]
async fn remove_backup(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || backup::remove(&root, &id))
        .await
        .map_err(|_| "备份删除任务中断")?
}

#[tauri::command]
async fn request_backup_restore(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    ui_state: std::collections::BTreeMap<String, String>,
) -> Result<backup::BackupSummary, String> {
    if workspace_windows::count(&app) > 0 {
        return Err("恢复备份前请先关闭其他工作区窗口".into());
    }
    let _guard = state.lifecycle.lock().await;
    if state
        .engine
        .lock()
        .await
        .as_ref()
        .is_some_and(|engine| engine.is_busy())
    {
        return Err("任务或终端正在运行，请结束后再恢复".into());
    }
    backup::validate_restore_ui_state(&ui_state)?;
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        backup::verify(&root, &id)?;
        let safety = backup::create(&root, &ui_state, false)?;
        backup::schedule_restore(&root, &id)?;
        Ok(safety)
    })
    .await
    .map_err(|_| "恢复准备任务中断")?
}

#[tauri::command]
fn restart_for_restore(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if !state.data_dir.join("pending-restore.toml").is_file() {
        return Err("没有待执行的恢复请求".into());
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
fn restart_unconfirmed_restore(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !state.data_dir.join("restore-ui.json").is_file() {
        return Err("没有等待确认的恢复结果".into());
    }
    app.request_restart();
    Ok(())
}

#[tauri::command]
fn restored_ui_state(
    state: State<'_, AppState>,
) -> Result<Option<std::collections::BTreeMap<String, String>>, String> {
    backup::restored_ui(&state.data_dir)
}

#[tauri::command]
async fn finish_ui_restore(state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || backup::finish_ui_restore(&root))
        .await
        .map_err(|_| "恢复清理任务中断")?
}

#[tauri::command]
async fn engine_rpc(
    state: State<'_, AppState>,
    method: String,
    mut params: Value,
) -> Result<Value, String> {
    let _guard = if matches!(
        method.as_str(),
        "turn/start"
            | "thread/start"
            | "thread/fork"
            | "thread/resume"
            | "thread/compact/start"
            | "review/start"
            | "command/exec"
    ) {
        Some(state.lifecycle.lock().await)
    } else {
        None
    };
    if !engine::allowed_method(&method) {
        return Err("此操作不在 FluxCode 接口契约内".into());
    }
    if !params.is_object() {
        return Err("请求参数必须是对象".into());
    }
    // Enforce product policy at the trusted boundary, regardless of renderer input.
    if matches!(
        method.as_str(),
        "thread/start" | "thread/resume" | "thread/fork"
    ) {
        params["approvalPolicy"] = json!("never");
        params["sandbox"] = json!("danger-full-access");
        params["modelProvider"] = json!("fluxcode");
        params.as_object_mut().unwrap().remove("config");
    }
    if method == "thread/start" {
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .ok_or("任务缺少项目目录")?;
        workspace::scoped_path(cwd, "")?;
        let config = state.configuration.config().await;
        let instructions = context::instructions(&config, cwd);
        params["developerInstructions"] = json!(instructions);
    }
    if matches!(method.as_str(), "turn/start" | "command/exec") {
        params["sandboxPolicy"] = json!({"type":"dangerFullAccess"});
    }
    if method == "turn/start" {
        model_selection::normalize_turn(&mut params)?;
        params["approvalPolicy"] = json!("never");
    }
    if method == "command/exec" {
        params["timeoutMs"] = json!(120_000);
        params["outputBytesCap"] = json!(1_048_576);
        params.as_object_mut().unwrap().remove("disableTimeout");
        params.as_object_mut().unwrap().remove("disableOutputCap");
    }
    let engine = state
        .engine
        .lock()
        .await
        .clone()
        .ok_or("请先在设置中连接执行引擎")?;
    let timeout = if method == "command/exec" { 135 } else { 45 };
    engine
        .request(&method, params, Duration::from_secs(timeout))
        .await
}

#[tauri::command]
async fn execute_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    caller: tauri::Webview,
    cwd: String,
    command: String,
    process_id: String,
) -> Result<Value, String> {
    workspace::scoped_path(&cwd, "")?;
    if command.trim().is_empty() || command.len() > 100_000 {
        return Err("命令为空或过长".into());
    }
    let config = state.configuration.config().await;
    let terminal = config.terminal;
    let argv = if cfg!(windows) {
        let prefix = "$utf8=[System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding=$utf8; [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8; ";
        vec![
            terminal.windows_shell,
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-Command".into(),
            format!("{prefix}{command}"),
        ]
    } else {
        vec![terminal.unix_shell, "-lc".into(), command]
    };
    let mut env = terminal.environment;
    if !config.network.proxy_url.trim().is_empty() {
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            env.insert(name.into(), config.network.proxy_url.clone());
        }
        env.insert("NO_PROXY".into(), String::new());
        env.insert("no_proxy".into(), String::new());
    }
    let (engine, reservation) = reserve_engine(&state).await?;
    let windows = app.state::<workspace_windows::Windows>();
    let _terminal_slot = windows.register_terminal(&process_id, caller.label())?;
    let result = engine.request("command/exec", json!({"command":argv,"cwd":cwd,"processId":process_id,"env":env,"streamStdoutStderr":true,"timeoutMs":terminal.timeout_seconds * 1000,"outputBytesCap":terminal.output_limit_bytes,"sandboxPolicy":{"type":"dangerFullAccess"}}), Duration::from_secs(terminal.timeout_seconds + 15)).await;
    drop(reservation);
    let _ = app.emit("engine-event", json!({"method":"engine/idle","params":{}}));
    result
}

#[tauri::command]
async fn search_workspace(
    root: String,
    query: String,
    contents: bool,
) -> Result<workspace::SearchResults, String> {
    tokio::time::timeout(
        Duration::from_secs(15),
        workspace::search(&root, &query, contents),
    )
    .await
    .map_err(|_| "工作区搜索超时")?
}
#[tauri::command]
async fn list_files(root: String, relative: String) -> Result<Vec<workspace::Entry>, String> {
    workspace::list(&root, &relative).await
}

#[tauri::command]
async fn open_terminal(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    caller: tauri::Webview,
    cwd: String,
    process_id: String,
    rows: u16,
    cols: u16,
) -> Result<Value, String> {
    let windows = app.state::<workspace_windows::Windows>();
    let _terminal_slot = windows.register_terminal(&process_id, caller.label())?;
    let (engine, reservation) = reserve_engine(&state).await?;
    let config = state.configuration.config().await;
    let result = terminal::open(engine, config, cwd, process_id, rows, cols).await;
    drop(reservation);
    let _ = app.emit("engine-event", json!({"method":"engine/idle","params":{}}));
    result
}

#[tauri::command]
async fn answer_agent(state: State<'_, AppState>, id: Value, answers: Value) -> Result<(), String> {
    state
        .engine
        .lock()
        .await
        .clone()
        .ok_or("Engine disconnected")?
        .answer(id, answers)
        .await
}
#[tauri::command]
async fn answer_elicitation(
    state: State<'_, AppState>,
    id: Value,
    result: Value,
) -> Result<(), String> {
    state
        .engine
        .lock()
        .await
        .clone()
        .ok_or("Engine disconnected")?
        .answer_elicitation(id, result)
        .await
}
#[tauri::command]
async fn read_file(root: String, relative: String) -> Result<String, String> {
    workspace::read(&root, &relative).await
}

#[tauri::command]
async fn save_file(
    state: State<'_, AppState>,
    root: String,
    relative: String,
    expected: String,
    content: String,
) -> Result<(), String> {
    let _guard = state.workspace_mutation.lock().await;
    editor::save(&root, &relative, &expected, &content).await
}
#[tauri::command]
async fn repo_status(root: String) -> Result<workspace::RepoStatus, String> {
    workspace::status(&root).await
}

#[tauri::command]
async fn git_action(
    state: State<'_, AppState>,
    root: String,
    action: git_service::GitAction,
) -> Result<String, String> {
    let _guard = state.workspace_mutation.lock().await;
    let config = state.configuration.config().await;
    git_service::apply(&root, &config.network.proxy_url, action).await
}
#[tauri::command]
async fn git_branches(
    state: State<'_, AppState>,
    root: String,
) -> Result<git_service::GitBranches, String> {
    let config = state.configuration.config().await;
    git_service::branches(&root, &config.network.proxy_url).await
}
#[tauri::command]
async fn git_operation(
    state: State<'_, AppState>,
    root: String,
) -> Result<git_service::GitOperation, String> {
    let config = state.configuration.config().await;
    git_service::operation(&root, &config.network.proxy_url).await
}
#[tauri::command]
async fn git_conflict_versions(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<git_service::ConflictVersions, String> {
    let config = state.configuration.config().await;
    git_service::conflict_versions(&root, &config.network.proxy_url, &path).await
}
#[tauri::command]
async fn list_checkpoints(
    state: State<'_, AppState>,
    root: String,
) -> Result<Vec<git_service::Checkpoint>, String> {
    let config = state.configuration.config().await;
    git_service::checkpoints(&root, &config.network.proxy_url).await
}
#[tauri::command]
async fn file_diff(root: String, relative: String, staged: bool) -> Result<String, String> {
    workspace::diff(&root, &relative, staged).await
}

#[tauri::command]
async fn list_mcp_definitions(
    state: State<'_, AppState>,
) -> Result<Vec<extensions::McpDefinition>, String> {
    extensions::list(&state.data_dir.join("engine-home")).await
}
#[tauri::command]
async fn save_mcp_definition(
    state: State<'_, AppState>,
    definition: extensions::McpDefinition,
) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    let config = state.configuration.config().await;
    extensions::save(
        &state.data_dir.join("engine-home"),
        definition,
        &config.network.proxy_url,
    )
    .await
}

#[tauri::command]
async fn install_skill(state: State<'_, AppState>, source: String) -> Result<String, String> {
    let _guard = state.lifecycle.lock().await;
    extensions::install_skill(&state.data_dir.join("engine-home"), &source).await
}

#[tauri::command]
async fn list_provider_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<providers::Profile>, String> {
    providers::list(&state.data_dir).await
}
#[tauri::command]
fn decode_provider_profiles(text: String) -> Result<Vec<providers::Profile>, String> {
    providers::decode(&text)
}
#[tauri::command]
fn encode_provider_profiles(profiles: Vec<providers::Profile>) -> Result<String, String> {
    providers::encode(profiles)
}
#[tauri::command]
async fn read_user_document(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("请选择绝对文件路径".into());
    }
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|_| "无法读取所选文件")?;
    if !metadata.is_file() || metadata.len() > 8_388_608 {
        return Err("导入文件超过 8 MiB 上限或不是普通文件".into());
    }
    tokio::fs::read_to_string(path)
        .await
        .map_err(|_| "文件必须使用有效 UTF-8 编码".into())
}

#[tauri::command]
async fn save_imported_conversation(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<(), String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || imported_history::save(&root, &id, &content))
        .await
        .map_err(|error| format!("导入历史写入任务失败：{error}"))?
}

#[tauri::command]
async fn read_imported_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || imported_history::read(&root, &id))
        .await
        .map_err(|error| format!("导入历史读取任务失败：{error}"))?
}

#[tauri::command]
async fn remove_imported_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let root = state.data_dir.clone();
    tokio::task::spawn_blocking(move || imported_history::remove(&root, &id))
        .await
        .map_err(|error| format!("导入历史清理任务失败：{error}"))?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedPath {
    path: String,
    kind: String,
}

#[tauri::command]
async fn inspect_dropped_paths(paths: Vec<String>) -> Result<Vec<DroppedPath>, String> {
    if paths.is_empty() || paths.len() > 20 {
        return Err("每次最多拖入 20 个文件或目录".into());
    }
    let mut result = Vec::with_capacity(paths.len());
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        let file = PathBuf::from(&path);
        if !file.is_absolute() || path.len() > 4096 {
            return Err("拖入的路径无效".into());
        }
        let metadata = tokio::fs::symlink_metadata(&file)
            .await
            .map_err(|_| "无法读取拖入的文件或目录")?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("不支持拖入链接文件或目录".into());
            }
        }
        if metadata.file_type().is_symlink() {
            return Err("不支持拖入链接文件或目录".into());
        }
        let kind = if metadata.is_dir() {
            "directory"
        } else if metadata.is_file() {
            tokio::fs::File::open(&file)
                .await
                .map_err(|_| "无法打开拖入的文件，请检查访问权限")?;
            let image = matches!(
                file.extension()
                    .and_then(|extension| extension.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("png" | "jpg" | "jpeg" | "webp" | "gif")
            );
            let limit = if image {
                20 * 1024 * 1024
            } else {
                50 * 1024 * 1024
            };
            if metadata.len() > limit {
                return Err("拖入的文件超过大小上限：图片 20 MiB，其他文件 50 MiB".into());
            }
            if image { "image" } else { "file" }
        } else {
            return Err("不支持拖入此类文件".into());
        };
        if seen.insert(file.clone()) {
            result.push(DroppedPath {
                path,
                kind: kind.into(),
            });
        }
    }
    Ok(result)
}

#[tauri::command]
async fn preview_attachment(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || attachments::preview_image(&path))
        .await
        .map_err(|error| format!("图片预览任务失败：{error}"))?
}
#[tauri::command]
async fn save_provider_profiles(
    state: State<'_, AppState>,
    profiles: Vec<providers::Profile>,
    expected_profiles: Option<Vec<providers::Profile>>,
) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    providers::save_checked(&state.data_dir, profiles, expected_profiles).await
}
#[tauri::command]
async fn save_provider_profile(
    state: State<'_, AppState>,
    profile: providers::Profile,
    previous_name: Option<String>,
    expected_profiles: Vec<providers::Profile>,
    api_key: Option<String>,
) -> Result<Vec<providers::Profile>, String> {
    let _guard = state.lifecycle.lock().await;
    providers::save_profile(
        &state.data_dir,
        profile,
        previous_name,
        expected_profiles,
        api_key,
    )
    .await
}
#[tauri::command]
async fn discover_provider(
    settings: Settings,
    api_key: Option<String>,
) -> Result<providers::Discovery, String> {
    settings.validate_connection()?;
    let key = match api_key.filter(|key| !key.trim().is_empty()) {
        Some(key) => Some(key),
        None => credentials::load(&settings)?.or_else(|| std::env::var(&settings.api_key_env).ok()),
    };
    providers::discover(settings, key).await
}

#[tauri::command]
async fn export_document(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let _guard = state.workspace_mutation.lock().await;
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || document_export::save(&path, &content))
        .await
        .map_err(|_| "导出任务未完成，请重试".to_string())?
}

#[tauri::command]
async fn diagnostics(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    windows: State<'_, workspace_windows::Windows>,
) -> Result<Value, String> {
    let config = state.configuration.config().await;
    let models = providers::list(&state.data_dir).await?;
    let runtime_health = runtime_health::inspect(&state.binary).await;
    let mut window_resources = windows.resource_status();
    window_resources["openWorkspaceWindows"] = json!(workspace_windows::count(&app));
    let engine_resources = state
        .engine
        .lock()
        .await
        .as_ref()
        .map(|engine| engine.resource_status());
    Ok(
        json!({"schemaVersion":1,"appVersion":env!("CARGO_PKG_VERSION"),"engineVersion":"0.156.1","os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"engineBundled":state.binary.is_file(),"connected":engine_resources.is_some(),"engineResources":engine_resources,"windowResources":window_resources,"configSchema":config.schema_version,"providerProfileCount":models.len(),"protocol":config.provider.wire_api,"contextOverrides":{"window":config.context.window_tokens,"compaction":config.context.auto_compact_tokens},"runtimeHealth":runtime_health}),
    )
}

#[tauri::command]
async fn list_schedules(state: State<'_, AppState>) -> Result<Vec<schedules::Schedule>, String> {
    let _guard = state.scheduling.lock().await;
    schedules::list(&state.data_dir).await
}
#[tauri::command]
async fn save_schedule(
    state: State<'_, AppState>,
    mut job: schedules::Schedule,
) -> Result<(), String> {
    let _guard = state.scheduling.lock().await;
    workspace::scoped_path(&job.project, "")?;
    job.status = if job.enabled { "waiting" } else { "paused" }.into();
    job.next_run = schedules::now() + u64::from(job.interval_minutes) * 60;
    schedules::update(&state.data_dir, job).await
}
#[tauri::command]
async fn remove_schedule(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _guard = state.scheduling.lock().await;
    let mut jobs = schedules::list(&state.data_dir).await?;
    if jobs
        .iter()
        .any(|job| job.id == id && job.status == "running")
    {
        return Err("请等待定时任务完成后再修改".into());
    }
    jobs.retain(|job| job.id != id);
    schedules::save(&state.data_dir, jobs).await
}

/// Resolve the desktop's data location without creating or migrating files.
pub fn desktop_data_directory() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|error| format!("无法定位程序文件：{error}"))?;
    let default_data_dir = data_directory::beside_executable(&executable)
        .map_err(|error| format!("无法定位程序数据目录：{error}"))?;
    Ok(cfg!(debug_assertions)
        .then(|| std::env::var_os("FLUXCODE_TEST_DATA_DIR"))
        .flatten()
        .map(PathBuf::from)
        .unwrap_or(default_data_dir))
}

pub fn run() -> Result<(), String> {
    #[cfg(windows)]
    {
        let current = std::env::current_exe().map_err(|error| error.to_string())?;
        if let Some(alias) =
            runtime_paths::compatible_executable(&current).map_err(|error| error.to_string())?
        {
            use std::os::windows::process::CommandExt;
            let mut child = std::process::Command::new(alias)
                .args(std::env::args_os().skip(1))
                .creation_flags(0x08000000) // CREATE_NO_WINDOW; the child creates its own GUI.
                .spawn()
                .map_err(|error| format!("无法通过兼容路径启动程序：{error}"))?;
            let _job = match process_job::attach_desktop(&child) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            let status = child
                .wait()
                .map_err(|error| format!("无法等待程序退出：{error}"))?;
            if status.success() {
                return Ok(());
            }
            return Err(format!("兼容路径中的程序退出失败：{status}"));
        }
    }
    let window_data_dir = desktop_data_directory()?;
    let mut context = tauri::generate_context!();
    if cfg!(debug_assertions) {
        context.config_mut().identifier.push_str(".development");
    }
    let app = tauri::Builder::default()
        .manage(browser::BrowserState::default())
        .manage(workspace_windows::Windows::default())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename(window_data_dir.join("window-state.json").to_string_lossy().to_string())
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let test_directory = cfg!(debug_assertions)
                .then(|| std::env::var_os("FLUXCODE_TEST_DATA_DIR"))
                .flatten().map(PathBuf::from);
            let data_dir = test_directory.clone().unwrap_or(data_directory::beside_executable(&std::fs::canonicalize(std::env::current_exe()?)?)?);
            backup::apply_pending(&data_dir).map_err(std::io::Error::other)?;
            let legacy_config = app.path().app_data_dir()?;
            let legacy_webview = app.path().app_local_data_dir()?;
            data_directory::prepare(&data_dir, (!cfg!(debug_assertions) && test_directory.is_none()).then_some((legacy_config.as_path(), legacy_webview.as_path())))
                .map_err(|error| std::io::Error::other(format!("无法初始化程序目录中的数据文件夹 {}：{error}。请确认目录可写，旧版已退出。旧数据未删除。", data_dir.display())))?;
            if let Some(overridden) = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER")
                && std::fs::canonicalize(overridden)? != std::fs::canonicalize(data_dir.join("webview"))? {
                return Err(std::io::Error::other("WEBVIEW2_USER_DATA_FOLDER 指向程序数据目录之外，请移除此环境变量后启动。").into());
            }
            // Retention inspects the directory before opening the first log file.
            // Create it explicitly so a fresh installation has no misleading scan warning.
            std::fs::create_dir_all(data_dir.join("logs"))?;
            let log_writer = tracing_appender::rolling::Builder::new()
                .rotation(tracing_appender::rolling::Rotation::DAILY)
                .filename_prefix("fluxcode")
                .filename_suffix("jsonl")
                .max_log_files(7)
                .build(data_dir.join("logs"))?;
            let (writer, guard) = tracing_appender::non_blocking(log_writer);
            tracing_subscriber::fmt()
                .json()
                .with_env_filter("fluxcode_lib=info")
                .with_writer(writer)
                .with_ansi(false)
                .try_init()
                .map_err(std::io::Error::other)?;
            app.manage(guard);
            tracing::info!(version = env!("CARGO_PKG_VERSION"), "desktop_started");
            let binary = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("resources/engine")
                    .join(if cfg!(windows) { "codex.exe" } else { "codex" })
            } else {
                app.path()
                    .resource_dir()?
                    .join("engine")
                    .join(if cfg!(windows) { "codex.exe" } else { "codex" })
            };
            app.manage(AppState {
                configuration: tauri::async_runtime::block_on(configuration::Configuration::open(
                    data_dir.clone(),
                ))
                .map_err(std::io::Error::other)?,
                configuration_revision: std::sync::atomic::AtomicU64::new(0),
                session_credential: Mutex::new(None),
                active_settings: Mutex::new(None),
                engine: Mutex::new(None),
                lifecycle: Mutex::new(()),
                backup_jobs: Mutex::new(HashMap::new()),
                workspace_mutation: Mutex::new(()),
                scheduling: Mutex::new(()),
                ui_state_write: Mutex::new(()),
                data_dir: data_dir.clone(),
                binary,
            });
            let window_config = app.config().app.windows.first().ok_or_else(|| std::io::Error::other("Missing main window configuration"))?;
            let window = tauri::WebviewWindowBuilder::from_config(app, window_config)?
                .data_directory(runtime_paths::webview_home(&data_dir.join("webview"))?);
            // tao asserts on failed OLE drop registration for long executable
            // paths. Wry retains its separate WebView drop handler.
            #[cfg(windows)]
            let window = {
                use std::os::windows::ffi::OsStrExt;
                if std::env::current_exe()?.as_os_str().encode_wide().count() >= 260 {
                    tracing::warn!("outer_window_drop_disabled_for_long_path");
                    window.drag_and_drop(false)
                } else {
                    window
                }
            };
            window.build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(configuration::serve(handle.clone()));
            tauri::async_runtime::spawn(schedules::serve(handle));
            Ok(())
        })
        .invoke_handler(|invoke| {
            if !workspace_windows::trusted(invoke.message.webview_ref().label()) {
                invoke.resolver.reject("此页面无权访问本地工作空间");
                return true;
            }
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            workspace_windows::open_workspace_window,
            workspace_windows::focus_main_window,
            workspace_windows::workspace_request,
            workspace_windows::complete_workspace_request,
            workspace_windows::publish_workspace_state,
            workspace_windows::close_workspace_window,
            workspace_windows::workspace_host_ready,
            workspace_windows::workspace_exit_needs_confirmation,
            workspace_windows::runtime_resource_usage,
            external_links::open_external_link,
            browser::browser_command,
            external_links::open_workspace_file,
            configuration_snapshot,
            configuration_runtime_idle,
            save_appearance,
            list_schedules,
            save_schedule,
            remove_schedule,
            diagnostics,
            install_skill,
            list_provider_profiles,
            decode_provider_profiles,
            encode_provider_profiles,
            read_user_document,
            save_imported_conversation,
            read_imported_conversation,
            remove_imported_conversation,
            inspect_dropped_paths,
            preview_attachment,
            save_provider_profiles,
            save_provider_profile,
            discover_provider,
            export_document,
            load_settings,
            load_preferences,
            load_ui_state,
            save_ui_state,
            restore_previous_ui_state,
            commit_restored_ui_state,
            save_font_size,
            save_panel_width,
            open_user_file,
            connect_engine,
            forget_api_key,
            list_backups,
            open_backup_location,
            create_backup,
            cancel_backup,
            backup_detail,
            verify_backup,
            remove_backup,
            request_backup_restore,
            restart_unconfirmed_restore,
            restart_for_restore,
            restored_ui_state,
            finish_ui_restore,
            engine_rpc,
            execute_terminal,
            open_terminal,
            answer_agent,
            answer_elicitation,
            search_workspace,
            list_files,
            read_file,
            save_file,
            repo_status,
            git_action,
            git_branches,
            git_operation,
            git_conflict_versions,
            list_checkpoints,
            list_mcp_definitions,
            save_mcp_definition,
            file_diff
            ];
            handler(invoke)
        })
        .build(context)
        .map_err(|error| error.to_string())?;
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Ready)
            && let Some(window) = app.get_webview_window("main")
            && let Err(error) = window_placement::ensure_visible(&window)
        {
            tracing::warn!(%error, "window_placement_failed");
        }
        if matches!(event, tauri::RunEvent::Exit) {
            tauri::async_runtime::block_on(async {
                if let Some(engine) = app.state::<AppState>().engine.lock().await.take() {
                    engine.shutdown().await;
                }
            });
        }
    });
    Ok(())
}

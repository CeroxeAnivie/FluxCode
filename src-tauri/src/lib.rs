mod config;
mod context;
mod credentials;
mod engine;
mod model_selection;
mod workspace;

use config::Settings;
use engine::Engine;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{Manager, State};
use tokio::sync::Mutex;

struct AppState {
    engine: Mutex<Option<Arc<Engine>>>,
    lifecycle: Mutex<()>,
    data_dir: PathBuf,
    binary: PathBuf,
}

#[tauri::command]
async fn load_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    config::load_settings(&state.data_dir).await
}

#[tauri::command]
async fn load_preferences(state: State<'_, AppState>) -> Result<config::UiConfig, String> {
    Ok(config::load_config(&state.data_dir).await?.ui)
}

#[tauri::command]
async fn save_font_size(state: State<'_, AppState>, size: u16) -> Result<(), String> {
    let _guard = state.lifecycle.lock().await;
    config::save_font_size(&state.data_dir, size).await
}

#[tauri::command]
async fn open_user_file(state: State<'_, AppState>, kind: String) -> Result<(), String> {
    let config = config::load_config(&state.data_dir).await?;
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
    let program = if cfg!(windows) {
        "notepad.exe"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    tokio::process::Command::new(program)
        .arg(path)
        .spawn()
        .map_err(|e| format!("无法打开编辑器：{e}"))?;
    Ok(())
}

#[tauri::command]
async fn connect_engine(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
    api_key: Option<String>,
    remember_key: bool,
) -> Result<Value, String> {
    settings.validate()?;
    let _guard = state.lifecycle.lock().await;
    let mut configuration = config::load_config(&state.data_dir).await?;
    configuration.network.proxy_url = settings.proxy_url.clone();
    let home = state.data_dir.join("engine-home");
    context::ensure_agent_file(&home).await?;
    context::write_environment(&home, &configuration).await?;
    if let Some(old) = state.engine.lock().await.take() {
        old.shutdown().await;
    }
    let supplied_key = api_key.filter(|key| !key.trim().is_empty());
    let effective_key = if supplied_key.is_some() {
        supplied_key.clone()
    } else {
        credentials::load(&settings)?
    };
    let engine = Engine::launch(&state.binary, &home, &settings, effective_key, app).await?;
    if remember_key
        && let Some(key) = &supplied_key
        && let Err(error) = credentials::save(&settings, key)
    {
        engine.shutdown().await;
        return Err(error);
    }
    if let Err(error) = config::save_settings(&state.data_dir, &settings).await {
        engine.shutdown().await;
        return Err(error);
    }
    *state.engine.lock().await = Some(engine);
    Ok(json!({"version":"0.156.1"}))
}

#[tauri::command]
async fn forget_api_key(settings: Settings) -> Result<(), String> {
    credentials::remove(&settings)
}

#[tauri::command]
async fn engine_rpc(
    state: State<'_, AppState>,
    method: String,
    mut params: Value,
) -> Result<Value, String> {
    if !engine::allowed_method(&method) {
        return Err("此操作不在 FluxCode 接口契约内".into());
    }
    if !params.is_object() {
        return Err("请求参数必须是对象".into());
    }
    // Enforce product policy at the trusted boundary, regardless of renderer input.
    if matches!(method.as_str(), "thread/start" | "thread/resume") {
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
        let config = config::load_config(&state.data_dir).await?;
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
    state: State<'_, AppState>,
    cwd: String,
    command: String,
    process_id: String,
) -> Result<Value, String> {
    workspace::scoped_path(&cwd, "")?;
    if command.trim().is_empty() || command.len() > 100_000 {
        return Err("命令为空或过长".into());
    }
    let config = config::load_config(&state.data_dir).await?;
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
    let engine = state.engine.lock().await.clone().ok_or("执行引擎未连接")?;
    engine.request("command/exec", json!({"command":argv,"cwd":cwd,"processId":process_id,"env":env,"streamStdoutStderr":true,"timeoutMs":terminal.timeout_seconds * 1000,"outputBytesCap":terminal.output_limit_bytes,"sandboxPolicy":{"type":"dangerFullAccess"}}), Duration::from_secs(terminal.timeout_seconds + 15)).await
}

#[tauri::command]
async fn list_files(root: String, relative: String) -> Result<Vec<workspace::Entry>, String> {
    workspace::list(&root, &relative).await
}
#[tauri::command]
async fn read_file(root: String, relative: String) -> Result<String, String> {
    workspace::read(&root, &relative).await
}
#[tauri::command]
async fn repo_status(root: String) -> Result<workspace::RepoStatus, String> {
    workspace::status(&root).await
}
#[tauri::command]
async fn file_diff(root: String, relative: String, staged: bool) -> Result<String, String> {
    workspace::diff(&root, &relative, staged).await
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("fluxcode_lib=info")
        .with_target(false)
        .init();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = if cfg!(debug_assertions) {
                std::env::var_os("FLUXCODE_TEST_DATA_DIR")
                    .map(PathBuf::from)
                    .unwrap_or(app.path().app_data_dir()?)
            } else {
                app.path().app_data_dir()?
            };
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
                engine: Mutex::new(None),
                lifecycle: Mutex::new(()),
                data_dir,
                binary,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            load_preferences,
            save_font_size,
            open_user_file,
            connect_engine,
            forget_api_key,
            engine_rpc,
            execute_terminal,
            list_files,
            read_file,
            repo_status,
            file_diff
        ])
        .build(tauri::generate_context!())
        .expect("failed to build FluxCode desktop application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            tauri::async_runtime::block_on(async {
                if let Some(engine) = app.state::<AppState>().engine.lock().await.take() {
                    engine.shutdown().await;
                }
            });
        }
    });
}

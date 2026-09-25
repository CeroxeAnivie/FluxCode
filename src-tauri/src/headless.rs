//! Console entry point: JSON-RPC over stdio, with the same bundled engine/config as desktop.
use crate::{config, credentials};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

pub fn run(args: Vec<String>) -> Result<i32, String> {
    if args.len() != 2 || args[0] != "--data-dir" {
        return Err(
            "Usage: fluxcode-cli --data-dir <absolute FluxCode configuration directory>".into(),
        );
    }
    let root = PathBuf::from(&args[1]);
    if !root.is_absolute() {
        return Err("Configuration directory must be absolute".into());
    }
    let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let configuration = runtime.block_on(config::load_config(&root))?;
    let settings = configuration.settings();
    settings.validate()?;
    let home = root.join("engine-home");
    runtime.block_on(crate::context::ensure_agent_file(&home))?;
    runtime.block_on(crate::context::write_environment(&home, &configuration))?;
    let sqlite_home = crate::runtime_paths::sqlite_home(&home)
        .map_err(|e| format!("Unable to resolve engine data directory: {e}"))?;
    let catalog = home.join("model-catalog.json");
    std::fs::write(&catalog, include_str!("../../config/engine-models.json"))
        .map_err(|e| e.to_string())?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let binary = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/engine")
    } else {
        executable
            .parent()
            .ok_or("Executable directory unavailable")?
            .join("engine")
    }
    .join(if cfg!(windows) { "codex.exe" } else { "codex" });
    if !binary.is_file() {
        return Err("Bundled engine missing".into());
    }
    let mut command = Command::new(binary);
    command
        .args(["app-server", "--listen", "stdio://"])
        .current_dir(&home)
        .env("CODEX_HOME", &home)
        .env("CODEX_SQLITE_HOME", &sqlite_home)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::null());
    command.arg("-c").arg(format!(
        "model_catalog_json={}",
        serde_json::to_string(&catalog).map_err(|e| e.to_string())?
    ));
    for setting in settings.overrides() {
        command.arg("-c").arg(setting);
    }
    command.arg("-c").arg(format!(
        "sqlite_home={}",
        serde_json::to_string(&sqlite_home).map_err(|e| e.to_string())?
    ));
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
    if let Some(key) = credentials::load(&settings)? {
        command.env(&settings.api_key_env, key);
    }
    let status = command
        .status()
        .map_err(|_| "Unable to start bundled engine")?;
    Ok(status.code().unwrap_or(1))
}

use crate::{config::AppConfig, engine::Engine, workspace};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

pub async fn open(
    engine: Arc<Engine>,
    config: AppConfig,
    cwd: String,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<Value, String> {
    workspace::scoped_path(&cwd, "")?;
    if id.is_empty() || id.len() > 100 || !(2..=500).contains(&rows) || !(10..=1000).contains(&cols)
    {
        return Err("Invalid terminal parameters".into());
    }
    let terminal = config.terminal;
    let command = if cfg!(windows) {
        vec![terminal.windows_shell,"-NoLogo".into(),"-NoExit".into(),"-Command".into(),
      "$utf8=[System.Text.UTF8Encoding]::new($false); [Console]::InputEncoding=$utf8; [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8".into()]
    } else {
        vec![terminal.unix_shell, "-i".into()]
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
    // Streaming PTYs retain no unbounded host-side transcript. The UI scrollback is bounded.
    engine
        .request(
            "command/exec",
            json!({"command":command,"cwd":cwd,"processId":id,"env":env,"tty":true,
      "size":{"rows":rows,"cols":cols},"disableTimeout":true,"disableOutputCap":true,
      "sandboxPolicy":{"type":"dangerFullAccess"}}),
            Duration::from_secs(7 * 24 * 3600),
        )
        .await
}

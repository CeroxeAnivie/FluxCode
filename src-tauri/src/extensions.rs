//! MCP configuration is scoped to FluxCode's isolated engine home.
use serde::{Deserialize, Serialize};
use std::path::Path;
use toml_edit::{Array, DocumentMut, Item, Table, value};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct McpDefinition {
    pub name: String,
    pub enabled: bool,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub bearer_token_env_var: Option<String>,
}
impl McpDefinition {
    fn validate(&self) -> Result<(), String> {
        if self.name.is_empty()
            || self.name.len() > 100
            || !self
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err("Invalid MCP server name".into());
        }
        if self.command.is_some() == self.url.is_some() {
            return Err("Choose exactly one MCP transport".into());
        }
        if self.args.len() > 100 || self.args.iter().any(|a| a.len() > 4096) {
            return Err("MCP arguments exceed limit".into());
        }
        if let Some(command) = &self.command
            && (command.trim().is_empty() || command.len() > 4096)
        {
            return Err("Invalid MCP command".into());
        }
        if let Some(address) = &self.url {
            let url = url::Url::parse(address).map_err(|_| "Invalid MCP URL")?;
            if !matches!(url.scheme(), "https" | "http")
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(
                    "MCP URL must be HTTP(S) without credentials or query parameters".into(),
                );
            }
        }
        if let Some(name) = &self.bearer_token_env_var
            && (name.is_empty()
                || !name.bytes().enumerate().all(|(i, b)| {
                    b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit())
                }))
        {
            return Err("Invalid token environment variable".into());
        }
        Ok(())
    }
}
async fn document(home: &Path) -> Result<DocumentMut, String> {
    let text = match tokio::fs::read_to_string(home.join("config.toml")).await {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.to_string()),
    };
    text.parse()
        .map_err(|e: toml_edit::TomlError| e.to_string())
}
pub async fn list(home: &Path) -> Result<Vec<McpDefinition>, String> {
    let doc = document(home).await?;
    let Some(servers) = doc.get("mcp_servers").and_then(Item::as_table) else {
        return Ok(vec![]);
    };
    Ok(servers
        .iter()
        .map(|(name, item)| McpDefinition {
            name: name.into(),
            enabled: item.get("enabled").and_then(Item::as_bool).unwrap_or(true),
            command: item
                .get("command")
                .and_then(Item::as_str)
                .map(str::to_owned),
            args: item
                .get("args")
                .and_then(Item::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
            url: item.get("url").and_then(Item::as_str).map(str::to_owned),
            bearer_token_env_var: item
                .get("bearer_token_env_var")
                .and_then(Item::as_str)
                .map(str::to_owned),
        })
        .collect())
}
pub async fn save(home: &Path, definition: McpDefinition, proxy: &str) -> Result<(), String> {
    definition.validate()?;
    tokio::fs::create_dir_all(home)
        .await
        .map_err(|e| e.to_string())?;
    let mut doc = document(home).await?;
    if !doc.contains_key("mcp_servers") {
        doc["mcp_servers"] = Item::Table(Table::new());
    }
    let mut server = doc["mcp_servers"]
        .get(&definition.name)
        .and_then(Item::as_table)
        .cloned()
        .unwrap_or_default();
    for field in ["command", "args", "url", "bearer_token_env_var"] {
        server.remove(field);
    }
    server["enabled"] = value(definition.enabled);
    if !server.contains_key("startup_timeout_sec") {
        server["startup_timeout_sec"] = value(30);
    }
    if !server.contains_key("tool_timeout_sec") {
        server["tool_timeout_sec"] = value(120);
    }
    if let Some(command) = definition.command {
        server["command"] = value(command);
        let mut args = Array::new();
        for arg in definition.args {
            args.push(arg);
        }
        server["args"] = value(args);
        let mut env = server
            .get("env")
            .and_then(Item::as_table)
            .cloned()
            .unwrap_or_default();
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "NO_PROXY",
            "no_proxy",
        ] {
            env.remove(key);
        }
        if !proxy.trim().is_empty() {
            for key in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                env[key] = value(proxy);
            }
            env["NO_PROXY"] = value("");
            env["no_proxy"] = value("");
        }
        if env.is_empty() {
            server.remove("env");
        } else {
            server["env"] = Item::Table(env);
        }
    }
    if let Some(url) = definition.url {
        server["url"] = value(url);
    }
    if let Some(name) = definition.bearer_token_env_var {
        server["bearer_token_env_var"] = value(name);
    }
    doc["mcp_servers"][&definition.name] = Item::Table(server);
    let temp = home.join("config.toml.tmp");
    tokio::fs::write(&temp, doc.to_string())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temp, home.join("config.toml"))
        .await
        .map_err(|e| e.to_string())
}
/// Install a local skill package without following symbolic links or overwriting user work.
pub async fn install_skill(home: &std::path::Path, source: &str) -> Result<String, String> {
    let source = std::path::PathBuf::from(source)
        .canonicalize()
        .map_err(|_| "技能目录不存在")?;
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("技能名称无效")?;
    if !source.join("SKILL.md").is_file() {
        return Err("技能目录缺少 SKILL.md".into());
    }
    let root = home.join("skills");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| e.to_string())?;
    let target = root.join(name);
    if target.exists() {
        return Err("同名技能已存在，请先在文件系统中管理已有版本".into());
    }
    let mut stack = vec![source.clone()];
    let mut files = vec![];
    let mut total = 0;
    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let kind = entry.file_type().await.map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err("技能包不能包含符号链接".into());
            }
            if kind.is_dir() {
                if stack.len() > 512 {
                    return Err("技能包过大".into());
                }
                stack.push(entry.path());
            } else if kind.is_file() {
                total += entry.metadata().await.map_err(|e| e.to_string())?.len();
                files.push(entry.path());
                if files.len() > 512 || total > 16_777_216 {
                    return Err("技能包过大".into());
                }
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let staging = root.join(format!(".install-{stamp}"));
    tokio::fs::create_dir(&staging)
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        for file in files {
            let path = staging.join(file.strip_prefix(&source).map_err(|e| e.to_string())?);
            tokio::fs::create_dir_all(path.parent().ok_or("技能路径无效")?)
                .await
                .map_err(|e| e.to_string())?;
            tokio::fs::copy(file, path)
                .await
                .map_err(|e| e.to_string())?;
        }
        tokio::fs::rename(&staging, &target)
            .await
            .map_err(|e| e.to_string())?;
        Ok(target.to_string_lossy().into_owned())
    }
    .await;
    if result.is_err() && tokio::fs::remove_dir_all(&staging).await.is_err() {
        tracing::warn!("skill_staging_cleanup_failed");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn local_skills_install_without_overwriting() {
        let source = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        assert!(
            install_skill(home.path(), source.path().to_str().unwrap())
                .await
                .is_err()
        );
        tokio::fs::write(source.path().join("SKILL.md"), "# 示例技能")
            .await
            .unwrap();
        let installed = install_skill(home.path(), source.path().to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(std::path::Path::new(&installed).join("SKILL.md"))
                .await
                .unwrap(),
            "# 示例技能"
        );
        assert!(
            install_skill(home.path(), source.path().to_str().unwrap())
                .await
                .is_err()
        );
    }
    #[tokio::test]
    async fn preserves_other_config_and_injects_proxy() {
        let d = tempfile::tempdir().unwrap();
        tokio::fs::write(d.path().join("config.toml"), "# user\nmodel = \"x\"\n")
            .await
            .unwrap();
        save(
            d.path(),
            McpDefinition {
                name: "local".into(),
                enabled: true,
                command: Some("node".into()),
                args: vec!["server.js".into()],
                url: None,
                bearer_token_env_var: None,
            },
            "http://127.0.0.1:12345/",
        )
        .await
        .unwrap();
        assert_eq!(list(d.path()).await.unwrap().len(), 1);
        let text = tokio::fs::read_to_string(d.path().join("config.toml"))
            .await
            .unwrap();
        assert!(text.contains("# user"));
        assert!(text.contains("HTTP_PROXY"));
        assert!(text.contains("model = \"x\""));
        save(
            d.path(),
            McpDefinition {
                name: "local".into(),
                enabled: true,
                command: Some("node".into()),
                args: vec!["server.js".into()],
                url: None,
                bearer_token_env_var: None,
            },
            "",
        )
        .await
        .unwrap();
        let text = tokio::fs::read_to_string(d.path().join("config.toml"))
            .await
            .unwrap();
        assert!(!text.contains("HTTP_PROXY"));
        assert!(text.contains("model = \"x\""));
    }
}

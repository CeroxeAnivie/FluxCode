use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use url::Url;

const TEMPLATE: &str = include_str!("../../config/fluxcode.example.toml");

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppConfig {
    pub schema_version: u32,
    pub provider: ProviderConfig,
    pub network: NetworkConfig,
    pub execution: ExecutionConfig,
    pub terminal: TerminalConfig,
    pub ui: UiConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    pub wire_api: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkConfig {
    pub proxy_url: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionConfig {
    pub sandbox_mode: String,
    pub approval_policy: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalConfig {
    pub windows_shell: String,
    pub unix_shell: String,
    pub timeout_seconds: u64,
    pub output_limit_bytes: u64,
    pub environment: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UiConfig {
    pub font_size: u16,
    pub sidebar_width: u16,
    pub inspector_width: u16,
}

impl AppConfig {
    pub fn settings(&self) -> Settings {
        Settings {
            base_url: self.provider.base_url.clone(),
            model: self.provider.model.clone(),
            api_key_env: self.provider.api_key_env.clone(),
            proxy_url: self.network.proxy_url.clone(),
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err("不支持此配置版本".into());
        }
        if self.provider.wire_api != "responses" {
            return Err("当前仅支持 Responses API".into());
        }
        if self.execution.sandbox_mode != "danger-full-access"
            || self.execution.approval_policy != "never"
        {
            return Err("当前版本执行策略必须为完全访问 / never".into());
        }
        if !(1..=600).contains(&self.terminal.timeout_seconds)
            || !(1024..=4_194_304).contains(&self.terminal.output_limit_bytes)
        {
            return Err("终端超时或输出上限超出有效范围".into());
        }
        if self.terminal.windows_shell.trim().is_empty()
            || self.terminal.unix_shell.trim().is_empty()
        {
            return Err("Shell 路径不能为空".into());
        }
        if !(11..=18).contains(&self.ui.font_size)
            || !(190..=360).contains(&self.ui.sidebar_width)
            || !(230..=600).contains(&self.ui.inspector_width)
        {
            return Err("UI 尺寸超出有效范围".into());
        }
        Ok(())
    }
}

async fn config_text(root: &Path) -> Result<String, String> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    let path = root.join("fluxcode.toml");
    match tokio::fs::read_to_string(&path).await {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            tokio::fs::write(&path, TEMPLATE)
                .await
                .map_err(|e| e.to_string())?;
            Ok(TEMPLATE.into())
        }
        Err(e) => Err(format!("无法读取 UTF-8 配置文件：{e}")),
    }
}

pub async fn load_config(root: &Path) -> Result<AppConfig, String> {
    let text = config_text(root).await?;
    let config: AppConfig =
        toml_edit::de::from_str(&text).map_err(|e| format!("fluxcode.toml 格式错误：{e}"))?;
    config.validate()?;
    Ok(config)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    pub proxy_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            api_key_env: "OPENAI_API_KEY".into(),
            proxy_url: "http://127.0.0.1:14455/".into(),
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        for (name, value) in [("服务", &self.base_url), ("代理", &self.proxy_url)] {
            let url = Url::parse(value).map_err(|_| format!("{name}地址格式无效"))?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(format!("{name}地址必须是不含凭据或查询参数的 HTTP(S) URL"));
            }
        }
        if self.model.trim().is_empty() || self.model.len() > 256 {
            return Err("请输入模型 ID（最多 256 字符）".into());
        }
        let mut chars = self.api_key_env.chars();
        if !chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err("API Key 环境变量名称无效".into());
        }
        Ok(())
    }

    pub fn overrides(&self) -> Vec<String> {
        // JSON string literals are also valid TOML basic strings. Never interpolate raw input.
        let quote = |s: &str| serde_json::to_string(s).expect("string serialization");
        vec![
            format!("model={}", quote(&self.model)),
            "model_provider=\"fluxcode\"".into(),
            "model_providers.fluxcode.name=\"FluxCode Responses\"".into(),
            format!(
                "model_providers.fluxcode.base_url={}",
                quote(&self.base_url)
            ),
            "model_providers.fluxcode.wire_api=\"responses\"".into(),
            format!(
                "model_providers.fluxcode.env_key={}",
                quote(&self.api_key_env)
            ),
            "model_providers.fluxcode.request_max_retries=2".into(),
            "model_providers.fluxcode.stream_max_retries=2".into(),
            "model_providers.fluxcode.stream_idle_timeout_ms=90000".into(),
            "approval_policy=\"never\"".into(),
            "sandbox_mode=\"danger-full-access\"".into(),
            "analytics.enabled=false".into(),
            "check_for_update_on_startup=false".into(),
            format!(
                "shell_environment_policy.exclude=[{}]",
                quote(&self.api_key_env)
            ),
        ]
    }
}

pub async fn load_settings(root: &Path) -> Result<Settings, String> {
    Ok(load_config(root).await?.settings())
}

pub async fn save_font_size(root: &Path, size: u16) -> Result<(), String> {
    if !(11..=18).contains(&size) {
        return Err("字号应在 11 到 18 之间".into());
    }
    let text = config_text(root).await?;
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| e.to_string())?;
    document["ui"]["font_size"] = toml_edit::value(i64::from(size));
    let temp = root.join("fluxcode.toml.tmp");
    tokio::fs::write(&temp, document.to_string())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temp, root.join("fluxcode.toml"))
        .await
        .map_err(|e| e.to_string())
}

pub async fn save_settings(root: &Path, settings: &Settings) -> Result<(), String> {
    settings.validate()?;
    let text = config_text(root).await?;
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| e.to_string())?;
    document["provider"]["base_url"] = toml_edit::value(&settings.base_url);
    document["provider"]["model"] = toml_edit::value(&settings.model);
    document["provider"]["api_key_env"] = toml_edit::value(&settings.api_key_env);
    document["network"]["proxy_url"] = toml_edit::value(&settings.proxy_url);
    let temp = root.join("fluxcode.toml.tmp");
    tokio::fs::write(&temp, document.to_string())
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temp, root.join("fluxcode.toml"))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid() -> Settings {
        Settings {
            model: "test-model".into(),
            ..Settings::default()
        }
    }

    #[test]
    fn validates_urls_and_environment_names() {
        assert!(valid().validate().is_ok());
        for endpoint in [
            "file:///tmp/a",
            "https://token@example.com/v1",
            "https://example.com/?key=secret",
        ] {
            let s = Settings {
                base_url: endpoint.into(),
                ..valid()
            };
            assert!(s.validate().is_err());
        }
        assert!(
            Settings {
                api_key_env: "A;exec".into(),
                ..valid()
            }
            .validate()
            .is_err()
        );
        assert!(Settings::default().validate().is_err());
    }

    #[test]
    fn overrides_enforce_responses_and_full_access() {
        let args = valid().overrides();
        assert!(args.contains(&"model_providers.fluxcode.wire_api=\"responses\"".into()));
        assert!(args.contains(&"approval_policy=\"never\"".into()));
        assert!(args.contains(&"sandbox_mode=\"danger-full-access\"".into()));
    }

    #[tokio::test]
    async fn settings_round_trip_and_corruption() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load_settings(dir.path()).await.unwrap().model, "");
        save_settings(dir.path(), &valid()).await.unwrap();
        save_settings(dir.path(), &valid()).await.unwrap();
        assert_eq!(load_settings(dir.path()).await.unwrap().model, "test-model");
        let text = tokio::fs::read_to_string(dir.path().join("fluxcode.toml"))
            .await
            .unwrap();
        assert!(text.contains("# FluxCode configuration"));
        assert!(text.contains("[terminal.environment]"));
        tokio::fs::write(dir.path().join("fluxcode.toml"), b"broken")
            .await
            .unwrap();
        assert!(load_settings(dir.path()).await.is_err());
    }

    #[tokio::test]
    async fn typography_persists_without_changing_provider_or_comments() {
        let dir = tempfile::tempdir().unwrap();
        save_settings(dir.path(), &valid()).await.unwrap();
        save_font_size(dir.path(), 18).await.unwrap();
        let configuration = load_config(dir.path()).await.unwrap();
        assert_eq!(configuration.ui.font_size, 18);
        assert_eq!(configuration.settings().model, "test-model");
        assert!(save_font_size(dir.path(), 19).await.is_err());
        assert_eq!(load_config(dir.path()).await.unwrap().ui.font_size, 18);
        assert!(
            config_text(dir.path())
                .await
                .unwrap()
                .contains("# FluxCode configuration")
        );
    }
}

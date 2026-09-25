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
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub context: ContextConfig,
    pub pricing: Option<Pricing>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Pricing {
    pub model: String,
    pub currency: String,
    pub input: f64,
    pub cached: f64,
    pub output: f64,
}
impl Pricing {
    fn validate(&self) -> Result<(), String> {
        if self.model.trim().is_empty()
            || self.model.len() > 256
            || self.currency.len() != 3
            || !self.currency.bytes().all(|c| c.is_ascii_uppercase())
            || [self.input, self.cached, self.output]
                .into_iter()
                .any(|v| !v.is_finite() || !(0.0..=1_000_000.0).contains(&v))
        {
            return Err("价格配置无效".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextConfig {
    pub window_tokens: Option<u32>,
    pub auto_compact_tokens: Option<u32>,
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
    #[serde(default)]
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Appearance {
    pub language: String,
    pub theme: String,
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            language: "zh-CN".into(),
            theme: "system".into(),
        }
    }
}
impl Appearance {
    pub fn validate(&self) -> Result<(), String> {
        if !["zh-CN", "en", "system"].contains(&self.language.as_str())
            || !["light", "dark", "system"].contains(&self.theme.as_str())
        {
            return Err("语言或主题配置无效".into());
        }
        Ok(())
    }
}

impl AppConfig {
    pub fn settings(&self) -> Settings {
        Settings {
            base_url: self.provider.base_url.clone(),
            model: self.provider.model.clone(),
            api_key_env: self.provider.api_key_env.clone(),
            proxy_url: self.network.proxy_url.clone(),
            pricing: self.pricing.clone(),
            context_window: self.context.window_tokens,
            auto_compact_tokens: self.context.auto_compact_tokens,
        }
    }
    pub fn validate(&self) -> Result<(), String> {
        self.appearance.validate()?;
        let mut connection = self.settings();
        if connection.model.is_empty() {
            connection.model = "unconfigured".into();
        }
        connection.validate()?;
        if let Some(pricing) = &self.pricing {
            pricing.validate()?;
        }
        validate_context(self.context.window_tokens, self.context.auto_compact_tokens)?;
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
    match tokio::fs::File::open(&path).await {
        Ok(file) => {
            use tokio::io::AsyncReadExt;
            let mut bytes = Vec::new();
            file.take(1_048_577)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| "无法读取配置文件")?;
            if bytes.len() > 1_048_576 {
                return Err("配置文件超过 1 MiB 上限".into());
            }
            String::from_utf8(bytes).map_err(|_| "配置文件必须使用 UTF-8".into())
        }
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
    let config: AppConfig = toml_edit::de::from_str(&text)
        .map_err(|_| "fluxcode.toml 格式错误，请检查配置文件".to_string())?;
    config.validate()?;
    Ok(config)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    #[serde(default)]
    pub pricing: Option<Pricing>,
    pub base_url: String,
    pub model: String,
    pub api_key_env: String,
    #[serde(default)]
    pub proxy_url: String,
    #[serde(default)]
    pub context_window: Option<u32>,
    #[serde(default)]
    pub auto_compact_tokens: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            model: String::new(),
            api_key_env: "OPENAI_API_KEY".into(),
            proxy_url: String::new(),
            pricing: None,
            context_window: None,
            auto_compact_tokens: None,
        }
    }
}

impl Settings {
    pub fn validate_connection(&self) -> Result<(), String> {
        let mut connection = self.clone();
        connection.model = "discovery".into();
        connection.pricing = None;
        connection.context_window = None;
        connection.auto_compact_tokens = None;
        connection.validate()
    }
    pub fn validate(&self) -> Result<(), String> {
        if let Some(pricing) = &self.pricing {
            pricing.validate()?;
        }
        validate_context(self.context_window, self.auto_compact_tokens)?;
        for (name, value) in [("服务", &self.base_url), ("代理", &self.proxy_url)] {
            if name == "代理" && value.trim().is_empty() {
                continue;
            }
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
        let mut overrides = vec![
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
            // An accepted request can outlive a lost response. Retrying is an
            // explicit user action after reconciliation, never hidden replay.
            "model_providers.fluxcode.request_max_retries=0".into(),
            "model_providers.fluxcode.stream_max_retries=0".into(),
            "model_providers.fluxcode.stream_idle_timeout_ms=90000".into(),
            "approval_policy=\"never\"".into(),
            "sandbox_mode=\"danger-full-access\"".into(),
            "analytics.enabled=false".into(),
            "check_for_update_on_startup=false".into(),
            format!(
                "shell_environment_policy.exclude=[{}]",
                quote(&self.api_key_env)
            ),
        ];
        if let Some(tokens) = self.context_window {
            overrides.push(format!("model_context_window={tokens}"));
        }
        if let Some(tokens) = self.auto_compact_tokens {
            overrides.push(format!("model_auto_compact_token_limit={tokens}"));
        }
        overrides
    }
}

fn validate_context(window: Option<u32>, threshold: Option<u32>) -> Result<(), String> {
    if [window, threshold]
        .into_iter()
        .flatten()
        .any(|n| !(1024..=100_000_000).contains(&n))
    {
        return Err("上下文数值必须是 1024 到 100000000 之间的整数".into());
    }
    if let (Some(window), Some(threshold)) = (window, threshold)
        && threshold >= window
    {
        return Err("自动压缩阈值必须小于上下文窗口".into());
    }
    Ok(())
}

#[cfg(test)]
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
    assign(
        &mut document["ui"]["font_size"],
        toml_edit::value(i64::from(size)),
    );
    write_document(root, &text, &document.to_string()).await
}

pub async fn save_panel_width(root: &Path, panel: &str, width: u16) -> Result<(), String> {
    let key = match panel {
        "sidebar" if (190..=360).contains(&width) => "sidebar_width",
        "inspector" if (230..=600).contains(&width) => "inspector_width",
        _ => return Err("UI 尺寸超出有效范围".into()),
    };
    let text = config_text(root).await?;
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "配置格式错误")?;
    assign(&mut document["ui"][key], toml_edit::value(i64::from(width)));
    write_document(root, &text, &document.to_string()).await
}

pub async fn save_appearance(root: &Path, appearance: &Appearance) -> Result<(), String> {
    appearance.validate()?;
    let text = config_text(root).await?;
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "配置格式错误")?;
    assign(
        &mut document["appearance"]["language"],
        toml_edit::value(&appearance.language),
    );
    assign(
        &mut document["appearance"]["theme"],
        toml_edit::value(&appearance.theme),
    );
    write_document(root, &text, &document.to_string()).await
}

async fn write_document(root: &Path, expected: &str, text: &str) -> Result<(), String> {
    let candidate: AppConfig = toml_edit::de::from_str(text).map_err(|_| "配置格式错误")?;
    candidate.validate()?;
    if tokio::fs::read_to_string(root.join("fluxcode.toml"))
        .await
        .map_err(|e| e.to_string())?
        != expected
    {
        return Err("配置已被其他程序修改，请重新加载后再保存".into());
    }
    use tokio::io::AsyncWriteExt;
    let temp = root.join("fluxcode.toml.tmp");
    let mut file = tokio::fs::File::create(&temp)
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    // Keep the previous valid document, including user comments, for explicit recovery.
    tokio::fs::write(root.join("fluxcode.toml.bak"), expected)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temp, root.join("fluxcode.toml"))
        .await
        .map_err(|e| e.to_string())
}

fn assign(item: &mut toml_edit::Item, mut replacement: toml_edit::Item) {
    if let (Some(current), Some(next)) = (item.as_value(), replacement.as_value_mut()) {
        *next.decor_mut() = current.decor().clone();
    }
    *item = replacement;
}

pub async fn save_settings(root: &Path, settings: &Settings) -> Result<(), String> {
    settings.validate()?;
    let text = config_text(root).await?;
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| e.to_string())?;
    assign(
        &mut document["provider"]["base_url"],
        toml_edit::value(&settings.base_url),
    );
    assign(
        &mut document["provider"]["model"],
        toml_edit::value(&settings.model),
    );
    assign(
        &mut document["provider"]["api_key_env"],
        toml_edit::value(&settings.api_key_env),
    );
    assign(
        &mut document["network"]["proxy_url"],
        toml_edit::value(&settings.proxy_url),
    );
    if document.get("context").is_none() {
        document["context"] = toml_edit::Item::Table(toml_edit::Table::new());
    }
    for (key, value) in [
        ("window_tokens", settings.context_window),
        ("auto_compact_tokens", settings.auto_compact_tokens),
    ] {
        if let Some(value) = value {
            assign(
                &mut document["context"][key],
                toml_edit::value(i64::from(value)),
            );
        } else if let Some(table) = document["context"].as_table_mut() {
            table.remove(key);
        }
    }
    if let Some(pricing) = &settings.pricing {
        if document.get("pricing").is_none() {
            document["pricing"] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        assign(
            &mut document["pricing"]["model"],
            toml_edit::value(&pricing.model),
        );
        assign(
            &mut document["pricing"]["currency"],
            toml_edit::value(&pricing.currency),
        );
        assign(
            &mut document["pricing"]["input"],
            toml_edit::value(pricing.input),
        );
        assign(
            &mut document["pricing"]["cached"],
            toml_edit::value(pricing.cached),
        );
        assign(
            &mut document["pricing"]["output"],
            toml_edit::value(pricing.output),
        );
    } else {
        document.remove("pricing");
    }
    write_document(root, &text, &document.to_string()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn updating_a_value_preserves_inline_comments() {
        let dir = tempfile::tempdir().unwrap();
        load_config(dir.path()).await.unwrap();
        let text = config_text(dir.path())
            .await
            .unwrap()
            .replace("font_size = 14", "font_size = 14 # 我的字号");
        tokio::fs::write(dir.path().join("fluxcode.toml"), text)
            .await
            .unwrap();
        save_font_size(dir.path(), 17).await.unwrap();
        assert!(
            config_text(dir.path())
                .await
                .unwrap()
                .contains("font_size = 17 # 我的字号")
        );
    }

    #[test]
    fn discovery_does_not_require_model_or_inference_options() {
        let settings = Settings {
            model: String::new(),
            context_window: Some(1),
            ..Settings::default()
        };
        assert!(settings.validate_connection().is_ok());
        assert!(settings.validate().is_err());
        let invalid = Settings {
            base_url: "javascript:bad".into(),
            ..settings
        };
        assert!(invalid.validate_connection().is_err());
    }

    fn valid() -> Settings {
        Settings {
            model: "test-model".into(),
            ..Settings::default()
        }
    }

    #[test]
    fn proxy_is_optional_but_explicit_values_are_validated() {
        assert_eq!(Settings::default().proxy_url, "");
        assert!(valid().validate().is_ok());
        let mut settings = valid();
        settings.proxy_url = "https://proxy.example:8443/".into();
        assert!(settings.validate().is_ok());
        settings.proxy_url = "https://user:secret@proxy.example/".into();
        assert!(settings.validate().is_err());
        settings.proxy_url = "not a URL".into();
        assert!(settings.validate().is_err());
        let legacy: Settings = serde_json::from_value(serde_json::json!({
            "baseUrl": "https://api.openai.com/v1",
            "model": "fixture",
            "apiKeyEnv": "OPENAI_API_KEY"
        }))
        .unwrap();
        assert_eq!(legacy.proxy_url, "");
    }

    #[tokio::test]
    async fn context_defaults_validation_and_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            load_settings(dir.path()).await.unwrap().context_window,
            None
        );
        assert!(
            !valid()
                .overrides()
                .iter()
                .any(|v| v.starts_with("model_context_window="))
        );
        let custom = Settings {
            context_window: Some(200_000),
            auto_compact_tokens: Some(160_000),
            ..valid()
        };
        save_settings(dir.path(), &custom).await.unwrap();
        let restored = load_settings(dir.path()).await.unwrap();
        assert_eq!(restored.context_window, Some(200_000));
        assert_eq!(restored.auto_compact_tokens, Some(160_000));
        assert!(
            restored
                .overrides()
                .contains(&"model_auto_compact_token_limit=160000".into())
        );
        for value in [0, 1023, 100_000_001] {
            assert!(
                Settings {
                    context_window: Some(value),
                    ..valid()
                }
                .validate()
                .is_err()
            );
        }
        assert!(
            Settings {
                auto_compact_tokens: Some(200_000),
                ..custom
            }
            .validate()
            .is_err()
        );
        save_settings(dir.path(), &valid()).await.unwrap();
        assert_eq!(
            load_settings(dir.path()).await.unwrap().context_window,
            None
        );
        assert_eq!(
            load_settings(dir.path()).await.unwrap().auto_compact_tokens,
            None
        );
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
        assert!(args.contains(&"model_providers.fluxcode.request_max_retries=0".into()));
        assert!(args.contains(&"model_providers.fluxcode.stream_max_retries=0".into()));
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

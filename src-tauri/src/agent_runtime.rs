//! Product-owned identity and team policy, independent from transport and UI.
use serde::Deserialize;
use serde_json::Value;

const POLICY: &str = include_str!("../../config/agent/runtime.toml");
pub const IDENTITY: &str = include_str!("../../config/agent/BASE_INSTRUCTIONS.md");
const COLLABORATION: &str = include_str!("../../config/agent/COLLABORATION.md");

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Policy {
    collaboration: Collaboration,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Collaboration {
    max_concurrent_agents: String,
    max_depth: String,
    tool_namespace: String,
}

pub fn overrides() -> Result<Vec<String>, String> {
    let policy: Policy =
        toml_edit::de::from_str(POLICY).map_err(|e| format!("代理运行策略无效：{e}"))?;
    let config = policy.collaboration;
    if config.max_concurrent_agents != "unbounded" || config.max_depth != "unbounded" {
        return Err("代理运行策略必须使用明确的无产品配额模式".into());
    }
    // The upstream API takes positive signed TOML integers, not an unlimited flag.
    // Use its representable ceiling without allocating slots or precreating agents.
    let capacity = i64::MAX;
    let quote = |value: &str| serde_json::to_string(value).expect("string serialization");
    Ok(vec![
        format!("instructions={}", quote(IDENTITY)),
        "skills.bundled.enabled=false".into(),
        "features.multi_agent_v2.enabled=true".into(),
        format!("features.multi_agent_v2.max_concurrent_threads_per_session={capacity}"),
        "features.multi_agent_v2.non_code_mode_only=false".into(),
        "features.multi_agent_v2.hide_spawn_agent_metadata=false".into(),
        "features.multi_agent_v2.expose_spawn_agent_model_overrides=true".into(),
        format!(
            "features.multi_agent_v2.tool_namespace={}",
            quote(&config.tool_namespace)
        ),
        format!(
            "features.multi_agent_v2.root_agent_usage_hint_text={}",
            quote(COLLABORATION)
        ),
        format!(
            "features.multi_agent_v2.subagent_usage_hint_text={}",
            quote(COLLABORATION)
        ),
        format!(
            "features.multi_agent_v2.multi_agent_mode_hint_text={}",
            quote(
                "Coordinate useful independent work freely within the user's requested scope. Follow the user's explicit preference for sequential or parallel work."
            )
        ),
        format!("agents.max_concurrent_threads_per_session={capacity}"),
        format!("agents.max_depth={}", i32::MAX),
    ])
}

pub fn model_catalog(available: &[String]) -> Result<String, String> {
    let catalog: Value = serde_json::from_str(include_str!("../../config/engine-models.json"))
        .map_err(|e| format!("模型目录无效：{e}"))?;
    let generic: Value =
        serde_json::from_str(include_str!("../../config/agent/generic-model.json"))
            .map_err(|e| format!("通用模型配置无效：{e}"))?;
    let original = catalog["models"].as_array().ok_or("模型目录缺少模型列表")?;
    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in available {
        if id.trim().is_empty() || !seen.insert(id) {
            continue;
        }
        let mut model = original
            .iter()
            .find(|model| model["slug"].as_str() == Some(id))
            .cloned()
            .unwrap_or_else(|| generic.clone());
        model["slug"] = Value::String(id.clone());
        model["display_name"] = Value::String(id.clone());
        // Portable Responses channels use direct calls, whose explicit plaintext
        // metadata is preserved by the product transport. Code-mode control calls
        // otherwise force encrypted messages regardless of the provider's ability.
        model["tool_mode"] = Value::String("direct".into());
        model["multi_agent_version"] = Value::String("v2".into());
        model["model_messages"]["instructions_template"] = Value::String(IDENTITY.into());
        // Upstream migration advertisements do not describe a custom Responses service.
        model["upgrade"] = Value::Null;
        models.push(model);
    }
    serde_json::to_string(&serde_json::json!({"models":models})).map_err(|e| e.to_string())
}

pub fn write_catalog(path: &std::path::Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("模型目录路径无效")?;
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("无法创建模型目录：{e}"))?;
    file.write_all(content.as_bytes())
        .and_then(|()| file.as_file().sync_all())
        .map_err(|e| format!("无法写入模型目录：{e}"))?;
    file.persist(path)
        .map_err(|e| format!("无法更新模型目录：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn team_tools_have_no_small_product_quota_and_work_in_both_tool_modes() {
        let args = overrides().unwrap();
        assert!(
            args.iter()
                .any(|arg| arg == "features.multi_agent_v2.enabled=true")
        );
        assert!(
            args.iter()
                .any(|arg| arg == "features.multi_agent_v2.non_code_mode_only=false")
        );
        assert!(args.iter().any(|arg| arg.ends_with(&i64::MAX.to_string())));
        assert!(COLLABORATION.contains("followup_task"));
        assert!(COLLABORATION.contains("siblings"));
    }
    #[test]
    fn runtime_persona_is_fluxcode_and_preserves_technical_model_metadata() {
        let result: Value = serde_json::from_str(
            &model_catalog(&["gpt-6-sol".into(), "custom-model".into()]).unwrap(),
        )
        .unwrap();
        assert_eq!(result["models"][0]["tool_mode"], "direct");
        assert_eq!(result["models"][1]["slug"], "custom-model");
        assert_eq!(result["models"][1]["tool_mode"], "direct");
        for current in result["models"].as_array().unwrap() {
            assert_eq!(current["model_messages"]["instructions_template"], IDENTITY);
            assert_eq!(current["multi_agent_version"], "v2");
        }
        assert!(!IDENTITY.to_lowercase().contains("codex"));
        assert!(!COLLABORATION.to_lowercase().contains("codex"));
    }
}

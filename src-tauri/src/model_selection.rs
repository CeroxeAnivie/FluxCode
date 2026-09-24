//! Product selection policy at the renderer/engine boundary.
use serde_json::{Value, json};

pub fn normalize_turn(params: &mut Value) -> Result<(), String> {
    let model = params
        .get("model")
        .and_then(Value::as_str)
        .ok_or("任务缺少模型 ID")?;
    if model.trim().is_empty() || model.len() > 200 {
        return Err("模型 ID 无效".into());
    }
    let effort = params
        .pointer("/collaborationMode/settings/reasoning_effort")
        .ok_or("任务缺少推理强度设置")?;
    if !effort.is_null()
        && !matches!(
            effort.as_str(),
            Some("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max")
        )
    {
        return Err("不支持的推理强度".into());
    }
    // Public effort:null means inherit. A complete collaboration selection clears it.
    // Empty instructions prevent injecting upstream mode prompts over FluxCode's context.
    params["collaborationMode"] = json!({"mode":"default","settings":{
        "model":model,"reasoning_effort":effort,"developer_instructions":""
    }});
    params
        .as_object_mut()
        .ok_or("请求参数必须是对象")?
        .remove("effort");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn off_explicitly_clears_previous_selection() {
        let mut p = json!({"model":"test", "effort":"high", "collaborationMode":{"settings":{"reasoning_effort":null,"developer_instructions":"untrusted"}}});
        normalize_turn(&mut p).unwrap();
        assert!(p.get("effort").is_none());
        assert!(p["collaborationMode"]["settings"]["reasoning_effort"].is_null());
        assert_eq!(
            p["collaborationMode"]["settings"]["developer_instructions"],
            ""
        );
    }
    #[test]
    fn rejects_unknown_effort_and_missing_model() {
        for mut p in [
            json!({}),
            json!({"model":"test","collaborationMode":{"settings":{"reasoning_effort":"unlimited"}}}),
        ] {
            assert!(normalize_turn(&mut p).is_err());
        }
    }
    #[test]
    fn every_native_level_is_preserved() {
        for effort in ["none", "minimal", "low", "medium", "high", "xhigh", "max"] {
            let mut p = json!({"model":"test","collaborationMode":{"settings":{"reasoning_effort":effort}}});
            normalize_turn(&mut p).unwrap();
            assert_eq!(
                p["collaborationMode"]["settings"]["reasoning_effort"],
                effort
            );
        }
    }
}

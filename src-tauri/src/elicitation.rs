use serde_json::Value;
/// Answers are ephemeral and validated against the exact pending request.
pub fn validate(request: &Value, result: &Value) -> Result<(), String> {
    let action = result["action"]
        .as_str()
        .ok_or("Invalid elicitation action")?;
    if !["accept", "decline", "cancel"].contains(&action) {
        return Err("Invalid elicitation action".into());
    }
    if action != "accept" {
        if !result["content"].is_null() {
            return Err("Declined requests cannot carry answers".into());
        }
        return Ok(());
    }
    if request["mode"] == "url" {
        return Ok(());
    }
    if !matches!(
        request["mode"].as_str(),
        Some("form" | "openai/form" | "openaiForm")
    ) {
        return Err("Unsupported verification form".into());
    }
    let properties = request["requestedSchema"]["properties"]
        .as_object()
        .ok_or("Invalid form schema")?;
    let content = result["content"]
        .as_object()
        .ok_or("Invalid form answers")?;
    if content.len() > 64 || result.to_string().len() > 131072 {
        return Err("Form answer limit exceeded".into());
    }
    if let Some(required) = request["requestedSchema"]["required"].as_array() {
        for name in required {
            if !content.contains_key(name.as_str().ok_or("Invalid required field")?) {
                return Err("Required answer missing".into());
            }
        }
    }
    for (name, value) in content {
        let schema = properties.get(name).ok_or("Unknown form field")?;
        let valid = match schema["type"].as_str() {
            Some("string") => value.is_string(),
            Some("number") => value.is_number(),
            Some("integer") => value.is_i64() || value.is_u64(),
            Some("boolean") => value.is_boolean(),
            _ => false,
        };
        if !valid {
            return Err("Invalid form field type".into());
        }
        if let Some(choices) = schema["enum"].as_array()
            && !choices.contains(value)
        {
            return Err("Invalid form choice".into());
        }
        if let Some(text) = value.as_str() {
            let len = text.chars().count() as u64;
            if len > 40000
                || schema["minLength"].as_u64().is_some_and(|n| len < n)
                || schema["maxLength"].as_u64().is_some_and(|n| len > n)
            {
                return Err("Invalid form text length".into());
            }
        }
        if let Some(number) = value.as_f64()
            && (schema["minimum"].as_f64().is_some_and(|min| number < min)
                || schema["maximum"].as_f64().is_some_and(|max| number > max))
        {
            return Err("Form number out of range".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validates_required_fields_types_choices_and_cancellation() {
        let request = json!({"mode":"form","requestedSchema":{"properties":{"name":{"type":"string","enum":["a","b"]}},"required":["name"]}});
        assert!(validate(&request, &json!({"action":"accept","content":{"name":"a"}})).is_ok());
        for content in [
            json!({}),
            json!({"name":1}),
            json!({"name":"c"}),
            json!({"name":"a","other":1}),
        ] {
            assert!(validate(&request, &json!({"action":"accept","content":content})).is_err());
        }
        assert!(validate(&request, &json!({"action":"cancel","content":null})).is_ok());
    }
}

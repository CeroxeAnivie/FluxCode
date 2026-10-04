//! Bounded diagnostics for trusted UI surfaces. Never log credentials or response bodies.
use regex::Regex;
use std::sync::LazyLock;
static RULES: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
    (Regex::new(r#"(?i)https?://[^\s<>"']+"#).unwrap(), "[URL]"),
    (Regex::new(r#"(?i)\b(?:bearer|basic)\s+[^\s"']+"#).unwrap(), "[AUTH REDACTED]"),
    (Regex::new(r"\bsk-[A-Za-z0-9_-]+").unwrap(), "[REDACTED]"),
    (Regex::new(r#"(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization|password|token|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&}]+)"#).unwrap(), "[REDACTED]"),
    (Regex::new(r"(?im)^\s*(?:cookie|set-cookie)\s*:.*$").unwrap(), "[COOKIE REDACTED]"),
]
});
pub fn redact(message: &str, secrets: &[&str]) -> String {
    let mut text = message.to_owned();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        text = text.replace(secret, "[REDACTED]");
    }
    for (pattern, replacement) in RULES.iter() {
        text = pattern.replace_all(&text, *replacement).into_owned();
    }
    text.chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(4096)
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_causes_without_credentials() {
        let raw = "HTTP 400: model unavailable https://account:pass@host/x?token=private\nAuthorization: Bearer sensitive\napi_key=raw-key sk-example-key arbitrary-known";
        let result = redact(raw, &["arbitrary-known"]);
        assert!(result.contains("HTTP 400: model unavailable"));
        for secret in [
            "account",
            "pass",
            "private",
            "sensitive",
            "raw-key",
            "sk-example",
            "arbitrary-known",
        ] {
            assert!(!result.contains(secret), "{secret}");
        }
        assert_eq!(redact(&"中".repeat(5000), &[]).chars().count(), 4096);
    }
}

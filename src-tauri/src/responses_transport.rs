//! Authenticated loopback adapter for portable Responses collaboration messages.
//! Upstream reasoning ciphertext is opaque and never decrypted or rewritten.
use axum::{
    Router,
    body::{Body, Bytes, to_bytes},
    extract::State,
    http::{Request, Response, StatusCode, header},
    routing::any,
};
use futures_util::StreamExt;
use serde_json::Value;
use std::{sync::Arc, time::Duration};

const MAX_BODY: usize = 64 * 1024 * 1024;
const MAX_EVENT: usize = 16 * 1024 * 1024;
struct Upstream {
    base: String,
    key: Option<String>,
    token: String,
    proxy: String,
}
pub struct Runtime {
    pub base_url: String,
    pub token: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start(
    settings: &crate::config::Settings,
    key: Option<String>,
) -> Result<Runtime, String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "无法启动模型协议适配器")?;
    let address = listener
        .local_addr()
        .map_err(|_| "无法读取模型适配器地址")?;
    let token = uuid::Uuid::new_v4().to_string();
    let upstream = Arc::new(Upstream {
        base: settings.base_url.trim_end_matches('/').into(),
        key: key.or_else(|| std::env::var(&settings.api_key_env).ok()),
        token: token.clone(),
        proxy: settings.proxy_url.clone(),
    });
    let app = Router::new().fallback(any(forward)).with_state(upstream);
    let task = tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(%error, "responses_adapter_stopped");
        }
    });
    Ok(Runtime {
        base_url: format!("http://{address}"),
        token,
        task,
    })
}
fn error(status: StatusCode, message: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({"error":{"message":message,"type":"fluxcode_transport_error"}})
                .to_string(),
        ))
        .expect("constant response headers")
}
async fn forward(State(upstream): State<Arc<Upstream>>, request: Request<Body>) -> Response<Body> {
    let expected = format!("Bearer {}", upstream.token);
    if request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        != Some(expected.as_str())
    {
        return error(StatusCode::UNAUTHORIZED, "模型适配器访问被拒绝");
    }
    let path = request.uri().path();
    if !matches!(
        path,
        "/responses" | "/responses/compact" | "/responses/lite" | "/models"
    ) {
        return error(StatusCode::NOT_FOUND, "不支持此模型服务端点");
    }
    if !matches!(
        *request.method(),
        axum::http::Method::POST | axum::http::Method::GET
    ) {
        return error(StatusCode::METHOD_NOT_ALLOWED, "不支持此请求方法");
    }
    let url = format!(
        "{}{}",
        upstream.base,
        request
            .uri()
            .path_and_query()
            .map(|v| v.as_str())
            .unwrap_or(path)
    );
    let route = match crate::network::resolve(&upstream.proxy, &url).await {
        Ok(route) => route,
        Err(reason) => return error(StatusCode::BAD_GATEWAY, &reason),
    };
    let client = match route.client().and_then(|builder| {
        builder
            .redirect(reqwest::redirect::Policy::none())
            .read_timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| "无法初始化模型服务连接".into())
    }) {
        Ok(client) => client,
        Err(reason) => return error(StatusCode::BAD_GATEWAY, &reason),
    };
    let (parts, body) = request.into_parts();
    let body = match to_bytes(body, MAX_BODY).await {
        Ok(body) => body,
        Err(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "模型请求过大或传输中断"),
    };
    let body = if !body.is_empty() {
        match serde_json::from_slice::<Value>(&body) {
            Ok(mut value) => {
                if let Some(tools) = value.get_mut("tools") {
                    plaintext_schema(tools);
                }
                Bytes::from(value.to_string())
            }
            Err(_) => return error(StatusCode::BAD_REQUEST, "模型请求不是有效 JSON"),
        }
    } else {
        body
    };
    let mut outbound = client.request(parts.method, &url).body(body);
    for name in [header::CONTENT_TYPE, header::ACCEPT, header::USER_AGENT] {
        if let Some(value) = parts.headers.get(&name) {
            outbound = outbound.header(name, value);
        }
    }
    // Forward protocol/session metadata, never local adapter credentials or hop-by-hop headers.
    for (name, value) in &parts.headers {
        if name.as_str().starts_with("x-") || name.as_str() == "openai-beta" {
            outbound = outbound.header(name, value);
        }
    }
    if let Some(key) = &upstream.key {
        outbound = outbound.bearer_auth(key);
    }
    let response = match outbound.send().await {
        Ok(response) => response,
        Err(cause) => {
            tracing::warn!(
                timeout = cause.is_timeout(),
                connect = cause.is_connect(),
                "responses_upstream_unreachable"
            );
            return error(
                StatusCode::BAD_GATEWAY,
                if cause.is_timeout() {
                    "模型服务连接超时，请检查服务与代理。"
                } else {
                    "无法连接模型服务，请检查服务地址、代理和网络。"
                },
            );
        }
    };
    let is_events = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"));
    let mut builder = Response::builder().status(response.status());
    for name in [
        header::CONTENT_TYPE,
        header::RETRY_AFTER,
        header::CACHE_CONTROL,
    ] {
        if let Some(value) = response.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    if !is_events {
        let mut input = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = input.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(_) => return error(StatusCode::BAD_GATEWAY, "模型响应传输中断"),
            };
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY {
                return error(StatusCode::BAD_GATEWAY, "模型响应超过大小限制");
            }
            bytes.extend_from_slice(&chunk);
        }
        if let Ok(mut value) = serde_json::from_slice::<Value>(&bytes) {
            plaintext_calls(&mut value);
            bytes = value.to_string().into_bytes();
        }
        return builder
            .body(Body::from(bytes))
            .expect("validated response headers");
    }
    let stream = futures_util::stream::unfold(
        (Box::pin(response.bytes_stream()), Vec::new(), false),
        |(mut input, mut pending, done)| async move {
            if done {
                return None;
            }
            loop {
                if let Some(end) = event_boundary(&pending) {
                    if end > MAX_EVENT {
                        return Some((
                            Err(std::io::Error::other("模型流式事件超过大小限制")),
                            (input, Vec::new(), true),
                        ));
                    }
                    let frame: Vec<_> = pending.drain(..end).collect();
                    return Some((
                        normalize_event(&frame).map(Bytes::from),
                        (input, pending, false),
                    ));
                }
                if pending.len() > MAX_EVENT {
                    return Some((
                        Err(std::io::Error::other("模型流式事件超过大小限制")),
                        (input, Vec::new(), true),
                    ));
                }
                match input.next().await {
                    Some(Ok(bytes)) => pending.extend_from_slice(&bytes),
                    Some(Err(_)) => {
                        return Some((
                            Err(std::io::Error::other("模型响应流中断")),
                            (input, Vec::new(), true),
                        ));
                    }
                    None if pending.is_empty() => return None,
                    None => {
                        return Some((
                            normalize_event(&pending).map(Bytes::from),
                            (input, Vec::new(), true),
                        ));
                    }
                }
            }
        },
    );
    builder
        .body(Body::from_stream(stream))
        .expect("validated response headers")
}
fn plaintext_schema(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (name, child) in map {
                if matches!(name.as_str(), "parameters" | "input_schema") {
                    plaintext_parameters(child);
                } else {
                    plaintext_schema(child);
                }
            }
        }
        Value::Array(values) => {
            for child in values {
                plaintext_schema(child);
            }
        }
        _ => {}
    }
}
fn plaintext_parameters(value: &mut Value) {
    let Value::Object(map) = value else {
        return;
    };
    if map.get("encrypted").is_some_and(Value::is_boolean) {
        map.remove("encrypted");
    }
    for (name, child) in map {
        match name.as_str() {
            "properties" | "$defs" | "definitions" | "patternProperties" | "dependentSchemas" => {
                if let Value::Object(schemas) = child {
                    for schema in schemas.values_mut() {
                        plaintext_parameters(schema);
                    }
                }
            }
            "allOf" | "anyOf" | "oneOf" | "prefixItems" => {
                if let Value::Array(schemas) = child {
                    for schema in schemas {
                        plaintext_parameters(schema);
                    }
                }
            }
            "items"
            | "additionalProperties"
            | "unevaluatedProperties"
            | "contains"
            | "not"
            | "if"
            | "then"
            | "else" => plaintext_parameters(child),
            _ => {}
        }
    }
}
fn plaintext_calls(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("function_call") {
                let name = map.get("name").and_then(Value::as_str).unwrap_or("");
                let namespace = map.get("namespace").and_then(Value::as_str).unwrap_or("");
                if namespace == "collaboration"
                    && matches!(name, "spawn_agent" | "send_message" | "followup_task")
                    && map
                        .get("encrypted_function_args")
                        .is_none_or(Value::is_null)
                {
                    map.insert("encrypted_function_args".into(), serde_json::json!([]));
                }
            }
            for child in map.values_mut() {
                plaintext_calls(child);
            }
        }
        Value::Array(values) => {
            for child in values {
                plaintext_calls(child)
            }
        }
        _ => {}
    }
}
fn event_boundary(bytes: &[u8]) -> Option<usize> {
    bytes
        .windows(2)
        .position(|v| v == b"\n\n")
        .map(|i| i + 2)
        .into_iter()
        .chain(
            bytes
                .windows(4)
                .position(|v| v == b"\r\n\r\n")
                .map(|i| i + 4),
        )
        .min()
}
fn normalize_event(bytes: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| std::io::Error::other("模型事件不是 UTF-8"))?;
    let data = text
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(bytes.to_vec());
    }
    let mut value: Value =
        serde_json::from_str(&data).map_err(|_| std::io::Error::other("模型事件不是有效 JSON"))?;
    plaintext_calls(&mut value);
    let metadata = text
        .lines()
        .filter(|line| !line.starts_with("data:") && !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(format!(
        "{}data: {}\n\n",
        if metadata.is_empty() {
            String::new()
        } else {
            format!("{metadata}\n")
        },
        value
    )
    .into_bytes())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn authenticates_preserves_limits_and_normalizes_real_http_responses() {
        async fn fixture(request: Request<Body>) -> Response<Body> {
            assert_eq!(
                request.headers()[header::AUTHORIZATION],
                "Bearer fixture-secret"
            );
            let mode = request
                .headers()
                .get("x-fixture")
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned();
            let bytes = to_bytes(request.into_body(), MAX_BODY).await.unwrap();
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            assert!(value["tools"][0]["parameters"]["encrypted"].is_null());
            assert!(value["tools"][0]["parameters"]["properties"]["encrypted"].is_object());
            if mode == "quota" {
                return Response::builder()
                    .status(429)
                    .header(header::RETRY_AFTER, "30")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"error":{"message":"fixture quota exhausted"}}"#,
                    ))
                    .unwrap();
            }
            let output = serde_json::json!({"output":[
                {"type":"function_call","namespace":"collaboration","name":"spawn_agent","arguments":"{}"},
                {"type":"reasoning","encrypted_content":"opaque-preserved"}
            ]});
            if mode == "stream" {
                let frame = format!("data: {}\r\n\r\ndata: [DONE]\r\n\r\n", output);
                let chunks = frame
                    .as_bytes()
                    .chunks(7)
                    .map(|chunk| Ok::<_, std::io::Error>(Bytes::copy_from_slice(chunk)))
                    .collect::<Vec<_>>();
                return Response::builder()
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from_stream(futures_util::stream::iter(chunks)))
                    .unwrap();
            }
            Response::builder()
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(output.to_string()))
                .unwrap()
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().route("/v1/responses", any(fixture)))
                .await
                .unwrap()
        });
        let settings = crate::config::Settings {
            base_url,
            proxy_url: "http://127.0.0.1:9".into(),
            ..Default::default()
        };
        let runtime = start(&settings, Some("fixture-secret".into()))
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let endpoint = format!("{}/responses", runtime.base_url);
        assert_eq!(
            client.post(&endpoint).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        let body = serde_json::json!({"tools":[{"parameters":{"encrypted":true,"properties":{"encrypted":{"type":"string"}}}}]});
        for mode in ["json", "stream", "quota"] {
            let response = client
                .post(&endpoint)
                .bearer_auth(&runtime.token)
                .header("x-fixture", mode)
                .json(&body)
                .send()
                .await
                .unwrap();
            if mode == "quota" {
                assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
                assert_eq!(response.headers()[header::RETRY_AFTER], "30");
                assert!(
                    response
                        .text()
                        .await
                        .unwrap()
                        .contains("fixture quota exhausted")
                );
            } else {
                assert!(response.status().is_success());
                let text = response.text().await.unwrap();
                assert!(text.contains("\"encrypted_function_args\":[]"));
                assert!(text.contains("opaque-preserved"));
                if mode == "stream" {
                    assert!(text.contains("data: [DONE]"));
                }
            }
        }
        assert_eq!(
            client
                .get(format!("{}/unrelated", runtime.base_url))
                .bearer_auth(&runtime.token)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        server.abort();
    }
    #[test]
    fn missing_plaintext_marker_is_normalized_without_touching_ciphertext() {
        let mut plain = serde_json::json!({"type":"function_call","namespace":"collaboration","name":"spawn_agent","arguments":"{\"message\":\"普通中文指令\"}"});
        plaintext_calls(&mut plain);
        assert_eq!(plain["encrypted_function_args"], serde_json::json!([]));
        plain["encrypted_function_args"] = serde_json::json!(["message"]);
        let encrypted = plain.clone();
        plaintext_calls(&mut plain);
        assert_eq!(plain, encrypted);
        let mut reasoning = serde_json::json!({"type":"reasoning","encrypted_content":"opaque"});
        let old = reasoning.clone();
        plaintext_calls(&mut reasoning);
        assert_eq!(old, reasoning);
    }
    #[test]
    fn plaintext_schema_preserves_named_properties_and_literal_values() {
        let mut tools = serde_json::json!([{"parameters":{"properties":{
            "message":{"type":"string","encrypted":true},
            "encrypted":true,
            "literal":{"const":{"encrypted":true}}
        }}}]);
        plaintext_schema(&mut tools);
        assert!(tools[0]["parameters"]["properties"]["message"]["encrypted"].is_null());
        assert_eq!(tools[0]["parameters"]["properties"]["encrypted"], true);
        assert_eq!(
            tools[0]["parameters"]["properties"]["literal"]["const"]["encrypted"],
            true
        );
    }
    #[test]
    fn handles_crlf_multiline_and_completion_envelopes() {
        let frame=b"event: response.output_item.done\r\ndata: {\"item\":\r\ndata: {\"type\":\"function_call\",\"namespace\":\"collaboration\",\"name\":\"send_message\"}}\r\n\r\n";
        assert_eq!(event_boundary(frame), Some(frame.len()));
        assert!(
            String::from_utf8(normalize_event(frame).unwrap())
                .unwrap()
                .contains("\"encrypted_function_args\":[]")
        );
        assert_eq!(
            normalize_event(b"data: [DONE]\n\n").unwrap(),
            b"data: [DONE]\n\n"
        );
        assert!(normalize_event(b"data: invalid\n\n").is_err());
    }
}

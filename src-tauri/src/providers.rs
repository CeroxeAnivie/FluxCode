//! Provider profiles contain configuration only. Credentials remain in the OS vault.
use crate::config::Settings;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub name: String,
    pub settings: Settings,
    #[serde(default)]
    pub models: Vec<String>,
}

pub async fn save_checked(
    root: &Path,
    profiles: Vec<Profile>,
    expected: Option<Vec<Profile>>,
) -> Result<(), String> {
    if let Some(expected) = expected
        && list(root).await? != expected
    {
        return Err("渠道列表已在其他位置更新，请重新载入渠道后保存".into());
    }
    save(root, profiles).await
}
/// Caller serializes mutations. A failed profile write restores the previous vault entry.
pub async fn save_profile(
    root: &Path,
    profile: Profile,
    previous_name: Option<String>,
    expected: Vec<Profile>,
    key: Option<String>,
) -> Result<Vec<Profile>, String> {
    let mut profiles = list(root).await?;
    if profiles != expected {
        return Err("渠道列表已在其他位置更新，请重新载入渠道后保存".into());
    }
    let position = previous_name
        .as_ref()
        .and_then(|name| profiles.iter().position(|row| &row.name == name));
    if previous_name.is_some() && position.is_none() {
        return Err("渠道已被移除，请重新载入渠道。".into());
    }
    let key = key.filter(|key| !key.trim().is_empty());
    if let Some(index) = position {
        let previous = &profiles[index].settings;
        let identity_changed = previous.base_url.trim().trim_end_matches('/')
            != profile.settings.base_url.trim().trim_end_matches('/')
            || previous.api_key_env != profile.settings.api_key_env;
        if identity_changed && key.is_none() {
            return Err("连接地址或凭据标识已改变，请输入新密钥。".into());
        }
    }
    if let Some(index) = position {
        profiles[index] = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    validate(&profiles)?;
    validate_unique_credentials(&profiles)?;
    let old = if key.is_some() {
        crate::credentials::load(&profile.settings)?
    } else {
        None
    };
    if let Some(key) = key.as_ref() {
        crate::credentials::save(&profile.settings, key)?;
    }
    if let Err(error) = save(root, profiles.clone()).await {
        if key.is_some() {
            let rollback = match old {
                Some(old) => crate::credentials::save(&profile.settings, &old),
                None => crate::credentials::remove(&profile.settings),
            };
            if rollback.is_err() {
                return Err("渠道保存失败，且密钥恢复失败，请检查系统凭据库。".into());
            }
        }
        return Err(error);
    }
    Ok(profiles)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Profiles {
    schema_version: u32,
    profiles: Vec<Profile>,
}

pub async fn list(root: &Path) -> Result<Vec<Profile>, String> {
    let file = root.join("providers.toml");
    let bytes = match tokio::fs::read(&file).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("无法读取服务配置".into()),
    };
    if bytes.len() > 8_388_608 {
        return Err("服务配置文件过大".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "服务配置必须使用 UTF-8")?;
    let data: Profiles = toml_edit::de::from_str(text).map_err(|_| "服务配置格式无效")?;
    if data.schema_version != 1 {
        return Err("不支持此配置版本".into());
    }
    validate(&data.profiles)?;
    Ok(data.profiles)
}
pub fn validate(profiles: &[Profile]) -> Result<(), String> {
    if profiles.len() > 256 {
        return Err("最多保存 256 个服务配置".into());
    }
    let mut names = std::collections::HashSet::new();
    for profile in profiles {
        if profile.name.trim().is_empty()
            || profile.name.chars().count() > 120
            || !names.insert(&profile.name)
        {
            return Err("服务配置名称无效或重复".into());
        }
        profile.settings.validate()?;
        let mut models = std::collections::HashSet::new();
        if profile.models.len() > 10000
            || profile.models.iter().any(|model| {
                model.trim().is_empty()
                    || model.len() > 256
                    || model.contains(['\n', '\r'])
                    || !models.insert(model)
            })
        {
            return Err("渠道模型列表无效或重复".into());
        }
    }
    Ok(())
}

fn validate_unique_credentials(profiles: &[Profile]) -> Result<(), String> {
    let mut identities = std::collections::HashSet::new();
    for profile in profiles {
        let identity = (
            profile.settings.base_url.trim().trim_end_matches('/'),
            profile.settings.api_key_env.as_str(),
        );
        if !identities.insert(identity) {
            return Err("相同服务地址与凭据标识不能用于多个渠道，请为新渠道设置独立密钥".into());
        }
    }
    Ok(())
}

pub fn decode(text: &str) -> Result<Vec<Profile>, String> {
    if text.len() > 8_388_608 {
        return Err("服务配置文件过大".into());
    }
    let data: Profiles = toml_edit::de::from_str(text).map_err(|_| "服务配置格式无效")?;
    if data.schema_version != 1 {
        return Err("不支持此配置版本".into());
    }
    validate(&data.profiles)?;
    Ok(data.profiles)
}

pub fn encode(profiles: Vec<Profile>) -> Result<String, String> {
    validate(&profiles)?;
    let text = toml_edit::ser::to_string_pretty(&Profiles {
        schema_version: 1,
        profiles,
    })
    .map_err(|e| e.to_string())?;
    if text.len() > 8_388_608 {
        return Err("服务配置文件过大".into());
    }
    Ok(text)
}
pub async fn save(root: &Path, profiles: Vec<Profile>) -> Result<(), String> {
    validate(&profiles)?;
    validate_unique_credentials(&profiles)?;
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    let text = toml_edit::ser::to_string_pretty(&Profiles {
        schema_version: 1,
        profiles,
    })
    .map_err(|e| e.to_string())?;
    if text.len() > 8_388_608 {
        return Err("服务配置文件过大".into());
    }
    let temp = root.join("providers.toml.tmp");
    tokio::fs::write(&temp, text)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temp, root.join("providers.toml"))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub models: Vec<String>,
    pub latency_ms: u128,
    pub duplicate_models: usize,
}
/// Read-only discovery, no redirects, bounded body, no response/key content in errors.
pub async fn discover(settings: Settings, key: Option<String>) -> Result<Discovery, String> {
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25));
    if !settings.proxy_url.trim().is_empty() {
        builder =
            builder.proxy(reqwest::Proxy::all(&settings.proxy_url).map_err(|_| "代理地址无效")?);
    }
    let client = builder.build().map_err(|_| "无法初始化网络连接")?;
    discover_with_client(settings, key, &client).await
}

async fn discover_with_client(
    settings: Settings,
    key: Option<String>,
    client: &reqwest::Client,
) -> Result<Discovery, String> {
    settings.validate_connection()?;
    let mut request = client.get(format!(
        "{}/models",
        settings.base_url.trim_end_matches('/')
    ));
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let started = Instant::now();
    let mut response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        match response.status().as_u16() {
            401 | 403 => return Err("服务拒绝访问，请检查密钥是否有效及模型权限".into()),
            404 | 405 => return Err("服务未提供模型目录，可手动填写模型 ID".into()),
            429 => return Err("服务请求过于频繁，请稍后重试".into()),
            500..=599 => return Err("模型服务暂时不可用，请稍后重试".into()),
            _ => {}
        }
        return Err(format!("服务返回 HTTP {}", response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if chunk.len() > 2_097_152 - bytes.len() {
            return Err("模型目录超过读取上限".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "模型目录格式无效")?;
    let (models, duplicate_models) = parse_models(&value)?;
    Ok(Discovery {
        models,
        latency_ms: started.elapsed().as_millis(),
        duplicate_models,
    })
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "模型服务请求超时，请检查代理或稍后重试".into()
    } else if error.is_connect() {
        "无法连接模型服务，请检查地址、代理和网络".into()
    } else {
        "模型服务响应中断，请重试".into()
    }
}
fn parse_models(value: &serde_json::Value) -> Result<(Vec<String>, usize), String> {
    let rows = value["data"].as_array().ok_or("模型目录格式无效")?;
    if rows.len() > 10000 {
        return Err("模型目录超过读取上限".into());
    }
    let mut models = std::collections::BTreeSet::new();
    let mut duplicate_models = 0;
    for row in rows {
        let id = row["id"]
            .as_str()
            .filter(|id| !id.trim().is_empty() && id.len() <= 256 && !id.contains(['\n', '\r']))
            .ok_or("模型目录格式无效")?;
        if !models.insert(id.to_owned()) {
            duplicate_models += 1;
        }
    }
    if models.is_empty() {
        return Err("模型目录为空，可手动添加模型 ID".into());
    }
    Ok((models.into_iter().collect(), duplicate_models))
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    struct FixtureReply {
        status: &'static str,
        body: String,
        delay: Duration,
    }

    impl FixtureReply {
        fn new(status: &'static str, body: impl Into<String>) -> Self {
            Self {
                status,
                body: body.into(),
                delay: Duration::ZERO,
            }
        }
    }

    fn fixture(replies: Vec<FixtureReply>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/v1", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for reply in replies {
                let deadline = Instant::now() + Duration::from_secs(5);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(pair) => break pair,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "fixture request did not arrive");
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept failed: {error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.ends_with(b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0 && request.len() + count <= 16_384);
                    request.extend_from_slice(&buffer[..count]);
                    if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request.starts_with("GET /v1/models HTTP/1.1\r\n"));
                requests.push(request);
                thread::sleep(reply.delay);
                let response = format!(
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    reply.status,
                    reply.body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.write_all(reply.body.as_bytes());
            }
            requests
        });
        (url, handle)
    }

    fn fixture_client(timeout: Duration) -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()
            .unwrap()
    }

    fn fixture_settings(url: String) -> Settings {
        Settings {
            base_url: url,
            ..Settings::default()
        }
    }

    #[tokio::test]
    async fn discovery_reports_http_failures_without_exposing_response_or_key() {
        let cases = [
            ("401 Unauthorized", "服务拒绝访问"),
            ("403 Forbidden", "服务拒绝访问"),
            ("404 Not Found", "服务未提供模型目录"),
            ("405 Method Not Allowed", "服务未提供模型目录"),
            ("429 Too Many Requests", "服务请求过于频繁"),
            ("500 Internal Server Error", "模型服务暂时不可用"),
            ("503 Service Unavailable", "模型服务暂时不可用"),
        ];
        for (status, expected) in cases {
            let (url, server) = fixture(vec![FixtureReply::new(status, "secret-response-body")]);
            let result = discover_with_client(
                fixture_settings(url),
                Some("fixture-secret-key".into()),
                &fixture_client(Duration::from_secs(2)),
            )
            .await;
            let error = result.err().expect("status must fail");
            assert!(error.contains(expected), "{status}: {error}");
            assert!(!error.contains("secret"));
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(
                requests[0]
                    .to_ascii_lowercase()
                    .contains("authorization: bearer fixture-secret-key")
            );
        }
    }

    #[tokio::test]
    async fn discovery_retries_only_when_the_user_requests_it() {
        let (url, server) = fixture(vec![
            FixtureReply::new("429 Too Many Requests", "{}"),
            FixtureReply::new("200 OK", r#"{"data":[{"id":"model-a"}]}"#),
        ]);
        let settings = fixture_settings(url);
        let client = fixture_client(Duration::from_secs(2));
        assert!(
            discover_with_client(settings.clone(), None, &client)
                .await
                .is_err()
        );
        let retry = discover_with_client(settings, None, &client).await.unwrap();
        assert_eq!(retry.models, vec!["model-a"]);
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn discovery_distinguishes_timeout_invalid_and_oversized_catalogues() {
        let mut slow = FixtureReply::new("200 OK", r#"{"data":[{"id":"model-a"}]}"#);
        slow.delay = Duration::from_millis(150);
        let (url, server) = fixture(vec![slow]);
        let error = discover_with_client(
            fixture_settings(url),
            None,
            &fixture_client(Duration::from_millis(40)),
        )
        .await
        .err()
        .unwrap();
        assert!(error.contains("超时"));
        server.join().unwrap();

        let cases = [
            ("not json".to_string(), "模型目录格式无效"),
            (r#"{"data":[]}"#.to_string(), "模型目录为空"),
            ("x".repeat(2_097_153), "模型目录超过读取上限"),
            (
                serde_json::json!({"data": (0..10_001).map(|i| serde_json::json!({"id": format!("model-{i}")})).collect::<Vec<_>>()}).to_string(),
                "模型目录超过读取上限",
            ),
        ];
        for (body, expected) in cases {
            let (url, server) = fixture(vec![FixtureReply::new("200 OK", body)]);
            let error = discover_with_client(
                fixture_settings(url),
                None,
                &fixture_client(Duration::from_secs(2)),
            )
            .await
            .err()
            .unwrap();
            assert!(error.contains(expected), "{error}");
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn discovery_reports_latency_and_merges_duplicate_ids() {
        let mut reply = FixtureReply::new(
            "200 OK",
            r#"{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-a"}]}"#,
        );
        reply.delay = Duration::from_millis(15);
        let (url, server) = fixture(vec![reply]);
        let result = discover_with_client(
            fixture_settings(url),
            None,
            &fixture_client(Duration::from_secs(2)),
        )
        .await
        .unwrap();
        assert_eq!(result.models, vec!["model-a", "model-b"]);
        assert_eq!(result.duplicate_models, 1);
        assert!(result.latency_ms >= 15);
        server.join().unwrap();
    }
    #[tokio::test]
    async fn profiles_round_trip_and_reject_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        assert!(list(dir.path()).await.unwrap().is_empty());
        let p = Profile {
            name: "测试服务".into(),
            models: vec!["fixture".into(), "another-model".into()],
            settings: Settings {
                model: "fixture".into(),
                ..Settings::default()
            },
        };
        save(dir.path(), vec![p.clone()]).await.unwrap();
        assert!(
            save_checked(dir.path(), vec![], Some(vec![]))
                .await
                .is_err()
        );
        assert_eq!(list(dir.path()).await.unwrap()[0].name, "测试服务");
        assert_eq!(list(dir.path()).await.unwrap()[0].models, p.models);
        assert!(save(dir.path(), vec![p.clone(), p]).await.is_err());
        assert_eq!(list(dir.path()).await.unwrap().len(), 1);
        save(dir.path(), vec![]).await.unwrap();
        assert!(list(dir.path()).await.unwrap().is_empty());
    }
    #[test]
    fn model_catalog_is_validated() {
        assert_eq!(
            parse_models(&serde_json::json!({"data":[{"id":"b"},{"id":"a"},{"id":"a"}]})).unwrap(),
            (vec!["a".into(), "b".into()], 1)
        );
        for invalid in [
            serde_json::json!({}),
            serde_json::json!({"data":[]}),
            serde_json::json!({"data":[{}]}),
            serde_json::json!({"data":[{"id":""}]}),
            serde_json::json!({"data":[{"id":" \t "}]}),
            serde_json::json!({"data":[{"id":"model\nname"}]}),
            serde_json::json!({"data":[{"id":"model\rname"}]}),
        ] {
            assert!(parse_models(&invalid).is_err());
        }
    }
    #[tokio::test]
    async fn same_url_accounts_require_distinct_credential_ids() {
        let dir = tempfile::tempdir().unwrap();
        let first = Profile {
            name: "Primary".into(),
            settings: Settings {
                model: "model-a".into(),
                ..Settings::default()
            },
            models: vec!["model-a".into()],
        };
        let mut second = first.clone();
        second.name = "Secondary".into();
        second.settings.base_url.push('/');
        assert!(
            save(dir.path(), vec![first.clone(), second.clone()])
                .await
                .is_err()
        );
        assert!(list(dir.path()).await.unwrap().is_empty());
        second.settings.api_key_env = "SECONDARY_KEY".into();
        save(dir.path(), vec![first, second]).await.unwrap();
        assert_eq!(list(dir.path()).await.unwrap().len(), 2);
    }
    #[tokio::test]
    async fn editing_connection_identity_requires_a_new_key_without_changing_saved_profiles() {
        let dir = tempfile::tempdir().unwrap();
        let existing = Profile {
            name: "测试渠道".into(),
            settings: Settings {
                model: "model-a".into(),
                ..Settings::default()
            },
            models: vec!["model-a".into()],
        };
        save(dir.path(), vec![existing.clone()]).await.unwrap();
        let mut changed = existing.clone();
        changed.settings.base_url = "https://other.example/v1".into();
        assert!(
            save_profile(
                dir.path(),
                changed,
                Some(existing.name.clone()),
                vec![existing.clone()],
                None,
            )
            .await
            .is_err()
        );
        assert!(list(dir.path()).await.unwrap() == vec![existing]);
    }
    #[test]
    fn transfer_round_trip_rejects_invalid_versions_and_secrets() {
        let profile = Profile {
            name: "服务".into(),
            settings: Settings {
                model: "model".into(),
                ..Settings::default()
            },
            models: vec!["model".into(), "other".into()],
        };
        let text = encode(vec![profile.clone()]).unwrap();
        assert!(decode(&text).unwrap() == vec![profile]);
        assert!(decode(&text.replace("schema_version = 1", "schema_version = 2")).is_err());
        assert!(decode("schema_version = 1\napi_key = 'secret'\nprofiles = []").is_err());
    }
    #[tokio::test]
    async fn legacy_profiles_migrate_and_large_catalogues_remain_complete() {
        let dir = tempfile::tempdir().unwrap();
        let mut profile = Profile {
            name: "Legacy".into(),
            settings: Settings {
                model: "model-0".into(),
                ..Settings::default()
            },
            models: vec![],
        };
        save(dir.path(), vec![profile.clone()]).await.unwrap();
        let file = dir.path().join("providers.toml");
        let legacy = tokio::fs::read_to_string(&file)
            .await
            .unwrap()
            .replace("models = []\n", "");
        tokio::fs::write(&file, legacy).await.unwrap();
        assert!(list(dir.path()).await.unwrap()[0].models.is_empty());
        profile.models = (0..500).map(|i| format!("model-{i}")).collect();
        save(dir.path(), vec![profile.clone()]).await.unwrap();
        assert_eq!(list(dir.path()).await.unwrap()[0].models.len(), 500);
        profile.models.push("model-0".into());
        assert!(save(dir.path(), vec![profile]).await.is_err());
        assert_eq!(list(dir.path()).await.unwrap()[0].models.len(), 500);
    }
}

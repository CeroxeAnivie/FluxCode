//! Resolve per-request network policy; never persist detected machine settings.
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use url::Url;

#[derive(Clone, Default)]
struct SystemProxy {
    server: String,
    bypass: String,
    pac: String,
    auto_detect: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub source: &'static str,
    #[serde(skip)]
    pub proxy: Option<String>,
    pub address: Option<String>,
    pub bypass: String,
    pub bypassed: bool,
}
fn env_value(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
    })
}
fn proxy_url(raw: &str) -> Result<String, String> {
    let value = if raw.contains("://") {
        raw.to_owned()
    } else {
        format!("http://{raw}")
    };
    let url = Url::parse(&value).map_err(|_| "代理地址无效")?;
    if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") || url.host_str().is_none()
    {
        return Err("代理协议不受支持".into());
    }
    Ok(url.to_string())
}
fn manual_proxy(server: &str, scheme: &str) -> Result<Option<String>, String> {
    if server.trim().is_empty() {
        return Ok(None);
    }
    if !server.contains('=') {
        return proxy_url(server.split(';').next().unwrap_or("").trim()).map(Some);
    }
    for part in server.split(';') {
        if let Some((kind, value)) = part.split_once('=')
            && kind.trim().eq_ignore_ascii_case(scheme)
        {
            return proxy_url(value.trim()).map(Some);
        }
    }
    if let Some(value) = server.split(';').find_map(|part| {
        part.split_once('=')
            .filter(|(kind, _)| kind.trim().eq_ignore_ascii_case("socks"))
            .map(|(_, value)| value.trim())
    }) {
        return proxy_url(&format!("socks5://{value}")).map(Some);
    }
    Ok(None)
}
fn bypass_list(raw: &str) -> String {
    let mut entries: Vec<String> = raw
        .split([';', ','])
        .map(str::trim)
        .filter(|x| !x.is_empty() && *x != "<local>")
        .map(|x| x.strip_prefix("*.").unwrap_or(x).to_owned())
        .collect();
    entries.extend(["localhost".into(), "127.0.0.1".into(), "::1".into()]);
    entries.join(",")
}
fn bypasses(target: &Url, raw: &str) -> bool {
    let host = target.host_str().unwrap_or("");
    if raw.split([';', ',']).any(|v| v.trim() == "<local>")
        && !host.contains('.')
        && !host.contains(':')
    {
        return true;
    }
    // Use the HTTP stack's maintained domain/IP/CIDR matcher. This sentinel
    // is never connected to; only the bypass decision is queried.
    let matcher = hyper_util::client::proxy::matcher::Matcher::builder()
        .all("http://proxy.invalid")
        .no(bypass_list(raw))
        .build();
    target
        .as_str()
        .parse::<http::Uri>()
        .ok()
        .is_some_and(|uri| matcher.intercept(&uri).is_none())
}
impl Route {
    pub fn client(&self) -> Result<reqwest::ClientBuilder, String> {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(10));
        if let Some(proxy) = &self.proxy
            && !self.bypassed
        {
            builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效")?);
        }
        Ok(builder)
    }
}
#[tauri::command]
pub async fn network_status(
    caller: tauri::Webview,
    proxy: String,
    target: String,
) -> Result<Route, String> {
    if !crate::workspace_windows::trusted(caller.label()) {
        return Err("此页面无权检查网络配置".into());
    }
    let url = Url::parse(&target).map_err(|_| "服务地址无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("服务地址无效".into());
    }
    resolve(&proxy, &target).await
}
pub async fn resolve(explicit: &str, target: &str) -> Result<Route, String> {
    let url = Url::parse(target).map_err(|_| "服务地址无效")?;
    let env_proxy = if url.scheme() == "https" {
        env_value(&["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"])
    } else {
        env_value(&["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"])
    };
    let (source, proxy, bypass) = if !explicit.trim().is_empty() {
        ("manual", Some(proxy_url(explicit.trim())?), String::new())
    } else if let Some(value) = env_proxy {
        (
            "environment",
            Some(proxy_url(&value)?),
            env_value(&["NO_PROXY", "no_proxy"]).unwrap_or_default(),
        )
    } else {
        let target = target.to_owned();
        let scheme = url.scheme().to_owned();
        let (proxy, bypass) = tokio::task::spawn_blocking(move || {
            let system = system_proxy()?;
            if !system.pac.is_empty() || (system.server.is_empty() && system.auto_detect) {
                resolve_pac(&system, &target)
            } else {
                Ok((manual_proxy(&system.server, &scheme)?, system.bypass))
            }
        })
        .await
        .map_err(|_| "系统代理检测任务中断")??;
        ("system", proxy, bypass)
    };
    let bypassed = bypasses(&url, &bypass);
    if let Some(proxy) = &proxy
        && !bypassed
    {
        probe(proxy).await?;
    }
    let address = proxy.as_ref().and_then(|v| Url::parse(v).ok()).map(|v| {
        format!(
            "{}://{}:{}",
            v.scheme(),
            v.host_str().unwrap_or(""),
            v.port_or_known_default().unwrap_or(1080)
        )
    });
    Ok(Route {
        source,
        proxy,
        address,
        bypass: bypass_list(&bypass),
        bypassed,
    })
}
pub async fn process_environment(
    explicit: &str,
    target: &str,
) -> Result<HashMap<String, String>, String> {
    let target = Url::parse(target).map_err(|_| "服务地址无效")?;
    let mut result = HashMap::new();
    let mut bypass = String::new();
    for (scheme, upper, lower) in [
        ("http", "HTTP_PROXY", "http_proxy"),
        ("https", "HTTPS_PROXY", "https_proxy"),
    ] {
        let mut destination = target.clone();
        destination.set_scheme(scheme).map_err(|_| "服务协议无效")?;
        let route = resolve(explicit, destination.as_str()).await?;
        for key in [upper, lower] {
            result.insert(key.into(), route.proxy.clone().unwrap_or_default());
        }
        bypass = route.bypass;
    }
    // Explicit empty values prevent stale parent ALL_PROXY from overriding a direct decision.
    for key in ["ALL_PROXY", "all_proxy"] {
        result.insert(key.into(), String::new());
    }
    for key in ["NO_PROXY", "no_proxy"] {
        result.insert(key.into(), bypass.clone());
    }
    Ok(result)
}
async fn probe(proxy: &str) -> Result<(), String> {
    static HEALTH: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let parsed = Url::parse(proxy).map_err(|_| "代理地址无效")?;
    let host = parsed.host_str().ok_or("代理地址无效")?;
    let port = parsed.port_or_known_default().unwrap_or(1080);
    let key = format!("{host}:{port}");
    let health = HEALTH.get_or_init(Default::default);
    if health
        .lock()
        .map_err(|_| "代理检查状态不可用")?
        .get(&key)
        .is_some_and(|at| at.elapsed() < Duration::from_secs(5))
    {
        return Ok(());
    }
    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::TcpStream::connect((host, port)),
    )
    .await
    .map_err(|_| "代理连接超时，请检查系统代理是否已启动。")?
    .map_err(|_| "代理已配置，但无法连接。请启动代理服务或关闭系统代理后重试。")?;
    let mut cache = health.lock().map_err(|_| "代理检查状态不可用")?;
    cache.retain(|_, at| at.elapsed() < Duration::from_secs(5));
    if cache.len() >= 64 {
        cache.clear();
    }
    cache.insert(key, Instant::now());
    Ok(())
}
#[cfg(not(windows))]
fn system_proxy() -> Result<SystemProxy, String> {
    Ok(SystemProxy::default())
}
#[cfg(not(windows))]
fn resolve_pac(_: &SystemProxy, _: &str) -> Result<(Option<String>, String), String> {
    Ok((None, String::new()))
}
#[cfg(windows)]
fn take_wide(pointer: *mut u16) -> String {
    if pointer.is_null() {
        return String::new();
    }
    // WinHTTP returns owned, NUL-terminated UTF-16 buffers, released with GlobalFree.
    unsafe {
        let mut length = 0;
        while *pointer.add(length) != 0 {
            length += 1;
        }
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
        windows_sys::Win32::Foundation::GlobalFree(pointer.cast());
        value
    }
}
#[cfg(windows)]
fn system_proxy() -> Result<SystemProxy, String> {
    use windows_sys::Win32::Networking::WinHttp::*;
    let mut config = unsafe { std::mem::zeroed() };
    if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut config) } == 0 {
        return Err("无法读取 Windows 系统代理设置".into());
    }
    Ok(SystemProxy {
        server: take_wide(config.lpszProxy),
        bypass: take_wide(config.lpszProxyBypass),
        pac: take_wide(config.lpszAutoConfigUrl),
        auto_detect: config.fAutoDetect != 0,
    })
}
#[cfg(windows)]
fn resolve_pac(system: &SystemProxy, target: &str) -> Result<(Option<String>, String), String> {
    use windows_sys::Win32::Networking::WinHttp::*;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let agent = wide("FluxCode");
    let pac = wide(&system.pac);
    let target = wide(target);
    let handle = unsafe {
        WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            std::ptr::null(),
            std::ptr::null(),
            0,
        )
    };
    if handle.is_null() {
        return Err("无法初始化系统代理解析器".into());
    }
    unsafe {
        WinHttpSetTimeouts(handle, 2000, 2000, 2000, 2000);
    }
    let mut options: WINHTTP_AUTOPROXY_OPTIONS = unsafe { std::mem::zeroed() };
    options.fAutoLogonIfChallenged = 0;
    if system.pac.is_empty() {
        options.dwFlags = WINHTTP_AUTOPROXY_AUTO_DETECT;
        options.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DNS_A | WINHTTP_AUTO_DETECT_TYPE_DHCP;
    } else {
        options.dwFlags = WINHTTP_AUTOPROXY_CONFIG_URL;
        options.lpszAutoConfigUrl = pac.as_ptr();
    }
    let mut info: WINHTTP_PROXY_INFO = unsafe { std::mem::zeroed() };
    let ok = unsafe { WinHttpGetProxyForUrl(handle, target.as_ptr(), &mut options, &mut info) };
    let error = unsafe { windows_sys::Win32::Foundation::GetLastError() };
    unsafe {
        WinHttpCloseHandle(handle);
    }
    let server = take_wide(info.lpszProxy);
    let bypass = take_wide(info.lpszProxyBypass);
    if ok == 0 {
        if system.pac.is_empty() && error == ERROR_WINHTTP_AUTODETECTION_FAILED {
            return Ok((None, system.bypass.clone()));
        }
        return Err(format!("系统自动代理解析失败（Windows 错误 {error}）"));
    }
    let destination = String::from_utf16_lossy(&target[..target.len() - 1]);
    Ok((
        manual_proxy(
            &server,
            Url::parse(&destination)
                .map_err(|_| "服务地址无效")?
                .scheme(),
        )?,
        bypass,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protocol_specific_proxy_and_disabled_configuration() {
        assert_eq!(manual_proxy("", "https").unwrap(), None);
        assert_eq!(
            manual_proxy("http=proxy.example:8080;https=secure.example:8443", "https")
                .unwrap()
                .as_deref(),
            Some("http://secure.example:8443/")
        );
        assert!(
            manual_proxy("http=proxy.example:8080", "https")
                .unwrap()
                .is_none()
        );
        assert!(manual_proxy("ftp://bad.example", "https").is_err());
    }
    #[test]
    fn bypasses_loopback_and_native_exceptions() {
        for url in [
            "http://127.0.0.1:9000",
            "http://localhost:8000",
            "http://[::1]:42",
            "https://service.internal.example",
        ] {
            assert!(bypasses(
                &Url::parse(url).unwrap(),
                "*.internal.example;<local>"
            ));
        }
        assert!(!bypasses(
            &Url::parse("https://public.example").unwrap(),
            "*.internal.example"
        ));
    }
    #[tokio::test]
    async fn health_checks_a_live_and_closed_listener() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        assert!(probe(&format!("http://{address}")).await.is_ok());
        let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = closed.local_addr().unwrap();
        drop(closed);
        assert!(probe(&format!("http://{address}")).await.is_err());
    }
}

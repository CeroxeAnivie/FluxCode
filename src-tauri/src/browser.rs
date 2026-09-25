//! One remote child WebView in the workspace's right panel. Never granted IPC capabilities.
use serde::{Deserialize, Serialize};
use tauri::{
    Emitter, Manager, State, WebviewUrl,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};

#[derive(Default)]
pub struct BrowserState(tokio::sync::Mutex<()>);

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn checked(self) -> Result<tauri::Rect, String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|n| !n.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.x + self.width > 32768.0
            || self.y + self.height > 32768.0
        {
            return Err("浏览器布局无效".into());
        }
        Ok(tauri::Rect {
            position: tauri::LogicalPosition::new(self.x, self.y).into(),
            size: tauri::LogicalSize::new(self.width, self.height).into(),
        })
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BrowserAction {
    Navigate { url: String, bounds: Bounds },
    Layout { bounds: Bounds, visible: bool },
    Back,
    Forward,
    Reload,
    Close,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserEvent {
    url: Option<String>,
    loading: bool,
    notice: Option<&'static str>,
}

fn emit(
    app: &tauri::AppHandle,
    target: &str,
    url: Option<String>,
    loading: bool,
    notice: Option<&'static str>,
) {
    if let Err(error) = app.emit_to(
        tauri::EventTarget::webview(target),
        "browser-state",
        BrowserEvent {
            url,
            loading,
            notice,
        },
    ) {
        tracing::warn!(%error, "browser_state_delivery_failed");
    }
}

fn remote_url(value: &str, dev_origin: Option<&str>) -> Result<url::Url, String> {
    let url = crate::external_links::validate(value)?;
    if matches!(
        url.host_str(),
        Some("tauri.localhost" | "asset.localhost" | "ipc.localhost")
    ) || dev_origin.is_some_and(|origin| url.origin().ascii_serialization() == origin)
    {
        return Err("浏览器不能访问应用内部地址".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn browser_command(
    app: tauri::AppHandle,
    state: State<'_, BrowserState>,
    caller: tauri::Webview,
    action: BrowserAction,
) -> Result<(), String> {
    if !crate::workspace_windows::trusted(caller.label()) {
        return Err("此页面无权控制工作空间".into());
    }
    let owner = caller.label().to_owned();
    let label = if owner == "main" {
        "restricted-browser".to_owned()
    } else {
        format!("restricted-browser-{owner}")
    };
    let _guard = state.0.lock().await;
    let origin = app
        .config()
        .build
        .dev_url
        .as_ref()
        .map(|url| url.origin().ascii_serialization());
    match action {
        BrowserAction::Navigate { url, bounds } => {
            let url = remote_url(&url, origin.as_deref())?;
            let rect = bounds.checked()?;
            if let Some(view) = app.get_webview(&label) {
                view.set_bounds(rect).map_err(|_| "无法调整浏览器布局")?;
                view.navigate(url).map_err(|_| "无法打开网页")?;
                return view.show().map_err(|_| "无法显示浏览器".into());
            }
            let navigation_app = app.clone();
            let popup_app = app.clone();
            let download_app = app.clone();
            let page_app = app.clone();
            let navigation_target = owner.clone();
            let popup_target = owner.clone();
            let download_target = owner.clone();
            let page_target = owner.clone();
            let popup_label = label.clone();
            let navigation_origin = origin.clone();
            let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
                .incognito(true)
                .data_directory(
                    crate::runtime_paths::webview_home(&if owner == "main" {
                        app.state::<crate::AppState>().data_dir.join("webview")
                    } else {
                        app.state::<crate::AppState>()
                            .data_dir
                            .join("webview")
                            .join(&owner)
                    })
                    .map_err(|_| "无法打开浏览器数据目录")?,
                )
                .disable_drag_drop_handler()
                .on_navigation(move |url| {
                    let allowed = remote_url(url.as_str(), navigation_origin.as_deref()).is_ok();
                    if !allowed {
                        emit(
                            &navigation_app,
                            &navigation_target,
                            None,
                            false,
                            Some("已阻止不安全的网页跳转"),
                        );
                    }
                    allowed
                })
                .on_new_window(move |url, _| {
                    if remote_url(url.as_str(), origin.as_deref()).is_ok() {
                        let app = popup_app.clone();
                        let label = popup_label.clone();
                        let target = popup_target.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(view) = app.get_webview(&label)
                                && view.navigate(url).is_err()
                            {
                                emit(&app, &target, None, false, Some("无法打开网页"));
                            }
                        });
                    } else {
                        emit(
                            &popup_app,
                            &popup_target,
                            None,
                            false,
                            Some("已阻止不安全的网页跳转"),
                        );
                    }
                    NewWindowResponse::Deny
                })
                .on_download(move |_, _| {
                    emit(
                        &download_app,
                        &download_target,
                        None,
                        false,
                        Some("请在系统浏览器中下载文件"),
                    );
                    false
                })
                .on_page_load(move |_, payload| {
                    emit(
                        &page_app,
                        &page_target,
                        Some(payload.url().to_string()),
                        matches!(payload.event(), PageLoadEvent::Started),
                        None,
                    );
                });
            app.get_window(&owner)
                .ok_or("主窗口尚未就绪")?
                .add_child(builder, rect.position, rect.size)
                .map_err(|error| {
                    tracing::warn!(%error, "browser_create_failed");
                    "无法打开应用内浏览器".to_string()
                })?;
            Ok(())
        }
        BrowserAction::Close => {
            if let Some(view) = app.get_webview(&label) {
                view.close().map_err(|_| "无法关闭浏览器")?;
            }
            if let Some(main) = app.get_webview(&owner) {
                main.set_focus().map_err(|_| "无法返回工作空间")?;
            }
            Ok(())
        }
        action => {
            let Some(view) = app.get_webview(&label) else {
                return Ok(());
            };
            let result = match action {
                BrowserAction::Layout { bounds, visible } => {
                    view.set_bounds(bounds.checked()?)
                        .map_err(|_| "无法调整浏览器布局")?;
                    if visible { view.show() } else { view.hide() }
                }
                BrowserAction::Back => view.eval("window.history.back()"),
                BrowserAction::Forward => view.eval("window.history.forward()"),
                BrowserAction::Reload => view.reload(),
                _ => unreachable!(),
            };
            result.map_err(|_| "浏览器操作未完成，请重试".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_internal_origins_and_unsafe_schemes() {
        for value in [
            "http://tauri.localhost/index.html",
            "http://asset.localhost/file",
            "http://ipc.localhost",
            "file:///C:/secret",
            "data:text/html,hi",
            "javascript:alert(1)",
            "https://user:password@example.com",
            "http://localhost:1420/a",
        ] {
            assert!(
                remote_url(value, Some("http://localhost:1420")).is_err(),
                "{value}"
            );
        }
        assert!(remote_url("https://example.com/guide", None).is_ok());
        assert!(
            remote_url(
                "http://localhost:8000/preview",
                Some("http://localhost:1420")
            )
            .is_ok()
        );
    }

    #[test]
    fn layout_rejects_invalid_or_unbounded_coordinates() {
        let good = Bounds {
            x: 600.0,
            y: 90.0,
            width: 500.0,
            height: 700.0,
        };
        assert!(good.checked().is_ok());
        for bad in [
            Bounds { width: 0.0, ..good },
            Bounds { x: -1.0, ..good },
            Bounds {
                height: f64::NAN,
                ..good
            },
            Bounds {
                width: 40000.0,
                ..good
            },
        ] {
            assert!(bad.checked().is_err());
        }
    }
}

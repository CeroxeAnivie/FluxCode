//! Keep the mature native dialog plugin, without replacing web alert/confirm.
//! App dialogs use explicit plugin commands; remote pages keep browser semantics.
use tauri::{
    AppHandle, RunEvent, Runtime, Webview, Window,
    ipc::Invoke,
    plugin::{Plugin, TauriPlugin},
    webview::PageLoadPayload,
};
pub struct NativeDialogs<R: Runtime>(TauriPlugin<R>);
pub fn init<R: Runtime>() -> NativeDialogs<R> {
    NativeDialogs(tauri_plugin_dialog::init())
}
impl<R: Runtime> Plugin<R> for NativeDialogs<R> {
    fn name(&self) -> &'static str {
        self.0.name()
    }
    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }
    // Intentionally omit the upstream global alert/confirm JavaScript overrides.
    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window);
    }
    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview);
    }
    fn on_navigation(&mut self, webview: &Webview<R>, url: &url::Url) -> bool {
        self.0.on_navigation(webview, url)
    }
    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload);
    }
    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event);
    }
    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.0.extend_api(invoke)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keeps_native_commands_without_injecting_remote_page_overrides() {
        let plugin = init::<tauri::Wry>();
        assert_eq!(plugin.name(), "dialog");
        assert!(plugin.initialization_script_2().is_none());
    }
}

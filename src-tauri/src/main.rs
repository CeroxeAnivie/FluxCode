#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = fluxcode_lib::run() {
        let english = startup_uses_english();
        let message = localized_startup_message(&error, english);
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
            let title: Vec<u16> = if english {
                "FluxCode startup failed\0"
            } else {
                "FluxCode 启动失败\0"
            }
            .encode_utf16()
            .collect();
            let content: Vec<u16> = format!("{message}\0").encode_utf16().collect();
            unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    content.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
        #[cfg(not(windows))]
        eprintln!("{message}");
        std::process::exit(1);
    }
}

fn startup_uses_english() -> bool {
    use std::io::Read;
    // Startup recovery must work without WebView2 and must never write config.
    let read = || -> Option<String> {
        let root = fluxcode_lib::desktop_data_directory().ok()?;
        let file = std::fs::File::open(root.join("fluxcode.toml")).ok()?;
        let mut text = String::new();
        file.take(1_048_577).read_to_string(&mut text).ok()?;
        (text.len() <= 1_048_576).then_some(text)
    };
    #[cfg(windows)]
    let system_chinese =
        unsafe { windows_sys::Win32::Globalization::GetUserDefaultUILanguage() } & 0x3ff == 0x04;
    #[cfg(not(windows))]
    let system_chinese = std::env::var("LANG").is_ok_and(|value| value.starts_with("zh"));
    configuration_uses_english(read().as_deref().unwrap_or(""), system_chinese)
}

fn configuration_uses_english(text: &str, system_chinese: bool) -> bool {
    let Ok(document) = text.parse::<toml_edit::DocumentMut>() else {
        return false;
    };
    match document
        .get("appearance")
        .and_then(|value| value.get("language"))
        .and_then(|value| value.as_str())
    {
        Some("en") => true,
        Some("system") => !system_chinese,
        _ => false,
    }
}

fn localized_startup_message(error: &str, english: bool) -> String {
    if !english {
        return startup_message(error);
    }
    let context = if error.contains("无法初始化程序目录中的数据文件夹") {
        "The data directory could not be initialized. Check available disk space and directory permissions."
    } else if error.contains("短路径") || error.contains("较短路径") {
        "The program path is too long and this disk cannot provide a compatible Windows short path. Move the entire program directory to a shorter path and try again."
    } else if error.contains("WEBVIEW2_USER_DATA_FOLDER") {
        "WEBVIEW2_USER_DATA_FOLDER points outside the program data directory. Remove this environment variable and try again."
    } else if error.to_ascii_lowercase().contains("webview2") {
        "WebView2 could not start. Install or repair Microsoft Edge WebView2 Runtime, then restart FluxCode."
    } else if error.contains("内置执行引擎") {
        "The bundled engine is missing or damaged. Repair FluxCode using the official installer."
    } else {
        "The desktop window or local service could not start. Check data/logs in the program directory and make sure WebView2 is available."
    };
    format!(
        "{context}\n\nKeep the data folder in the program directory. Fix the issue and try again."
    )
}

fn startup_message(error: &str) -> String {
    let context = if error.contains("无法初始化程序目录中的数据文件夹")
        && !error.to_ascii_lowercase().contains("sk-")
    {
        error.lines().next().unwrap_or("数据目录初始化失败。")
    } else if error.contains("短路径") || error.contains("较短路径") {
        "程序路径过长，此磁盘无法提供兼容的 Windows 短路径。请退出后将整个程序目录移至较短路径，再重新启动。"
    } else if error.contains("WEBVIEW2_USER_DATA_FOLDER") {
        "WEBVIEW2_USER_DATA_FOLDER 指向程序数据目录之外。请移除此环境变量后重试。"
    } else if error.to_ascii_lowercase().contains("webview2") {
        "WebView2 无法启动。请安装或修复 Microsoft Edge WebView2 Runtime，然后重新启动 FluxCode。"
    } else if error.contains("内置执行引擎") {
        "内置执行引擎缺失或损坏。请用官方安装包修复 FluxCode，保留程序目录中的 data 文件夹。"
    } else {
        "桌面窗口或本地服务初始化失败。请检查程序目录的 data/logs，并确认 WebView2 可用。"
    };
    format!("{context}\n\n请保留程序目录中的 data 文件夹，修复问题后重试。")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_language_follows_configuration_without_exposing_raw_errors() {
        assert!(configuration_uses_english(
            "[appearance]\nlanguage = 'en'",
            true
        ));
        assert!(!configuration_uses_english(
            "[appearance]\nlanguage = 'zh-CN'",
            false
        ));
        assert!(configuration_uses_english(
            "[appearance]\nlanguage = 'system'",
            false
        ));
        assert!(!configuration_uses_english(
            "[appearance]\nlanguage = 'system'",
            true
        ));
        assert!(!configuration_uses_english("broken", false));
        let message = localized_startup_message("内置执行引擎损坏 sk-private", true);
        assert!(message.contains("bundled engine"));
        assert!(!message.contains("sk-private"));
        assert!(!message.contains("内置"));
    }

    #[test]
    fn startup_message_exposes_storage_failure_without_leaking_other_error_details() {
        let storage = startup_message(
            "无法初始化程序目录中的数据文件夹 C:\\FluxCode\\data：拒绝访问。\nsecret",
        );
        assert!(storage.contains("拒绝访问"));
        assert!(!storage.contains("secret"));
        let generic = startup_message("provider secret sk-sensitive-value");
        assert!(!generic.contains("sk-sensitive-value"));
        let storage_secret = startup_message(
            "无法初始化程序目录中的数据文件夹 C:\\sk-sensitive-value\\data：拒绝访问。",
        );
        assert!(!storage_secret.contains("sk-sensitive-value"));
        let invalid_webview =
            startup_message("WEBVIEW2_USER_DATA_FOLDER points outside data; secret=private-token");
        assert!(invalid_webview.contains("WEBVIEW2_USER_DATA_FOLDER 指向程序数据目录之外"));
        assert!(!invalid_webview.contains("private-token"));
        let runtime = startup_message("WebView2 initialization failed: secret=private-token");
        assert!(runtime.contains("Microsoft Edge WebView2 Runtime"));
        assert!(!runtime.contains("private-token"));
        let engine = startup_message("内置执行引擎损坏: secret=private-token");
        assert!(engine.contains("官方安装包修复"));
        assert!(!engine.contains("private-token"));
    }
}

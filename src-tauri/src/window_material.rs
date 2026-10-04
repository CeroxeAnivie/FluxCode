//! A thin adapter over the official Windows bindings, not a custom blur renderer.
//! Tauri's effect wrapper discards the native HRESULT; check it here before exposing transparency.
use serde::Serialize;
#[derive(Serialize)]
pub struct MaterialResult {
    applied: bool,
    reason: &'static str,
}
#[cfg(windows)]
fn system_allows_material() -> bool {
    use windows_sys::Win32::{
        System::{Power::*, Registry::*},
        UI::{Accessibility::*, WindowsAndMessaging::*},
    };
    let mut contrast = HIGHCONTRASTW {
        cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
        dwFlags: 0,
        lpszDefaultScheme: std::ptr::null_mut(),
    };
    let mut power = SYSTEM_POWER_STATUS::default();
    let mut transparency = 1_u32;
    let mut size = 4_u32;
    let key: Vec<u16> = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\0"
        .encode_utf16()
        .collect();
    let value: Vec<u16> = "EnableTransparency\0".encode_utf16().collect();
    unsafe {
        if SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            &mut contrast as *mut _ as _,
            0,
        ) != 0
            && contrast.dwFlags & HCF_HIGHCONTRASTON != 0
        {
            return false;
        }
        if GetSystemPowerStatus(&mut power) != 0 && power.SystemStatusFlag != 0 {
            return false;
        }
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut transparency as *mut _ as _,
            &mut size,
        );
        if status == 0 && transparency == 0 {
            return false;
        }
    }
    true
}
#[tauri::command]
pub fn configure_window_material(
    window: tauri::WebviewWindow,
    dark: bool,
    enabled: bool,
) -> Result<MaterialResult, String> {
    if !crate::workspace_windows::trusted(window.label()) {
        return Err("此页面无权设置窗口材质".into());
    }
    let solid = if dark {
        tauri::window::Color(18, 18, 20, 255)
    } else {
        tauri::window::Color(250, 250, 252, 255)
    };
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Dwm::*;
        let hwnd = window.hwnd().map_err(|_| "无法读取窗口句柄")?.0 as _;
        let allowed = enabled && system_allows_material();
        let dark = if dark { 1_i32 } else { 0_i32 };
        let backdrop = if allowed {
            DWMSBT_TRANSIENTWINDOW
        } else {
            DWMSBT_NONE
        };
        let applied;
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
                &dark as *const _ as _,
                4,
            );
            let corners = DWMWCP_ROUND;
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &corners as *const _ as _,
                4,
            );
            let status = DwmSetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE as u32,
                &backdrop as *const _ as _,
                4,
            );
            let mut actual = DWMSBT_NONE;
            applied = allowed
                && status >= 0
                && DwmGetWindowAttribute(
                    hwnd,
                    DWMWA_SYSTEMBACKDROP_TYPE as u32,
                    &mut actual as *mut _ as _,
                    4,
                ) >= 0
                && actual == DWMSBT_TRANSIENTWINDOW;
            if !applied {
                let none = DWMSBT_NONE;
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_SYSTEMBACKDROP_TYPE as u32,
                    &none as *const _ as _,
                    4,
                );
            }
        }
        window
            .set_background_color(Some(if applied {
                tauri::window::Color(0, 0, 0, 0)
            } else {
                solid
            }))
            .map_err(|_| "无法更新窗口背景")?;
        tracing::debug!(
            applied,
            allowed,
            window = window.label(),
            "window_material_updated"
        );
        Ok(MaterialResult {
            applied,
            reason: if applied {
                "native-acrylic"
            } else if !allowed {
                "system-preference"
            } else {
                "unsupported"
            },
        })
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        window
            .set_background_color(Some(solid))
            .map_err(|_| "无法更新窗口背景")?;
        Ok(MaterialResult {
            applied: false,
            reason: "unsupported",
        })
    }
}

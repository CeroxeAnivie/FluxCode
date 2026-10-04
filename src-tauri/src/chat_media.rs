//! Bounded image import and display. Images remain under application-owned data.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{
    io::{Read, Write},
    path::Path,
    time::Duration,
};
use tauri::State;
static IMAGE_JOBS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);
const MAX: usize = 20 * 1024 * 1024;
fn suffix(bytes: &[u8]) -> Result<&'static str, String> {
    match image::guess_format(bytes).map_err(|_| "图片格式无法识别")? {
        image::ImageFormat::Png => Ok("png"),
        image::ImageFormat::Jpeg => Ok("jpg"),
        image::ImageFormat::Gif => Ok("gif"),
        image::ImageFormat::WebP => Ok("webp"),
        _ => Err("仅支持 PNG、JPEG、WebP 和 GIF 图片".into()),
    }
}
fn decode_data(source: &str) -> Result<Vec<u8>, String> {
    if source.len() > 28 * 1024 * 1024 {
        return Err("图片超过 20 MiB 上限".into());
    }
    let (header, body) = source.split_once(',').ok_or("图片数据无效")?;
    if !matches!(
        header,
        "data:image/png;base64"
            | "data:image/jpeg;base64"
            | "data:image/gif;base64"
            | "data:image/webp;base64"
    ) {
        return Err("图片数据格式无效".into());
    }
    let bytes = STANDARD.decode(body).map_err(|_| "图片数据无效")?;
    if bytes.len() > MAX {
        return Err("图片超过 20 MiB 上限".into());
    }
    suffix(&bytes)?;
    Ok(bytes)
}
fn local_bytes(source: &str) -> Result<Vec<u8>, String> {
    // Existing validator checks format, dimensions, file links and resource bounds.
    crate::attachments::preview_image(source)?;
    let mut bytes = Vec::new();
    std::fs::File::open(source)
        .map_err(|_| "无法打开图片")?
        .take((MAX + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取图片")?;
    if bytes.len() > MAX {
        return Err("图片超过 20 MiB 上限".into());
    }
    Ok(bytes)
}
fn preview_bytes(bytes: &[u8], full: bool) -> Result<String, String> {
    let ext = suffix(bytes)?;
    let mut file = tempfile::Builder::new()
        .suffix(&format!(".{ext}"))
        .tempfile()
        .map_err(|_| "无法准备图片预览")?;
    file.write_all(bytes).map_err(|_| "无法写入图片预览")?;
    crate::attachments::preview_image_sized(
        file.path().to_str().ok_or("图片路径无效")?,
        if full { 2048 } else { 320 },
    )
}
#[tauri::command]
pub async fn store_chat_image(
    state: State<'_, crate::AppState>,
    caller: tauri::Webview,
    source: String,
) -> Result<String, String> {
    if !crate::workspace_windows::trusted(caller.label()) {
        return Err("此页面无权导入图片".into());
    }
    let permit = IMAGE_JOBS.acquire().await.map_err(|_| "图片服务不可用")?;
    let directory = state.data_dir.join("attachments");
    let result = tokio::task::spawn_blocking(move || {
        let bytes = if source.starts_with("data:") {
            decode_data(&source)?
        } else {
            local_bytes(&source)?
        };
        preview_bytes(&bytes, false)?;
        let ext = suffix(&bytes)?;
        use sha2::{Digest, Sha256};
        let name = format!("{:x}.{ext}", Sha256::digest(&bytes));
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建图片存储目录")?;
        let path = directory.join(name);
        if !path.exists() {
            let mut file =
                tempfile::NamedTempFile::new_in(&directory).map_err(|_| "无法保存图片")?;
            file.write_all(&bytes).map_err(|_| "图片写入失败")?;
            file.as_file().sync_all().map_err(|_| "图片保存失败")?;
            match file.persist_noclobber(&path) {
                Ok(_) => {}
                Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err("图片保存失败".into()),
            }
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "图片导入任务失败")?;
    drop(permit);
    result
}
#[tauri::command]
pub async fn load_chat_image(
    state: State<'_, crate::AppState>,
    caller: tauri::Webview,
    source: String,
    full: Option<bool>,
) -> Result<String, String> {
    if !crate::workspace_windows::trusted(caller.label()) {
        return Err("此页面无权读取图片".into());
    }
    let _permit = IMAGE_JOBS.acquire().await.map_err(|_| "图片服务不可用")?;
    let full = full.unwrap_or(false);
    if source.starts_with("data:") {
        return tokio::task::spawn_blocking(move || preview_bytes(&decode_data(&source)?, full))
            .await
            .map_err(|_| "图片解码任务失败")?;
    }
    if Path::new(&source).is_absolute() {
        return tokio::task::spawn_blocking(move || {
            crate::attachments::preview_image_sized(&source, if full { 2048 } else { 320 })
        })
        .await
        .map_err(|_| "图片预览任务失败")?;
    }
    let mut url = crate::browser::remote_url(&source, None)?;
    let proxy = state.configuration.config().await.network.proxy_url;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    let mut response = {
        let mut redirects = 0;
        loop {
            let request = async {
                let route = crate::network::resolve(&proxy, url.as_str()).await?;
                route
                    .client()?
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|_| "无法初始化图片加载器".to_string())?
                    .get(url.clone())
                    .send()
                    .await
                    .map_err(|cause| {
                        if cause.is_timeout() {
                            "图片加载超时，请检查连接后重试".to_string()
                        } else {
                            "图片连接失败，请检查服务地址、代理和网络".to_string()
                        }
                    })
            };
            let response = tokio::time::timeout_at(deadline, request)
                .await
                .map_err(|_| "图片加载超时")??;
            if response.status().is_redirection() {
                if redirects >= 5 {
                    return Err("图片重定向次数超过限制".into());
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or("图片重定向缺少有效地址")?;
                let next = url.join(location).map_err(|_| "图片重定向地址无效")?;
                url = crate::browser::remote_url(next.as_str(), None)?;
                redirects += 1;
                continue;
            }
            if !response.status().is_success() {
                return Err(format!("图片服务返回 HTTP {}", response.status().as_u16()));
            }
            break response;
        }
    };
    if response.content_length().is_some_and(|n| n > MAX as u64) {
        return Err("图片超过 20 MiB 上限".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = tokio::time::timeout_at(deadline, response.chunk())
        .await
        .map_err(|_| "图片传输超时")?
        .map_err(|_| "图片传输中断")?
    {
        if bytes.len() + chunk.len() > MAX {
            return Err("图片超过 20 MiB 上限".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    tokio::task::spawn_blocking(move || preview_bytes(&bytes, full))
        .await
        .map_err(|_| "图片解码任务失败")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_and_invalid_images() {
        assert!(decode_data("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(decode_data("data:image/png;base64,bm90LWFuLWltYWdl").is_err());
        assert!(local_bytes("relative.png").is_err());
    }
    #[test]
    fn decoded_image_can_be_previewed() {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(32, 24)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let data = format!("data:image/png;base64,{}", STANDARD.encode(bytes.get_ref()));
        assert!(
            preview_bytes(&decode_data(&data).unwrap(), true)
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
    }
}

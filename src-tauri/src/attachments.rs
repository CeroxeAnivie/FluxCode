use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader, Limits};
use std::{fs::File, io::Read, path::Path};

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 16_000_000;
const PREVIEW_EDGE: u32 = 320;

pub fn preview_image(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    if !file_path.is_absolute() || path.len() > 4096 {
        return Err("图片路径无效".into());
    }
    let expected = match file_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => ImageFormat::Png,
        Some("jpg" | "jpeg") => ImageFormat::Jpeg,
        Some("webp") => ImageFormat::WebP,
        Some("gif") => ImageFormat::Gif,
        _ => return Err("仅支持 PNG、JPEG、WebP 和 GIF 图片预览".into()),
    };
    let link_metadata = file_path
        .symlink_metadata()
        .map_err(|_| "无法读取图片，请检查路径和访问权限")?;
    if link_metadata.file_type().is_symlink() || is_reparse_point(&link_metadata) {
        return Err("不支持预览链接文件".into());
    }
    let mut file = File::open(file_path).map_err(|_| "无法打开图片，请检查访问权限")?;
    let metadata = file.metadata().map_err(|_| "无法读取图片信息")?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES {
        return Err("图片无效或超过 20 MiB 上限".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "图片读取失败，请重试")?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("图片超过 20 MiB 上限".into());
    }
    let make_reader = || {
        ImageReader::new(std::io::Cursor::new(bytes.as_slice()))
            .with_guessed_format()
            .map_err(|_| "无法识别图片格式")
    };
    let reader = make_reader()?;
    if reader.format() != Some(expected) {
        return Err("图片内容与扩展名不匹配".into());
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "图片已损坏或无法解码")?;
    if width == 0
        || height == 0
        || width > MAX_IMAGE_EDGE
        || height > MAX_IMAGE_EDGE
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err("图片尺寸超过预览上限".into());
    }
    let mut reader = make_reader()?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_EDGE);
    limits.max_image_height = Some(MAX_IMAGE_EDGE);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| "图片已损坏或无法解码")?;
    let mut preview = std::io::Cursor::new(Vec::new());
    decoded
        .thumbnail(PREVIEW_EDGE, PREVIEW_EDGE)
        .write_to(&mut preview, ImageFormat::Png)
        .map_err(|_| "图片预览生成失败")?;
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(preview.into_inner())
    ))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn previews_valid_png_without_exposing_file_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.png");
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1000, 500)
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let original = encoded.into_inner();
        std::fs::write(&path, &original).unwrap();
        let preview = preview_image(path.to_str().unwrap()).unwrap();
        assert!(preview.starts_with("data:image/png;base64,"));
        assert!(!preview.contains(path.to_str().unwrap()));
        let thumbnail = STANDARD
            .decode(preview.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        assert!(thumbnail.len() < original.len());
        assert_eq!(
            image::load_from_memory(&thumbnail).unwrap().width(),
            PREVIEW_EDGE
        );

        let mismatched = dir.path().join("mismatched.jpg");
        std::fs::write(&mismatched, original).unwrap();
        assert!(preview_image(mismatched.to_str().unwrap()).is_err());
    }

    #[test]
    fn rejects_invalid_and_oversized_images() {
        let dir = tempfile::tempdir().unwrap();
        let invalid = dir.path().join("invalid.png");
        File::create(&invalid)
            .unwrap()
            .write_all(b"not an image")
            .unwrap();
        assert!(preview_image(invalid.to_str().unwrap()).is_err());

        let oversized = dir.path().join("oversized.png");
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_IMAGE_BYTES + 1)
            .unwrap();
        assert!(preview_image(oversized.to_str().unwrap()).is_err());
    }
}

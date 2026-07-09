use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::path::{Path, PathBuf};

// Cap the source read so a stray huge file can't blow up the IPC payload or RAM.
const MAX_PREVIEW_SOURCE_BYTES: u64 = 25 * 1024 * 1024;

fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    PathBuf::from(value)
}

fn mime_for(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("avif") => Some("image/avif"),
        Some("bmp") => Some("image/bmp"),
        Some("svg") => Some("image/svg+xml"),
        Some("ico") => Some("image/x-icon"),
        Some("tif") | Some("tiff") => Some("image/tiff"),
        Some("heic") => Some("image/heic"),
        Some("heif") => Some("image/heif"),
        _ => None,
    }
}

/// Read a local image file (chosen by the user via drag-drop, so only the path
/// reaches the webview on desktop) and return it as a full-resolution data URL.
/// The renderer downscales it into a small display-only preview. Restricted to
/// image extensions and a size cap; never used to send file contents to agents.
#[tauri::command]
pub(crate) fn read_local_image_preview(path: String) -> Result<String, String> {
    let expanded = expand_home(path.trim());
    let file = expanded.as_path();
    let mime = mime_for(file).ok_or_else(|| "Not a supported image file.".to_string())?;
    let metadata = fs::metadata(file).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a file.".to_string());
    }
    if metadata.len() > MAX_PREVIEW_SOURCE_BYTES {
        return Err("Image is too large to preview.".to_string());
    }
    let bytes = fs::read(file).map_err(|error| error.to_string())?;
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(&bytes)))
}

use serde_json::{json, Value};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 256 * 1024;

#[tauri::command]
pub(crate) fn wallet_secret_export_save(
    app: tauri::AppHandle,
    filename: String,
    content: String,
) -> Result<Value, String> {
    if content.trim().is_empty() {
        return Err("Wallet secret export content is empty.".to_string());
    }
    if content.len() > MAX_EXPORT_BYTES {
        return Err("Wallet secret export is too large to save from the dashboard.".to_string());
    }

    let Some(file_path) = app
        .dialog()
        .file()
        .set_title("Export wallet keys")
        .set_file_name(safe_export_filename(&filename))
        .add_filter("Text", &["txt"])
        .blocking_save_file()
    else {
        return Ok(json!({ "ok": false, "cancelled": true }));
    };
    let path = file_path
        .into_path()
        .map_err(|_| "Selected wallet export path is not a local file.".to_string())?;
    if path.is_dir() {
        return Err("Select a file path, not a directory.".to_string());
    }

    fs::write(&path, content).map_err(|error| format!("Could not save wallet secret export: {error}"))?;
    #[cfg(unix)]
    {
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(json!({ "ok": true, "path": path.to_string_lossy() }))
}

fn safe_export_filename(filename: &str) -> String {
    let fallback = "hivemindos-wallet-secrets.txt";
    let name = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback)
        .trim();
    let clean = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '\0' => '-',
            _ => character,
        })
        .collect::<String>();
    let clean = clean.trim_matches(['-', '.', ' ']).trim();
    if clean.is_empty() {
        fallback.to_string()
    } else if clean.ends_with(".txt") {
        clean.to_string()
    } else {
        format!("{clean}.txt")
    }
}

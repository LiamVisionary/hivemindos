use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const DEFAULT_SCHEDULED_FOLDER: &str = "Operations/Automations";

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(value: &str) -> PathBuf {
    let trimmed = value.trim();
    if let Some(home) = home_dir() {
        if trimmed == "~" || trimmed.is_empty() {
            return home;
        }
        if let Some(rest) = trimmed.strip_prefix("~/") {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn safe_folder(value: Option<String>) -> Result<String, String> {
    let folder = value.unwrap_or_else(|| DEFAULT_SCHEDULED_FOLDER.to_string());
    let trimmed = folder.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_SCHEDULED_FOLDER.to_string());
    }
    if Path::new(trimmed).is_absolute() || trimmed.split(['/', '\\']).any(|part| part == "..") {
        return Err("Scheduled folder must be a relative path inside the shared vault.".to_string());
    }
    Ok(trimmed.split(['/', '\\']).filter(|part| !part.is_empty()).collect::<Vec<_>>().join("/"))
}

fn vault_root(vault_path: Option<String>) -> PathBuf {
    let raw = vault_path
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_VAULT.to_string());
    expand_home(&raw).canonicalize().unwrap_or_else(|_| expand_home(&raw))
}

fn collect_schedule_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            collect_schedule_files(&path, files);
        } else if path.file_name().and_then(|name| name.to_str()) == Some("schedule.md") {
            files.push(path);
        }
    }
}

fn extract_fenced_section(content: &str, label: &str) -> String {
    let marker = format!("## {label}");
    let Some(start) = content.find(&marker) else {
        return String::new();
    };
    let after = &content[start + marker.len()..];
    let Some(fence_start) = after.find("```text") else {
        return String::new();
    };
    let after_fence = &after[fence_start + "```text".len()..];
    let Some(fence_end) = after_fence.find("```") else {
        return String::new();
    };
    after_fence[..fence_end].trim().to_string()
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .replace('\\', "/")
}

#[tauri::command]
pub(crate) fn scheduler_shared_schedules(
    vault_path: Option<String>,
    scheduled_folder: Option<String>,
) -> Result<Value, String> {
    let vault = vault_root(vault_path);
    let root = vault.join(safe_folder(scheduled_folder)?);
    let mut files = Vec::new();
    collect_schedule_files(&root, &mut files);
    let mut schedules = Vec::new();
    for file in files {
        let content = fs::read_to_string(&file).unwrap_or_default();
        let raw = extract_fenced_section(&content, "Config JSON");
        if raw.is_empty() {
            continue;
        }
        let Ok(mut schedule) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        if schedule.get("id").and_then(Value::as_str).unwrap_or("").is_empty()
            || schedule.get("name").and_then(Value::as_str).unwrap_or("").is_empty()
        {
            continue;
        }
        if let Some(object) = schedule.as_object_mut() {
            object.insert("sharedSchedulePath".to_string(), Value::String(relative(&vault, &file)));
            if let Some(parent) = file.parent() {
                object.insert("sharedRunFolder".to_string(), Value::String(relative(&vault, parent)));
            }
        }
        schedules.push(schedule);
    }
    schedules.sort_by(|left, right| {
        right.get("updatedAt").and_then(Value::as_i64).unwrap_or(0)
            .cmp(&left.get("updatedAt").and_then(Value::as_i64).unwrap_or(0))
    });
    Ok(json!({
        "ok": true,
        "source": "native-scheduler-shared",
        "schedules": schedules,
        "root": root.to_string_lossy(),
    }))
}

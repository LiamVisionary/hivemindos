use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const DEFAULT_VAULT: &str = "~/Documents/Obsidian/hivemindos-vault";
const PRIMARY_FOLDER: &str = "Operations/Automations/Calls";
const LEGACY_FOLDER: &str = "Claw/Calls";

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

fn vault_root(vault_path: Option<String>) -> PathBuf {
    expand_home(vault_path.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or(DEFAULT_VAULT))
}

fn safe_join(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let target = root.join(folder);
    let normalized = target.components().collect::<PathBuf>();
    if !normalized.starts_with(&root) {
        return Err("Refusing to access a path outside the vault.".to_string());
    }
    Ok(normalized)
}

fn slugify_title(title: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;
    for ch in title.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            previous_dash = false;
        } else if !previous_dash {
            slug.push('-');
            previous_dash = true;
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "call".to_string()
    } else {
        slug
    }
}

fn parse_quoted_string(raw: &str) -> String {
    let value = raw.trim();
    if value.len() >= 2 {
        let first = value.chars().next().unwrap_or_default();
        let last = value.chars().last().unwrap_or_default();
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return value[1..value.len() - 1].replace("\\\"", "\"");
        }
    }
    value.to_string()
}

fn parse_prompt(content: &str) -> (String, String, bool, String) {
    let normalized = content.replace("\r\n", "\n");
    let mut title = String::new();
    let mut time = String::new();
    let mut enabled = true;
    let mut instructions = normalized.as_str();

    if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let frontmatter = &rest[..end];
            instructions = rest[end + 4..].trim_start_matches('\n');
            for line in frontmatter.lines() {
                if let Some((key, value)) = line.split_once(':') {
                    match key.trim().to_lowercase().as_str() {
                        "title" => title = parse_quoted_string(value),
                        "time" => time = parse_quoted_string(value),
                        "enabled" => enabled = !matches!(value.trim().to_lowercase().as_str(), "false" | "no" | "0"),
                        _ => {}
                    }
                }
            }
        }
    }

    (title, time, enabled, instructions.trim().to_string())
}

fn read_folder_prompts(vault_path: &Path, folder: &str) -> Result<Vec<Value>, String> {
    let dir = safe_join(vault_path, folder)?;
    let mut prompts = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(prompts);
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("md")) != Some(true) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let (title, time, enabled, instructions) = parse_prompt(&content);
        let base_name = path.file_stem().and_then(|value| value.to_str()).unwrap_or("call");
        let display_title = if title.is_empty() { base_name.to_string() } else { title };
        prompts.push(json!({
            "id": slugify_title(&display_title),
            "title": display_title,
            "time": time,
            "enabled": enabled,
            "instructions": instructions,
            "path": path.to_string_lossy(),
        }));
    }
    Ok(prompts)
}

#[tauri::command]
pub(crate) fn phone_prompts(vault_path: Option<String>) -> Result<Value, String> {
    let vault = vault_root(vault_path);
    let mut by_id = HashMap::<String, Value>::new();
    for prompt in read_folder_prompts(&vault, LEGACY_FOLDER)?.into_iter().chain(read_folder_prompts(&vault, PRIMARY_FOLDER)?) {
        if let Some(id) = prompt.get("id").and_then(|value| value.as_str()) {
            by_id.insert(id.to_string(), prompt);
        }
    }

    let mut prompts = by_id.into_values().collect::<Vec<_>>();
    prompts.sort_by(|left, right| {
        let left_time = left.get("time").and_then(|value| value.as_str()).unwrap_or("");
        let right_time = right.get("time").and_then(|value| value.as_str()).unwrap_or("");
        left_time.cmp(right_time).then_with(|| {
            let left_title = left.get("title").and_then(|value| value.as_str()).unwrap_or("");
            let right_title = right.get("title").and_then(|value| value.as_str()).unwrap_or("");
            left_title.cmp(right_title)
        })
    });

    Ok(json!({
        "ok": true,
        "source": "tauri",
        "vaultPath": vault.to_string_lossy(),
        "prompts": prompts,
    }))
}

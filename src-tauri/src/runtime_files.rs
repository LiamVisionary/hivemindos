use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_READ_BYTES: u64 = 500_000;
const MAX_WRITE_BYTES: usize = 750_000;
const IGNORED: &[&str] = &[".git", "node_modules", ".next", "dist", "build", ".DS_Store"];

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

fn string_field(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn add_root(roots: &mut Vec<Value>, key: &str, label: &str, path: PathBuf, writable: bool) {
    if path.as_os_str().is_empty() {
        return;
    }
    let resolved = path.canonicalize().unwrap_or(path);
    if roots.iter().any(|root| root.get("key").and_then(Value::as_str) == Some(key)) {
        return;
    }
    roots.push(json!({
        "key": key,
        "label": label,
        "path": resolved.to_string_lossy(),
        "writable": writable
    }));
}

fn runtime_roots(agents: &[Value], shared_vault: Option<&Value>) -> Vec<Value> {
    let mut roots = Vec::new();
    add_root(
        &mut roots,
        "hivemindos",
        "HivemindOS project",
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        false,
    );
    add_root(&mut roots, "hivemindos-state", "HivemindOS state", expand_home("~/.hivemindos"), true);
    if let Some(vault) = shared_vault {
        if bool_field(vault, "enabled") {
            let vault_path = string_field(vault, "vaultPath");
            if !vault_path.is_empty() {
                add_root(&mut roots, "shared-vault", "Shared Obsidian brain", expand_home(&vault_path), true);
            }
        }
    }
    for agent in agents {
        let id = string_field(agent, "id");
        let name = string_field(agent, "name");
        let local_data_dir = string_field(agent, "localDataDir");
        if !id.is_empty() && !local_data_dir.is_empty() {
            add_root(
                &mut roots,
                &format!("agent-{id}"),
                &format!("{} runtime", if name.is_empty() { &id } else { &name }),
                expand_home(&local_data_dir),
                true,
            );
        }
    }
    add_root(&mut roots, "hermes", "Hermes home", expand_home("~/.hermes"), true);
    add_root(&mut roots, "openclaw", "OpenClaw agents", expand_home("~/.openclaw/agents"), true);
    add_root(&mut roots, "aeon", "Aeon home", expand_home("~/.aeon"), true);
    roots
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .trim_start_matches('/')
        .replace('\\', "/")
}

fn resolve_inside_root(roots: &[Value], root_key: &str, relative: &str) -> Result<(Value, PathBuf), String> {
    let root = roots
        .iter()
        .find(|item| item.get("key").and_then(Value::as_str) == Some(root_key))
        .cloned()
        .ok_or_else(|| "Unknown file root.".to_string())?;
    let root_path = PathBuf::from(root.get("path").and_then(Value::as_str).unwrap_or(""));
    let clean_relative = relative.replace('\\', "/").trim_start_matches('/').to_string();
    let candidate = root_path.join(if clean_relative.is_empty() { "." } else { &clean_relative });
    let resolved = candidate.canonicalize().unwrap_or(candidate);
    if resolved != root_path && !resolved.starts_with(&root_path) {
        return Err("Path escapes the selected root.".to_string());
    }
    Ok((root, resolved))
}

fn list_files(roots: &[Value], root_key: &str, path: &str) -> Result<Vec<Value>, String> {
    let (root, dir) = resolve_inside_root(roots, root_key, path)?;
    let root_path = PathBuf::from(root.get("path").and_then(Value::as_str).unwrap_or(""));
    if !dir.is_dir() {
        return Err("Selected path is not a directory.".to_string());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|error| error.to_string())?.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if IGNORED.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        files.push(json!({
            "name": name,
            "path": path.to_string_lossy(),
            "relativePath": relative_path(&root_path, &path),
            "type": if metadata.is_dir() { "dir" } else { "file" },
            "size": metadata.len(),
            "updatedAt": metadata.modified().ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
        }));
    }
    files.sort_by(|left, right| {
        let left_type = left.get("type").and_then(Value::as_str).unwrap_or("");
        let right_type = right.get("type").and_then(Value::as_str).unwrap_or("");
        if left_type != right_type {
            return if left_type == "dir" { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        left.get("name").and_then(Value::as_str).unwrap_or("").cmp(right.get("name").and_then(Value::as_str).unwrap_or(""))
    });
    Ok(files)
}

fn read_file(roots: &[Value], root_key: &str, path: &str) -> Result<Value, String> {
    let (root, file) = resolve_inside_root(roots, root_key, path)?;
    let root_path = PathBuf::from(root.get("path").and_then(Value::as_str).unwrap_or(""));
    let metadata = fs::metadata(&file).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Selected path is not a file.".to_string());
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!("File is too large to preview ({} KB).", metadata.len() / 1024));
    }
    Ok(json!({
        "root": root,
        "name": file.file_name().and_then(|name| name.to_str()).unwrap_or(""),
        "path": file.to_string_lossy(),
        "relativePath": relative_path(&root_path, &file),
        "content": fs::read_to_string(&file).map_err(|error| error.to_string())?,
        "size": metadata.len(),
        "updatedAt": metadata.modified().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis())
    }))
}

#[tauri::command]
pub(crate) fn runtime_files(
    action: Option<String>,
    agents: Option<Vec<Value>>,
    shared_vault: Option<Value>,
    root_key: Option<String>,
    path: Option<String>,
    content: Option<String>,
) -> Result<Value, String> {
    let agents = agents.unwrap_or_default();
    let roots = runtime_roots(&agents, shared_vault.as_ref());
    let action = action.unwrap_or_else(|| "roots".to_string());
    if action == "roots" {
        return Ok(json!({ "ok": true, "source": "native-runtime-files", "roots": roots }));
    }
    let root_key = root_key.or_else(|| roots.first().and_then(|root| root.get("key").and_then(Value::as_str).map(str::to_string))).unwrap_or_default();
    let path = path.unwrap_or_default();
    match action.as_str() {
        "list" => Ok(json!({ "ok": true, "source": "native-runtime-files", "roots": roots, "files": list_files(&roots, &root_key, &path)? })),
        "read" => Ok(json!({ "ok": true, "source": "native-runtime-files", "roots": roots, "file": read_file(&roots, &root_key, &path)? })),
        "write" => {
            let (root, file) = resolve_inside_root(&roots, &root_key, &path)?;
            if root.get("writable").and_then(Value::as_bool) != Some(true) {
                return Err("This root is read-only.".to_string());
            }
            let content = content.unwrap_or_default();
            if content.len() > MAX_WRITE_BYTES {
                return Err("File content is too large to save from the dashboard.".to_string());
            }
            fs::write(&file, content).map_err(|error| error.to_string())?;
            Ok(json!({ "ok": true, "source": "native-runtime-files", "roots": roots, "file": read_file(&roots, &root_key, &path)? }))
        }
        _ => Err("Unknown file action.".to_string()),
    }
}

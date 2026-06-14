// Native reads of the Obsidian shared-brain vault for the STATIC desktop build,
// which ships no Next /api server. Mirrors src/lib/services/obsidian/* readers so
// the dashboard can load vault-backed data over Tauri `invoke` instead of the
// (absent) HTTP routes. Agents first; wallets / miroshark sims to follow.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

// Exact-named (case-sensitive) child folder, mirroring exactRootFolder.
fn exact_root_folder(root: &Path, name: &str) -> Option<PathBuf> {
    let candidate = root.join(name);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

fn collect_profile_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_profile_files(&path, out);
        } else if path.file_name().map(|name| name == "profile.json").unwrap_or(false) {
            out.push(path);
        }
    }
}

/// Read agent profile records from the vault's Agents/ (or legacy AGENTS/) folder.
/// Mirrors readVaultAgentProfiles: every profile.json with an `id` + `runtime` is
/// a profile; dedupe by `runtime|agentId`. Returns `{ ok, agents }`.
#[tauri::command]
pub fn obsidian_agents(vault_path: Option<String>) -> Value {
    let Some(vault) = vault_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return json!({ "ok": true, "agents": [] });
    };
    let root = expand_home(vault);

    let mut files = Vec::new();
    // Legacy first so current profiles (read later) win on dedupe.
    for name in ["AGENTS", "Agents"] {
        if let Some(folder) = exact_root_folder(&root, name) {
            collect_profile_files(&folder, &mut files);
        }
    }

    let mut agents: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for file in files {
        let Ok(raw) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(profile) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let id = profile.get("id").and_then(Value::as_str).unwrap_or("").trim();
        let runtime = profile
            .get("runtime")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if id.is_empty() || runtime.is_empty() {
            continue;
        }
        let agent_id = profile
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        let key = format!("{runtime}|{agent_id}").to_lowercase();
        if seen.insert(key) {
            agents.push(profile);
        }
    }

    json!({ "ok": true, "agents": agents })
}

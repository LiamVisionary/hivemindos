use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
struct EnvSourceDef {
    id: &'static str,
    label: &'static str,
    scope: &'static str,
    runtime: &'static str,
}

#[derive(Debug, Serialize)]
struct HiveEnvSource {
    id: &'static str,
    label: &'static str,
    scope: &'static str,
    runtime: &'static str,
    values: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

const SHARED_SOURCE: EnvSourceDef = EnvSourceDef {
    id: "shared",
    label: "Shared sync store",
    scope: "agent",
    runtime: "generic",
};

const RUNTIME_SOURCES: &[EnvSourceDef] = &[
    EnvSourceDef {
        id: "runtime-openclaw",
        label: "OpenClaw",
        scope: "agent",
        runtime: "openclaw",
    },
    EnvSourceDef {
        id: "runtime-hermes",
        label: "Hermes",
        scope: "agent",
        runtime: "hermes",
    },
    EnvSourceDef {
        id: "runtime-aeon",
        label: "Aeon",
        scope: "agent",
        runtime: "aeon",
    },
];

const LOCAL_ONLY_KEYS: &[&str] = &[
    "HIVE_AGENT_ENV_FILE",
    "HIVE_ENV_BACKUP_DIR",
    "HIVE_ENV_COLLECTOR_PORT",
    "HIVE_ENV_FILE",
    "HIVE_ENV_GPG_RECIPIENT",
    "HIVE_ENV_PROJECT_ROOT",
    "HIVE_ENV_PUBLIC_KEY",
    "HIVE_ENV_TAILNET_SYNC",
    "HIVE_ENV_TAILNET_TARGETS",
    "HIVE_ENV_TAILNET_USER",
    "HIVE_ENV_TAILNET_VERBOSE",
    "HIVE_NOTE_ROOT",
    "HIVE_NOTE_SECURE_FOLDER",
    "HIVE_SHARED_BRAIN_PATH",
    "NEXT_ALLOWED_DEV_ORIGINS",
    "NEXT_PUBLIC_OBSIDIAN_VAULT_PATH",
    "NEXT_PUBLIC_TAILNET_SYNC_ENABLED",
];

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

fn project_root() -> PathBuf {
    if let Ok(configured) = std::env::var("HIVE_ENV_PROJECT_ROOT") {
        if !configured.trim().is_empty() {
            return expand_home(&configured);
        }
    }
    if let Some(manifest_dir) = option_env!("CARGO_MANIFEST_DIR") {
        return PathBuf::from(manifest_dir)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(manifest_dir));
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn valid_env_key(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && chars.all(|item| item.is_ascii_alphanumeric() || item == '_')
}

fn unescape_double_quoted(value: &str) -> String {
    let mut output = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some('\\') => output.push('\\'),
            Some('"') => output.push('"'),
            Some('$') => output.push('$'),
            Some('`') => output.push('`'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

fn parse_env_text(data: &str) -> BTreeMap<String, String> {
    data.lines()
        .filter_map(|raw_line| {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') || !line.contains('=') {
                return None;
            }
            let (raw_key, raw_value) = line.split_once('=')?;
            let key = raw_key
                .trim()
                .strip_prefix("export ")
                .unwrap_or(raw_key.trim())
                .trim();
            if !valid_env_key(key) {
                return None;
            }
            let value = raw_value.trim();
            let parsed = if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
                unescape_double_quoted(&value[1..value.len() - 1])
            } else if value.len() >= 2 && value.starts_with('\'') && value.ends_with('\'') {
                value[1..value.len() - 1].to_string()
            } else {
                value.to_string()
            };
            Some((key.to_string(), parsed))
        })
        .collect()
}

fn parse_env_file(path: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(path).map(|data| parse_env_text(&data)).unwrap_or_default()
}

fn local_setting(key: &str) -> Option<String> {
    for filename in [".env.local", ".env"] {
        let value = parse_env_file(&project_root().join(filename)).remove(key);
        if value.as_ref().is_some_and(|item| !item.trim().is_empty()) {
            return value;
        }
    }
    None
}

fn env_or_local(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .filter(|item| !item.trim().is_empty())
        .or_else(|| local_setting(key))
}

fn agent_env_file() -> PathBuf {
    env_or_local("HIVE_AGENT_ENV_FILE")
        .map(|value| expand_home(&value))
        .or_else(|| home_dir().map(|home| home.join(".hivemindos").join(".env")))
        .unwrap_or_else(|| PathBuf::from(".hivemindos/.env"))
}

fn hermes_env_file() -> PathBuf {
    home_dir()
        .map(|home| home.join(".hermes").join(".env"))
        .unwrap_or_else(|| PathBuf::from(".hermes/.env"))
}

fn aeon_env_file() -> PathBuf {
    home_dir()
        .map(|home| home.join(".aeon").join(".env"))
        .unwrap_or_else(|| PathBuf::from(".aeon/.env"))
}

fn strip_json_line_comments(data: &str) -> String {
    data.lines()
        .map(|line| line.split_once("//").map(|(left, _)| left).unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn read_json_object(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str::<Value>(&strip_json_line_comments(&data)).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    let value = value.as_str()?;
                    valid_env_key(key).then(|| (key.to_string(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn openclaw_values() -> BTreeMap<String, String> {
    let Some(home) = home_dir() else {
        return BTreeMap::new();
    };
    let openclaw_dir = home.join(".openclaw");
    let secrets = read_json_object(&openclaw_dir.join("secrets.json"));
    let config = read_json_object(&openclaw_dir.join("openclaw.json"));
    let mut values = string_map(Some(&secrets));
    values.extend(string_map(config.get("env").and_then(|env| env.get("vars"))));
    values
}

fn remove_local_only(values: &mut BTreeMap<String, String>) {
    for key in LOCAL_ONLY_KEYS {
        values.remove(*key);
    }
}

fn read_source(source: EnvSourceDef) -> HiveEnvSource {
    let mut values = match source.runtime {
        "openclaw" => openclaw_values(),
        "hermes" => parse_env_file(&hermes_env_file()),
        "aeon" => parse_env_file(&aeon_env_file()),
        _ => parse_env_file(&agent_env_file()),
    };
    remove_local_only(&mut values);
    HiveEnvSource {
        id: source.id,
        label: source.label,
        scope: source.scope,
        runtime: source.runtime,
        values,
        error: None,
    }
}

fn note_root() -> Option<PathBuf> {
    env_or_local("HIVE_NOTE_ROOT")
        .or_else(|| env_or_local("HIVE_SHARED_BRAIN_PATH"))
        .or_else(|| env_or_local("NEXT_PUBLIC_OBSIDIAN_VAULT_PATH"))
        .map(|value| expand_home(&value))
        .or_else(|| {
            let home = home_dir()?;
            [
                home.join("Documents/Obsidian/hivemindos-vault"),
                home.join("Documents/Obsidian/HivemindOS Vault"),
                home.join("Documents/Obsidian/Agent Team Vault"),
            ]
            .into_iter()
            .find(|candidate| candidate.exists())
        })
}

fn backup_dir() -> Option<PathBuf> {
    env_or_local("HIVE_ENV_BACKUP_DIR")
        .map(|value| expand_home(&value))
        .or_else(|| {
            note_root().map(|root| {
                root.join(
                    env_or_local("HIVE_NOTE_SECURE_FOLDER")
                        .unwrap_or_else(|| "Operations/Secure".to_string()),
                )
            })
        })
}

fn command_exists(name: &str) -> bool {
    let Some(paths) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&paths).any(|path| path.join(name).is_file())
}

fn read_backup_status() -> Value {
    let path = backup_dir().map(|directory| directory.join("hive.env.gpg"));
    serde_json::json!({
        "version": 1,
        "scope": SHARED_SOURCE.scope,
        "runtime": SHARED_SOURCE.runtime,
        "envFile": agent_env_file().to_string_lossy(),
        "backupPath": path.as_ref().map(|item| item.to_string_lossy().to_string()).unwrap_or_default(),
        "backupExists": path.as_ref().is_some_and(|item| item.exists()),
        "gpgAvailable": command_exists("gpg"),
        "backupApplies": true,
    })
}

#[tauri::command]
pub(crate) fn hive_env_read() -> Result<Value, String> {
    let shared_source = read_source(SHARED_SOURCE);
    let shared_keys = shared_source.values.keys().cloned().collect::<HashSet<_>>();
    let runtime_sources = RUNTIME_SOURCES
        .iter()
        .map(|source| {
            let mut source = read_source(*source);
            source.values.retain(|key, _| !shared_keys.contains(key));
            source
        })
        .collect::<Vec<_>>();
    let total = shared_source.values.len();
    Ok(serde_json::json!({
        "ok": true,
        "sharedSource": shared_source,
        "runtimeSources": runtime_sources,
        "backupStatus": read_backup_status(),
        "total": total,
    }))
}

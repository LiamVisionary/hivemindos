// Native read/write for the dashboard state KV store, mirroring the HTTP route
// `/api/dashboard/state` (src/app/api/dashboard/state/route.ts) and its service
// (src/lib/services/dashboard-state.ts). The packaged release ships a static UI
// with no embedded Next server, so the dashboard reaches this over Tauri
// `invoke` instead of HTTP. Without it, hydration's `/api/dashboard/state` fetch
// hits the static asset shell (HTTP 200, HTML) and the app hangs on load.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const AGENT_PROFILES_KEY: &str = "hivemindos.agentProfiles.v1";
const AGENT_CONFIGURATION_FIELDS: [&str; 7] = [
    "runtime",
    "provider",
    "model",
    "gatewayUrl",
    "chatPath",
    "statusPath",
    "localDataDir",
];

fn state_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)?;
    Some(home.join(".hivemindos").join("dashboard-state.json"))
}

// Serializes concurrent writes so two read-modify-write calls can't lose each
// other's keys (the HTTP service uses an in-process write queue for the same
// reason).
fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

// Read persisted values. A missing, empty, or corrupt file yields an empty map
// (never an error), matching readDashboardState's try/catch fallback.
fn read_values() -> Map<String, Value> {
    let Some(path) = state_path() else {
        return Map::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Map::new();
    };
    if raw.trim().is_empty() {
        return Map::new();
    }
    let Ok(parsed) = serde_json::from_str::<Value>(&raw) else {
        return Map::new();
    };
    match parsed.get("values") {
        Some(Value::Object(values)) => values
            .iter()
            .filter(|(key, value)| !key.trim().is_empty() && value.is_string())
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        _ => Map::new(),
    }
}

fn profile_revision(profile: &Value) -> u64 {
    profile
        .get("configurationUpdatedAt")
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn profile_provider(profile: &Value) -> &str {
    profile
        .get("provider")
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn merge_agent_profile_value(current: &Value, incoming: &Value, now: u64) -> Value {
    let current_revision = profile_revision(current);
    let incoming_revision = profile_revision(incoming);
    let current_provider = profile_provider(current).to_ascii_lowercase();
    let incoming_provider = profile_provider(incoming).to_ascii_lowercase();
    let unversioned_oauth_downgrade = current_revision == 0
        && incoming_revision == 0
        && matches!(current_provider.as_str(), "openai-codex" | "openai-oauth")
        && matches!(incoming_provider.as_str(), "openai" | "openai-api");
    let preserve_current = current_revision > incoming_revision || unversioned_oauth_downgrade;

    let mut merged = current.as_object().cloned().unwrap_or_default();
    if let Some(incoming_object) = incoming.as_object() {
        merged.extend(incoming_object.clone());
    }
    if preserve_current {
        let current_object = current.as_object();
        for field in AGENT_CONFIGURATION_FIELDS {
            match current_object.and_then(|profile| profile.get(field)) {
                Some(value) => {
                    merged.insert(field.to_string(), value.clone());
                }
                None => {
                    merged.remove(field);
                }
            }
        }
        match current
            .get("configurationUpdatedAt")
            .and_then(Value::as_u64)
        {
            Some(value) if value > 0 => {
                merged.insert("configurationUpdatedAt".to_string(), json!(value));
            }
            _ => {
                merged.remove("configurationUpdatedAt");
            }
        }
    }
    if merged
        .get("configurationUpdatedAt")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        == 0
    {
        merged.insert("configurationUpdatedAt".to_string(), json!(now));
    }
    Value::Object(merged)
}

fn merge_agent_profile_snapshot(current_raw: Option<&str>, incoming_raw: &str) -> String {
    let Some(incoming_profiles) = serde_json::from_str::<Value>(incoming_raw)
        .ok()
        .and_then(|value| value.as_array().cloned())
    else {
        return incoming_raw.to_string();
    };
    let current_profiles = current_raw
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    let current_by_id: HashMap<String, Value> = current_profiles
        .into_iter()
        .filter_map(|profile| {
            profile
                .get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), profile.clone()))
        })
        .collect();
    let now = chrono::Utc::now().timestamp_millis().max(1) as u64;
    let merged: Vec<Value> = incoming_profiles
        .into_iter()
        .map(|profile| {
            let current = profile
                .get("id")
                .and_then(Value::as_str)
                .and_then(|id| current_by_id.get(id));
            current
                .map(|existing| merge_agent_profile_value(existing, &profile, now))
                .unwrap_or_else(|| {
                    let mut created = profile;
                    if profile_revision(&created) == 0 {
                        if let Some(record) = created.as_object_mut() {
                            record.insert("configurationUpdatedAt".to_string(), json!(now));
                        }
                    }
                    created
                })
        })
        .collect();
    serde_json::to_string(&merged).unwrap_or_else(|_| incoming_raw.to_string())
}

// Both commands are async so they run on the async runtime instead of the
// UI-process main thread. The store can reach tens of megabytes, and wry
// delivers sync-command invokes (and serializes their responses) on the main
// thread — which stalled every WKWebView input event and layer-tree commit
// behind multi-second JSON work, freezing the whole dev app per interaction.
#[tauri::command]
pub async fn dashboard_state_read() -> Value {
    json!({ "ok": true, "values": Value::Object(read_values()) })
}

#[tauri::command]
pub async fn dashboard_state_write(
    values: Option<HashMap<String, String>>,
    remove: Option<Vec<String>>,
) -> Result<Value, String> {
    let _guard = write_lock()
        .lock()
        .map_err(|_| "dashboard state write lock poisoned".to_string())?;

    let path = state_path().ok_or("Could not resolve home directory.")?;
    let mut current = read_values();

    for key in remove.unwrap_or_default() {
        if !key.trim().is_empty() {
            current.remove(&key);
        }
    }
    for (key, value) in values.unwrap_or_default() {
        if key.trim().is_empty() {
            continue;
        }
        let protected_value = if key == AGENT_PROFILES_KEY || key.ends_with(".agentProfiles.v1") {
            merge_agent_profile_snapshot(current.get(&key).and_then(Value::as_str), &value)
        } else {
            value
        };
        current.insert(key, Value::String(protected_value));
    }

    let updated_at = chrono::Utc::now().to_rfc3339();
    let document = json!({
        "version": 1,
        "values": Value::Object(current),
        "updatedAt": updated_at,
    });

    let parent = path.parent().ok_or("Invalid dashboard state path.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
    }

    // Write to a temp file then rename, so a crash mid-write can't truncate the
    // store (same atomic pattern as writeDashboardState).
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let serialized = serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?;
    fs::write(&temporary, format!("{serialized}\n")).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;

    // Deliberately no `values` echo: the only caller (dashboard-state-client.ts
    // postDashboardState) reads just `ok`, and echoing the full store shipped
    // the entire multi-megabyte state back through IPC on every save.
    Ok(json!({ "ok": true, "updatedAt": updated_at }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_profile_cannot_replace_newer_oauth_routing() {
        let current = json!({
            "id": "queen",
            "runtime": "hermes",
            "provider": "openai-codex",
            "model": "gpt-5.4",
            "configurationUpdatedAt": 200
        });
        let incoming = json!({
            "id": "queen",
            "name": "Updated elsewhere",
            "runtime": "hivemind-os",
            "provider": "openai-api",
            "model": "gpt-4o-mini",
            "configurationUpdatedAt": 100
        });
        let merged = merge_agent_profile_value(&current, &incoming, 300);
        assert_eq!(merged["name"], "Updated elsewhere");
        assert_eq!(merged["runtime"], "hermes");
        assert_eq!(merged["provider"], "openai-codex");
        assert_eq!(merged["model"], "gpt-5.4");
        assert_eq!(merged["configurationUpdatedAt"], 200);
    }

    #[test]
    fn unversioned_oauth_to_api_downgrade_is_rejected() {
        let current = json!({
            "id": "queen",
            "runtime": "hermes",
            "provider": "openai-codex",
            "model": "gpt-5.4"
        });
        let incoming = json!({
            "id": "queen",
            "runtime": "hivemind-os",
            "provider": "openai-api",
            "model": "gpt-4o-mini"
        });
        let merged = merge_agent_profile_value(&current, &incoming, 300);
        assert_eq!(merged["runtime"], "hermes");
        assert_eq!(merged["provider"], "openai-codex");
        assert_eq!(merged["configurationUpdatedAt"], 300);
    }
}

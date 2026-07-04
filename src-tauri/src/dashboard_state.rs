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
        current.insert(key, Value::String(value));
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

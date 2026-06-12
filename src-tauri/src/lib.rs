use serde::Serialize;
use serde_json::Value;
use std::any::Any;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, Once};
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent};
#[cfg(not(debug_assertions))]
use tauri::Runtime;

mod brain;
mod desktop_navigation;
mod deliverables;
mod env;
mod fleet;
mod kanban;
mod memory;
mod phone;
mod runtime_files;
mod runtime_usage;
mod scheduler;
mod setup;

#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::process::Stdio;
#[cfg(not(debug_assertions))]

#[cfg(all(not(debug_assertions), target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;
// The embedded Next dashboard binds IPv4 loopback only (127.0.0.1 — NOT
// "localhost", which resolves to IPv6 ::1 and breaks the IPv4 forwarder dial).
// A paired phone reaches it over the tailnet via spawn_tailnet_forwarder, which
// bridges this machine's 100.x tailnet IP to this loopback port. Keeping Next
// on loopback means the LAN can never reach the dashboard API directly, and the
// desktop window keeps working even if Tailscale drops.
#[cfg(not(debug_assertions))]
const NATIVE_BIND_HOST: &str = "127.0.0.1";
const NATIVE_BROWSER_HOST: &str = "localhost";
// Prefer a stable port so a paired phone's saved hub survives app restarts;
// reserve_local_port falls back to any free port when 5020 is taken (we never
// evict whoever holds it).
#[cfg(not(debug_assertions))]
const NATIVE_PREFERRED_PORT: u16 = 5020;
const NATIVE_CACHE_TTL: Duration = Duration::from_secs(30);
#[cfg(not(debug_assertions))]
const DASHBOARD_AUTH_SECRET_KEY: &str = "HIVEMINDOS_DASHBOARD_AUTH_SECRET";
#[cfg(not(debug_assertions))]
const DASHBOARD_DEVICE_TOKEN_KEY: &str = "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN";
#[cfg(not(debug_assertions))]
const NATIVE_BOOTSTRAP_TOKEN_KEY: &str = "HIVEMINDOS_NATIVE_BOOTSTRAP_TOKEN";
#[cfg(not(debug_assertions))]
const MIN_DASHBOARD_AUTH_SECRET_LENGTH: usize = 32;
#[cfg(not(debug_assertions))]
const MIN_DASHBOARD_DEVICE_TOKEN_LENGTH: usize = 24;

struct NativeCacheEntry {
    loaded_at: Instant,
    payload: Value,
}

struct NativeServerState {
    child: Mutex<Option<Child>>,
    // The claw gateway, when this app hosts it as a child process (Stage 1 of
    // the signed-agent file-access work). None when the headless launchd agent
    // owns it (the default).
    gateway_child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    dashboard_token: Mutex<Option<String>>,
    cache: Mutex<HashMap<String, NativeCacheEntry>>,
}

#[cfg(not(debug_assertions))]
struct NativeDashboardAuth {
    secret: String,
    token: String,
    bootstrap_token: String,
}

impl NativeServerState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            gateway_child: Mutex::new(None),
            port: Mutex::new(None),
            dashboard_token: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg(not(debug_assertions))]
fn random_hex(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::getrandom(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(not(debug_assertions))]
fn parse_env_key(contents: &str, key: &str) -> String {
    contents
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once('=')?;
            if name == key {
                Some(value.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default()
}

#[cfg(not(debug_assertions))]
fn native_dashboard_auth_path<R: Runtime>(app: &impl Manager<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("dashboard-auth.env"))
}

#[cfg(not(debug_assertions))]
fn secure_native_dashboard_auth_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).map_err(|error| error.to_string())?.permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
fn ensure_native_dashboard_auth<R: Runtime>(app: &impl Manager<R>) -> Result<NativeDashboardAuth, String> {
    let path = native_dashboard_auth_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let current = fs::read_to_string(&path).unwrap_or_default();
    let mut secret = parse_env_key(&current, DASHBOARD_AUTH_SECRET_KEY);
    let mut token = parse_env_key(&current, DASHBOARD_DEVICE_TOKEN_KEY);

    if secret.len() < MIN_DASHBOARD_AUTH_SECRET_LENGTH {
        secret = random_hex(32)?;
    }
    if token.len() < MIN_DASHBOARD_DEVICE_TOKEN_LENGTH {
        token = random_hex(32)?;
    }

    let next = format!(
        "{DASHBOARD_AUTH_SECRET_KEY}={secret}\n{DASHBOARD_DEVICE_TOKEN_KEY}={token}\n",
    );
    if next != current {
        fs::write(&path, next).map_err(|error| error.to_string())?;
    }
    secure_native_dashboard_auth_file(&path)?;

    Ok(NativeDashboardAuth {
        secret,
        token,
        bootstrap_token: random_hex(32)?,
    })
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
    kind: &'static str,
}

#[derive(Serialize)]
struct DirectoryListing {
    ok: bool,
    path: String,
    #[serde(rename = "parentPath")]
    parent_path: String,
    directories: Vec<DirectoryEntry>,
}

#[derive(Serialize)]
struct CreatedFolder {
    ok: bool,
    path: String,
    label: String,
}

static PANIC_LOGGER: Once = Once::new();

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn panic_payload_text(payload: &(dyn Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|value| (*value).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "non-string panic payload".to_string())
}

fn append_native_panic_log(context: &str, payload: &str, location: &str) {
    if let Some(path) = home_dir().map(|home| home.join(".hivemindos").join("native-panic.log")) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(
                file,
                "\n--- HivemindOS native panic {:?} ---\ncontext: {context}\nthread: {:?}\nlocation: {location}\npayload: {payload}\nbacktrace:\n{}",
                std::time::SystemTime::now(),
                std::thread::current().name(),
                std::backtrace::Backtrace::force_capture(),
            );
        }
    }
}

pub(crate) fn guard_native_callback(context: &str, callback: impl FnOnce()) {
    if let Err(payload) = catch_unwind(AssertUnwindSafe(callback)) {
        let payload = panic_payload_text(payload.as_ref());
        append_native_panic_log(context, &payload, "caught native callback panic");
        eprintln!("HivemindOS: suppressed native callback panic in {context}: {payload}");
    }
}

fn install_native_panic_logger() {
    PANIC_LOGGER.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let payload = panic_payload_text(info.payload());
            let location = info
                .location()
                .map(|item| format!("{}:{}:{}", item.file(), item.line(), item.column()))
                .unwrap_or_else(|| "unknown location".to_string());
            append_native_panic_log("uncaught panic", &payload, &location);
            previous(info);
        }));
    });
}

fn expand_home_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
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

fn clean_path(path: &Path) -> PathBuf {
    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                cleaned.pop();
            }
            other => cleaned.push(other.as_os_str()),
        }
    }
    cleaned
}

fn display_path(path: &Path) -> String {
    let clean = clean_path(path);
    if let Some(home) = home_dir().map(|item| clean_path(&item)) {
        if clean == home {
            return "~".to_string();
        }
        if let Ok(rest) = clean.strip_prefix(&home) {
            let rest = rest.to_string_lossy().replace('\\', "/");
            return format!("~/{}", rest.trim_start_matches('/'));
        }
    }
    clean.to_string_lossy().to_string()
}

fn clean_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err("Choose a simple folder name.".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_existing_directory(path: &str) -> Result<PathBuf, String> {
    let expanded = expand_home_path(path);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(expanded)
    };
    let canonical = absolute.canonicalize().map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("Path is not a directory.".to_string());
    }
    Ok(canonical)
}

#[tauri::command]
fn list_local_directories(path: Option<String>) -> Result<DirectoryListing, String> {
    let absolute = resolve_existing_directory(path.as_deref().unwrap_or("~"))?;
    let mut directories = fs::read_dir(&absolute)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            if !path.is_dir() {
                return None;
            }
            Some(DirectoryEntry {
                name,
                path: display_path(&path),
                kind: "directory",
            })
        })
        .collect::<Vec<_>>();
    directories.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    let parent_path = absolute
        .parent()
        .filter(|parent| *parent != absolute)
        .map(display_path)
        .unwrap_or_default();

    Ok(DirectoryListing {
        ok: true,
        path: display_path(&absolute),
        parent_path,
        directories,
    })
}

#[tauri::command]
fn create_local_folder(parent_path: String, name: String) -> Result<CreatedFolder, String> {
    let parent = resolve_existing_directory(&parent_path)?;
    let label = clean_folder_name(&name)?;
    let target = parent.join(&label);
    if target.exists() {
        return Err("Folder already exists.".to_string());
    }
    fs::create_dir(&target).map_err(|error| error.to_string())?;
    Ok(CreatedFolder {
        ok: true,
        path: display_path(&target),
        label,
    })
}

#[tauri::command]
fn display_local_path(path: String) -> String {
    display_path(&expand_home_path(&path))
}

fn clean_target(value: &str) -> String {
    value.trim().replace(['\0', '\r', '\n'], "")
}

fn path_from_target(target: &str) -> Result<PathBuf, String> {
    let cleaned = clean_target(target);
    if cleaned.starts_with("file://") {
        let url = url::Url::parse(&cleaned).map_err(|error| error.to_string())?;
        return url
            .to_file_path()
            .map_err(|_| "Deliverable file URL could not be converted to a local path.".to_string());
    }
    let path = expand_home_path(&cleaned);
    if !path.is_absolute() {
        return Err("Deliverable file paths must be absolute.".to_string());
    }
    Ok(path)
}

fn open_system_target(target: &str) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/c", "start", "", target])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

fn reveal_system_path(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else if cfg!(target_os = "windows") {
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    } else {
        let parent = path.parent().unwrap_or(path);
        Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

/// Open macOS System Settings → Privacy & Security → Full Disk Access so the
/// user can grant the always-on gateway access to protected folders
/// (Downloads/Desktop/Documents) for phone file browsing. TCC is macOS-only; a
/// no-op elsewhere.
#[tauri::command]
fn open_full_disk_access_settings() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        open_system_target(
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        )
    } else {
        Ok(())
    }
}

/// Reveal, in Finder, the exact gateway binary that needs Full Disk Access, so
/// the user can drag it into the list. The installer records the path in
/// ~/.hivemindos/claw/gateway-fda-target.txt; fall back to the claw install dir
/// if it's missing.
#[tauri::command]
fn reveal_gateway_for_full_disk_access() -> Result<(), String> {
    let home = home_dir().ok_or("Could not resolve home directory")?;
    let claw_dir = home.join(".hivemindos").join("claw");
    let target = std::fs::read_to_string(claw_dir.join("gateway-fda-target.txt"))
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(claw_dir);
    reveal_system_path(&target)
}

fn contains_dashboard_auth_helper(path: &Path) -> bool {
    path.join("package.json").exists() && path.join("scripts").join("dashboard-auth.mjs").exists()
}

fn dashboard_auth_project_dir() -> Option<PathBuf> {
    if let Ok(current_dir) = std::env::current_dir() {
        if contains_dashboard_auth_helper(&current_dir) {
            return Some(current_dir);
        }
    }

    let source_dir = home_dir()?.join(".hivemindos").join("app-source");
    if contains_dashboard_auth_helper(&source_dir) {
        return Some(source_dir);
    }

    None
}

fn open_terminal_in_directory(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        return Command::new("open")
            .args(["-a", "Terminal"])
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string());
    }

    if cfg!(target_os = "windows") {
        let command = format!("cd /d \"{}\"", path.display().to_string().replace('"', "\\\""));
        return Command::new("cmd")
            .args(["/c", "start", "", "cmd.exe", "/K", &command])
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string());
    }

    for (program, args) in [
        ("x-terminal-emulator", vec!["--working-directory".to_string(), path.display().to_string()]),
        ("gnome-terminal", vec![format!("--working-directory={}", path.display())]),
        ("konsole", vec!["--workdir".to_string(), path.display().to_string()]),
    ] {
        if Command::new(program).args(args).spawn().is_ok() {
            return Ok(());
        }
    }

    open_system_target(&path.to_string_lossy())
}

#[tauri::command]
fn open_project_terminal() -> Result<serde_json::Value, String> {
    let directory = dashboard_auth_project_dir()
        .ok_or_else(|| "No HivemindOS source folder with dashboard auth commands was found.".to_string())?;
    open_terminal_in_directory(&directory)?;
    Ok(serde_json::json!({
        "ok": true,
        "directory": display_path(&directory),
    }))
}

#[tauri::command]
fn open_deliverable(action: Option<String>, path: Option<String>, url: Option<String>) -> Result<serde_json::Value, String> {
    let action = if action.as_deref() == Some("reveal") { "reveal" } else { "open" };
    let path_target = clean_target(path.as_deref().unwrap_or(""));
    let url_target = clean_target(url.as_deref().unwrap_or(""));
    let target = if path_target.is_empty() { url_target } else { path_target };
    if target.is_empty() {
        return Err("Deliverable path or URL is required.".to_string());
    }

    if target.starts_with("http://") || target.starts_with("https://") {
        if action == "reveal" {
            return Err("Web URLs can be opened, but not revealed in the file manager.".to_string());
        }
        open_system_target(&target)?;
        return Ok(serde_json::json!({ "ok": true }));
    }

    let file_path = path_from_target(&target)?;
    if !file_path.exists() {
        return Err("Deliverable does not exist on this machine.".to_string());
    }
    if action == "reveal" {
        reveal_system_path(&file_path)?;
    } else {
        open_system_target(&file_path.to_string_lossy())?;
    }
    Ok(serde_json::json!({ "ok": true }))
}

fn optional_build_value(value: &'static str) -> Option<&'static str> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn short_commit(commit: &str) -> String {
    commit.chars().take(7).collect()
}

#[tauri::command]
fn desktop_status(state: tauri::State<NativeServerState>) -> serde_json::Value {
    let port = state.port.lock().ok().and_then(|guard| *guard);
    let commit = optional_build_value(env!("HIVEMINDOS_GIT_COMMIT"));
    let branch = optional_build_value(env!("HIVEMINDOS_GIT_BRANCH"));
    let latest_commit = commit;
    let app_dir = std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string());

    serde_json::json!({
        "ok": true,
        "appDir": app_dir,
        "version": env!("CARGO_PKG_VERSION"),
        "latestVersion": env!("CARGO_PKG_VERSION"),
        "commit": commit,
        "shortCommit": commit.map(short_commit),
        "branch": branch,
        "dirty": env!("HIVEMINDOS_GIT_DIRTY") == "true",
        "latestCommit": latest_commit,
        "latestShortCommit": latest_commit.map(short_commit),
        "updateCommand": "Install the latest HivemindOS desktop build.",
        "runtime": "tauri",
        "phase": if cfg!(debug_assertions) {
            "phase-1-dev"
        } else if port.is_some() {
            "phase-2-packaged"
        } else {
            "phase-3-static"
        },
        "devUrl": if cfg!(debug_assertions) { Some("http://localhost:5021") } else { None },
        "nativeHost": NATIVE_BROWSER_HOST,
        "nativePort": port
    })
}

#[tauri::command]
fn native_dashboard_unlock_token(
    state: tauri::State<NativeServerState>,
) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let native_server_running = state.port.lock().ok().and_then(|guard| *guard).is_some();
    if !native_server_running {
        return Ok(None);
    }
    Ok(state.dashboard_token.lock().ok().and_then(|guard| guard.clone()))
}

fn native_payload(result: Result<serde_json::Value, String>) -> serde_json::Value {
    match result {
        Ok(value) => value,
        Err(error) => serde_json::json!({ "ok": false, "error": error }),
    }
}

fn cache_key(name: &str, parts: &[Option<&str>]) -> String {
    let mut key = name.to_string();
    for part in parts {
        key.push('|');
        key.push_str(part.unwrap_or(""));
    }
    key
}

fn cached_payload<F>(state: &tauri::State<NativeServerState>, key: String, refresh: F) -> Value
where
    F: FnOnce() -> Value,
{
    if let Ok(cache) = state.cache.lock() {
        if let Some(entry) = cache.get(&key) {
            if entry.loaded_at.elapsed() <= NATIVE_CACHE_TTL {
                let mut payload = entry.payload.clone();
                if let Some(object) = payload.as_object_mut() {
                    object.insert("nativeCacheHit".to_string(), Value::Bool(true));
                }
                return payload;
            }
        }
    }

    let payload = refresh();
    if let Ok(mut cache) = state.cache.lock() {
        cache.insert(key, NativeCacheEntry {
            loaded_at: Instant::now(),
            payload: payload.clone(),
        });
    }
    payload
}

fn join_scoped_payload(handle: std::thread::ScopedJoinHandle<'_, Value>) -> Value {
    handle.join().unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": "Native cache worker panicked." }))
}

#[tauri::command]
fn dashboard_bootstrap(
    state: tauri::State<NativeServerState>,
    max_age_ms: Option<u64>,
    vault_path: Option<String>,
    kanban_folder: Option<String>,
    kanban_board: Option<String>,
    scheduled_folder: Option<String>,
) -> serde_json::Value {
    let hive_key = cache_key("hive-env", &[]);
    let max_age_key = max_age_ms.map(|value| value.to_string());
    let fleet_key = cache_key("fleet-apps", &[max_age_key.as_deref()]);
    let tailscale_key = cache_key("tailscale", &[]);
    let kanban_key = cache_key("kanban", &[kanban_board.as_deref(), vault_path.as_deref(), kanban_folder.as_deref()]);
    let brain_key = cache_key("brain-summary", &[vault_path.as_deref()]);
    let memory_key = cache_key("memory", &[]);
    let phone_key = cache_key("phone-prompts", &[vault_path.as_deref()]);
    let runtime_usage_key = cache_key("runtime-usage", &[]);
    let scheduler_key = cache_key("scheduler", &[vault_path.as_deref(), scheduled_folder.as_deref()]);
    let desktop_status = desktop_status(state.clone());

    std::thread::scope(|scope| {
        let state_ref = &state;
        let hive_env = scope.spawn(move || cached_payload(state_ref, hive_key, || native_payload(env::hive_env_read())));
        let fleet_apps = scope.spawn(move || cached_payload(state_ref, fleet_key, || native_payload(fleet::fleet_apps_cache(max_age_ms))));
        let tailscale_devices = scope.spawn(move || cached_payload(state_ref, tailscale_key, || native_payload(fleet::tailscale_devices())));
        let kanban_read = {
            let vault_path = vault_path.clone();
            let kanban_folder = kanban_folder.clone();
            let kanban_board = kanban_board.clone();
            scope.spawn(move || cached_payload(state_ref, kanban_key, || native_payload(kanban::kanban_read(
                kanban_board,
                vault_path,
                kanban_folder,
                None,
                Some(true),
                Some(false),
                None,
                None,
                None,
            ))))
        };
        let brain_summary = {
            let vault_path = vault_path.clone();
            scope.spawn(move || cached_payload(state_ref, brain_key, || native_payload(brain::brain_summary(vault_path))))
        };
        let memory_telemetry = scope.spawn(move || cached_payload(state_ref, memory_key, || native_payload(memory::memory_telemetry())));
        let phone_prompts = {
            let vault_path = vault_path.clone();
            scope.spawn(move || cached_payload(state_ref, phone_key, || native_payload(phone::phone_prompts(vault_path))))
        };
        let runtime_usage = scope.spawn(move || cached_payload(state_ref, runtime_usage_key, || native_payload(runtime_usage::runtime_usage(Some(200)))));
        let scheduler_shared = {
            let vault_path = vault_path.clone();
            let scheduled_folder = scheduled_folder.clone();
            scope.spawn(move || cached_payload(state_ref, scheduler_key, || native_payload(scheduler::scheduler_shared_schedules(vault_path, scheduled_folder))))
        };

        serde_json::json!({
            "ok": true,
            "checkedAt": chrono::Utc::now().to_rfc3339(),
            "desktopStatus": desktop_status,
            "appVersion": desktop_status,
            "hiveEnv": join_scoped_payload(hive_env),
            "fleetApps": join_scoped_payload(fleet_apps),
            "tailscaleDevices": join_scoped_payload(tailscale_devices),
            "kanban": join_scoped_payload(kanban_read),
            "brainSummary": join_scoped_payload(brain_summary),
            "memoryTelemetry": join_scoped_payload(memory_telemetry),
            "phonePrompts": join_scoped_payload(phone_prompts),
            "runtimeUsage": join_scoped_payload(runtime_usage),
            "schedulerShared": join_scoped_payload(scheduler_shared),
        })
    })
}

#[cfg(not(debug_assertions))]
fn reserve_local_port() -> Result<u16, Box<dyn std::error::Error>> {
    // Prefer the stable port so a paired phone's saved hub survives restarts;
    // if it's already in use, take any free port rather than evicting it.
    if let Ok(listener) = TcpListener::bind((NATIVE_BIND_HOST, NATIVE_PREFERRED_PORT)) {
        let port = listener.local_addr()?.port();
        drop(listener);
        return Ok(port);
    }
    let listener = TcpListener::bind((NATIVE_BIND_HOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(not(debug_assertions))]
fn wait_for_native_server(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(25);

    while Instant::now() < deadline {
        if TcpStream::connect((NATIVE_BIND_HOST, port)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!("Next server did not open port {port} within 25 seconds"))
}

#[cfg(not(debug_assertions))]
fn packaged_next_server_paths(app: &tauri::App) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;
    let server_dir = resource_dir.join("resources").join("hivemindos-next");
    let server_js = server_dir.join("server.js");
    let node_path = resource_dir
        .join("resources")
        .join("hivemindos-node")
        .join(if cfg!(target_os = "windows") {
            "node.exe"
        } else {
            "node"
        });
    Ok((server_js, node_path))
}

#[cfg(not(debug_assertions))]
fn has_packaged_next_server(app: &tauri::App) -> bool {
    packaged_next_server_paths(app)
        .map(|(server_js, node_path)| server_js.exists() && node_path.exists())
        .unwrap_or(false)
}

/// Bridge the loopback dashboard onto the tailnet so a paired phone can reach
/// it: bind this machine's 100.x tailnet IP at the SAME port the dashboard uses
/// on loopback, and pipe bytes through. The LAN can't route to a 100.x socket,
/// so only tailnet peers (the phone) get in. No-op when Tailscale is down — the
/// desktop window still works on loopback; relaunch with Tailscale up to pair.
/// Because the tailnet port equals the loopback port, the pairing QR
/// (`<tailnet-ip>:<window.location.port>`) addresses the bridge with no change.
#[cfg(not(debug_assertions))]
fn spawn_tailnet_forwarder(loopback_port: u16) {
    std::thread::spawn(move || {
        let Some(tailnet_ip) = fleet::self_tailnet_ipv4() else {
            return;
        };
        let listener = match TcpListener::bind((tailnet_ip.as_str(), loopback_port)) {
            Ok(listener) => listener,
            Err(_) => return,
        };
        for incoming in listener.incoming() {
            let Ok(client) = incoming else { continue };
            std::thread::spawn(move || {
                if let Ok(upstream) = TcpStream::connect((NATIVE_BIND_HOST, loopback_port)) {
                    forward_between(client, upstream);
                }
            });
        }
    });
}

/// Splice two TCP streams in both directions until either side closes. Each
/// direction runs on its own thread; a half-close is propagated so the peer's
/// copy() can drain and finish.
#[cfg(not(debug_assertions))]
fn forward_between(client: TcpStream, upstream: TcpStream) {
    let (mut client_read, mut upstream_write) = match (client.try_clone(), upstream.try_clone()) {
        (Ok(client_read), Ok(upstream_write)) => (client_read, upstream_write),
        _ => return,
    };
    let mut upstream_read = upstream;
    let mut client_write = client;
    let pump = std::thread::spawn(move || {
        let _ = std::io::copy(&mut client_read, &mut upstream_write);
        let _ = upstream_write.shutdown(std::net::Shutdown::Write);
    });
    let _ = std::io::copy(&mut upstream_read, &mut client_write);
    let _ = client_write.shutdown(std::net::Shutdown::Write);
    let _ = pump.join();
}

#[cfg(not(debug_assertions))]
fn spawn_native_next_server(app: &tauri::App) -> Result<(Child, u16, String), Box<dyn std::error::Error>> {
    let (server_js, node_path) = packaged_next_server_paths(app)?;
    let server_dir = server_js
        .parent()
        .ok_or("Packaged Next server path has no parent directory")?;

    if !server_js.exists() {
        return Err(format!("Missing packaged Next server at {}", server_js.display()).into());
    }
    if !node_path.exists() {
        return Err(format!("Missing packaged Node.js runtime at {}", node_path.display()).into());
    }

    let auth = ensure_native_dashboard_auth(app)?;
    let port = reserve_local_port()?;
    let mut command = Command::new(&node_path);
    command
        .arg(&server_js)
        .current_dir(&server_dir)
        .env("HOSTNAME", NATIVE_BIND_HOST)
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("HIVEMINDOS_NATIVE", "1")
        .env(DASHBOARD_AUTH_SECRET_KEY, &auth.secret)
        .env(DASHBOARD_DEVICE_TOKEN_KEY, &auth.token)
        .env(NATIVE_BOOTSTRAP_TOKEN_KEY, &auth.bootstrap_token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn()?;

    if let Err(message) = wait_for_native_server(port) {
        let _ = child.kill();
        return Err(message.into());
    }

    // Expose the loopback dashboard to a paired phone over the tailnet only.
    spawn_tailnet_forwarder(port);

    Ok((child, port, auth.bootstrap_token))
}

/// The system-Tailscale IPv4 a paired phone should dial — the SAME address the
/// tailnet forwarder binds (spawn_tailnet_forwarder). The dashboard's device
/// list can report a different "self" IP because hivemind-linkd runs its own
/// embedded tsnet node; that node has no bridge on the dashboard port, so a QR
/// built from it makes the phone time out. The pairing QR uses this instead.
/// None when Tailscale isn't up.
#[tauri::command]
fn native_pairing_host() -> Option<String> {
    fleet::self_tailnet_ipv4()
}

/// Whether this desktop app should host the claw gateway as a child process
/// (instead of the headless launchd agent). OFF by default — opt in with the
/// `HIVEMINDOS_APP_HOSTS_GATEWAY` env var (1/true/on) or a
/// `~/.hivemindos/app-hosts-gateway` marker file. When on, the gateway's file
/// access is attributed to this (signed) app, so macOS shows one-click "Allow"
/// prompts for Downloads/Desktop/Documents instead of a silent EPERM.
///
/// NOTE: while opting in, stop the launchd gateway first
/// (`launchctl bootout gui/$(id -u)/com.hivemindos.claw-backend`) so two
/// gateways don't fight over the port. Stage 3 makes this the permanent path.
fn app_should_host_gateway() -> bool {
    if let Ok(raw) = std::env::var("HIVEMINDOS_APP_HOSTS_GATEWAY") {
        match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" | "force" => return true,
            "0" | "false" | "no" | "off" | "" => return false,
            _ => {}
        }
    }
    home_dir()
        .map(|home| home.join(".hivemindos").join("app-hosts-gateway").exists())
        .unwrap_or(false)
}

fn app_forces_host_gateway() -> bool {
    std::env::var("HIVEMINDOS_APP_HOSTS_GATEWAY")
        .map(|raw| raw.trim().eq_ignore_ascii_case("force"))
        .unwrap_or(false)
}

/// The port the app-hosted gateway binds and the phone probes. NOT 5000 — that's
/// permanently held by Apple's ControlCenter / AirPlay receiver.
const HOSTED_GATEWAY_PORT: u16 = 5001;

fn claw_gateway_already_listening() -> bool {
    // Probe the GATEWAY port (5001), NOT 5000. Port 5000 is permanently held by
    // Apple's ControlCenter / AirPlay receiver, so probing it is a false positive
    // ("a gateway is already up") — which made the app skip hosting and leave the
    // phone on the launchd gateway (external claw, no Downloads grant). The hosted
    // gateway binds 5001 (see spawn_hosted_gateway), so that's the port to check.
    TcpStream::connect(("127.0.0.1", HOSTED_GATEWAY_PORT)).is_ok()
}

/// Stop a stale hosted gateway so a fresh one can bind 5001. Dev relaunches
/// (`pnpm tauri dev`) don't go through stop_native_server — a killed dev app
/// orphans its gateway child, and the adopt-if-listening rule then pins every
/// later run to that orphan's old backend code. Only a process whose command
/// line proves it is OUR installed gateway is stopped; any other squatter
/// keeps the port and we fall back to skipping the host (never steal a port
/// from an unrelated project). Returns true when the port is free to bind.
fn stop_stale_hosted_gateway() -> bool {
    let port_arg = format!("tcp:{HOSTED_GATEWAY_PORT}");
    let pids = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-ti", &port_arg, "-sTCP:LISTEN"])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
        .unwrap_or_default();
    let mut stopped_any = false;
    for pid in pids.split_whitespace() {
        let command_line = Command::new("/bin/ps")
            .args(["-o", "command=", "-p", pid])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
            .unwrap_or_default();
        if !command_line.contains(".hivemindos/claw/backend") {
            eprintln!(
                "HivemindOS: port {HOSTED_GATEWAY_PORT} is held by a non-gateway process (pid {pid}); leaving it alone"
            );
            return false;
        }
        eprintln!(
            "HivemindOS: stopping stale hosted gateway (pid {pid}) to relaunch with current backend code"
        );
        // SIGTERM — the backend's shutdown handler reaps its shells and
        // exits within ~2s on its own.
        let _ = Command::new("/bin/kill").arg(pid).status();
        stopped_any = true;
    }
    if !stopped_any {
        // lsof saw nothing (transient listener already gone, or lsof failed).
        // Report whatever the direct probe says now.
        return TcpStream::connect(("127.0.0.1", HOSTED_GATEWAY_PORT)).is_err();
    }
    for _ in 0..40 {
        if TcpStream::connect(("127.0.0.1", HOSTED_GATEWAY_PORT)).is_err() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    eprintln!(
        "HivemindOS: stale gateway did not release port {HOSTED_GATEWAY_PORT} in time; skipping host"
    );
    false
}

/// Spawn the installed claw gateway launcher as a child of this app. Returns
/// None if the launcher is missing (claw not installed) or the spawn fails.
fn spawn_hosted_gateway() -> Option<Child> {
    let launcher = home_dir()?
        .join(".hivemindos")
        .join("claw")
        .join("launch-gateway.sh");
    if !launcher.exists() {
        eprintln!(
            "HivemindOS: app-hosted gateway requested but launcher is missing at {}",
            launcher.display()
        );
        return None;
    }
    let mut command = Command::new("/bin/bash");
    command.arg(&launcher).stdin(std::process::Stdio::null());
    // Prefer the `claw` binary bundled INSIDE this signed app (Contents/MacOS/claw,
    // next to our own executable). A binary nested in the app bundle inherits the
    // app's TCC identity, so the agent's file writes to protected folders are
    // covered by the one-click "Allow <folder>" grant. An EXTERNAL claw
    // (~/.hivemindos/claw/bin/claw) is its own TCC responsible process and gets
    // denied. launch-gateway.sh honors an inherited CLAW_BINARY; it falls back to
    // the installed copy when this isn't bundled (e.g. a dev build).
    if let Some(bundled_claw) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("claw")))
        .filter(|path| path.exists())
    {
        command.env("CLAW_BINARY", bundled_claw);
    }
    // Pin the gateway to the port the phone probes (5001). 5000 is taken by Apple's
    // ControlCenter, so the backend's EADDRINUSE walk-up would otherwise reach 5001
    // only by luck. Making it deterministic means this signed, app-hosted gateway is
    // the single owner of the port — the launchd gateway (external claw, denied
    // ~/Downloads) can't win the race. launch-gateway.sh sets no PORT, so it inherits.
    command.env("PORT", HOSTED_GATEWAY_PORT.to_string());
    match command.spawn() {
        Ok(child) => {
            eprintln!("HivemindOS: hosting claw gateway as a child (pid {})", child.id());
            Some(child)
        }
        Err(error) => {
            eprintln!("HivemindOS: failed to spawn hosted gateway: {error}");
            None
        }
    }
}

fn stop_native_server(state: tauri::State<NativeServerState>) {
    for lock in [&state.child, &state.gateway_child] {
        if let Ok(mut guard) = lock.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_native_panic_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(NativeServerState::new())
        .menu(desktop_navigation::app_menu)
        .on_menu_event(|app, event| {
            guard_native_callback("app menu event", || {
                desktop_navigation::handle_menu_event(app, event.id().as_ref());
            });
        })
        .setup(|_app| {
            if let Err(error) = desktop_navigation::setup_tray(_app.handle()) {
                eprintln!("HivemindOS tray setup failed: {error}");
            }
            desktop_navigation::restore_window_state(_app.handle());

            // Stage 1: optionally host the claw gateway as a child of this
            // (signed) app, so its filesystem access is attributed to
            // HivemindOS and macOS shows one-click folder prompts. Opt-in;
            // the default leaves the headless launchd gateway untouched.
            if app_should_host_gateway() {
                // Dev builds (and `force`) RESTART a stale gateway instead of
                // adopting it, so every `pnpm tauri dev` run serves the current
                // backend code. Release builds keep the adopt rule: a healthy
                // production gateway shouldn't bounce on every app launch.
                let restart_stale = cfg!(debug_assertions) || app_forces_host_gateway();
                let port_free = if claw_gateway_already_listening() {
                    if restart_stale {
                        stop_stale_hosted_gateway()
                    } else {
                        eprintln!(
                            "HivemindOS: app-hosted gateway skipped because a gateway is already listening on 127.0.0.1:5001"
                        );
                        false
                    }
                } else {
                    true
                };
                if port_free {
                    if let Some(child) = spawn_hosted_gateway() {
                        if let Ok(mut guard) =
                            _app.state::<NativeServerState>().gateway_child.lock()
                        {
                            *guard = Some(child);
                        }
                    }
                }
            }

            #[cfg(not(debug_assertions))]
            {
                let app = _app;
                if has_packaged_next_server(app) {
                    let (child, port, token) = spawn_native_next_server(app)?;
                    let state = app.state::<NativeServerState>();
                    *state.child.lock().map_err(|_| "Native server lock poisoned")? = Some(child);
                    *state.port.lock().map_err(|_| "Native server port lock poisoned")? = Some(port);
                    *state.dashboard_token.lock().map_err(|_| "Native server token lock poisoned")? = Some(token.clone());

                    let window = app
                        .get_webview_window("main")
                        .ok_or("Missing main HivemindOS window")?;
                    let mut url = url::Url::parse(&format!("http://{NATIVE_BIND_HOST}:{port}/"))?;
                    url.set_fragment(Some(&format!("hivemindos_native_bootstrap={token}")));
                    window.navigate(url)?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            native_pairing_host,
            native_dashboard_unlock_token,
            dashboard_bootstrap,
            list_local_directories,
            create_local_folder,
            display_local_path,
            open_deliverable,
            open_project_terminal,
            open_full_disk_access_settings,
            reveal_gateway_for_full_disk_access,
            deliverables::list_aeon_deliverables,
            deliverables::list_aeon_outputs,
            deliverables::list_aeon_schedules,
            deliverables::get_aeon_memory,
            deliverables::prepare_aeon_workspace,
            deliverables::aeon_repo_sync,
            deliverables::list_aeon_runs,
            deliverables::get_aeon_run_log,
            brain::brain_skill_inventory,
            brain::brain_graph,
            env::hive_env_read,
            fleet::fleet_apps_cache,
            fleet::tailscale_devices,
            kanban::kanban_read,
            memory::memory_telemetry,
            phone::phone_prompts,
            runtime_files::runtime_files,
            runtime_usage::runtime_usage,
            setup::native_setup_run,
            setup::native_setup_status,
            scheduler::scheduler_shared_schedules,
            deliverables::download_aeon_deliverable,
            deliverables::send_aeon_deliverable,
            desktop_navigation::open_route_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building HivemindOS desktop")
        .run(|app_handle, event| {
            guard_native_callback("app run event", || match event {
                RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        desktop_navigation::save_main_window_state(app_handle);
                    }
                }
                RunEvent::ExitRequested { .. } => {
                    desktop_navigation::save_main_window_state(app_handle);
                    let state = app_handle.state::<NativeServerState>();
                    stop_native_server(state);
                }
                _ => {}
            });
        });
}

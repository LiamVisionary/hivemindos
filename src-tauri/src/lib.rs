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
mod dashboard_state;
mod desktop_navigation;
mod deliverables;
mod env;
mod fleet;
mod kanban;
mod memory;
mod obsidian;
mod phone;
mod runtime_files;
mod runtime_usage;
mod scheduler;
mod setup;
mod speech;
mod wallet_export;

#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::process::Stdio;
#[cfg(not(debug_assertions))]

#[cfg(all(not(debug_assertions), target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Build a `Command` for a background/probe spawn that must NOT pop a console
/// window on Windows. On Windows a plain `Command` flashes a black console
/// window every time it runs; for one-off opens that's a blink, but for
/// repeated probes it's a strobe. The native_setup_status command alone fires
/// ~12 `where` probes per call, polled every 4s while setup finishes, which
/// looked like "black screens popping up constantly" on a real Windows box.
/// Routes every background/polled spawn through CREATE_NO_WINDOW. No-op off
/// Windows. Do NOT use this for spawns that are *meant* to open a window (the
/// setup terminal, "open in Terminal", reveal-in-Explorer).
pub(crate) fn hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

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
    port: Mutex<Option<u16>>,
    dashboard_token: Mutex<Option<String>>,
    cache: Mutex<HashMap<String, NativeCacheEntry>>,
    // Set (to the error + server-log tail) when the embedded server fails to
    // boot. The loading shell polls `native_boot_status`; when this is Some it
    // shows an interactive error screen (log + Copy + Retry) instead of a frozen
    // loader. Always present (debug builds never set it; the shell is release-only).
    boot_error: Mutex<Option<String>>,
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
            port: Mutex::new(None),
            dashboard_token: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
            boot_error: Mutex::new(None),
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
    let source_build = env!("HIVEMINDOS_TAURI_SOURCE_BUILD") == "true";
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
        "packaged": !cfg!(debug_assertions),
        "sourceBuild": source_build,
        "releaseChannel": if source_build { "source" } else { "release" },
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
    allow_private_filesystem: Option<bool>,
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
    let allow_private_filesystem = allow_private_filesystem.unwrap_or(false);

    if !allow_private_filesystem {
        return serde_json::json!({
            "ok": true,
            "checkedAt": chrono::Utc::now().to_rfc3339(),
            "desktopStatus": desktop_status,
            "appVersion": desktop_status,
        });
    }

    std::thread::scope(|scope| {
        let state_ref = &state;
        let hive_env = scope.spawn(move || cached_payload(state_ref, hive_key, || native_payload(env::hive_env_read(Some(true)))));
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
    // 60s, not 25s: a fresh Windows install with Defender real-time scanning the
    // just-extracted node.exe + thousands of node_modules files can take far
    // longer than 25s on the very first boot. The window shows the animated
    // loading shell the entire time (not a frozen blank), so a longer ceiling
    // only helps. Overridable for CI/tests via HIVEMINDOS_NATIVE_BOOT_TIMEOUT_SECS.
    let timeout_secs = std::env::var("HIVEMINDOS_NATIVE_BOOT_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(60);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    while Instant::now() < deadline {
        if TcpStream::connect((NATIVE_BIND_HOST, port)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    Err(format!("Next server did not open port {port} within {timeout_secs} seconds"))
}

#[cfg(not(debug_assertions))]
fn packaged_next_server_paths<R: Runtime>(
    app: &impl Manager<R>,
) -> Result<(PathBuf, PathBuf), Box<dyn std::error::Error>> {
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
fn has_packaged_next_server<R: Runtime>(app: &impl Manager<R>) -> bool {
    packaged_next_server_paths(app)
        .map(|(server_js, node_path)| server_js.exists() && node_path.exists())
        .unwrap_or(false)
}

/// Push the bundled brain content (skills, packaged skills, For Users / For
/// Investors docs) into the user's shared vault on launch. The release bundle
/// ships no setup scripts, so packaged installs that never run setup.sh would
/// otherwise never get brain improvements after an update. The engine
/// (resources/brain-seed/hive-brain-sync.mjs, run by the bundled node) is
/// checksum-managed (updates managed-unedited content, preserves user edits,
/// never duplicates) and version-gated (a no-op once this version has synced).
/// Fire-and-forget and best-effort: it must never block or crash launch.
#[cfg(not(debug_assertions))]
fn start_bundled_brain_sync<R: Runtime>(app: &impl Manager<R>) {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let brain_seed_dir = resource_dir.join("resources").join("brain-seed");
    let script = brain_seed_dir.join("hive-brain-sync.mjs");
    let node_path = resource_dir
        .join("resources")
        .join("hivemindos-node")
        .join(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
    // Older bundles (or dev) ship no brain-seed; nothing to do.
    if !script.exists() || !node_path.exists() {
        return;
    }
    let log_path = native_server_log_path();
    let (stdout, stderr) = native_server_log_stdio(log_path.as_deref());
    let mut command = Command::new(&node_path);
    command
        .arg("--preserve-symlinks-main")
        .arg(&script)
        .arg("--content-base")
        .arg(&brain_seed_dir)
        .arg("--app-version")
        .arg(env!("CARGO_PKG_VERSION"))
        .arg("--quiet")
        .current_dir(&brain_seed_dir)
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    if let Err(error) = command.spawn() {
        eprintln!("HivemindOS: brain sync did not start: {error}");
    }
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

/// Where the embedded Next server's captured stdout/stderr is written.
#[cfg(not(debug_assertions))]
fn native_server_log_path() -> Option<PathBuf> {
    home_dir().map(|home| home.join(".hivemindos").join("native-server.log"))
}

/// Open (truncate) the server log and return stdout/stderr handles pointed at
/// it. Best-effort: if the file can't be opened, fall back to /dev/null so a
/// logging hiccup never blocks the server from starting.
#[cfg(not(debug_assertions))]
fn native_server_log_stdio(path: Option<&Path>) -> (Stdio, Stdio) {
    let Some(path) = path else {
        return (Stdio::null(), Stdio::null());
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
    {
        Ok(file) => match file.try_clone() {
            Ok(clone) => (Stdio::from(file), Stdio::from(clone)),
            Err(_) => (Stdio::from(file), Stdio::null()),
        },
        Err(_) => (Stdio::null(), Stdio::null()),
    }
}

/// Read the last ~4 KB of the server log for inclusion in an error message.
#[cfg(not(debug_assertions))]
fn read_native_server_log_tail(path: &Path) -> String {
    const MAX: usize = 4000;
    match fs::read(path) {
        Ok(bytes) => {
            let start = bytes.len().saturating_sub(MAX);
            String::from_utf8_lossy(&bytes[start..]).into_owned()
        }
        Err(_) => String::new(),
    }
}

#[cfg(not(debug_assertions))]
fn start_native_next_server<R: Runtime>(
    app: &impl Manager<R>,
) -> Result<(Child, u16, String, Option<PathBuf>), Box<dyn std::error::Error>> {
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

    // Capture the embedded server's own stdout/stderr. They used to both go to
    // /dev/null, so a boot failure (a JIT-blocked node, a missing standalone
    // trace file, a wrong-arch binary) left no trace and surfaced only as an
    // opaque "port did not open in 25s". Now the cause lands in
    // ~/.hivemindos/native-server.log and in the returned error.
    let log_path = native_server_log_path();
    let (stdout, stderr) = native_server_log_stdio(log_path.as_deref());

    let mut command = Command::new(&node_path);
    command
        // Node realpath-resolves the main-module path at startup. On Windows,
        // Tauri's resource_dir() yields an extended-length (verbatim) path
        // (\\?\C:\...\server.js) and Node's realpathSync chokes on it with
        // "EISDIR: illegal operation on a directory, lstat 'C:'", so the
        // embedded server never starts and every launch lands on the
        // "couldn't start its local server" page (Windows has been broken this
        // way since the first embedded release). --preserve-symlinks-main skips
        // that realpath of the entry script, fixing it while keeping the
        // verbatim prefix (so deep node_modules paths stay long-path-safe).
        // Reproduced + fix-validated on windows-latest. Harmless on macOS/Linux
        // (the standalone's main path has no symlink to preserve).
        .arg("--preserve-symlinks-main")
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
        .stdout(stdout)
        .stderr(stderr);

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    // Spawn only — do NOT block here waiting for the port to open. Blocking was
    // done synchronously inside setup() on the main thread, which froze the whole
    // app (no paint) for the 1-3s the Node server takes to boot. The readiness
    // wait now happens on a background thread (await_native_server_then_navigate)
    // so the window can paint the loading shell instantly.
    let child = command.spawn()?;

    Ok((child, port, auth.bootstrap_token, log_path))
}

/// Background-thread half of the embedded boot: wait for the Node server's port
/// to open, then swap the loading shell for the real dashboard (or show the
/// error page if it never comes up). Never blocks the main thread.
#[cfg(not(debug_assertions))]
fn await_native_server_then_navigate(
    handle: tauri::AppHandle,
    port: u16,
    token: String,
    log_path: Option<PathBuf>,
) {
    match wait_for_native_server(port) {
        Ok(()) => {
            // Publish port + token only now that the server is actually ready, then
            // bridge it onto the tailnet for a paired phone and navigate to the app.
            // The Child is already in NativeServerState (stored in setup() before
            // this thread launched), so a quit during the boot wait still kills it.
            let state = handle.state::<NativeServerState>();
            if let Ok(mut guard) = state.port.lock() {
                *guard = Some(port);
            }
            if let Ok(mut guard) = state.dashboard_token.lock() {
                *guard = Some(token.clone());
            }
            spawn_tailnet_forwarder(port);
            navigate_main_window_to_server(&handle, port, &token);
        }
        Err(message) => {
            // Reclaim the child from shared state to capture its exit status and
            // kill it. Surface why: if node already exited, include its status;
            // always append the tail of its own log so the real error (not just
            // "port never opened") reaches native-panic.log and the user.
            let state = handle.state::<NativeServerState>();
            let mut child = state.child.lock().ok().and_then(|mut guard| guard.take());
            let exit = child.as_mut().and_then(|c| c.try_wait().ok().flatten());
            if let Some(c) = child.as_mut() {
                let _ = c.kill();
            }
            let exited = match exit {
                Some(status) => format!(" (node process exited: {status})"),
                None => " (node process still running but unresponsive)".to_string(),
            };
            let tail = log_path
                .as_deref()
                .map(read_native_server_log_tail)
                .unwrap_or_default();
            let where_log = log_path
                .as_deref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "no log path".to_string());
            let full = format!(
                "embedded Next server did not become ready: {message}{exited}\n--- embedded server log tail ({where_log}) ---\n{tail}"
            );
            eprintln!("HivemindOS: {full}");
            append_native_panic_log(
                "embedded server start",
                &full,
                "kept app alive; showed local-server error page",
            );
            // Publish the failure to shared state. The loading shell is still on
            // screen (we did NOT navigate away), and its native_boot_status poll
            // picks this up and swaps to the interactive error screen (log + Copy
            // + Retry) — which also reports the failure to telemetry from the
            // webview, the one place that can reach the network here. Re-acquire
            // state inline so its borrow drops with this statement (the `state`
            // binding above is borrowed for the child reclaim and would outlive
            // the lock guard otherwise -> E0597).
            if let Ok(mut guard) = handle.state::<NativeServerState>().boot_error.lock() {
                *guard = Some(full);
            }
        }
    }
}

/// Navigate the main window from the loading shell to the booted Node server,
/// carrying the one-time bootstrap token in the URL fragment. Marshalled to the
/// main thread because it is called from the boot background thread.
#[cfg(not(debug_assertions))]
fn navigate_main_window_to_server(handle: &tauri::AppHandle, port: u16, token: &str) {
    let token = token.to_string();
    let inner = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        if let Some(window) = inner.get_webview_window("main") {
            match url::Url::parse(&format!("http://{NATIVE_BIND_HOST}:{port}/")) {
                Ok(mut url) => {
                    url.set_fragment(Some(&format!("hivemindos_native_bootstrap={token}")));
                    if let Err(error) = window.navigate(url) {
                        eprintln!("HivemindOS: could not navigate to embedded server: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("HivemindOS: bad embedded server URL: {error}");
                }
            }
        }
    });
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

/// The port the app-signed gateway login item binds and the phone probes. NOT 5000 — that's
/// permanently held by Apple's ControlCenter / AirPlay receiver.
#[cfg(target_os = "macos")]
const HOSTED_GATEWAY_PORT: u16 = 5001;

#[cfg(target_os = "macos")]
fn claw_gateway_already_listening() -> bool {
    // Probe the GATEWAY port (5001), NOT 5000. Port 5000 is permanently held by
    // Apple's ControlCenter / AirPlay receiver, so probing it is a false positive
    // ("a gateway is already up") — which made the app skip hosting and leave the
    // phone on the launchd gateway (external claw, no Downloads grant). The hosted
    // gateway binds 5001 (see install_gateway_login_item), so that's the port to check.
    TcpStream::connect(("127.0.0.1", HOSTED_GATEWAY_PORT)).is_ok()
}

/// Stop a stale hosted gateway so a fresh one can bind 5001. Dev relaunches
/// (`pnpm tauri dev`) don't go through stop_native_server — a killed dev app
/// orphans its gateway child, and the adopt-if-listening rule then pins every
/// later run to that orphan's old backend code. Only a process whose command
/// line proves it is OUR installed gateway is stopped; any other squatter
/// keeps the port and we fall back to skipping the host (never steal a port
/// from an unrelated project). Returns true when the port is free to bind.
#[cfg(target_os = "macos")]
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
        let is_our_gateway = command_line.contains(".hivemindos/claw")
            || command_line.contains("hivemind-gateway-host")
            || command_line.contains(GATEWAY_LOGIN_ITEM_LABEL);
        if !is_our_gateway {
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

/// launchd label for the app-signed gateway login item.
#[cfg(target_os = "macos")]
const GATEWAY_LOGIN_ITEM_LABEL: &str = "com.hivemindos.claw-gateway";

/// The current user's numeric uid via `id -u` (libc::getuid would need `unsafe`,
/// which the crate forbids). Used to address the `gui/<uid>` launchd domain.
#[cfg(target_os = "macos")]
fn current_uid() -> Option<String> {
    let output = Command::new("id").arg("-u").output().ok()?;
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(target_os = "macos")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Boot out and remove the legacy headless launchd gateway
/// (`com.hivemindos.claw-backend`). It runs the EXTERNAL claw/node, which is its
/// own TCC subject and is denied protected folders — the exact failure this
/// migration removes — and would otherwise co-bind 5001 with the new login item.
/// Idempotent.
#[cfg(target_os = "macos")]
fn retire_legacy_launchd_gateway() {
    let Some(uid) = current_uid() else {
        return;
    };
    let service = format!("gui/{uid}/com.hivemindos.claw-backend");
    let _ = Command::new("launchctl").args(["bootout", &service]).status();
    // bootout is async — the legacy node (which binds 5001) may still be tearing
    // down. WAIT for it to fully unload before we let the new login item bind
    // 5001, so the two gateways can't double-bind / race the port. The legacy job
    // has KeepAlive, so freeing the port by-PID before it's unloaded would just
    // let it respawn.
    for _ in 0..8 {
        let still_loaded = Command::new("launchctl")
            .args(["print", &service])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !still_loaded {
            break;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    let _ = Command::new("launchctl").args(["disable", &service]).status();
    if let Some(home) = home_dir() {
        let plist = home
            .join("Library")
            .join("LaunchAgents")
            .join("com.hivemindos.claw-backend.plist");
        let _ = fs::remove_file(&plist);
    }
}

/// Register (or refresh) the claw gateway as a launchd login item that runs the
/// app-signed in-bundle helper (Contents/MacOS/hivemind-gateway-host). Because
/// the helper carries the app's code identity, the gateway's file access is
/// attributed to HivemindOS (one-click "Allow" prompts that persist across
/// updates), while launchd RunAtLoad+KeepAlive keep it running at login and after
/// the window closes. Idempotent: re-points the plist at the current app path on
/// every launch (so app updates take effect) and relaunches via the same
/// bootout → wait → bootstrap → kickstart sequence as install-claw-backend.sh.
#[cfg(target_os = "macos")]
fn install_gateway_login_item() -> Result<(), String> {
    let helper = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("hivemind-gateway-host")))
        .filter(|path| path.exists())
        .ok_or("bundled gateway-host helper not found next to the app executable")?;

    let home = home_dir().ok_or("Could not resolve home directory")?;
    let launch_agents = home.join("Library").join("LaunchAgents");
    let logs_dir = home.join("Library").join("Logs");
    let _ = fs::create_dir_all(&launch_agents);
    let _ = fs::create_dir_all(&logs_dir);
    let plist_path = launch_agents.join(format!("{GATEWAY_LOGIN_ITEM_LABEL}.plist"));
    let out_log = logs_dir.join("hivemindos-claw-gateway.out.log");
    let err_log = logs_dir.join("hivemindos-claw-gateway.err.log");

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{helper}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>{out}</string>
  <key>StandardErrorPath</key>
  <string>{err}</string>
</dict>
</plist>
"#,
        label = GATEWAY_LOGIN_ITEM_LABEL,
        helper = xml_escape(&helper.to_string_lossy()),
        out = xml_escape(&out_log.to_string_lossy()),
        err = xml_escape(&err_log.to_string_lossy()),
    );
    fs::write(&plist_path, plist).map_err(|error| format!("write login item plist: {error}"))?;

    let uid = current_uid().ok_or("Could not resolve current uid")?;
    let domain = format!("gui/{uid}");
    let service = format!("{domain}/{GATEWAY_LOGIN_ITEM_LABEL}");
    let plist_str = plist_path.to_string_lossy().to_string();

    // bootout is async: wait for the old instance to fully unload before
    // bootstrapping, else the bootstrap silently no-ops and the job stays down.
    let _ = Command::new("launchctl").args(["bootout", &service]).status();
    for _ in 0..8 {
        let still_loaded = Command::new("launchctl")
            .args(["print", &service])
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if !still_loaded {
            break;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    let bootstrapped = Command::new("launchctl")
        .args(["bootstrap", &domain, &plist_str])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !bootstrapped {
        let _ = Command::new("launchctl").args(["load", &plist_str]).status();
    }
    let _ = Command::new("launchctl")
        .args(["kickstart", "-k", &service])
        .status();
    Ok(())
}

fn stop_native_server(state: tauri::State<NativeServerState>) {
    // Only the embedded dashboard server is a child of this app. The gateway now
    // runs as a launchd login item (com.hivemindos.claw-gateway) so it persists
    // after the window closes and at login — quitting the app must NOT kill it.
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Boot status the loading shell polls. While the embedded server is still
/// coming up this is "booting"; if it failed, "failed" plus the error + server
/// log tail so the shell can render an interactive error screen (Copy + Retry).
/// (Once the server is ready the window has navigated to it, so the shell never
/// observes a "ready" here.)
#[tauri::command]
fn native_boot_status(state: tauri::State<NativeServerState>) -> serde_json::Value {
    let detail = state.boot_error.lock().ok().and_then(|guard| guard.clone());
    match detail {
        Some(detail) => serde_json::json!({ "state": "failed", "detail": detail }),
        None => serde_json::json!({ "state": "booting" }),
    }
}

/// Re-attempt the embedded server boot from the error screen's Retry button,
/// WITHOUT restarting the whole app (the prior "rerun setup" menu item did
/// nothing because it needed the server). Kills any old child, clears the prior
/// error, and re-runs the spawn + background readiness wait (which navigates to
/// the dashboard on success, or re-sets boot_error on failure).
#[tauri::command]
fn retry_native_server(app: tauri::AppHandle) -> serde_json::Value {
    #[cfg(not(debug_assertions))]
    {
        let state = app.state::<NativeServerState>();
        if let Ok(mut guard) = state.boot_error.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = state.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        match start_native_next_server(&app) {
            Ok((child, port, token, log_path)) => {
                if let Ok(mut guard) = state.child.lock() {
                    *guard = Some(child);
                }
                let handle = app.clone();
                std::thread::spawn(move || {
                    await_native_server_then_navigate(handle, port, token, log_path);
                });
                serde_json::json!({ "ok": true })
            }
            Err(error) => {
                let message = format!("retry could not start the embedded server: {error}");
                if let Ok(mut guard) = state.boot_error.lock() {
                    *guard = Some(message.clone());
                }
                serde_json::json!({ "ok": false, "error": message })
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let _ = app;
        serde_json::json!({ "ok": false, "error": "retry is only available in packaged builds" })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_native_panic_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            if let Err(error) = desktop_navigation::setup_deep_links(_app) {
                eprintln!("HivemindOS deep link setup failed: {error}");
            }
            desktop_navigation::restore_window_state(_app.handle());

            // Run the claw gateway as an app-signed launchd login item
            // (com.hivemindos.claw-gateway → Contents/MacOS/hivemind-gateway-host).
            // It persists at login and with the window closed, AND its file access
            // is attributed to this signed app (one-click TCC prompts, no manual
            // Full Disk Access). Only when running from a bundle that actually
            // contains the helper (release, or a dev-codesign-runner bundle); a
            // plain `cargo run` has no nested helper and skips this.
            #[cfg(target_os = "macos")]
            {
                let helper_bundled = std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|dir| dir.join("hivemind-gateway-host")))
                    .map(|path| path.exists())
                    .unwrap_or(false);
                if helper_bundled {
                    // Remove the old headless launchd gateway (external claw, denied
                    // protected folders) so it can't co-bind 5001.
                    retire_legacy_launchd_gateway();
                    // Free 5001 from any pre-migration app-hosted child still holding
                    // it (ownership-guarded; never steals an unrelated port).
                    if claw_gateway_already_listening() {
                        let _ = stop_stale_hosted_gateway();
                    }
                    if let Err(error) = install_gateway_login_item() {
                        eprintln!("HivemindOS: could not register gateway login item: {error}");
                    }
                }
            }

            #[cfg(not(debug_assertions))]
            {
                let app = _app;
                if has_packaged_next_server(app) {
                    // A failure here must NOT crash the app. Previously `?` bubbled
                    // the error out of setup(), so `.build(...).expect(...)` panicked
                    // and a server that couldn't boot took the whole window down with
                    // it. Now we log the cause (with the server's own log tail) and
                    // show a readable error page instead of dying on launch.
                    match start_native_next_server(app) {
                        Ok((child, port, token, log_path)) => {
                            // Store the Child in shared state IMMEDIATELY — before the
                            // boot thread launches — so quitting during the 1-3s boot
                            // window still kills it (ExitRequested -> stop_native_server
                            // takes + kills it). The old code blocked here until ready,
                            // so this exit window did not exist; the async boot opens it.
                            let state = app.state::<NativeServerState>();
                            if let Ok(mut guard) = state.child.lock() {
                                *guard = Some(child);
                            }
                            // Boot WITHOUT blocking setup(): the window paints the
                            // loading shell instantly; a background thread publishes
                            // port+token, swaps to the real dashboard once the server
                            // is ready (or shows the error page if it never opens).
                            let handle = app.handle().clone();
                            std::thread::spawn(move || {
                                await_native_server_then_navigate(handle, port, token, log_path);
                            });
                        }
                        Err(error) => {
                            let message = format!("embedded Next server did not start: {error}");
                            eprintln!("HivemindOS: {message}");
                            append_native_panic_log(
                                "embedded server start",
                                &message,
                                "kept app alive; showed local-server error page",
                            );
                            // Surface to the loading shell (still on screen) via its
                            // native_boot_status poll -> interactive error screen.
                            if let Ok(mut guard) = app.state::<NativeServerState>().boot_error.lock()
                            {
                                *guard = Some(message);
                            }
                        }
                    }
                }

                // Packaged installs never run setup.sh, so seed/refresh the
                // bundled brain content into the user's vault on launch. Version-
                // gated, checksum-managed, idempotent; runs detached, never blocks.
                start_bundled_brain_sync(app);
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
            fleet::fleet_discover,
            fleet::tailscale_devices,
            kanban::kanban_read,
            memory::memory_telemetry,
            phone::phone_prompts,
            native_boot_status,
            retry_native_server,
            runtime_files::runtime_files,
            runtime_usage::runtime_usage,
            setup::native_setup_run,
            setup::native_setup_status,
            scheduler::scheduler_shared_schedules,
            wallet_export::wallet_secret_export_save,
            obsidian::obsidian_capture_note,
            obsidian::obsidian_agents,
            obsidian::obsidian_personal_wallets,
            dashboard_state::dashboard_state_read,
            dashboard_state::dashboard_state_write,
            deliverables::download_aeon_deliverable,
            deliverables::send_aeon_deliverable,
            desktop_navigation::open_route_window,
            speech::speech_recognition_available,
            speech::speech_recognition_start,
            speech::speech_recognition_stop
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

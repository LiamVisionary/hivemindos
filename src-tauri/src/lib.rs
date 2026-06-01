use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent};

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
use std::net::{TcpListener, TcpStream};
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::process::Stdio;
#[cfg(not(debug_assertions))]

#[cfg(all(not(debug_assertions), target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const NATIVE_HOST: &str = "127.0.0.1";
const NATIVE_CACHE_TTL: Duration = Duration::from_secs(30);

struct NativeCacheEntry {
    loaded_at: Instant,
    payload: Value,
}

struct NativeServerState {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    cache: Mutex<HashMap<String, NativeCacheEntry>>,
}

impl NativeServerState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        }
    }
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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
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
        "devUrl": if cfg!(debug_assertions) { Some("http://127.0.0.1:5021") } else { None },
        "nativeHost": NATIVE_HOST,
        "nativePort": port
    })
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
    let listener = TcpListener::bind((NATIVE_HOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

#[cfg(not(debug_assertions))]
fn wait_for_native_server(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(25);

    while Instant::now() < deadline {
        if TcpStream::connect((NATIVE_HOST, port)).is_ok() {
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

#[cfg(not(debug_assertions))]
fn spawn_native_next_server(app: &tauri::App) -> Result<(Child, u16), Box<dyn std::error::Error>> {
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

    let port = reserve_local_port()?;
    let mut command = Command::new(&node_path);
    command
        .arg(&server_js)
        .current_dir(&server_dir)
        .env("HOSTNAME", NATIVE_HOST)
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .env("HIVEMINDOS_NATIVE", "1")
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

    Ok((child, port))
}

fn stop_native_server(state: tauri::State<NativeServerState>) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(NativeServerState::new())
        .menu(desktop_navigation::app_menu)
        .on_menu_event(|app, event| {
            desktop_navigation::handle_menu_event(app, event.id().as_ref());
        })
        .setup(|_app| {
            if let Err(error) = desktop_navigation::setup_tray(_app.handle()) {
                eprintln!("HivemindOS tray setup failed: {error}");
            }
            desktop_navigation::restore_window_state(_app.handle());

            #[cfg(not(debug_assertions))]
            {
                let app = _app;
                if has_packaged_next_server(app) {
                    let (child, port) = spawn_native_next_server(app)?;
                    let state = app.state::<NativeServerState>();
                    *state.child.lock().map_err(|_| "Native server lock poisoned")? = Some(child);
                    *state.port.lock().map_err(|_| "Native server port lock poisoned")? = Some(port);

                    let window = app
                        .get_webview_window("main")
                        .ok_or("Missing main HivemindOS window")?;
                    let url = url::Url::parse(&format!("http://{NATIVE_HOST}:{port}/"))?;
                    window.navigate(url)?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            dashboard_bootstrap,
            list_local_directories,
            create_local_folder,
            display_local_path,
            open_deliverable,
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
            match event {
                RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::CloseRequested { .. }) {
                        desktop_navigation::save_main_window_state(app_handle);
                    }
                }
                RunEvent::ExitRequested { .. } => {
                    let state = app_handle.state::<NativeServerState>();
                    stop_native_server(state);
                }
                _ => {}
            }
        });
}

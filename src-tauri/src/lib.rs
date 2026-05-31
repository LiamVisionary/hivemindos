use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

mod brain;
mod deliverables;
mod env;

#[cfg(not(debug_assertions))]
use std::net::{TcpListener, TcpStream};
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::process::Stdio;
#[cfg(not(debug_assertions))]
use std::time::{Duration, Instant};

#[cfg(all(not(debug_assertions), target_os = "windows"))]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const NATIVE_HOST: &str = "127.0.0.1";

struct NativeServerState {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
}

impl NativeServerState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
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
        "phase": if cfg!(debug_assertions) { "phase-1-dev" } else { "phase-2-packaged" },
        "devUrl": if cfg!(debug_assertions) { Some("http://127.0.0.1:5021") } else { None },
        "nativeHost": NATIVE_HOST,
        "nativePort": port
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
fn spawn_native_next_server(app: &tauri::App) -> Result<(Child, u16), Box<dyn std::error::Error>> {
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
        .setup(|_app| {
            #[cfg(not(debug_assertions))]
            {
                let app = _app;
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_status,
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
            env::hive_env_read,
            deliverables::download_aeon_deliverable,
            deliverables::send_aeon_deliverable
        ])
        .build(tauri::generate_context!())
        .expect("error while building HivemindOS desktop")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<NativeServerState>();
                stop_native_server(state);
            }
        });
}

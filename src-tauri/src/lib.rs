use std::process::Child;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

#[cfg(not(debug_assertions))]
use std::net::{TcpListener, TcpStream};
#[cfg(all(not(debug_assertions), target_os = "windows"))]
use std::os::windows::process::CommandExt;
#[cfg(not(debug_assertions))]
use std::process::{Command, Stdio};
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

#[tauri::command]
fn desktop_status(state: tauri::State<NativeServerState>) -> serde_json::Value {
    let port = state.port.lock().ok().and_then(|guard| *guard);

    serde_json::json!({
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
        .invoke_handler(tauri::generate_handler![desktop_status])
        .build(tauri::generate_context!())
        .expect("error while building HivemindOS desktop")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<NativeServerState>();
                stop_native_server(state);
            }
        });
}

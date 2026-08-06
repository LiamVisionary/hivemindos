use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::{guard_native_callback, NativeServerState};
#[cfg(not(debug_assertions))]
use crate::NATIVE_BROWSER_HOST;

const NAVIGATE_EVENT: &str = "hivemindos:navigate";
const OPEN_PALETTE_EVENT: &str = "hivemindos:open-command-palette";
const OPEN_POPOUT_EVENT: &str = "hivemindos:open-popout";
const RERUN_SETUP_EVENT: &str = "hivemindos:rerun-setup";
const MODELS_CREDITS_RETURN_EVENT: &str = "hivemindos:models-credits-return";
const MANAGED_X_RETURN_EVENT: &str = "hivemindos:managed-x-return";
const RESEARCH_SYNC_CODE_EVENT: &str = "hivemindos:research-sync-code";
const QUEEN_VOICE_EVENT: &str = "hivemindos:queen-bee-voice";
const QUEEN_SETTINGS_EVENT: &str = "hivemindos:queen-bee-settings";

#[derive(Deserialize)]
pub struct RouteWindowTarget {
    url: String,
    view: String,
    /// Spawn the window under the pointer (drag-out flows). The actual
    /// position comes from the OS cursor — webview screenX/screenY are not
    /// trustworthy across platforms — with these as the fallback when the
    /// cursor can't be read.
    #[serde(default, rename = "screenX")]
    screen_x: Option<f64>,
    #[serde(default, rename = "screenY")]
    screen_y: Option<f64>,
    /// The pointer is still held mid-drag (live drag-out). The window spawns
    /// unfocused so the origin window keeps its pointer stream, and on macOS
    /// a native follow loop keeps it under the cursor until the physical
    /// button releases — webview pointer events die once focus shifts, so
    /// the follow cannot depend on them.
    #[serde(default)]
    live: Option<bool>,
}

/// Native cursor/button reads for the live drag-out follow loop, via the safe
/// core-graphics / objc2-app-kit wrappers (this crate forbids unsafe code).
/// The reads are OS-global and independent of any webview event stream, which
/// is the whole point: the origin webview stops delivering pointermoves once
/// the new window appears, so the follow must come from the OS.
#[cfg(target_os = "macos")]
mod macos_drag {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use objc2_app_kit::NSEvent;

    /// Global cursor position in logical points (top-left origin) — the same
    /// space Quartz events and window positioning use.
    pub fn cursor_point() -> Option<(f64, f64)> {
        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
        let event = CGEvent::new(source).ok()?;
        let point = event.location();
        Some((point.x, point.y))
    }

    /// Whether the primary (left) mouse button is physically held.
    pub fn left_button_down() -> bool {
        NSEvent::pressedMouseButtons() & 1 == 1
    }
}

/// Where the pointer "holds" a popped-out window relative to its top-left
/// corner. Mirrors POPOUT_GRAB_OFFSET_X/Y in dashboard-navigation.ts.
const POPOUT_GRAB_OFFSET_X: f64 = 160.0;
const POPOUT_GRAB_OFFSET_Y: f64 = 24.0;

/// The OS cursor in logical (points) coordinates — the space window
/// positioning uses. Reads the physical cursor and divides by the scale
/// factor of the monitor under it.
fn cursor_logical_position(app: &AppHandle) -> Option<(f64, f64)> {
    let cursor = app.cursor_position().ok()?;
    let mut scale = 1.0;
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            let origin = monitor.position();
            let size = monitor.size();
            if cursor.x >= origin.x as f64
                && cursor.x <= origin.x as f64 + size.width as f64
                && cursor.y >= origin.y as f64
                && cursor.y <= origin.y as f64 + size.height as f64
            {
                scale = monitor.scale_factor();
                break;
            }
        }
    }
    Some((cursor.x / scale, cursor.y / scale))
}

#[derive(Serialize, Deserialize)]
struct SavedWindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    maximized: bool,
}

fn menu_item(app: &AppHandle, id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, label, true, accelerator)
}

fn emit_route(app: &AppHandle, view: &str) {
    let _ = app.emit(NAVIGATE_EVENT, serde_json::json!({ "view": view }));
}

fn emit_popout(app: &AppHandle, view: &str) {
    let _ = app.emit(OPEN_POPOUT_EVENT, serde_json::json!({ "view": view }));
}

fn emit_current_popout(app: &AppHandle) {
    let _ = app.emit(OPEN_POPOUT_EVENT, serde_json::json!({}));
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Deep-linked hrsc_ research pairing codes are single-use with a 10-minute
// TTL, so a code that arrives before the dashboard webview is listening (the
// app was cold-started by the deep link itself) is parked here for the
// frontend to collect exactly once via take_pending_research_sync_code.
static PENDING_RESEARCH_SYNC_CODE: Mutex<Option<String>> = Mutex::new(None);

/// One-shot handoff of a deep-linked research sync code: returns the parked
/// code and clears it, so a later dashboard reload can never re-redeem a
/// single-use code.
#[tauri::command]
pub fn take_pending_research_sync_code() -> Option<String> {
    PENDING_RESEARCH_SYNC_CODE
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
}

pub fn setup_deep_links(app: &App) -> Result<(), String> {
    use tauri_plugin_deep_link::DeepLinkExt;

    let start_urls = app.deep_link().get_current().map_err(|error| error.to_string())?;
    if let Some(urls) = start_urls {
        handle_deep_link_urls(app.handle(), urls.iter().map(|url| url.to_string()).collect());
    }

    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        let urls = event.urls().iter().map(|url| url.to_string()).collect::<Vec<_>>();
        handle_deep_link_urls(&handle, urls);
    });

    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all().map_err(|error| error.to_string())?;

    Ok(())
}

fn handle_deep_link_urls(app: &AppHandle, urls: Vec<String>) {
    for raw_url in urls {
        let Ok(url) = url::Url::parse(&raw_url) else {
            continue;
        };
        if url.scheme() != "hivemindos" && url.scheme() != "hivemindos-dev" {
            continue;
        }
        let host = url.host_str().unwrap_or_default();
        let path = url.path().trim_matches('/');
        if host == "models" && path == "credits" {
            show_main_window(app);
            let status = query_value(&url, "status").unwrap_or_else(|| "returned".to_string());
            let source = query_value(&url, "source").unwrap_or_else(|| "stripe".to_string());
            let slug = query_value(&url, "slug").unwrap_or_default();
            let _ = app.emit(MODELS_CREDITS_RETURN_EVENT, serde_json::json!({
                "status": status,
                "source": source,
                "slug": slug,
                "url": url.to_string(),
            }));
        } else if host == "integrations" && path == "oauth-return" {
            // Generic OAuth external-browser return (github/linkedin/google …):
            // the provider callback page deep-links here after the token
            // exchange completed server-side. Foreground the app and open the
            // view the signed state named; the open Connect modal (or the AEON
            // panel) picks the credential up through its own polling/refresh.
            let view = match query_value(&url, "view").as_deref() {
                Some("aeon") => "aeon",
                Some("socials") => "socials",
                _ => "integrations",
            };
            show_main_window(app);
            let _ = app.emit(NAVIGATE_EVENT, serde_json::json!({ "view": view }));
        } else if host == "integrations" && path == "google-cloud" {
            // Return target from the Google Cloud OAuth "close this tab" page.
            // The consent flow ran in the external browser; this deep link brings
            // the desktop app back to the front and opens Integrations, where the
            // open Connect modal is already polling for the saved refresh token.
            show_main_window(app);
            let _ = app.emit(NAVIGATE_EVENT, serde_json::json!({ "view": "integrations" }));
        } else if (host == "integrations" && path == "x-managed")
            || (host == "socials" && path == "x-managed")
        {
            let return_view = if host == "socials" {
                "socials"
            } else {
                "integrations"
            };
            let return_tab = if return_view == "integrations"
                && query_value(&url, "x_return_tab").as_deref() == Some("xbot")
            {
                "xbot"
            } else if return_view == "integrations" {
                "mcp"
            } else {
                ""
            };
            show_main_window(app);
            let _ = app.emit(NAVIGATE_EVENT, serde_json::json!({
                "view": return_view,
                "integrationsTab": return_tab,
            }));
            let _ = app.emit(
                MANAGED_X_RETURN_EVENT,
                serde_json::json!({
                    "status": query_value(&url, "x_status").unwrap_or_default(),
                    "connectionId": query_value(&url, "connectionId").unwrap_or_default(),
                    "username": query_value(&url, "username").unwrap_or_default(),
                    "error": query_value(&url, "error").unwrap_or_default(),
                    "creditAccountId": query_value(&url, "x_credit_account_id").unwrap_or_default(),
                    "slug": query_value(&url, "x_slug").unwrap_or_default(),
                    "returnView": return_view,
                    "returnTab": return_tab,
                    "url": url.to_string(),
                }),
            );
        } else if host == "research" && path == "sync" {
            // "Sync memories to app" on hivemindos.app/research. Park the code
            // for take_pending_research_sync_code (cold start) and emit it for
            // a running dashboard; the frontend claims each code exactly once
            // so the single-use hrsc_ code is never redeemed twice.
            let code = query_value(&url, "code").unwrap_or_default();
            if let Ok(mut pending) = PENDING_RESEARCH_SYNC_CODE.lock() {
                *pending = (!code.is_empty()).then(|| code.clone());
            }
            show_main_window(app);
            let _ = app.emit(NAVIGATE_EVENT, serde_json::json!({ "view": "integrations" }));
            let _ = app.emit(RESEARCH_SYNC_CODE_EVENT, serde_json::json!({
                "code": code,
                "url": url.to_string(),
            }));
        } else {
            // Unknown deep link: FOREGROUND-ONLY. Never navigate (a route reset
            // to the default view strands the user), never drop the activation —
            // an unrecognized hivemindos:// URL still means "bring the app up".
            show_main_window(app);
        }
    }
}

fn query_value(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find_map(|(name, value)| (name == key).then(|| value.into_owned()))
}

// Tray menu clicks are delivered to both the tray menu handler and the
// app-level menu handler, so a single click would toggle twice (open then
// instantly close). Debounce duplicate toggles within this window.
static LAST_QUEEN_VOICE_TOGGLE_MS: AtomicU64 = AtomicU64::new(0);
const QUEEN_VOICE_TOGGLE_DEBOUNCE_MS: u64 = 300;

fn toggle_queen_voice_chat(app: &AppHandle) {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0);
    let last_ms = LAST_QUEEN_VOICE_TOGGLE_MS.swap(now_ms, Ordering::SeqCst);
    if now_ms.saturating_sub(last_ms) < QUEEN_VOICE_TOGGLE_DEBOUNCE_MS {
        log_queen_voice_debug(app, "duplicate menu event ignored");
        return;
    }
    show_main_window(app);
    let emitted = app.emit(QUEEN_VOICE_EVENT, serde_json::json!({ "action": "toggle" }));
    log_queen_voice_debug(app, &format!("toggle clicked, emit_ok={}", emitted.is_ok()));
}

// Opening settings is idempotent, so duplicate tray/menu deliveries need no
// debounce here.
fn open_queen_bee_settings(app: &AppHandle) {
    show_main_window(app);
    let _ = app.emit(QUEEN_SETTINGS_EVENT, serde_json::json!({ "action": "open" }));
}

// Temporary diagnostics for the Queen Bee voice toggle: append one line per
// click so the event path is bisectable without a visible console.
fn log_queen_voice_debug(app: &AppHandle, message: &str) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = fs::create_dir_all(&dir);
    let line = format!("{} {message}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"));
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(dir.join("queen-voice-debug.log")) {
        use std::io::Write;
        let _ = file.write_all(line.as_bytes());
    }
}

#[cfg(debug_assertions)]
fn force_reload_main_window(app: &AppHandle) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.location.reload()");
        let _ = window.set_focus();
    }
}

pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = menu_item(app, "app:about", "About HivemindOS", None::<&str>)?;
    let settings = menu_item(app, "app:settings", "Settings...", Some("CmdOrCtrl+,"))?;
    let updates = menu_item(app, "app:updates", "Check for Updates...", None::<&str>)?;
    let rerun_setup = menu_item(app, "app:rerun-setup", "Re-run Setup...", None::<&str>)?;
    #[cfg(debug_assertions)]
    let force_reload = menu_item(app, "app:force-reload", "Force Reload (Dev)", Some("CmdOrCtrl+Shift+R"))?;
    let services = PredefinedMenuItem::services(app, Some("Services"))?;
    let hide = PredefinedMenuItem::hide(app, Some("Hide HivemindOS"))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit HivemindOS"))?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;

    let fleet = menu_item(app, "nav:agents", "Fleet", Some("CmdOrCtrl+1"))?;
    let work = menu_item(app, "nav:kanban", "Work", Some("CmdOrCtrl+2"))?;
    let brain = menu_item(app, "nav:vault", "Brain", Some("CmdOrCtrl+3"))?;
    let chat = menu_item(app, "nav:chat", "Chat", Some("CmdOrCtrl+4"))?;
    let wallets = menu_item(app, "nav:wallet", "Wallets", Some("CmdOrCtrl+5"))?;
    let more = menu_item(app, "nav:more", "More", Some("CmdOrCtrl+6"))?;
    let palette = menu_item(app, "nav:palette", "Command Palette", Some("CmdOrCtrl+K"))?;
    let new_task = menu_item(app, "nav:new-task", "New Task", Some("CmdOrCtrl+Shift+K"))?;
    let new_chat = menu_item(app, "nav:new-chat", "Agent Chat", Some("CmdOrCtrl+Shift+C"))?;
    let queen_voice = menu_item(app, "queen-voice:toggle", "Voice Chat with Queen Bee", Some("CmdOrCtrl+Shift+V"))?;
    let queen_settings = menu_item(app, "queen-settings:open", "Queen Bee Settings...", None::<&str>)?;

    let show = menu_item(app, "window:show", "Show Main Window", None::<&str>)?;
    let popout_current = menu_item(app, "window:popout-current", "Pop Out Current View", None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "HivemindOS",
                true,
                &[
                    &about,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &updates,
                    &rerun_setup,
                    #[cfg(debug_assertions)]
                    &force_reload,
                    &PredefinedMenuItem::separator(app)?,
                    &services,
                    &PredefinedMenuItem::separator(app)?,
                    &hide,
                    &hide_others,
                    &show_all,
                    &PredefinedMenuItem::separator(app)?,
                    &quit,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &undo,
                    &redo,
                    &PredefinedMenuItem::separator(app)?,
                    &cut,
                    &copy,
                    &paste,
                    &select_all,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Navigation",
                true,
                &[
                    &palette,
                    &PredefinedMenuItem::separator(app)?,
                    &fleet,
                    &work,
                    &brain,
                    &chat,
                    &wallets,
                    &more,
                    &PredefinedMenuItem::separator(app)?,
                    &new_task,
                    &new_chat,
                    &queen_voice,
                    &queen_settings,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &show,
                    &PredefinedMenuItem::separator(app)?,
                    &popout_current,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::bring_all_to_front(app, None)?,
                ],
            )?,
        ],
    )
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
    if let Some(action) = id.strip_prefix("app:") {
        if action == "about" {
            let _ = open_about_window(app, false);
            return;
        } else if action == "settings" {
            emit_route(app, "more");
        } else if action == "updates" {
            let _ = open_about_window(app, true);
            return;
        } else if action == "rerun-setup" {
            show_main_window(app);
            let _ = app.emit(RERUN_SETUP_EVENT, ());
            return;
        } else if action == "force-reload" {
            #[cfg(debug_assertions)]
            force_reload_main_window(app);
            #[cfg(not(debug_assertions))]
            show_main_window(app);
            return;
        }
        show_main_window(app);
        return;
    }
    if let Some(view) = id.strip_prefix("nav:") {
        if view == "palette" {
            let _ = app.emit(OPEN_PALETTE_EVENT, ());
        } else if view == "new-task" {
            emit_route(app, "kanban");
        } else if view == "new-chat" {
            emit_route(app, "chat");
        } else {
            emit_route(app, view);
        }
        show_main_window(app);
        return;
    }
    if let Some(view) = id.strip_prefix("popout:") {
        emit_popout(app, view);
        return;
    }
    if id == "queen-voice:toggle" {
        toggle_queen_voice_chat(app);
    } else if id == "queen-settings:open" {
        open_queen_bee_settings(app);
    } else if id == "window:show" || id == "tray:show" {
        show_main_window(app);
    } else if id == "window:popout-current" {
        emit_current_popout(app);
    } else if id == "tray:palette" {
        show_main_window(app);
        let _ = app.emit(OPEN_PALETTE_EVENT, ());
    } else if id == "tray:quit" {
        app.exit(0);
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let queen_voice = menu_item(app, "queen-voice:toggle", "Voice Chat with Queen Bee", Some("CmdOrCtrl+Shift+V"))?;
    let queen_settings = menu_item(app, "queen-settings:open", "Queen Bee Settings...", None::<&str>)?;
    let show = menu_item(app, "tray:show", "Show HivemindOS", None::<&str>)?;
    let palette = menu_item(app, "tray:palette", "Command Palette", Some("CmdOrCtrl+K"))?;
    let fleet = menu_item(app, "nav:agents", "Fleet", Some("CmdOrCtrl+1"))?;
    let work = menu_item(app, "nav:kanban", "Work", Some("CmdOrCtrl+2"))?;
    let chat = menu_item(app, "nav:chat", "Chat", Some("CmdOrCtrl+4"))?;
    let quit = menu_item(app, "tray:quit", "Quit HivemindOS", None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &queen_voice,
            &queen_settings,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &palette,
            &PredefinedMenuItem::separator(app)?,
            &fleet,
            &work,
            &chat,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("HivemindOS")
        .on_menu_event(|app, event| {
            guard_native_callback("tray menu event", || {
                handle_menu_event(app, event.id().as_ref());
            });
        })
        .on_tray_icon_event(|tray, event| {
            guard_native_callback("tray icon event", || {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            });
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("window-state.json"))
}

fn save_window_state(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Ok(position) = window.outer_position() else {
        return;
    };
    let state = SavedWindowState {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized: window.is_maximized().unwrap_or(false),
    };
    let Some(path) = state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(&state) {
        let _ = fs::write(path, json);
    }
}

pub fn restore_window_state(app: &AppHandle) {
    let Some(path) = state_path(app) else {
        return;
    };
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    let Ok(state) = serde_json::from_str::<SavedWindowState>(&content) else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(state.width, state.height)));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(state.x, state.y)));
    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn save_main_window_state(app: &AppHandle) {
    save_window_state(app);
}

fn route_url(app: &AppHandle, state: &NativeServerState, route: &str) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let _ = state;
        let main_window_route = app.get_webview_window("main").and_then(|window| {
            window
                .url()
                .ok()
                .and_then(|main_url| main_url.join(route).ok())
        });
        let url = dev_backend_route_url(route)
            .or(main_window_route)
            .or_else(|| url::Url::parse(&format!("http://127.0.0.1:5021{route}")).ok())
            .ok_or_else(|| format!("Could not build native route URL for {route}"))?;
        Ok(WebviewUrl::External(url))
    }

    #[cfg(not(debug_assertions))]
    {
        if let Ok(port) = state.port.lock() {
            if let Some(port) = *port {
                let url = url::Url::parse(&format!("http://{NATIVE_BROWSER_HOST}:{port}{route}")).map_err(|error| error.to_string())?;
                return Ok(WebviewUrl::External(url));
            }
        }

        let _ = app;
        Ok(WebviewUrl::App(route.to_string().into()))
    }
}

#[cfg(debug_assertions)]
fn dev_backend_route_url(route: &str) -> Option<url::Url> {
    let content = fs::read_to_string(".next-tauri/dev-server.json").ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    let backend_url = value.get("backendUrl")?.as_str()?;
    url::Url::parse(backend_url).ok()?.join(route).ok()
}

fn open_about_window(app: &AppHandle, check_now: bool) -> Result<(), String> {
    let state = app.state::<NativeServerState>();
    let route = if check_now {
        "/about?native=1&check=1"
    } else {
        "/about?native=1"
    };
    if let Some(window) = app.get_webview_window("about") {
        let _ = window.show();
        let _ = window.unminimize();
        if let WebviewUrl::External(url) = route_url(app, &state, route)? {
            let _ = window.navigate(url);
        }
        let _ = window.set_focus();
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(app, "about", route_url(app, &state, route)?)
        .title("About HivemindOS")
        .inner_size(520.0, 430.0)
        .min_inner_size(520.0, 430.0)
        .resizable(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone()).map_err(|error| error.to_string())?;
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// The floating hologram-companion popover: a small transparent, borderless,
/// always-on-top window showing only the 3D companion (route
/// /companion-popover). `open: true` creates or re-shows it; `open: false`
/// closes it. Mirrors the standalone Ami widget shell's window flags.
#[tauri::command]
pub fn set_companion_popover(
    app: AppHandle,
    state: tauri::State<NativeServerState>,
    open: bool,
) -> Result<(), String> {
    const LABEL: &str = "companion-popover";
    if !open {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.close();
        }
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        route_url(&app, &state, "/companion-popover")?,
    )
    .title("Companion")
    .inner_size(360.0, 560.0)
    .min_inner_size(240.0, 360.0)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    .map_err(|error| error.to_string())?;
    // Fully transparent webview background (macOS) so only the hologram
    // paints — same trick the standalone Ami widget uses.
    let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
    Ok(())
}

#[tauri::command]
pub fn open_route_window(
    app: AppHandle,
    state: tauri::State<NativeServerState>,
    target: RouteWindowTarget,
) -> Result<String, String> {
    let route = if target.url.starts_with('/') {
        target.url
    } else {
        format!("/{}", target.url)
    };
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let label = format!("route-{}-{created_at}", target.view.replace(|c: char| !c.is_ascii_alphanumeric(), "-"));
    let title = format!("HivemindOS - {}", target.view);
    let mut builder = WebviewWindowBuilder::new(&app, label.clone(), route_url(&app, &state, &route)?)
        .title(title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(860.0, 560.0)
        .resizable(true);
    if target.screen_x.is_some() || target.screen_y.is_some() {
        // Drag-out flow: spawn under the pointer. Trust the OS cursor over
        // the webview-reported coordinates; clamp so the title bar stays
        // reachable.
        let (x, y) = cursor_logical_position(&app)
            .or_else(|| match (target.screen_x, target.screen_y) {
                (Some(x), Some(y)) => Some((x, y)),
                _ => None,
            })
            .unwrap_or((POPOUT_GRAB_OFFSET_X, POPOUT_GRAB_OFFSET_Y));
        builder = builder.position((x - POPOUT_GRAB_OFFSET_X).max(0.0), (y - POPOUT_GRAB_OFFSET_Y).max(0.0));
    }
    let live = target.live.unwrap_or(false);
    if live {
        // Keep the origin window focused so its drag gesture stays alive;
        // the follow loop (or the release) focuses this window afterwards.
        builder = builder.focused(false);
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    if !live {
        let _ = window.set_focus();
    }
    #[cfg(target_os = "macos")]
    if live {
        // Native follow: track the physical cursor while the button is held,
        // then focus on release. Runs off-thread; set_position/set_focus are
        // dispatched to the main loop by tauri. Hard 60s cap as a backstop
        // against a stuck button-state read.
        let follow = window.clone();
        std::thread::spawn(move || {
            let started = std::time::Instant::now();
            while macos_drag::left_button_down()
                && started.elapsed() < std::time::Duration::from_secs(60)
            {
                if let Some((x, y)) = macos_drag::cursor_point() {
                    if follow
                        .set_position(tauri::LogicalPosition::new(
                            (x - POPOUT_GRAB_OFFSET_X).max(0.0),
                            (y - POPOUT_GRAB_OFFSET_Y).max(0.0),
                        ))
                        .is_err()
                    {
                        // Window is gone; stop following.
                        return;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
            let _ = follow.set_focus();
        });
    }
    Ok(label)
}

/// Live drag-out follow: reposition a popped-out route window under the OS
/// cursor. Driven by the origin window's pointermove stream while the user
/// keeps holding the drag after the window pops out.
#[tauri::command]
pub fn move_route_window(app: AppHandle, label: String) -> Result<(), String> {
    if !label.starts_with("route-") {
        return Err("not a route window".to_string());
    }
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    if let Some((x, y)) = cursor_logical_position(&app) {
        let _ = window.set_position(tauri::LogicalPosition::new(
            (x - POPOUT_GRAB_OFFSET_X).max(0.0),
            (y - POPOUT_GRAB_OFFSET_Y).max(0.0),
        ));
    }
    Ok(())
}

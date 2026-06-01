use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

use crate::NativeServerState;
#[cfg(not(debug_assertions))]
use crate::NATIVE_HOST;

const NAVIGATE_EVENT: &str = "hivemindos:navigate";
const OPEN_PALETTE_EVENT: &str = "hivemindos:open-command-palette";
const OPEN_POPOUT_EVENT: &str = "hivemindos:open-popout";

#[derive(Deserialize)]
pub struct RouteWindowTarget {
    url: String,
    view: String,
}

#[derive(Deserialize)]
pub struct OpenRouteWindowTarget {
    target: RouteWindowTarget,
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let fleet = menu_item(app, "nav:agents", "Fleet", Some("CmdOrCtrl+1"))?;
    let work = menu_item(app, "nav:kanban", "Work", Some("CmdOrCtrl+2"))?;
    let brain = menu_item(app, "nav:vault", "Brain", Some("CmdOrCtrl+3"))?;
    let chat = menu_item(app, "nav:chat", "Chat", Some("CmdOrCtrl+4"))?;
    let wallets = menu_item(app, "nav:wallet", "Wallets", Some("CmdOrCtrl+5"))?;
    let more = menu_item(app, "nav:more", "More", Some("CmdOrCtrl+6"))?;
    let palette = menu_item(app, "nav:palette", "Command Palette", Some("CmdOrCtrl+K"))?;
    let new_task = menu_item(app, "nav:new-task", "New Task", Some("CmdOrCtrl+Shift+K"))?;
    let new_chat = menu_item(app, "nav:new-chat", "Agent Chat", Some("CmdOrCtrl+Shift+C"))?;

    let popout_chat = menu_item(app, "popout:chat", "Pop Out Chat", None::<&str>)?;
    let popout_work = menu_item(app, "popout:kanban", "Pop Out Work", None::<&str>)?;
    let show = menu_item(app, "window:show", "Show Main Window", None::<&str>)?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Navigate",
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
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &show,
                    &PredefinedMenuItem::separator(app)?,
                    &popout_chat,
                    &popout_work,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

pub fn handle_menu_event(app: &AppHandle, id: &str) {
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
    if id == "window:show" || id == "tray:show" {
        show_main_window(app);
    } else if id == "tray:palette" {
        show_main_window(app);
        let _ = app.emit(OPEN_PALETTE_EVENT, ());
    } else if id == "tray:quit" {
        app.exit(0);
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = menu_item(app, "tray:show", "Show HivemindOS", None::<&str>)?;
    let palette = menu_item(app, "tray:palette", "Command Palette", Some("CmdOrCtrl+K"))?;
    let fleet = menu_item(app, "nav:agents", "Fleet", Some("CmdOrCtrl+1"))?;
    let work = menu_item(app, "nav:kanban", "Work", Some("CmdOrCtrl+2"))?;
    let chat = menu_item(app, "nav:chat", "Chat", Some("CmdOrCtrl+4"))?;
    let quit = menu_item(app, "tray:quit", "Quit HivemindOS", None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
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
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
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

fn route_url(app: &AppHandle, state: tauri::State<NativeServerState>, route: &str) -> Result<WebviewUrl, String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        let _ = state;
        let url = url::Url::parse(&format!("http://127.0.0.1:5021{route}")).map_err(|error| error.to_string())?;
        Ok(WebviewUrl::External(url))
    }

    #[cfg(not(debug_assertions))]
    {
        if let Ok(port) = state.port.lock() {
            if let Some(port) = *port {
                let url = url::Url::parse(&format!("http://{NATIVE_HOST}:{port}{route}")).map_err(|error| error.to_string())?;
                return Ok(WebviewUrl::External(url));
            }
        }

        let _ = app;
        Ok(WebviewUrl::App(route.to_string().into()))
    }
}

#[tauri::command]
pub fn open_route_window(
    app: AppHandle,
    state: tauri::State<NativeServerState>,
    target: OpenRouteWindowTarget,
) -> Result<(), String> {
    let route = if target.target.url.starts_with('/') {
        target.target.url
    } else {
        format!("/{}", target.target.url)
    };
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let label = format!("route-{}-{created_at}", target.target.view.replace(|c: char| !c.is_ascii_alphanumeric(), "-"));
    let title = format!("HivemindOS - {}", target.target.view);
    let window = WebviewWindowBuilder::new(&app, label, route_url(&app, state, &route)?)
        .title(title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(860.0, 560.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

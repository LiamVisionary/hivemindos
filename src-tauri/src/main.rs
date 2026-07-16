#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(feature = "link-app"))]
fn main() {
    if std::env::args().any(|argument| argument == "--beeline-credential-broker") {
        std::process::exit(hivemindos_desktop_lib::run_beeline_credential_broker_cli());
    }
    hivemindos_desktop_lib::run(tauri::generate_context!())
}

#[cfg(feature = "link-app")]
fn main() {
    hivemindos_desktop_lib::run_link(tauri::generate_context!())
}

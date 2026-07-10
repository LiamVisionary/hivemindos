use std::{path::PathBuf, process::Command};

fn git(repo_root: &PathBuf, args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .current_dir(repo_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn set_env(key: &str, value: &str) {
    println!("cargo:rustc-env={key}={}", value.replace(['\n', '\r'], " "));
}

fn main() {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    println!("cargo:rerun-if-changed={}", repo_root.join(".git/HEAD").display());
    println!("cargo:rerun-if-changed={}", repo_root.join(".git/index").display());
    println!("cargo:rerun-if-env-changed=HIVEMINDOS_TAURI_SOURCE_BUILD");

    let commit = git(&repo_root, &["rev-parse", "HEAD"]);
    let branch = git(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let dirty = !git(&repo_root, &["status", "--porcelain"]).is_empty();

    set_env("HIVEMINDOS_GIT_COMMIT", &commit);
    set_env("HIVEMINDOS_GIT_BRANCH", &branch);
    set_env("HIVEMINDOS_GIT_DIRTY", if dirty { "true" } else { "false" });
    set_env(
        "HIVEMINDOS_TAURI_SOURCE_BUILD",
        if std::env::var("HIVEMINDOS_TAURI_SOURCE_BUILD")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            "true"
        } else {
            "false"
        },
    );

    // Declare the app's own #[tauri::command]s so Tauri generates `allow-<cmd>`
    // ACL permissions for them. The EMBEDDED build loads the UI from the local
    // Next server at http://127.0.0.1:<port>, which Tauri treats as a REMOTE
    // (untrusted) origin; remote origins cannot invoke app commands unless a
    // capability grants the generated permission. Without this, first-run setup
    // fails with "Command native_setup_run not allowed by ACL".
    //
    // IMPORTANT: declaring an app manifest makes EVERY app command ACL-gated
    // (even for local content), so this list MUST stay in lockstep with the
    // `tauri::generate_handler![]` list in src/lib.rs — a missing entry breaks
    // that command everywhere. Each name yields an `allow-<command>` permission
    // that capabilities/default.json must then grant.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "desktop_status",
                "native_pairing_host",
                "native_dashboard_unlock_token",
                "dashboard_bootstrap",
                "list_local_directories",
                "create_local_folder",
                "display_local_path",
                "open_deliverable",
                "open_in_app",
                "open_project_terminal",
                "list_aeon_deliverables",
                "list_aeon_outputs",
                "list_aeon_schedules",
                "get_aeon_memory",
                "prepare_aeon_workspace",
                "aeon_repo_sync",
                "list_aeon_runs",
                "get_aeon_run_log",
                "brain_skill_inventory",
                "brain_graph",
                "hive_env_read",
                "fleet_apps_cache",
                "fleet_discover",
                "tailscale_devices",
                "kanban_read",
                "memory_telemetry",
                "phone_prompts",
                "native_boot_status",
                "retry_native_server",
                "runtime_files",
                "runtime_usage",
                "read_local_image_preview",
                "native_setup_run",
                "native_setup_status",
                "scheduler_shared_schedules",
                "obsidian_capture_note",
                "obsidian_agents",
                "obsidian_personal_wallets",
                "dashboard_state_read",
                "dashboard_state_write",
                "download_aeon_deliverable",
                "send_aeon_deliverable",
                "open_route_window",
                "wallet_secret_export_save",
                "slack_session_capture",
                "speech_recognition_available",
                "speech_recognition_start",
                "speech_recognition_stop",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

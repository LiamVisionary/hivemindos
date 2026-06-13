// Tiny supervisor for the claw gateway, launched by the
// `com.hivemindos.claw-gateway` LaunchAgent (see lib.rs install_gateway_login_item).
//
// Why this exists: it is staged as a Tauri externalBin and nested at
// `Contents/MacOS/hivemind-gateway-host` inside the signed, notarized
// HivemindOS.app, signed inside-out under the app's Developer ID. macOS TCC keys
// a launchd job's file-access grant on the CODE IDENTITY of the program launchd
// execs — so running the gateway through this in-bundle helper attributes its
// Downloads/Desktop/Documents access to the app (one-click "Allow HivemindOS"
// prompt, persists across updates) instead of a silent EPERM against a
// self-signed `node`. launchd's RunAtLoad+KeepAlive keep it running at login and
// after the app window closes.
//
// Dependency-free (std only) and `unsafe`-free.

use std::path::PathBuf;
use std::process::Command;

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn main() {
    let mut command = Command::new("/bin/bash");

    // The bundled `claw` binary sits next to this helper in Contents/MacOS.
    // Pass it as CLAW_BINARY so launch-gateway.sh runs the app-signed copy and
    // its filesystem access inherits the app's TCC identity.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled_claw = dir.join("claw");
            if bundled_claw.exists() {
                command.env("CLAW_BINARY", &bundled_claw);
            }
        }
    }

    let Some(home) = home_dir() else {
        eprintln!("hivemind-gateway-host: HOME is unset; cannot locate launch-gateway.sh");
        std::process::exit(1);
    };
    let launcher = home
        .join(".hivemindos")
        .join("claw")
        .join("launch-gateway.sh");
    if !launcher.exists() {
        // Exit non-zero so launchd KeepAlive backs off instead of hot-looping
        // before the claw backend has been installed.
        eprintln!(
            "hivemind-gateway-host: launcher missing at {}",
            launcher.display()
        );
        std::process::exit(1);
    }

    command.env("PORT", "5001").arg(&launcher);

    // Run the launcher and mirror its exit code. launchd supervises THIS process
    // (KeepAlive), so when the gateway dies the helper returns and launchd
    // restarts it.
    match command.status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("hivemind-gateway-host: failed to start launcher: {error}");
            std::process::exit(1);
        }
    }
}

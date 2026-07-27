// Self-healing supervisor for the claw gateway, launched by the
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
// It SUPERVISES rather than one-shots: it rides out a launcher that isn't
// installed yet (fresh install, before setup writes launch-gateway.sh) and
// restarts the gateway if it exits — including losing a 5001 bind race during an
// upgrade while the legacy gateway is still releasing the port. So the gateway
// self-heals without app relaunches, and launchd's KeepAlive is only a backstop
// for a crash of this helper itself.
//
// Dependency-free (std only) and `unsafe`-free.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread::sleep;
use std::time::Duration;

// While the gateway is installed but keeps exiting (e.g. 5001 not yet free),
// pause this long between restarts so a hard-failing gateway can't hot-loop.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
// Consecutive fast failures double the pause up to this cap. A gateway that
// dies instantly on every start (e.g. a native-module ABI mismatch after a
// Homebrew node upgrade) otherwise re-pays a full tsx transpile at ~100% CPU
// every few seconds, forever — and appends a stack trace to the launchd err
// log each time (observed: a 110MB log and a permanently hot core).
const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(300);
// A run shorter than this counts as a fast failure; a longer run resets the
// backoff so transient crashes after healthy uptime still restart quickly.
const HEALTHY_RUN: Duration = Duration::from_secs(60);
// While launch-gateway.sh doesn't exist yet (setup hasn't run), re-check this
// often so the gateway comes up promptly once setup installs it.
const WAIT_FOR_INSTALL: Duration = Duration::from_secs(5);

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

// The `claw` binary bundled next to this helper in Contents/MacOS — passing it as
// CLAW_BINARY makes the gateway's file access inherit the app's TCC identity.
fn bundled_claw() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("claw")))
        .filter(|path| path.exists())
}

fn run_gateway(launcher: &Path, claw: Option<&Path>) -> std::io::Result<std::process::ExitStatus> {
    let mut command = Command::new("/bin/bash");
    command.arg(launcher).env("PORT", "5001");
    if let Some(claw) = claw {
        command.env("CLAW_BINARY", claw);
    }
    command.status()
}

fn main() {
    let Some(home) = home_dir() else {
        eprintln!("hivemind-gateway-host: HOME is unset; cannot locate launch-gateway.sh");
        std::process::exit(1);
    };
    let launcher = home
        .join(".hivemindos")
        .join("claw")
        .join("launch-gateway.sh");
    let claw = bundled_claw();

    let mut backoff = RESTART_BACKOFF;
    loop {
        if !launcher.exists() {
            // The claw backend isn't installed yet (fresh app, before setup) or
            // was removed. Idle-wait and re-check rather than exiting, so the
            // gateway starts on its own once setup writes the launcher.
            sleep(WAIT_FOR_INSTALL);
            continue;
        }
        let started = std::time::Instant::now();
        match run_gateway(&launcher, claw.as_deref()) {
            Ok(status) => eprintln!("hivemind-gateway-host: gateway exited ({status}); restarting"),
            Err(error) => eprintln!("hivemind-gateway-host: failed to start gateway: {error}"),
        }
        if started.elapsed() >= HEALTHY_RUN {
            backoff = RESTART_BACKOFF;
        } else {
            backoff = (backoff * 2).min(RESTART_BACKOFF_MAX);
            eprintln!(
                "hivemind-gateway-host: gateway exited after {:.1}s; next restart in {}s",
                started.elapsed().as_secs_f32(),
                backoff.as_secs()
            );
        }
        sleep(backoff);
    }
}

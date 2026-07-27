//! On-device speech recognition behind a small safe API, one backend per
//! OS: macOS SFSpeechRecognizer (mac.rs) and Windows WinRT
//! Windows.Media.SpeechRecognition (win.rs); other platforms report
//! unavailable. This crate is the app's single unsafe/FFI boundary for the
//! speech bindings — the parent crate forbids `unsafe_code` and only ever
//! calls these safe fns. Callbacks arrive on framework threads with
//! cumulative best-transcription-so-far text.

use std::sync::Arc;

/// Called with (bestTranscriptionSoFar, isFinal) from a framework queue.
pub type PartialHandler = Arc<dyn Fn(String, bool) + Send + Sync>;
/// Runs a closure on the app's main thread (the parent wraps Tauri's
/// `run_on_main_thread`). Only the macOS backend needs it; Windows ignores it.
pub type MainThreadRunner = Arc<dyn Fn(Box<dyn FnOnce() + Send + 'static>) + Send + Sync>;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "windows")]
mod win;

pub fn available() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::available()
    }
    #[cfg(target_os = "windows")]
    {
        win::available()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

/// Start recognizing. macOS: MUST be called on the main thread. Windows:
/// callable from any thread (work moves to a worker thread internally).
pub fn start(session_id: String, on_partial: PartialHandler, run_on_main: MainThreadRunner) {
    #[cfg(target_os = "macos")]
    {
        mac::start(session_id, on_partial, run_on_main);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = run_on_main;
        win::start(session_id, on_partial);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (session_id, on_partial, run_on_main);
    }
}

pub fn stop(session_id: &str) {
    #[cfg(target_os = "macos")]
    {
        mac::stop(session_id);
    }
    #[cfg(target_os = "windows")]
    {
        win::stop(session_id);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = session_id;
    }
}

// On-device speech recognition bridge for Queen voice live captions.
//
// macOS (SFSpeechRecognizer) and Windows (WinRT SpeechRecognition); partial
// transcripts stream to the webview as `hivemindos:speech-partial` events
// ({ sessionId, text, isFinal }). Free, on-device, zero install bloat — the
// OS ships the model — so voice transcription works without an OpenAI key.
// Linux reports unavailable and the webview falls back to Web Speech /
// fleet STT / OpenAI (see src/features/queen-voice/caption-source.ts).
//
// The ObjC FFI lives in the `hivemindos-speech-native` path crate (this
// crate forbids `unsafe_code`; every objc2 Speech binding is unsafe). Its
// objects are main-thread-only, so commands hop over with
// run_on_main_thread; partials arrive on framework queues and are emitted
// straight to the webview.

use tauri::AppHandle;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::Emitter;

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub const SPEECH_PARTIAL_EVENT: &str = "hivemindos:speech-partial";

#[tauri::command]
pub fn speech_recognition_available() -> bool {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        hivemindos_speech_native::available()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[tauri::command]
pub fn speech_recognition_start(app: AppHandle, session_id: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        use std::sync::Arc;

        let event_app = app.clone();
        let event_session = session_id.clone();
        let on_partial: hivemindos_speech_native::PartialHandler =
            Arc::new(move |text: String, is_final: bool| {
                let _ = event_app.emit(
                    SPEECH_PARTIAL_EVENT,
                    serde_json::json!({
                        "sessionId": event_session,
                        "text": text,
                        "isFinal": is_final,
                    }),
                );
            });
        let runner_app = app.clone();
        let run_on_main: hivemindos_speech_native::MainThreadRunner =
            Arc::new(move |work: Box<dyn FnOnce() + Send + 'static>| {
                let _ = runner_app.run_on_main_thread(work);
            });
        app.clone()
            .run_on_main_thread(move || {
                hivemindos_speech_native::start(session_id, on_partial, run_on_main);
            })
            .map_err(|error| format!("speech start failed to reach main thread: {error}"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, session_id);
        Err("Native speech recognition is not available on this platform.".into())
    }
}

#[tauri::command]
pub fn speech_recognition_stop(app: AppHandle, session_id: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        app.run_on_main_thread(move || {
            hivemindos_speech_native::stop(&session_id);
        })
        .map_err(|error| format!("speech stop failed to reach main thread: {error}"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, session_id);
        Ok(())
    }
}

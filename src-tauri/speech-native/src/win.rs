//! Windows backend: WinRT Windows.Media.SpeechRecognition continuous
//! dictation. Free and OS-provided (needs the system speech language pack
//! and the "online speech recognition" privacy setting; `available()` fails
//! closed when the language pack is absent, and a privacy-blocked StartAsync
//! just leaves captions empty — the caller treats this stream as
//! best-effort).
//!
//! Threading: WinRT objects here are agile, so the session registry is a
//! plain global Mutex and `start`/`stop` may be called from any thread. The
//! blocking async `.get()` calls run on a worker thread (never the UI
//! thread), which is COM-initialized as MTA first. Hypothesis events carry
//! only the CURRENT utterance segment, so the handler prepends the finalized
//! segments to keep the crate's cumulative-text contract.

use std::sync::{Arc, Mutex, OnceLock};

use windows::core::Ref;
use windows::Foundation::TypedEventHandler;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
    SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognizer,
};

use crate::PartialHandler;

struct ActiveSession {
    session_id: String,
    recognizer: SpeechRecognizer,
    session: SpeechContinuousRecognitionSession,
}

fn registry() -> &'static Mutex<Option<ActiveSession>> {
    static ACTIVE: OnceLock<Mutex<Option<ActiveSession>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(None))
}

fn ensure_worker_com() {
    // WinRT activation needs an initialized apartment on this thread; MTA
    // suits a worker. RPC_E_CHANGED_MODE (already initialized differently)
    // is fine — activation still works.
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
    // SAFETY: RoInitialize has no memory preconditions; double-init returns
    // an ignorable error code.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
}

pub fn available() -> bool {
    // A system speech language means the recognizer + language pack exist.
    // The privacy toggle is only observable at StartAsync time; a block
    // there degrades to empty captions rather than an error.
    SpeechRecognizer::SystemSpeechLanguage().is_ok()
}

pub fn start(session_id: String, on_partial: PartialHandler) {
    std::thread::spawn(move || {
        ensure_worker_com();
        stop_active();
        if let Err(error) = start_blocking(session_id, on_partial) {
            // Best-effort captions: leave a breadcrumb for `--debug` runs.
            eprintln!("[speech-native] windows start failed: {error}");
        }
    });
}

fn start_blocking(
    session_id: String,
    on_partial: PartialHandler,
) -> windows::core::Result<()> {
    let recognizer = SpeechRecognizer::new()?;
    // No custom constraints = the default free-form dictation grammar.
    recognizer.CompileConstraintsAsync()?.get()?;
    let session = recognizer.ContinuousRecognitionSession()?;

    // Finalized segments so far; hypothesis events only carry the segment
    // in progress.
    let finalized = Arc::new(Mutex::new(String::new()));

    let hypothesis_finalized = finalized.clone();
    let hypothesis_partial = on_partial.clone();
    recognizer.HypothesisGenerated(&TypedEventHandler::new(
        move |_recognizer, args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let segment = args.Hypothesis()?.Text()?.to_string();
                let done = hypothesis_finalized
                    .lock()
                    .map(|text| text.clone())
                    .unwrap_or_default();
                hypothesis_partial(format!("{done} {segment}").trim().to_string(), false);
            }
            Ok(())
        },
    ))?;

    let result_finalized = finalized.clone();
    let result_partial = on_partial.clone();
    session.ResultGenerated(&TypedEventHandler::new(
        move |_session, args: Ref<'_, SpeechContinuousRecognitionResultGeneratedEventArgs>| {
            if let Some(args) = args.as_ref() {
                let segment = args.Result()?.Text()?.to_string();
                if !segment.is_empty() {
                    let mut done = match result_finalized.lock() {
                        Ok(done) => done,
                        Err(_) => return Ok(()),
                    };
                    if done.is_empty() {
                        *done = segment;
                    } else {
                        *done = format!("{done} {segment}");
                    }
                    result_partial(done.clone(), false);
                }
            }
            Ok(())
        },
    ))?;

    session.StartAsync()?.get()?;
    if let Ok(mut slot) = registry().lock() {
        *slot = Some(ActiveSession {
            session_id,
            recognizer,
            session,
        });
    }
    Ok(())
}

pub fn stop(session_id: &str) {
    let matches_active = registry()
        .lock()
        .ok()
        .and_then(|slot| {
            slot.as_ref()
                .map(|session| session.session_id == session_id)
        })
        .unwrap_or(false);
    if !matches_active {
        return;
    }
    let session_id = session_id.to_string();
    std::thread::spawn(move || {
        ensure_worker_com();
        let still_matches = registry()
            .lock()
            .ok()
            .and_then(|slot| {
                slot.as_ref()
                    .map(|session| session.session_id == session_id)
            })
            .unwrap_or(false);
        if still_matches {
            stop_active();
        }
    });
}

fn stop_active() {
    let Some(active) = registry().lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    // Blocking waits are fine: this only ever runs on worker threads.
    if let Ok(operation) = active.session.StopAsync() {
        let _ = operation.get();
    }
    let _ = active.recognizer.Close();
}

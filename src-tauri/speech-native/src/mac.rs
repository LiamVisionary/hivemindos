//! macOS backend: SFSpeechRecognizer fed by an AVAudioEngine input tap.
//! See the crate docs for the threading model.

use std::cell::RefCell;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
use objc2_foundation::NSError;
use objc2_speech::{
    SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
    SFSpeechRecognizer, SFSpeechRecognizerAuthorizationStatus,
};
use std::ptr::NonNull;

use crate::{MainThreadRunner, PartialHandler};

struct ActiveSession {
    session_id: String,
    engine: Retained<AVAudioEngine>,
    request: Retained<SFSpeechAudioBufferRecognitionRequest>,
    task: Retained<SFSpeechRecognitionTask>,
    // Keep the recognizer and the tap block alive for the task's duration.
    _recognizer: Retained<SFSpeechRecognizer>,
    _tap: RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)>,
}

thread_local! {
    // Main-thread-only registry; a single active session at a time (one
    // input tap per engine/input device).
    static ACTIVE: RefCell<Option<ActiveSession>> = const { RefCell::new(None) };
}

fn authorization_status() -> SFSpeechRecognizerAuthorizationStatus {
    // SAFETY: reads a process-wide authorization value; no preconditions.
    unsafe { SFSpeechRecognizer::authorizationStatus() }
}

/// Authorized or not-yet-asked counts as available; the permission prompt
/// fires on the first `start` (alongside the mic prompt the voice call
/// already triggers). Denied/restricted means gone.
pub fn available() -> bool {
    authorization_status() == SFSpeechRecognizerAuthorizationStatus::Authorized
        || authorization_status() == SFSpeechRecognizerAuthorizationStatus::NotDetermined
}

/// Start recognizing; MUST be called on the main thread. Stops any prior
/// session first. If authorization was never asked, prompts and starts on
/// approval (via `run_on_main`).
pub fn start(session_id: String, on_partial: PartialHandler, run_on_main: MainThreadRunner) {
    stop_active();
    if authorization_status() == SFSpeechRecognizerAuthorizationStatus::NotDetermined {
        let handler = RcBlock::new(move |status: SFSpeechRecognizerAuthorizationStatus| {
            if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
                let session_id = session_id.clone();
                let on_partial = on_partial.clone();
                run_on_main(Box::new(move || start_authorized(session_id, on_partial)));
            }
        });
        // SAFETY: the handler block is a valid, retained block; the API
        // copies it and may invoke it on any queue (the closure is Send-safe:
        // it captures only Send + Sync values).
        unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
        return;
    }
    start_authorized(session_id, on_partial);
}

fn start_authorized(session_id: String, on_partial: PartialHandler) {
    if authorization_status() != SFSpeechRecognizerAuthorizationStatus::Authorized {
        return;
    }
    // SAFETY: plain alloc/init of the default-locale recognizer; nil (locale
    // unsupported) surfaces as None.
    let Some(recognizer) = (unsafe { SFSpeechRecognizer::init(SFSpeechRecognizer::alloc()) })
    else {
        return;
    };
    // SAFETY: property read on a valid recognizer.
    if !unsafe { recognizer.isAvailable() } {
        return;
    }
    // SAFETY: plain constructor + property write on the fresh request.
    let request = unsafe {
        let request = SFSpeechAudioBufferRecognitionRequest::new();
        request.setShouldReportPartialResults(true);
        request
    };

    // SAFETY: plain constructors/property reads; `engine` and `input` are
    // valid for the calls below.
    let engine = unsafe { AVAudioEngine::new() };
    let input = unsafe { engine.inputNode() };
    let format = unsafe { input.outputFormatForBus(0) };

    let tap_request = request.clone();
    let tap = RcBlock::new(
        move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
            // SAFETY: the framework passes a valid buffer for the duration
            // of the callback; append is documented thread-safe (the tap
            // runs on an audio queue).
            unsafe { tap_request.appendAudioPCMBuffer(buffer.as_ref()) };
        },
    );
    // SAFETY: bus 0 exists on the input node; the tap block pointer is valid
    // (kept alive in ActiveSession) and the API copies it besides.
    unsafe {
        input.installTapOnBus_bufferSize_format_block(
            0,
            1024,
            Some(&format),
            RcBlock::as_ptr(&tap),
        );
    }
    // SAFETY: prepare/start on the configured engine; failure cleans up the tap.
    let started = unsafe {
        engine.prepare();
        engine.startAndReturnError().is_ok()
    };
    if !started {
        // SAFETY: removing the tap just installed on bus 0.
        unsafe { input.removeTapOnBus(0) };
        return;
    }

    let result_handler = RcBlock::new(
        move |result: *mut SFSpeechRecognitionResult, _error: *mut NSError| {
            // SAFETY: the framework passes either nil or a valid result that
            // outlives the callback; reads are property getters.
            let Some((text, is_final)) = (unsafe {
                result.as_ref().map(|result| {
                    (
                        result.bestTranscription().formattedString().to_string(),
                        result.isFinal(),
                    )
                })
            }) else {
                return;
            };
            on_partial(text, is_final);
        },
    );
    // SAFETY: request and handler are valid; the API copies the block and
    // may invoke it on any queue (the closure captures only Send + Sync
    // values). The returned task is retained in ActiveSession.
    let task = unsafe { recognizer.recognitionTaskWithRequest_resultHandler(&request, &result_handler) };

    ACTIVE.with(|slot| {
        *slot.borrow_mut() = Some(ActiveSession {
            session_id,
            engine,
            request,
            task,
            _recognizer: recognizer,
            _tap: tap,
        });
    });
}

/// Stop the session if it is the active one; MUST be called on the main thread.
pub fn stop(session_id: &str) {
    let matches_active = ACTIVE.with(|slot| {
        slot.borrow()
            .as_ref()
            .map(|session| session.session_id == session_id)
            .unwrap_or(false)
    });
    if matches_active {
        stop_active();
    }
}

fn stop_active() {
    let Some(session) = ACTIVE.with(|slot| slot.borrow_mut().take()) else {
        return;
    };
    // SAFETY: teardown of objects this module created, in the documented
    // order: remove the tap, stop the engine, end the audio request, cancel
    // the task.
    unsafe {
        session.engine.inputNode().removeTapOnBus(0);
        session.engine.stop();
        session.request.endAudio();
        session.task.cancel();
    }
}

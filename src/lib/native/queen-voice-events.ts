import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";

export const QUEEN_VOICE_TOGGLE_EVENT = "hivemindos:queen-bee-voice";
export const QUEEN_SETTINGS_OPEN_EVENT = "hivemindos:queen-bee-settings";

/**
 * Toggles the Queen Bee voice overlay from anywhere in the app (e.g. a "Call"
 * button) by dispatching the same DOM event the overlay already listens for.
 */
export function emitQueenVoiceToggle() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(QUEEN_VOICE_TOGGLE_EVENT));
}

export const QUEEN_VOICE_STATE_EVENT = "hivemindos:queen-bee-voice-state";

// The overlay owns the open/closed state; mirror the latest value here so a
// late-subscribing control (e.g. the chat pill's voice toggle) can read the
// current state synchronously on mount instead of waiting for the next change.
let currentQueenVoiceOpen = false;

/** Whether the Queen Bee voice overlay is currently open. */
export function getQueenVoiceOpen() {
  return currentQueenVoiceOpen;
}

/**
 * Broadcasts the Queen Bee voice overlay's open/closed state so controls
 * outside the overlay (e.g. the "Message the hive" pill's voice toggle) can
 * reflect whether voice mode is active.
 */
export function emitQueenVoiceState(open: boolean) {
  currentQueenVoiceOpen = open;
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(QUEEN_VOICE_STATE_EVENT, { detail: { open } }),
  );
}

/**
 * Subscribes to Queen Bee voice open/close state changes. Returns an unlisten
 * function. The callback is not invoked on subscribe — read getQueenVoiceOpen()
 * for the initial value.
 */
export function listenForQueenVoiceState(onState: (open: boolean) => void) {
  if (typeof window === "undefined") return () => {};
  const handleDomEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ open?: boolean }>).detail;
    onState(Boolean(detail?.open));
  };
  window.addEventListener(QUEEN_VOICE_STATE_EVENT, handleDomEvent);
  return () => window.removeEventListener(QUEEN_VOICE_STATE_EVENT, handleDomEvent);
}

/**
 * Subscribes to Queen Bee voice toggles from the desktop shell (tray icon,
 * app menu) and from in-page CustomEvents so the flow stays testable in a
 * plain browser. Returns an unlisten function.
 */
export async function listenForQueenVoiceToggle(onToggle: () => void) {
  const handleDomEvent = () => onToggle();
  window.addEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);

  if (!isTauriDesktopRuntime()) {
    console.info("[queen-voice] DOM listener registered (browser runtime)");
    return () => window.removeEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenTauri = await listen(QUEEN_VOICE_TOGGLE_EVENT, () => {
      console.info("[queen-voice] tauri toggle event received");
      onToggle();
    });
    const safeUnlistenTauri = createSafeTauriUnlisten(unlistenTauri);
    console.info("[queen-voice] tauri + DOM listeners registered");
    return () => {
      window.removeEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);
      safeUnlistenTauri();
    };
  } catch (listenError) {
    console.error("[queen-voice] tauri listen failed; DOM fallback only", listenError);
    return () => window.removeEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);
  }
}

/**
 * Subscribes to "open Queen Bee settings" requests from the desktop shell
 * (tray icon, app menu) and from in-page CustomEvents so the flow stays
 * testable in a plain browser. Returns an unlisten function.
 */
export async function listenForQueenSettingsOpen(onOpen: () => void) {
  const handleDomEvent = () => onOpen();
  window.addEventListener(QUEEN_SETTINGS_OPEN_EVENT, handleDomEvent);

  if (!isTauriDesktopRuntime()) {
    return () => window.removeEventListener(QUEEN_SETTINGS_OPEN_EVENT, handleDomEvent);
  }
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenTauri = await listen(QUEEN_SETTINGS_OPEN_EVENT, () => onOpen());
    const safeUnlistenTauri = createSafeTauriUnlisten(unlistenTauri);
    return () => {
      window.removeEventListener(QUEEN_SETTINGS_OPEN_EVENT, handleDomEvent);
      safeUnlistenTauri();
    };
  } catch (listenError) {
    console.error("[queen-settings] tauri listen failed; DOM fallback only", listenError);
    return () => window.removeEventListener(QUEEN_SETTINGS_OPEN_EVENT, handleDomEvent);
  }
}

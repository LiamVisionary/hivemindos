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

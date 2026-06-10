import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";

export const QUEEN_VOICE_TOGGLE_EVENT = "hivemindos:queen-bee-voice";

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
    console.info("[queen-voice] tauri + DOM listeners registered");
    return () => {
      window.removeEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);
      try {
        unlistenTauri();
      } catch {
        // The webview may already be tearing down.
      }
    };
  } catch (listenError) {
    console.error("[queen-voice] tauri listen failed; DOM fallback only", listenError);
    return () => window.removeEventListener(QUEEN_VOICE_TOGGLE_EVENT, handleDomEvent);
  }
}

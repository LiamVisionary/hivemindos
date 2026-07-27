import { isTauriDesktopRuntime } from "@/lib/native/desktop-status";
import { createSafeTauriUnlisten } from "@/lib/native/tauri-event-listeners";

// Deep-linked pairing codes from hivemindos.app/research ("Sync memories to
// app" -> hivemindos://research/sync?code=hrsc_...). Codes are single-use with
// a 10-minute TTL, so delivery must be exactly-once: a code is parked until
// one consumer (the Hive Research card) claims it, and a claimed code is never
// handed out again — duplicate deep-link deliveries and replays are dropped
// instead of burning the code twice. The paste-code path in the card stays as
// the manual fallback.

export const RESEARCH_SYNC_CODE_EVENT = "hivemindos:research-sync-code";

export type ResearchSyncCodePayload = {
  code?: string;
  url?: string;
};

let pendingCode: string | null = null;
let claimCode: ((code: string) => void) | null = null;
const claimedCodes = new Set<string>();

/** Parks a code for the Hive Research card (or delivers it live when the card
 *  is mounted). Returns true only for a fresh, plausible, unclaimed code. */
export function stashResearchSyncCode(raw: string | null | undefined): boolean {
  const code = String(raw ?? "").trim();
  if (!code.startsWith("hrsc_") || claimedCodes.has(code)) return false;
  if (claimCode) {
    claimedCodes.add(code);
    pendingCode = null;
    claimCode(code);
  } else {
    pendingCode = code;
  }
  return true;
}

/** The single consumer (the Hive Research card). Subscribing claims any
 *  parked code immediately; codes arriving while mounted are claimed live. */
export function subscribeResearchSyncCode(onCode: (code: string) => void): () => void {
  claimCode = onCode;
  if (pendingCode) {
    const code = pendingCode;
    pendingCode = null;
    claimedCodes.add(code);
    onCode(code);
  }
  return () => {
    if (claimCode === onCode) claimCode = null;
  };
}

/** Always-mounted listener (registered at the dashboard root, since the
 *  Integrations view unmounts when inactive): parks codes from the deep-link
 *  event and collects any code parked natively before this webview was
 *  listening (the app was cold-started by the deep link). onFreshCode fires
 *  once per fresh code so the caller can bring the Integrations view up. */
export async function listenForResearchSyncCodes(onFreshCode: () => void) {
  if (!isTauriDesktopRuntime()) return () => {};
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    // Taking always clears the native parked copy, so a later dashboard
    // reload can never re-redeem a code this webview already consumed.
    const collectNativeParkedCode = async () => {
      const parked = await invoke<string | null>("take_pending_research_sync_code").catch(() => null);
      return stashResearchSyncCode(parked);
    };
    const unlisten = await listen<ResearchSyncCodePayload>(RESEARCH_SYNC_CODE_EVENT, (event) => {
      const fresh = stashResearchSyncCode(event.payload?.code);
      void collectNativeParkedCode().then((alsoFresh) => {
        if (fresh || alsoFresh) onFreshCode();
      });
    });
    if (await collectNativeParkedCode()) onFreshCode();
    return createSafeTauriUnlisten(unlisten);
  } catch {
    return () => {};
  }
}

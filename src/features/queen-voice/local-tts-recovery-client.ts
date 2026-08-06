export type QueenVoiceNoticeKind = "loading" | "ready" | "error";

type RecoveryPayload = {
  status?: "loading" | "ready" | "failed";
  message?: string;
};

type PrewarmPayload = {
  ok?: boolean;
  recovery?: RecoveryPayload;
};

const RECOVERY_POLL_MS = 900;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function prewarmQueenLocalTts(input: {
  signal: AbortSignal;
  onNotice: (message: string, kind: QueenVoiceNoticeKind) => void;
  onHealthy: () => void;
}) {
  while (!input.signal.aborted) {
    const response = await fetch("/api/queen-bee/voice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "speak-prewarm" }),
      cache: "no-store",
      signal: input.signal,
    }).catch(() => null);
    if (!response || input.signal.aborted) return false;
    const payload = (await response.json().catch(() => null)) as PrewarmPayload | null;
    const recovery = payload?.recovery;
    if (recovery?.status === "loading") {
      input.onNotice(recovery.message || "Local voice server not loaded, loading now…", "loading");
      await delay(RECOVERY_POLL_MS, input.signal);
      continue;
    }
    if (recovery?.status === "ready") {
      input.onNotice(recovery.message || "Local voice is ready. She’ll speak on the next reply.", "ready");
      return true;
    }
    if (recovery?.status === "failed") {
      input.onNotice(recovery.message || "Local voice could not be loaded. Replies will stay text-only for now.", "error");
      return false;
    }
    if (payload?.ok !== false) input.onHealthy();
    return payload?.ok !== false;
  }
  return false;
}

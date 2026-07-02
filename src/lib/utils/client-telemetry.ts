type ClientTelemetryEvent = {
  type: string;
  threadId?: string;
  runId?: string;
  payload?: Record<string, unknown>;
};

const telemetryBuffer: ClientTelemetryEvent[] = [];
let telemetryFlushTimer: ReturnType<typeof setTimeout> | null = null;
const TELEMETRY_FLUSH_INTERVAL_MS = 2_000;
const TELEMETRY_MAX_BUFFER = 200;

export function logClientTelemetry(eventType: string, payload: Record<string, unknown> = {}, context: Pick<ClientTelemetryEvent, "threadId" | "runId"> = {}) {
  if (!clientTelemetryEnabled()) return;
  telemetryBuffer.push({
    type: eventType,
    threadId: context.threadId,
    runId: context.runId,
    payload,
  });
  if (telemetryBuffer.length >= TELEMETRY_MAX_BUFFER) {
    void flushClientTelemetry();
    return;
  }
  if (telemetryFlushTimer === null) {
    telemetryFlushTimer = setTimeout(() => {
      telemetryFlushTimer = null;
      void flushClientTelemetry();
    }, TELEMETRY_FLUSH_INTERVAL_MS);
  }
}

async function flushClientTelemetry() {
  if (telemetryBuffer.length === 0) return;
  const batch = telemetryBuffer.splice(0, telemetryBuffer.length);
  try {
    await fetch("/api/telemetry/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Telemetry must never block dashboard work. Dropped local-dev batches are acceptable.
  }
}

// Opt-in even in dev. Always-on dev telemetry meant a POST to the dev server
// every ≤2s plus payload construction on hot paths (the 5s chat-session poll
// builds full-thread summaries), which is real render-thread and dev-server
// load — and none of it exists in production builds, so dev felt slower than
// prod. Flip NEXT_PUBLIC_HIVEMINDOS_CLIENT_TELEMETRY=1 when actively debugging
// chat-history/persistence issues.
//
// Exported so expensive call sites can skip building payloads entirely when
// telemetry is off (arguments evaluate before logClientTelemetry can return).
export function clientTelemetryEnabled() {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NEXT_PUBLIC_HIVEMINDOS_CLIENT_TELEMETRY === "1";
}

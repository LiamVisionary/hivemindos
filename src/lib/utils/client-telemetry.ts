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
  if (!telemetryEnabled()) return;
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

function telemetryEnabled() {
  if (typeof window === "undefined") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * NDJSON event reader for the streaming converse action (one JSON object per
 * line). Reads are pump-based so a caller can race pump() against another
 * signal (barge-in) without ever orphaning bytes: parsing happens inside the
 * shared in-flight promise and parsed events accumulate until take() drains
 * them, so a lost Promise.race can never drop data.
 *
 * Framework-free so the gate can exercise it hermetically.
 */

/** One NDJSON line of the streaming converse action (action "converse-stream"). */
export type ConverseStreamEvent = {
  type?: string;
  /** Incremental spoken-reply text (type "speech"). */
  text?: string;
  ok?: boolean;
  transcript?: string;
  /** Canonical final reply text (type "done"). */
  reply?: string;
  brainLabel?: string;
  brainFallback?: { label?: string; error?: string };
  error?: string;
};

export function voiceTurnBrainMetadata(value: Pick<ConverseStreamEvent, "brainLabel" | "brainFallback">) {
  return {
    ...(value.brainLabel ? { brain: value.brainLabel } : {}),
    ...(value.brainFallback?.label
      ? { brainFallback: { label: value.brainFallback.label, error: String(value.brainFallback.error || "") } }
      : {}),
  };
}

export function voiceRouteFailureMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const detail = error instanceof Error ? error.message.trim() : "";
  if (name === "TimeoutError" || /timed?\s*out|timeout/i.test(detail)) {
    return "The Queen Bee voice route timed out before the selected brain finished.";
  }
  if (detail) return `The Queen Bee voice route failed: ${detail}`;
  return "I couldn't reach the Queen Bee voice route just now.";
}

export type NdjsonEventReader<T> = {
  /** Parsed events since the last take, in arrival order. */
  take(): T[];
  /** Await the next network chunk; false once the stream ends. Every caller
   *  gets the same in-flight promise until it settles. */
  pump(): Promise<boolean>;
};

export function createNdjsonEventReader<T>(
  body: ReadableStream<Uint8Array>,
): NdjsonEventReader<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let events: T[] = [];
  let inFlight: Promise<boolean> | null = null;
  const parseLines = (last: boolean) => {
    const lines = pending.split("\n");
    pending = last ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      try {
        events.push(JSON.parse(raw) as T);
      } catch {
        // Skip malformed lines; terminal events carry the payload.
      }
    }
  };
  return {
    take() {
      const taken = events;
      events = [];
      return taken;
    },
    pump() {
      if (!inFlight) {
        inFlight = (async () => {
          const { value, done } = await reader.read();
          inFlight = null;
          if (done) {
            pending += decoder.decode();
            parseLines(true);
            return false;
          }
          pending += decoder.decode(value, { stream: true });
          parseLines(false);
          return true;
        })();
      }
      return inFlight;
    },
  };
}

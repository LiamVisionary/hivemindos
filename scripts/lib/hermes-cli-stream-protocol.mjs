export const HERMES_CLI_STREAM_EVENT_PREFIX = "__HIVEMIND_HERMES_EVENT__";

function cleanText(value) {
  return typeof value === "string" ? value : "";
}

function comparableText(value) {
  return cleanText(value).replace(/\r\n/g, "\n").trim();
}

/**
 * Parses the private line-delimited protocol emitted by hermes-hivemind-stream.py.
 * Unmarked stdout is intentionally ignored: it is terminal rendering, not chat.
 */
export function createHermesCliStreamProtocol(handlers = {}) {
  let lineBuffer = "";
  let activeSegment = "";
  let segmentEnded = false;
  let sawAssistantDelta = false;

  const emitDelta = (delta) => {
    const text = cleanText(delta);
    if (!text) return;
    if (segmentEnded && activeSegment) {
      handlers.onAssistantReset?.(activeSegment);
      activeSegment = "";
    }
    segmentEnded = false;
    sawAssistantDelta = true;
    activeSegment += text;
    handlers.onAssistantDelta?.(text);
  };

  const handleEvent = (event) => {
    if (!event || typeof event !== "object") return;
    if (event.type === "assistant.delta") {
      emitDelta(event.delta);
      return;
    }
    if (event.type === "assistant.segment_end") {
      segmentEnded = Boolean(activeSegment);
      return;
    }
    if (/^tool\.(?:generating|started|completed|failed)$/.test(String(event.type || ""))) {
      handlers.onProcessEvent?.(event);
    }
  };

  const handleLine = (line) => {
    const markerIndex = line.indexOf(HERMES_CLI_STREAM_EVENT_PREFIX);
    if (markerIndex < 0) return;
    const payload = line.slice(markerIndex + HERMES_CLI_STREAM_EVENT_PREFIX.length);
    try {
      handleEvent(JSON.parse(payload));
    } catch {
      // A malformed private event is ignored; canonical DB reconciliation still runs at exit.
    }
  };

  return {
    push(chunk) {
      lineBuffer += cleanText(chunk);
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    },
    flush() {
      if (lineBuffer) handleLine(lineBuffer);
      lineBuffer = "";
    },
    reconcileFinal(value) {
      const finalText = cleanText(value);
      if (!comparableText(finalText)) return;
      if (!sawAssistantDelta) {
        emitDelta(finalText);
        return;
      }
      if (comparableText(activeSegment) === comparableText(finalText)) return;
      if (finalText.startsWith(activeSegment)) {
        emitDelta(finalText.slice(activeSegment.length));
        return;
      }
      if (activeSegment) handlers.onAssistantReset?.(activeSegment);
      activeSegment = "";
      segmentEnded = false;
      emitDelta(finalText);
    },
    snapshot() {
      return { activeSegment, segmentEnded, sawAssistantDelta };
    },
  };
}

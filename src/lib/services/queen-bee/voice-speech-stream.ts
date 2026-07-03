/**
 * Streaming pieces for the fused converse+speak voice turn: extract the
 * `speech` string from a STRICT-JSON reply while it is still streaming from
 * the model, and split it into sentence-ish chunks sized for incremental TTS
 * (first chunk as soon as the first sentence lands, larger chunks after).
 *
 * Pure and framework-free so the gate can exercise it hermetically.
 */

const SPEECH_KEY = /"speech"\s*:\s*"/;
// The spoken reply is capped at 600 chars everywhere else in the voice
// pipeline (parseVoiceTurnJson); the extractor honors the same cap so a
// runaway model cannot stream minutes of audio.
const MAX_SPEECH_CHARS = 600;

export type SpeechDeltaExtractor = {
  /** Feed a raw text delta; returns the speech-text delta it unlocked ("" often). */
  push(chunk: string): string;
  /** True once the closing quote of the speech string was consumed. */
  readonly finished: boolean;
  /** True once the `"speech": "` key was located in the stream. */
  readonly started: boolean;
  /** Everything emitted so far, unescaped. */
  readonly speech: string;
};

/**
 * Incrementally pulls the `speech` string value out of streamed model text.
 * Tolerates markdown fences or prose before the JSON object; handles JSON
 * escapes split across chunk boundaries. Emits nothing for non-JSON replies
 * (callers fall back to speaking the fully-parsed reply once complete).
 */
export function createSpeechDeltaExtractor(): SpeechDeltaExtractor {
  let raw = "";
  let inString = false;
  let finished = false;
  let started = false;
  let speech = "";
  // Escape state carried across chunk boundaries: "" none, "\\" after a
  // backslash, "\\u" collecting hex digits.
  let escape = "";
  let unicodeDigits = "";

  const push = (chunk: string): string => {
    if (finished || !chunk) return "";
    let emitted = "";
    let index = 0;
    if (!inString) {
      raw += chunk;
      const match = raw.match(SPEECH_KEY);
      if (!match || match.index === undefined) return "";
      inString = true;
      started = true;
      // Continue scanning within THIS accumulated raw after the opening quote.
      const offset = match.index + match[0].length;
      chunk = raw.slice(offset);
      raw = "";
      index = 0;
    }
    for (; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (escape === "\\") {
        if (char === "u") {
          escape = "\\u";
          unicodeDigits = "";
        } else {
          const simple: Record<string, string> = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            n: "\n",
            t: "\t",
            r: "\r",
            b: "\b",
            f: "\f",
          };
          emitted += simple[char] ?? char;
          escape = "";
        }
        continue;
      }
      if (escape === "\\u") {
        unicodeDigits += char;
        if (unicodeDigits.length === 4) {
          const code = Number.parseInt(unicodeDigits, 16);
          emitted += Number.isNaN(code) ? "" : String.fromCharCode(code);
          escape = "";
          unicodeDigits = "";
        }
        continue;
      }
      if (char === "\\") {
        escape = "\\";
        continue;
      }
      if (char === '"') {
        finished = true;
        break;
      }
      emitted += char;
    }
    if (speech.length + emitted.length > MAX_SPEECH_CHARS) {
      emitted = emitted.slice(0, MAX_SPEECH_CHARS - speech.length);
      finished = true;
    }
    speech += emitted;
    return emitted;
  };

  return {
    push,
    get finished() {
      return finished;
    },
    get started() {
      return started;
    },
    get speech() {
      return speech;
    },
  };
}

export type VoiceSpeechEmitter = {
  /** Feed a raw model text delta from the current attempt. */
  onTextDelta(chunk: string): void;
  /**
   * A new model attempt is starting (runtime brain → OpenAI fallback → direct
   * submission). Returns true when the failed attempt already emitted speech —
   * the caller must tell the client to discard what it heard/queued.
   */
  attemptReset(): boolean;
  /**
   * Stream over: `finalReply` is the full text the buffered turn would have
   * spoken. Emits whatever the live extraction did not already cover — the
   * whole reply for non-JSON turns, the delegation-receipt suffix for task
   * turns, nothing when the speech field covered it all.
   */
  finalize(finalReply: string): void;
  /** Everything emitted so far (across finalize, since the last reset). */
  readonly emitted: string;
};

/**
 * Composition used by the streaming converse action: pipes raw model deltas
 * through the speech extractor and guarantees that the concatenation of
 * emitted text equals what the buffered path would have spoken — never more
 * (no re-speaking, no garbled overlap), at worst slightly less when the final
 * parsed reply diverges from the streamed extraction (then the screen text is
 * authoritative and the divergent tail stays unspoken).
 */
export function createVoiceSpeechEmitter(
  emit: (text: string) => void,
): VoiceSpeechEmitter {
  let extractor = createSpeechDeltaExtractor();
  let emitted = "";
  const send = (text: string) => {
    if (!text) return;
    emitted += text;
    emit(text);
  };
  return {
    onTextDelta(chunk) {
      send(extractor.push(chunk));
    },
    attemptReset() {
      const hadEmitted = emitted.length > 0;
      extractor = createSpeechDeltaExtractor();
      emitted = "";
      return hadEmitted;
    },
    finalize(finalReply) {
      const target = (finalReply ?? "").trim();
      if (!target) return;
      if (!emitted) {
        send(target);
        return;
      }
      const spoken = emitted.trim();
      if (target.startsWith(spoken)) {
        send(target.slice(spoken.length));
      }
      // Divergent target: what was already spoken cannot be unspoken, and
      // re-speaking the full reply would garble; the final text is for the
      // screen/history only.
    },
    get emitted() {
      return emitted;
    },
  };
}

export type SentenceChunkerOptions = {
  /** Minimum chars before the FIRST chunk may emit (avoids lone-punctuation
   *  fragments; kept tiny so a short ack like "On it." still ships alone). */
  minFirstChunkChars?: number;
  /** Minimum chars for chunks after the first (fewer, longer synths). */
  minNextChunkChars?: number;
  /** Hard cap: emit at a word boundary even without sentence punctuation. */
  maxChunkChars?: number;
};

export type SentenceChunker = {
  /** Feed a speech delta; returns zero or more chunks ready for TTS. */
  push(delta: string): string[];
  /** End of speech: returns the final remainder chunk, if any. */
  flush(): string[];
};

// A sentence ends at ./!/?/… followed by whitespace or end-of-buffer. The
// whitespace requirement keeps decimals ("$5.50") and version numbers whole.
const SENTENCE_END = /[.!?…]["')\]]?\s/g;

/**
 * Splits streamed speech text into TTS-sized chunks: the first sentence ships
 * alone as soon as it is complete (first audio as early as possible); later
 * text accumulates into larger chunks so long replies do not pay a TTS
 * round-trip per sentence.
 */
export function createSentenceChunker(
  options: SentenceChunkerOptions = {},
): SentenceChunker {
  const minFirst = options.minFirstChunkChars ?? 4;
  const minNext = options.minNextChunkChars ?? 120;
  const maxChunk = options.maxChunkChars ?? 360;
  let buffer = "";
  let emittedAny = false;

  const takeChunk = (endIndex: number) => {
    const chunk = buffer.slice(0, endIndex).trim();
    buffer = buffer.slice(endIndex);
    emittedAny = true;
    return chunk;
  };

  const push = (delta: string): string[] => {
    if (!delta) return [];
    buffer += delta;
    const chunks: string[] = [];
    for (;;) {
      const minChars = emittedAny ? minNext : minFirst;
      let cutAt = -1;
      SENTENCE_END.lastIndex = 0;
      for (
        let match = SENTENCE_END.exec(buffer);
        match;
        match = SENTENCE_END.exec(buffer)
      ) {
        const end = match.index + match[0].length;
        if (end >= minChars) {
          cutAt = end;
          break;
        }
      }
      if (cutAt < 0 && buffer.length >= maxChunk) {
        // No sentence boundary in a very long run: cut at the last word
        // boundary before the cap so the synth text stays natural.
        const space = buffer.lastIndexOf(" ", maxChunk);
        cutAt = space > minChars ? space + 1 : maxChunk;
      }
      if (cutAt < 0) break;
      const chunk = takeChunk(cutAt);
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  };

  const flush = (): string[] => {
    const rest = buffer.trim();
    buffer = "";
    if (!rest) return [];
    emittedAny = true;
    return [rest];
  };

  return { push, flush };
}

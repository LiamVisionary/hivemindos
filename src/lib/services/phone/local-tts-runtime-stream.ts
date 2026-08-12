import type { AgentProfile } from "@/lib/types/agent-runtime";
import { streamLocalTtsPcm } from "@/lib/services/phone/local-tts";
import {
  sseErrorFromPayload,
  sseTextFromPayload,
} from "@/lib/services/phone/runtime-voice-turn";
import {
  errorDetail,
  recordVoiceRunEvent,
} from "@/lib/services/phone/voice-run-route-actions";
import {
  createSentenceChunker,
  sanitizeSpokenVoiceText,
} from "@/lib/services/queen-bee/voice-speech-stream";

function pullSpeakableSegments(
  text: string,
  force = false,
  options?: { fastFirstSegment?: boolean },
) {
  const segments: string[] = [];
  let rest = text;
  for (;;) {
    const match = /[.!?。！？](?:\s+|$)|\n{2,}/.exec(rest);
    if (!match) break;
    const end = match.index + match[0].length;
    const segment = rest.slice(0, end).trim();
    if (segment) segments.push(segment);
    rest = rest.slice(end).trimStart();
  }
  if (!force && options?.fastFirstSegment && !segments.length && rest.length > 42) {
    const clauseMatch = /[,;:](?:\s+|$)|\s+-\s+/.exec(rest);
    const clauseEnd =
      clauseMatch && clauseMatch.index > 18 && clauseMatch.index < 70
        ? clauseMatch.index + clauseMatch[0].length
        : -1;
    const splitAt = clauseEnd > 0 ? clauseEnd : rest.lastIndexOf(" ", 56);
    if (splitAt > 24) {
      const segment = rest.slice(0, splitAt).trim();
      if (segment) segments.push(segment);
      rest = rest.slice(splitAt).trimStart();
    }
  }
  if (!force && rest.length > 90) {
    const clauseAt = Math.max(
      rest.lastIndexOf(",", 90),
      rest.lastIndexOf(";", 90),
      rest.lastIndexOf(":", 90),
      rest.lastIndexOf(" - ", 90),
    );
    const splitAt = clauseAt > 36 ? clauseAt + 1 : rest.lastIndexOf(" ", 76);
    if (splitAt > 36) {
      const segment = rest.slice(0, splitAt).trim();
      if (segment) segments.push(segment);
      rest = rest.slice(splitAt).trimStart();
    }
  }
  if (force && rest.trim()) {
    segments.push(rest.trim());
    rest = "";
  }
  return { rest, segments };
}

function isUnspeakableVoicePreamble(text: string) {
  return /^\s*(?:we need|we are asked|the user asked|i need to|let's|first,|the scenario says|the instruction says)/i.test(
    text,
  );
}

type VoiceStreamFailureRecorder = (
  agent: AgentProfile | null,
  stage: "stream",
  detail: {
    error: unknown;
    appId: string;
    model: string;
    voice: string;
    aborted: boolean;
    spoke: boolean;
  },
) => void;

/** Turn runtime SSE/Queen NDJSON into ordered local-TTS PCM. Kept out of the
 * phone route so transport dispatch and speech streaming remain independently
 * reviewable. */
export async function pipeRuntimeVoiceToLocalTts(options: {
  controller: ReadableStreamDefaultController<Uint8Array>;
  runtimeResponse: Response;
  queenConverseStream: boolean;
  requestOrigin: string;
  appId: string;
  model: string;
  voice: string;
  voiceRunId?: string;
  streamSignal: AbortSignal;
  voiceAgent: AgentProfile | null;
  recordFailure: VoiceStreamFailureRecorder;
  spokenRuntimeFailure: (error: unknown) => string;
}) {
  const runtimeReader = options.runtimeResponse.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pendingText = "";
  let queenChunker = createSentenceChunker();
  let queenSawSpeech = false;
  let spokenText = "";
  let spoke = false;
  let spokeReply = false;

  const speakSegment = async (segment: string) => {
    const text = sanitizeSpokenVoiceText(segment);
    if (!text || isUnspeakableVoicePreamble(text)) return;
    spoke = true;
    const ttsText = /[.!?。！？]$/.test(text) ? text : `${text}.`;
    spokenText = `${spokenText} ${ttsText}`.trim().slice(-2_000);
    const ttsStream = await streamLocalTtsPcm({
      origin: options.requestOrigin,
      appId: options.appId,
      model: options.model,
      voice: options.voice,
      text: ttsText,
      signal: options.streamSignal,
    });
    if (!ttsStream.ok) {
      throw new Error(ttsStream.error || "Local TTS streaming failed.");
    }
    const ttsReader = ttsStream.body.getReader();
    try {
      for (;;) {
        const { value, done } = await ttsReader.read();
        if (done) break;
        if (value?.byteLength) options.controller.enqueue(value);
      }
    } finally {
      await ttsReader.cancel().catch(() => undefined);
    }
  };

  let speechQueue = Promise.resolve();
  const enqueueSpeech = (segment: string) => {
    const queued = speechQueue.then(() => speakSegment(segment));
    speechQueue = queued.catch(() => undefined);
    return queued;
  };
  const acceptText = async (chunk: string, force = false) => {
    pendingText += chunk;
    const pulled = pullSpeakableSegments(pendingText, force, {
      fastFirstSegment: !spoke,
    });
    pendingText = pulled.rest;
    for (const segment of pulled.segments) {
      if (!sanitizeSpokenVoiceText(segment)) continue;
      spokeReply = true;
      await enqueueSpeech(segment);
    }
  };
  const acceptQueenText = async (chunk: string, force = false) => {
    const segments = force ? queenChunker.flush() : queenChunker.push(chunk);
    for (const segment of segments) {
      if (!sanitizeSpokenVoiceText(segment)) continue;
      spokeReply = true;
      await enqueueSpeech(segment);
    }
  };
  const acceptQueenEvent = async (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    let event: {
      type?: string;
      text?: string;
      reply?: string;
      error?: string;
    };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      return;
    }
    if (event.type === "speech" && event.text) {
      queenSawSpeech = true;
      await acceptQueenText(event.text);
      return;
    }
    if (event.type === "status" && event.text) {
      await enqueueSpeech(event.text);
      return;
    }
    if (event.type === "reset") {
      pendingText = "";
      queenChunker = createSentenceChunker();
      queenSawSpeech = false;
      return;
    }
    if (event.type === "done") {
      if (!queenSawSpeech && event.reply) await acceptQueenText(event.reply);
      await acceptQueenText("", true);
      return;
    }
    if (event.type === "error") {
      throw new Error(event.error || "Queen Bee voice turn failed.");
    }
  };

  try {
    while (runtimeReader) {
      const { value, done } = await runtimeReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (options.queenConverseStream) {
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) await acceptQueenEvent(line);
        continue;
      }
      const frames = buffer.split(/\n\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame
          .split(/\n/)
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data === "[DONE]") continue;
        const error = sseErrorFromPayload(data);
        if (error) throw new Error(error);
        await acceptText(sseTextFromPayload(data));
      }
    }
    if (buffer) {
      if (options.queenConverseStream) {
        await acceptQueenEvent(buffer);
      } else {
        const data = buffer
          .split(/\n/)
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        const error = sseErrorFromPayload(data);
        if (error) throw new Error(error);
        await acceptText(sseTextFromPayload(data));
      }
    }
    if (options.queenConverseStream) await acceptQueenText("", true);
    else await acceptText("", true);
    if (!spokeReply) {
      await enqueueSpeech("The agent completed the request without a spoken response.");
    }
    await speechQueue;
    options.controller.close();
    await recordVoiceRunEvent(options.voiceRunId, {
      type: "agent.caption",
      speaker: "agent",
      text: spokenText || "The agent completed the request without a spoken response.",
    });
    await recordVoiceRunEvent(options.voiceRunId, {
      type: "runtime.turn.completed",
      speaker: "system",
      text: "Local TTS runtime turn completed.",
      payload: { appId: options.appId, model: options.model, voice: options.voice },
    });
  } catch (error) {
    options.recordFailure(options.voiceAgent, "stream", {
      error,
      appId: options.appId,
      model: options.model,
      voice: options.voice,
      aborted: options.streamSignal.aborted,
      spoke,
    });
    await recordVoiceRunEvent(options.voiceRunId, {
      type: "runtime.turn.failed",
      speaker: "system",
      text: "Local TTS runtime turn failed.",
      detail: errorDetail(error),
      payload: {
        appId: options.appId,
        model: options.model,
        voice: options.voice,
        spoke,
      },
    });
    if (spokenText) {
      await recordVoiceRunEvent(options.voiceRunId, {
        type: "agent.caption",
        speaker: "agent",
        text: spokenText,
      });
    }
    if (!spokeReply && !options.streamSignal.aborted) {
      try {
        const fallbackText = options.spokenRuntimeFailure(error);
        await enqueueSpeech(fallbackText);
        await recordVoiceRunEvent(options.voiceRunId, {
          type: "agent.caption",
          speaker: "agent",
          text: fallbackText,
        });
        options.controller.close();
        return;
      } catch {
        // Preserve the real stream error when even fallback speech fails.
      }
    }
    options.controller.error(error);
  } finally {
    await runtimeReader?.cancel().catch(() => undefined);
  }
}

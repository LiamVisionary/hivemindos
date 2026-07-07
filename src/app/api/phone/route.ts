import { NextRequest, NextResponse } from "next/server";
import { mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import { join, resolve, sep } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { recordTelemetryBatch } from "@/lib/services/telemetry/local-telemetry";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { readVaultAgentProfiles } from "@/lib/services/obsidian/agent-profiles";
import {
  readGatewayVoiceConfig,
  readGatewayVoiceDeviceStatus,
  ringAgentCall,
  ringStoredPrompt,
  startAgentDashboardCall,
  startAgentMobileCall,
} from "@/lib/services/phone/call-gateway";
import { streamLocalTtsSpeech } from "@/lib/services/phone/local-tts";
import {
  readRuntimeResponseText,
  sseErrorFromPayload,
  sseTextFromPayload,
  voiceOptimizedAgent,
} from "@/lib/services/phone/runtime-voice-turn";
import {
  errorDetail,
  handleVoiceRunGetAction,
  handleVoiceRunPostAction,
  recordVoiceRunEvent,
  voiceRunIdFromBody,
} from "@/lib/services/phone/voice-run-route-actions";
import {
  createRealtimeTranscriptionClientSecret,
  transcribeAudioWithWhisper,
} from "@/lib/services/phone/transcription";
import {
  handleMobileAgentHostComplete,
  handleMobileAgentHostEvent,
  handleMobileAgentHostPoll,
} from "@/lib/services/mobile-agents/host-actions";
import { runChatImageGeneration } from "@/lib/services/chat/image-generation";
import { cacheGeneratedImageForPhone } from "@/lib/services/chat/generated-media-cache";
import { signedGeneratedMediaUrl } from "@/lib/services/chat/generated-media-signing";
import { registerPushDevice } from "@/lib/services/push/mobile-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SHARED CONTRACT — the mobile app + gateway scheduler parse exactly this.
// Call prompts live as one markdown file per prompt with frontmatter:
//   ---
//   title: "Morning briefing"
//   time: "08:30"
//   enabled: true
//   ---
//   <spoken instructions / prompt body>
const PRIMARY_FOLDER = "Operations/Automations/Calls";
const LEGACY_FOLDER = "Claw/Calls";
const VOICE_RUNTIME_TURN_TIMEOUT_MS = 15_000;
const VOICE_RUNTIME_CONNECT_TIMEOUT_MS = 30_000;

type CallPrompt = {
  id: string;
  title: string;
  time: string;
  enabled: boolean;
  instructions: string;
  path: string;
};

type MobileAgentTarget = Pick<
  AgentProfile,
  | "id"
  | "name"
  | "runtime"
  | "workerClass"
  | "beeRole"
  | "machineName"
  | "skillProfilePrompt"
  | "preferredSkillSlugs"
  | "aeonRepo"
  | "aeonRepoName"
  | "aeonBranch"
  | "aeonLocalPath"
  | "aeonMode"
  | "a2aUrl"
  | "localDataDir"
>;

function safeVoiceConfigPayload(
  result: Awaited<ReturnType<typeof readGatewayVoiceConfig>>,
) {
  if (!result.ok || !result.result || typeof result.result !== "object")
    return result;
  const payload = result.result as { config?: Record<string, unknown> };
  const config =
    payload.config && typeof payload.config === "object" ? payload.config : {};
  const voiceProviders = Array.isArray(config.voiceProviders)
    ? config.voiceProviders
        .filter((provider) => provider && typeof provider === "object")
        .map((provider) => {
          const item = provider as Record<string, unknown>;
          return {
            id: typeof item.id === "string" ? item.id : "",
            provider: typeof item.provider === "string" ? item.provider : "",
            voice: typeof item.voice === "string" ? item.voice : "",
          };
        })
        .filter(
          (provider) => provider.id && provider.provider && provider.voice,
        )
    : [];
  const voiceOptions = voiceProviders.length
    ? voiceProviders.map((provider) => ({
        ...provider,
        source: "configured",
      }))
    : [
        {
          id: "runtime-default:openai-realtime",
          provider: "openai-realtime",
          voice: "Gateway default",
          source: "runtime-default",
        },
      ];
  const rawVoiceOptions = Array.isArray(config.voiceOptions)
    ? config.voiceOptions
    : [];
  const extraVoiceOptions = rawVoiceOptions
    .filter((provider) => provider && typeof provider === "object")
    .map((provider) => provider as Record<string, unknown>)
    .filter((provider) => provider.provider === "local-tts")
    .map((provider) => ({
      id: typeof provider.id === "string" ? provider.id : "",
      provider: "local-tts",
      voice: typeof provider.voice === "string" ? provider.voice : "",
      model: typeof provider.model === "string" ? provider.model : undefined,
      appName:
        typeof provider.appName === "string" ? provider.appName : undefined,
      machineName:
        typeof provider.machineName === "string"
          ? provider.machineName
          : undefined,
      source: "configured",
    }))
    .filter((provider) => provider.id && provider.voice);
  const localTtsCandidates = Array.isArray(config.localTtsCandidates)
    ? config.localTtsCandidates.filter(
        (candidate) => candidate && typeof candidate === "object",
      )
    : [];
  const callModes = Array.isArray(config.callModes)
    ? config.callModes.filter((mode) => mode && typeof mode === "object")
    : [];
  const providerCapabilities = Array.isArray(config.providerCapabilities)
    ? config.providerCapabilities.filter((capability) => capability && typeof capability === "object")
    : [];
  const toolBundles = Array.isArray(config.toolBundles)
    ? config.toolBundles.filter((bundle) => bundle && typeof bundle === "object")
    : [];
  const recipes = Array.isArray(config.recipes)
    ? config.recipes.filter((recipe) => recipe && typeof recipe === "object")
    : [];
  return {
    ...result,
    result: {
      ok: true,
      config: {
        enabled: Boolean(config.enabled),
        timezone:
          typeof config.timezone === "string" ? config.timezone : undefined,
        quietHoursEnabled: Boolean(config.quietHoursEnabled),
        quietHoursStart:
          typeof config.quietHoursStart === "string"
            ? config.quietHoursStart
            : undefined,
        quietHoursEnd:
          typeof config.quietHoursEnd === "string"
            ? config.quietHoursEnd
            : undefined,
        maxCallsPerDay:
          typeof config.maxCallsPerDay === "number"
            ? config.maxCallsPerDay
            : undefined,
        dailyEnabled: Boolean(config.dailyEnabled),
        dailyCallTime:
          typeof config.dailyCallTime === "string"
            ? config.dailyCallTime
            : undefined,
        voiceProviders,
        voiceOptions: [...voiceOptions, ...extraVoiceOptions],
        localTtsCandidates,
        callModes,
        providerCapabilities,
        toolBundles,
        recipes,
      },
    },
  };
}

function safeVoiceDeviceStatusPayload(
  result: Awaited<ReturnType<typeof readGatewayVoiceDeviceStatus>>,
) {
  if (!result.ok || !result.result || typeof result.result !== "object")
    return result;
  const payload = result.result as {
    count?: unknown;
    device?: Record<string, unknown>;
    apns?: Record<string, unknown>;
  };
  const device =
    payload.device && typeof payload.device === "object"
      ? payload.device
      : null;
  const apns =
    payload.apns && typeof payload.apns === "object" ? payload.apns : null;
  const missing = Array.isArray(apns?.missing)
    ? apns.missing.filter((item): item is string => typeof item === "string")
    : [];
  return {
    ...result,
    result: {
      ok: true,
      count: typeof payload.count === "number" ? payload.count : device ? 1 : 0,
      device: device
        ? {
            platform:
              typeof device.platform === "string" ? device.platform : undefined,
            environment:
              typeof device.environment === "string"
                ? device.environment
                : undefined,
            appVersion:
              typeof device.appVersion === "string" ? device.appVersion : null,
            lastSeenAt:
              typeof device.lastSeenAt === "string"
                ? device.lastSeenAt
                : undefined,
          }
        : null,
      apns: apns
        ? {
            configured: Boolean(apns.configured),
            missing,
          }
        : { configured: false, missing },
    },
  };
}

function mobileSafeAgentTarget(agent: AgentProfile): MobileAgentTarget {
  return {
    id: agent.id,
    name: agent.name,
    runtime: agent.runtime,
    workerClass: agent.workerClass,
    beeRole: agent.beeRole,
    machineName: agent.machineName,
    skillProfilePrompt: agent.skillProfilePrompt,
    preferredSkillSlugs: agent.preferredSkillSlugs,
    aeonRepo: agent.aeonRepo,
    aeonRepoName: agent.aeonRepoName,
    aeonBranch: agent.aeonBranch,
    aeonLocalPath: agent.aeonLocalPath,
    aeonMode: agent.aeonMode,
    a2aUrl: agent.a2aUrl,
    localDataDir: agent.localDataDir,
  };
}

function hubUrlFromRequest(request: NextRequest, explicit?: unknown) {
  const value = typeof explicit === "string" ? explicit.trim() : "";
  if (value) return value.replace(/\/+$/, "");
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost)
    return `${forwardedProto || request.nextUrl.protocol.replace(/:$/, "")}://${forwardedHost}`.replace(
      /\/+$/,
      "",
    );
  return request.nextUrl.origin.replace(/\/+$/, "");
}

function linkedAbortSignal(signals: AbortSignal[], timeoutMs: number) {
  const activeSignals = signals.filter(Boolean);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return anyAbortSignal([...activeSignals, timeoutSignal]);
}

function anyAbortSignal(signals: AbortSignal[]) {
  const activeSignals = signals.filter(Boolean);
  const abortSignalWithAny = AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  };
  if (typeof abortSignalWithAny.any === "function") {
    return abortSignalWithAny.any(activeSignals);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function spokenVoiceRuntimeFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/missing runtime chat url/i.test(message))
    return "That agent is missing its local runtime URL, so I can't reach it for this call yet.";
  if (/abort|timeout|timed out/i.test(message))
    return "That agent is taking too long to answer. Try again in a moment, or switch to a faster model for calls.";
  return "I couldn't reach that agent for this call. Try again in a moment.";
}

// The voice-turn pipeline (dashboard agent call + telephony, both via this
// route) used to swallow the real upstream error into a generic spoken line,
// leaving no trace to debug from. Record the actual failure so a dropped turn
// has a telemetry breadcrumb (agent, stage, error, whether it was aborted).
function recordVoiceTurnFailure(
  agent: AgentProfile | null,
  stage: "runtime-connect" | "stream",
  detail: { error: unknown; appId?: string; model?: string; voice?: string; aborted?: boolean; spoke?: boolean; httpStatus?: number },
) {
  const reason = detail.error instanceof Error ? detail.error.message : String(detail.error || "");
  console.error(`[phone-voice] ${stage} failed for ${agent?.name || agent?.id || "agent"}: ${reason}`);
  void recordTelemetryBatch([{
    source: "route",
    type: "phone.voice.turn_failed",
    threadId: agent?.id ? `voice-${agent.id}` : null,
    runId: null,
    payload: {
      stage,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      runtime: agent?.runtime ?? null,
      provider: agent?.provider ?? null,
      appId: detail.appId ?? null,
      model: detail.model ?? null,
      voice: detail.voice ?? null,
      aborted: detail.aborted ?? false,
      spoke: detail.spoke ?? false,
      httpStatus: detail.httpStatus ?? null,
      error: reason.slice(0, 600),
    },
  }]).catch(() => undefined);
}

async function fetchRuntimeVoiceTurn(
  request: NextRequest,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const rawAgent =
    body.agent && typeof body.agent === "object"
      ? (body.agent as AgentProfile)
      : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const resolvedAgent = rawAgent ? await resolveVoiceCallAgent(rawAgent) : null;
  const agent = resolvedAgent ? voiceOptimizedAgent(resolvedAgent) : null;
  if (!agent?.id || !agent.runtime)
    throw new Error("A voice-call agent target is required.");
  if (!message) throw new Error("A spoken request is required.");
  await recordVoiceRunEvent(voiceRunIdFromBody(body), {
    type: "runtime.turn.started",
    speaker: "system",
    text: "Runtime voice turn started.",
    payload: {
      agentId: agent.id,
      agentName: agent.name,
      runtime: agent.runtime,
      message,
    },
  });
  return fetch(new URL("/api/chat/agent-runtime", request.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({
      agent,
      messages: [
        {
          role: "system",
          content:
            "You are speaking on a live phone call. Reply directly in one or two short spoken sentences. Do not explain your reasoning, quote instructions, mention providers, or include preambles.",
        },
        { role: "user", content: message },
      ],
      runtimeSessionId:
        typeof body.runtimeSessionId === "string"
          ? body.runtimeSessionId
          : `voice-${agent.id}`,
      agentMode: "act",
      latencyMode: "voice",
    }),
    cache: "no-store",
    signal:
      signal ??
      linkedAbortSignal([request.signal], VOICE_RUNTIME_TURN_TIMEOUT_MS),
  });
}

async function runAgentVoiceTurn(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const voiceRunId = voiceRunIdFromBody(body);
  try {
    const runtimeResponse = await fetchRuntimeVoiceTurn(request, body);
    const text = await readRuntimeResponseText(runtimeResponse);
    const spokenText = text || "The agent completed the request without a spoken response.";
    await recordVoiceRunEvent(voiceRunId, {
      type: "runtime.turn.completed",
      speaker: "system",
      text: "Runtime voice turn completed.",
      payload: { httpStatus: runtimeResponse.status },
    });
    await recordVoiceRunEvent(voiceRunId, {
      type: "agent.caption",
      speaker: "agent",
      text: spokenText,
    });
    return {
      ok: true,
      text: spokenText,
    };
  } catch (error) {
    await recordVoiceRunEvent(voiceRunId, {
      type: "runtime.turn.failed",
      speaker: "system",
      text: "Runtime voice turn failed.",
      detail: errorDetail(error),
    });
    throw error;
  }
}

async function streamAgentVoiceTurn(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const voiceRunId = voiceRunIdFromBody(body);
  let runtimeResponse: Response;
  try {
    runtimeResponse = await fetchRuntimeVoiceTurn(request, body);
  } catch (error) {
    await recordVoiceRunEvent(voiceRunId, {
      type: "runtime.turn.failed",
      speaker: "system",
      text: "Runtime voice turn failed.",
      detail: errorDetail(error),
    });
    throw error;
  }
  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
  });
  if (
    !runtimeResponse.body ||
    !runtimeResponse.headers.get("content-type")?.includes("text/event-stream")
  ) {
    const text = await readRuntimeResponseText(runtimeResponse).catch(
      (error) =>
        error instanceof Error
          ? error.message
          : `Runtime returned HTTP ${runtimeResponse.status}.`,
    );
    await recordVoiceRunEvent(voiceRunId, runtimeResponse.ok
      ? {
        type: "runtime.turn.completed",
        speaker: "system",
        text: "Runtime voice turn completed.",
        payload: { httpStatus: runtimeResponse.status },
      }
      : {
        type: "runtime.turn.failed",
        speaker: "system",
        text: "Runtime voice turn failed.",
        detail: text,
        payload: { httpStatus: runtimeResponse.status },
      });
    if (runtimeResponse.ok) {
      await recordVoiceRunEvent(voiceRunId, {
        type: "agent.caption",
        speaker: "agent",
        text,
      });
    }
    return new Response(
      `data: ${JSON.stringify(runtimeResponse.ok ? { choices: [{ delta: { content: text } }] } : { error: text })}\n\ndata: [DONE]\n\n`,
      {
        status: runtimeResponse.ok ? 200 : runtimeResponse.status,
        headers,
      },
    );
  }
  await recordVoiceRunEvent(voiceRunId, {
    type: "runtime.turn.completed",
    speaker: "system",
    text: "Runtime voice stream handed off.",
    payload: { httpStatus: runtimeResponse.status },
  });
  return new Response(runtimeResponse.body, {
    status: runtimeResponse.status,
    headers,
  });
}

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
  if (
    !force &&
    options?.fastFirstSegment &&
    !segments.length &&
    rest.length > 42
  ) {
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

async function streamAgentLocalTtsAudio(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const localTts =
    body.localTts && typeof body.localTts === "object"
      ? (body.localTts as Record<string, unknown>)
      : {};
  const appId = typeof localTts.appId === "string" ? localTts.appId.trim() : "";
  const model = typeof localTts.model === "string" ? localTts.model.trim() : "";
  const voice = typeof localTts.voice === "string" ? localTts.voice.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const voiceRunId = voiceRunIdFromBody(body);
  const voiceAgent = body.agent && typeof body.agent === "object" ? (body.agent as AgentProfile) : null;
  if (!appId) throw new Error("A validated local TTS app is required.");
  if (!message) throw new Error("A spoken request is required.");
  await recordVoiceRunEvent(voiceRunId, {
    type: "user.transcript",
    speaker: "user",
    text: message,
  });

  const streamAbort = new AbortController();
  const streamSignal = linkedAbortSignal(
    [request.signal, streamAbort.signal],
    120_000,
  );
  const runtimeConnectAbort = new AbortController();
  const runtimeConnectTimeout = setTimeout(
    () => runtimeConnectAbort.abort(),
    VOICE_RUNTIME_CONNECT_TIMEOUT_MS,
  );
  const runtimeResponse = await fetchRuntimeVoiceTurn(
    request,
    body,
    anyAbortSignal([
      request.signal,
      streamAbort.signal,
      runtimeConnectAbort.signal,
    ]),
  ).finally(() => clearTimeout(runtimeConnectTimeout));
  if (!runtimeResponse.ok) {
    const text = await readRuntimeResponseText(runtimeResponse).catch(
      (error) =>
        error instanceof Error
          ? error.message
          : `Runtime returned HTTP ${runtimeResponse.status}.`,
    );
    recordVoiceTurnFailure(voiceAgent, "runtime-connect", {
      error: text || `Runtime returned HTTP ${runtimeResponse.status}.`,
      appId,
      model,
      voice,
      httpStatus: runtimeResponse.status,
    });
    await recordVoiceRunEvent(voiceRunId, {
      type: "runtime.turn.failed",
      speaker: "system",
      text: "Runtime voice turn failed.",
      detail: text || `Runtime returned HTTP ${runtimeResponse.status}.`,
      payload: { httpStatus: runtimeResponse.status },
    });
    return Response.json(
      {
        ok: false,
        error: text || `Runtime returned HTTP ${runtimeResponse.status}.`,
      },
      { status: runtimeResponse.status },
    );
  }
  if (!runtimeResponse.body) {
    return Response.json(
      { ok: false, error: "Runtime returned an empty stream." },
      { status: 502 },
    );
  }

  const encoderHeaders = new Headers();
  encoderHeaders.set("Content-Type", "audio/pcm");
  encoderHeaders.set("Cache-Control", "no-store, no-transform");
  encoderHeaders.set(
    "x-audio-sample-rate",
    String(Number(localTts.sampleRate) || 24_000),
  );
  encoderHeaders.set(
    "x-audio-channels",
    String(Number(localTts.channels) || 1),
  );
  encoderHeaders.set(
    "x-audio-sample-format",
    typeof localTts.sampleFormat === "string" ? localTts.sampleFormat : "pcm16",
  );
  encoderHeaders.set(
    "x-hivemindos-orchestrator",
    "local-tts-agent-audio-stream",
  );
  if (typeof localTts.streamingImplementation === "string") {
    encoderHeaders.set(
      "x-universal-tts-streaming-implementation",
      localTts.streamingImplementation,
    );
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const runtimeReader = runtimeResponse.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let pendingText = "";
      let spokenText = "";
      let spoke = false;

      const speakSegment = async (segment: string) => {
        const text = segment.trim();
        if (!text) return;
        if (isUnspeakableVoicePreamble(text)) return;
        spoke = true;
        const ttsText = /[.!?。！？]$/.test(text) ? text : `${text}.`;
        spokenText = `${spokenText} ${ttsText}`.trim().slice(-2_000);
        const ttsResponse = await streamLocalTtsSpeech({
          origin: request.nextUrl.origin,
          appId,
          model,
          voice,
          text: ttsText,
          utteranceId: `voice_${Date.now()}`,
          signal: streamSignal,
        });
        if (!ttsResponse.ok || !ttsResponse.body) {
          const errorText = await ttsResponse.text().catch(() => "");
          throw new Error(
            errorText || `Local TTS returned HTTP ${ttsResponse.status}.`,
          );
        }
        const ttsReader = ttsResponse.body.getReader();
        try {
          for (;;) {
            const { value, done } = await ttsReader.read();
            if (done) break;
            if (value?.byteLength) controller.enqueue(value);
          }
        } finally {
          await ttsReader.cancel().catch(() => undefined);
        }
      };

      const acceptText = async (chunk: string, force = false) => {
        pendingText += chunk;
        const pulled = pullSpeakableSegments(pendingText, force, {
          fastFirstSegment: !spoke,
        });
        pendingText = pulled.rest;
        for (const segment of pulled.segments) await speakSegment(segment);
      };

      try {
        while (runtimeReader) {
          const { value, done } = await runtimeReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
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
          const data = buffer
            .split(/\n/)
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("\n");
          const error = sseErrorFromPayload(data);
          if (error) throw new Error(error);
          await acceptText(sseTextFromPayload(data));
        }
        await acceptText("", true);
        if (!spoke)
          await speakSegment(
            "The agent completed the request without a spoken response.",
          );
        controller.close();
        await recordVoiceRunEvent(voiceRunId, {
          type: "agent.caption",
          speaker: "agent",
          text: spokenText || "The agent completed the request without a spoken response.",
        });
        await recordVoiceRunEvent(voiceRunId, {
          type: "runtime.turn.completed",
          speaker: "system",
          text: "Local TTS runtime turn completed.",
          payload: { appId, model, voice },
        });
      } catch (error) {
        recordVoiceTurnFailure(voiceAgent, "stream", {
          error,
          appId,
          model,
          voice,
          aborted: streamSignal.aborted,
          spoke,
        });
        await recordVoiceRunEvent(voiceRunId, {
          type: "runtime.turn.failed",
          speaker: "system",
          text: "Local TTS runtime turn failed.",
          detail: errorDetail(error),
          payload: { appId, model, voice, spoke },
        });
        if (spokenText) {
          await recordVoiceRunEvent(voiceRunId, {
            type: "agent.caption",
            speaker: "agent",
            text: spokenText,
          });
        }
        if (!spoke && !streamSignal.aborted) {
          try {
            const fallbackText = spokenVoiceRuntimeFailure(error);
            await speakSegment(fallbackText);
            await recordVoiceRunEvent(voiceRunId, {
              type: "agent.caption",
              speaker: "agent",
              text: fallbackText,
            });
            controller.close();
            return;
          } catch {
            // Fall through to the real stream error when even the fallback cannot be spoken.
          }
        }
        controller.error(error);
      } finally {
        await runtimeReader?.cancel().catch(() => undefined);
      }
    },
    cancel() {
      streamAbort.abort();
    },
  });

  return new Response(readable, { headers: encoderHeaders });
}

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formJsonValue(form: FormData, key: string) {
  const raw = formValue(form, key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function streamLocalTtsAudioTurnFromForm(
  request: NextRequest,
  form: FormData,
) {
  const audio = form.get("audio");
  if (!(audio instanceof Blob))
    throw new Error("An audio recording is required.");
  const signal = linkedAbortSignal([request.signal], 120_000);
  const message = await transcribeAudioWithWhisper(audio, signal);
  const body: Record<string, unknown> = {
    action: "local-tts-agent-audio-stream",
    localTts: formJsonValue(form, "localTts"),
    agent: formJsonValue(form, "agent"),
    machine: formJsonValue(form, "machine"),
    runtimeSessionId: formValue(form, "runtimeSessionId"),
    voiceRunId: formValue(form, "voiceRunId"),
    message,
  };
  const response = await streamAgentLocalTtsAudio(request, body);
  response.headers.set("x-hivemindos-stt-provider", "whisper");
  response.headers.set(
    "x-hivemindos-transcript",
    encodeURIComponent(message.slice(0, 500)),
  );
  return response;
}

async function resolveVoiceCallAgent(
  agent: AgentProfile,
): Promise<AgentProfile> {
  const profiles = await readVaultAgentProfiles().catch(() => []);
  const match = profiles.find(
    (profile) =>
      profile.id === agent.id ||
      (agent.agentId && profile.agentId === agent.agentId),
  );
  return match ? { ...match, ...agent } : agent;
}

// title.toLowerCase(), strip quotes, non-alnum -> "-", trim leading/trailing "-".
function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/["']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "call"
  );
}

function serializePrompt(prompt: {
  title: string;
  time: string;
  enabled: boolean;
  instructions: string;
}): string {
  const title = JSON.stringify(String(prompt.title ?? ""));
  const time = JSON.stringify(String(prompt.time ?? ""));
  const enabled = prompt.enabled ? "true" : "false";
  const body = String(prompt.instructions ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+$/, "");
  return `---\ntitle: ${title}\ntime: ${time}\nenabled: ${enabled}\n---\n\n${body}\n`;
}

function parseQuotedString(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(
        value.startsWith("'")
          ? `"${value.slice(1, -1).replace(/"/g, '\\"')}"`
          : value,
      );
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parsePrompt(content: string): {
  title: string;
  time: string;
  enabled: boolean;
  instructions: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  let title = "";
  let time = "";
  let enabled = true;
  let instructions = normalized;
  if (match) {
    instructions = normalized.slice(match[0].length);
    for (const line of match[1].split("\n")) {
      const sep = line.indexOf(":");
      if (sep < 0) continue;
      const key = line.slice(0, sep).trim().toLowerCase();
      const value = line.slice(sep + 1).trim();
      if (key === "title") title = parseQuotedString(value);
      else if (key === "time") time = parseQuotedString(value);
      else if (key === "enabled")
        enabled = !/^(false|no|0)$/i.test(value.trim());
    }
  }
  return {
    title,
    time,
    enabled,
    instructions: instructions.replace(/^\n+/, "").replace(/\s+$/, ""),
  };
}

// Keep file operations inside the resolved vault. Never escape it.
function safeJoin(vaultPath: string, ...segments: string[]): string {
  const target = resolve(vaultPath, ...segments);
  const root = resolve(vaultPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("Refusing to access a path outside the vault.");
  }
  return target;
}

async function readFolderPrompts(
  vaultPath: string,
  folder: string,
): Promise<CallPrompt[]> {
  const dir = safeJoin(vaultPath, folder);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  // Each entry reads an independent file; nothing depends on a prior read, so
  // run them in parallel. listPrompts re-sorts the result, so push order here
  // does not affect the response. A read failure still skips that entry (null).
  const prompts = await Promise.all(
    entries.map(async (entry): Promise<CallPrompt | null> => {
      if (!entry.toLowerCase().endsWith(".md")) return null;
      const filePath = join(dir, entry);
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        return null;
      }
      const parsed = parsePrompt(content);
      const baseName = entry.replace(/\.md$/i, "");
      const id = parsed.title
        ? slugifyTitle(parsed.title)
        : slugifyTitle(baseName);
      return {
        id,
        title: parsed.title || baseName,
        time: parsed.time,
        enabled: parsed.enabled,
        instructions: parsed.instructions,
        path: filePath,
      };
    }),
  );
  return prompts.filter((prompt): prompt is CallPrompt => prompt !== null);
}

async function listPrompts(vaultPath: string): Promise<CallPrompt[]> {
  const [primary, legacy] = await Promise.all([
    readFolderPrompts(vaultPath, PRIMARY_FOLDER),
    readFolderPrompts(vaultPath, LEGACY_FOLDER),
  ]);
  // Prefer the primary folder when the same prompt id exists in both.
  const byId = new Map<string, CallPrompt>();
  for (const prompt of [...legacy, ...primary]) byId.set(prompt.id, prompt);
  return [...byId.values()].sort(
    (a, b) =>
      (a.time || "").localeCompare(b.time || "") ||
      a.title.localeCompare(b.title),
  );
}

async function findPromptFile(
  vaultPath: string,
  id: string,
): Promise<string | null> {
  const slug = slugifyTitle(id);
  for (const folder of [PRIMARY_FOLDER, LEGACY_FOLDER]) {
    const candidate = safeJoin(vaultPath, folder, `${slug}.md`);
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // try next folder
    }
  }
  // Fall back to matching by parsed/derived id across both folders.
  const prompts = await listPrompts(vaultPath);
  return prompts.find((prompt) => prompt.id === slug)?.path ?? null;
}

async function fetchCollectorJson(
  collectorBase: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${collectorBase}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  return response.json().catch(() => null);
}

function collectorBaseFromRequest(request: NextRequest): string {
  return (
    request.nextUrl.searchParams.get("collectorUrl")?.trim() ||
    "http://127.0.0.1:8787"
  ).replace(/\/+$/, "");
}

// Never throws: degrades to a neutral "unavailable" payload.
async function syncStatus(request: NextRequest, vaultPath: string) {
  const collectorBase = collectorBaseFromRequest(request);
  try {
    const payload = (await fetchCollectorJson(
      collectorBase,
      `/syncthing/folder-status?path=${encodeURIComponent(vaultPath)}`,
    )) as { ok?: boolean; folders?: unknown[]; error?: string } | null;
    if (!payload || payload.ok === false || !Array.isArray(payload.folders)) {
      return { ok: false, available: false, error: payload?.error };
    }
    return { ok: true, available: true, folders: payload.folders };
  } catch {
    return { ok: false, available: false };
  }
}

function errorResponse(error: unknown) {
  // Undici network failures throw TypeError("fetch failed") with the real
  // reason (ECONNREFUSED, ENOTFOUND, …) hidden in `cause` — surface it, or
  // the phone shows a bare "fetch failed" with nothing to act on.
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? `: ${error.cause.message}`
      : "";
  const message =
    error instanceof Error
      ? `${error.message}${cause}`
      : "Phone request failed.";
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

/**
 * Phone-facing image generation. Runs the same orchestration as the
 * dashboard's /api/chat/image-generation, then pulls every result image onto
 * hub disk (connected apps often answer with hub-only URLs like
 * http://127.0.0.1:7860/… that the phone can't reach) and answers with
 * short-lived signed /api/chat/generated-media URLs. The phone downloads each
 * image once over the tailnet and stores it locally with the thread.
 */
async function runPhoneImageGeneration(
  request: NextRequest,
  body: Record<string, unknown>,
) {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const prompt = text(body.prompt);
  if (!prompt) {
    return {
      payload: { ok: false, error: "An image prompt is required." },
      status: 400,
    };
  }
  const result = await runChatImageGeneration({
    origin: request.nextUrl.origin,
    prompt,
    appId: text(body.appId) || undefined,
    serviceKind: text(body.serviceKind) || undefined,
    model: text(body.model) || undefined,
    runId: text(body.runId) || undefined,
  });
  if (!result.ok) {
    return {
      payload: { ok: false, error: result.error },
      status: result.status,
    };
  }

  const images: {
    url: string;
    width?: number;
    height?: number;
    seed?: string | number;
  }[] = [];
  let firstFailure = "";
  for (const image of result.images) {
    try {
      const path = await cacheGeneratedImageForPhone(image.url);
      images.push({
        url: await signedGeneratedMediaUrl(path),
        width: image.width,
        height: image.height,
        seed: image.seed,
      });
    } catch (error) {
      firstFailure ||=
        error instanceof Error
          ? error.message
          : "Generated image could not be prepared for the phone.";
    }
  }
  if (images.length === 0) {
    return {
      payload: {
        ok: false,
        error:
          firstFailure ||
          "Generated images could not be prepared for the phone.",
      },
      status: 502,
    };
  }
  return {
    payload: {
      ok: true,
      prompt: result.prompt,
      app: result.app,
      endpoint: result.endpoint,
      images,
      rawStatus: result.rawStatus,
    },
    status: 200,
  };
}

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action");

    if (action === "voice-config") {
      const result = await readGatewayVoiceConfig(request.nextUrl.origin);
      return NextResponse.json(safeVoiceConfigPayload(result), {
        status: result.ok ? 200 : 502,
      });
    }

    if (action === "device-status") {
      const result = await readGatewayVoiceDeviceStatus();
      return NextResponse.json(safeVoiceDeviceStatusPayload(result), {
        status: result.ok ? 200 : 502,
      });
    }

    const voiceRunResponse = await handleVoiceRunGetAction(action, request);
    if (voiceRunResponse) return voiceRunResponse;

    const vaultPath = resolveObsidianVaultPath(
      request.nextUrl.searchParams.get("vaultPath") ?? undefined,
    );

    if (action === "agent-targets") {
      const agents = (await readVaultAgentProfiles(vaultPath)).map(
        mobileSafeAgentTarget,
      );
      return NextResponse.json({ ok: true, agents, vaultPath });
    }

    if (action === "sync-status") {
      const status = await syncStatus(request, vaultPath);
      return NextResponse.json({ ...status, vaultPath });
    }

    const prompts = await listPrompts(vaultPath);
    return NextResponse.json({ ok: true, prompts, vaultPath });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      if (formValue(form, "action") === "local-tts-audio-turn-stream") {
        return streamLocalTtsAudioTurnFromForm(request, form);
      }
      throw new Error("Unsupported multipart phone action.");
    }
    const body = await request.json().catch(() => ({}));
    const writableVaultPath = () =>
      resolveObsidianVaultPath(
        body.vaultPath ??
          request.nextUrl.searchParams.get("vaultPath") ??
          undefined,
        { requireWritable: true },
      );

    const voiceRunResponse = await handleVoiceRunPostAction(body);
    if (voiceRunResponse) return voiceRunResponse;

    if (body.action === "save") {
      const vaultPath = writableVaultPath();
      const title = String(body.title ?? "").trim();
      if (!title) throw new Error("A title is required.");
      const time = String(body.time ?? "").trim();
      const enabled = Boolean(body.enabled);
      const instructions = String(body.instructions ?? "");
      const slug = slugifyTitle(title);

      // If the prompt is being renamed, drop the old slug file so we never duplicate.
      if (body.id) {
        const previous = await findPromptFile(vaultPath, String(body.id));
        const nextPath = safeJoin(vaultPath, PRIMARY_FOLDER, `${slug}.md`);
        if (previous && resolve(previous) !== resolve(nextPath)) {
          await unlink(previous).catch(() => undefined);
        }
      }

      const dir = safeJoin(vaultPath, PRIMARY_FOLDER);
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `${slug}.md`);
      await writeFile(
        filePath,
        serializePrompt({ title, time, enabled, instructions }),
        "utf8",
      );
      return NextResponse.json({
        ok: true,
        prompt: {
          id: slug,
          title,
          time,
          enabled,
          instructions,
          path: filePath,
        },
      });
    }

    if (body.action === "delete") {
      const vaultPath = writableVaultPath();
      const id = String(body.id ?? "").trim();
      if (!id) throw new Error("An id is required.");
      const filePath = await findPromptFile(vaultPath, id);
      if (filePath) await unlink(filePath).catch(() => undefined);
      return NextResponse.json({ ok: true, id });
    }

    if (body.action === "toggle") {
      const vaultPath = writableVaultPath();
      const id = String(body.id ?? "").trim();
      if (!id) throw new Error("An id is required.");
      const filePath = await findPromptFile(vaultPath, id);
      if (!filePath) throw new Error("Call prompt not found.");
      const parsed = parsePrompt(await readFile(filePath, "utf8"));
      const enabled =
        body.enabled === undefined ? !parsed.enabled : Boolean(body.enabled);
      await writeFile(
        filePath,
        serializePrompt({ ...parsed, enabled }),
        "utf8",
      );
      return NextResponse.json({ ok: true, id: slugifyTitle(id), enabled });
    }

    if (body.action === "ring") {
      const id = String(body.id ?? "").trim();
      if (!id) throw new Error("An id is required.");
      const result = await ringStoredPrompt(id);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.action === "ring-agent") {
      const agent =
        body.agent && typeof body.agent === "object" ? body.agent : {};
      const machine =
        body.machine && typeof body.machine === "object"
          ? body.machine
          : undefined;
      const result = await ringAgentCall({ agent, machine });
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.action === "dashboard-agent-call") {
      const agent =
        body.agent && typeof body.agent === "object" ? body.agent : {};
      const machine =
        body.machine && typeof body.machine === "object"
          ? body.machine
          : undefined;
      const result = await startAgentDashboardCall(
        { agent, machine },
        hubUrlFromRequest(request, body.hubUrl),
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    if (body.action === "mobile-agent-call") {
      const rawAgent =
        body.agent && typeof body.agent === "object"
          ? (body.agent as AgentProfile)
          : ({} as AgentProfile);
      const agent = rawAgent.id
        ? await resolveVoiceCallAgent(rawAgent)
        : rawAgent;
      const machine =
        body.machine && typeof body.machine === "object"
          ? body.machine
          : undefined;
      const callMode = body.callMode === "cloud" ? "cloud" : "byok";
      const result = await startAgentMobileCall(
        { agent, machine },
        hubUrlFromRequest(request, body.hubUrl),
        callMode,
      );
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    // Register this phone's Expo push token so the hub can alert it about new
    // spend approvals (device-token gated by the /api proxy, like every action).
    if (body.action === "register-push") {
      const token = typeof body.token === "string" ? body.token : "";
      const platform = typeof body.platform === "string" ? body.platform : "ios";
      await registerPushDevice(token, platform);
      return NextResponse.json({ ok: true });
    }

    // Phone-hosted mobile agents: the phone app heartbeats/claims queued chat
    // jobs, streams run events, and posts the final result back to the hub.
    if (body.action === "agent-host-poll") {
      const result = await handleMobileAgentHostPoll(body);
      return NextResponse.json(result.payload, { status: result.status });
    }

    if (body.action === "agent-host-event") {
      const result = await handleMobileAgentHostEvent(body);
      return NextResponse.json(result.payload, { status: result.status });
    }

    if (body.action === "agent-host-complete") {
      const result = await handleMobileAgentHostComplete(body);
      return NextResponse.json(result.payload, { status: result.status });
    }

    if (body.action === "image-generation") {
      const result = await runPhoneImageGeneration(request, body);
      return NextResponse.json(result.payload, { status: result.status });
    }

    if (body.action === "agent-voice-turn") {
      return NextResponse.json(await runAgentVoiceTurn(request, body));
    }

    if (body.action === "agent-voice-turn-stream") {
      return streamAgentVoiceTurn(request, body);
    }

    if (body.action === "local-tts-agent-audio-stream") {
      return streamAgentLocalTtsAudio(request, body);
    }

    if (body.action === "local-tts-stt-client-secret") {
      // "turns" (default): server-VAD session that auto-commits utterances.
      // "continuous": streaming pre-commit deltas, caller ends turns itself.
      return NextResponse.json(
        await createRealtimeTranscriptionClientSecret(
          body.mode === "continuous" ? "continuous" : "turns",
        ),
      );
    }

    if (body.action === "local-tts-speech-stream") {
      const localTts =
        body.localTts && typeof body.localTts === "object"
          ? (body.localTts as Record<string, unknown>)
          : {};
      const appId =
        typeof localTts.appId === "string" ? localTts.appId.trim() : "";
      const model =
        typeof localTts.model === "string" ? localTts.model.trim() : "";
      const voice =
        typeof localTts.voice === "string" ? localTts.voice.trim() : "";
      const text = typeof body.input === "string" ? body.input.trim() : "";
      if (!appId) throw new Error("A validated local TTS app is required.");
      if (!text) throw new Error("Speech text is required.");
      return streamLocalTtsSpeech({
        origin: request.nextUrl.origin,
        appId,
        model,
        voice,
        text,
        utteranceId:
          typeof body.utteranceId === "string" ? body.utteranceId : undefined,
      });
    }

    if (body.action === "rescan") {
      const vaultPath = writableVaultPath();
      const collectorBase = collectorBaseFromRequest(request);
      try {
        const payload = (await fetchCollectorJson(
          collectorBase,
          "/syncthing/rescan",
          {
            method: "POST",
            body: JSON.stringify({ path: vaultPath }),
          },
        )) as { ok?: boolean; error?: string } | null;
        if (!payload || payload.ok === false) {
          return NextResponse.json({
            ok: false,
            available: Boolean(payload),
            error: payload?.error ?? "Syncthing rescan unavailable.",
          });
        }
        return NextResponse.json({ ok: true, available: true });
      } catch {
        return NextResponse.json({
          ok: false,
          available: false,
          error: "Syncthing rescan unavailable.",
        });
      }
    }

    throw new Error(`Unknown action: ${String(body.action ?? "")}`);
  } catch (error) {
    return errorResponse(error);
  }
}

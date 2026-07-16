import { HIVEMIND_OS_RUNTIME, getRuntimeUrl, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { proxyInput, proxyOutput } from "@/lib/services/agent-security-proxy";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import {
  isBankrAdaptiveModel,
  isBankrLlmProfile,
  resolveAdaptiveBankrLlmModels,
} from "@/lib/services/bankr-llm";
import { isHivemindosWalletPaidModelProfile } from "@/lib/services/hivemindos-wallet-paid-models";
import { isHiveComputeProfile } from "@/lib/services/hive-compute-marketplace";
import {
  buildHivemindPromptEnvelope,
  prependHivemindSystemMessage,
} from "@/lib/services/chat/hivemind-system-prompt";
import {
  AGENT_COLD_START_EVENT_TYPE,
  inferredModalColdStartProcessEvent,
  recordAgentRuntimeWarm,
} from "@/lib/services/chat/agent-cold-start";
import { resolveAdaptiveOpenRouterModel } from "@/lib/services/chat/adaptive-openrouter-models";
import { flushChannelMarkup } from "@/lib/services/chat/channel-markup";
import { normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import { normalizeChatReasoningEffort } from "@/lib/types/chat-reasoning-effort";
import { isAdaptiveProviderProfile, resolveAdaptiveRoutePlan } from "@/lib/services/chat/adaptive-model-router";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { resolveLmStudioFleetBaseUrl } from "@/lib/services/fleet/lmstudio-model-hosts";
import {
  createChannelMarkupState,
  extractChunk,
  extractReasoningChunk,
  isTerminalOpenAiStreamMetadata,
  routeChannelMarkupDelta,
  safeAgentEnv,
  ssePayload,
  type IncomingMessage,
} from "./messages";
import type { ChatMediaArtifact } from "./media-artifacts";
import { recordRuntimeTelemetry, telemetryPayloadForProfile, type RuntimeRouteTelemetry } from "./route-telemetry";
import {
  buildWalletTools,
  interactiveRuntimeLockKey,
  readWorkspaceSnapshot,
  recordChatHoney,
  releaseInteractiveRuntime,
  reserveInteractiveRuntime,
  RUNTIME_FETCH_TIMEOUT_MS,
  runtimeFetchError,
  runtimeStreamErrorMessage,
  workspaceChangeSummary,
  type AgentMode,
} from "./runtime-helpers";
import {
  isAdaptiveOpenRouterProfile,
  isOpenAICompatibleRuntime,
  isOpenRouterProvider,
  openRouterCompatibleProfile,
  profileWithResolvedModel,
} from "./openai-compat";
import { streamAdaptiveHermesOpenRouterRuntime } from "./stream-adaptive-hermes";
import { streamOpenAICompatibleRuntime } from "./stream-openai-compatible";
import { runtimeProcessEventsSsePayload } from "./process-events";
import { isXaiOAuthProvider } from "@/lib/services/xai-oauth-inference-contract";
import { resolveXaiOAuthRuntimeProfile } from "@/lib/services/xai-oauth-inference";
import { runtimeSessionErrorResponse } from "./runtime-session-response";

export async function streamHttpRuntime(
  profile: AgentProfile,
  messages: IncomingMessage[],
  userText: string,
  sharedVault: SharedVaultConfig | null,
  agentMode: AgentMode,
  workingDirectory?: string,
  wallet?: AgentWalletConfig,
  honeyLedgerEnabled = false,
  runtimeSessionId = "",
  telemetry?: RuntimeRouteTelemetry,
  taskRetrievalContext = "",
  sharedBrainMemoryContext = "",
  vaultPromptContext = "",
  permissionMode = "manual",
  mediaArtifacts: ChatMediaArtifact[] = [],
  reasoningEffort: unknown = "medium",
) {
  const normalizedPermissionMode = normalizeChatPermissionMode(permissionMode);
  const normalizedReasoningEffort = normalizeChatReasoningEffort(reasoningEffort);
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return runtimeSessionErrorResponse(runtimeSessionId, inputCheck.reason ?? "Message blocked by security policy", 400, "blocked");
  }
  if (isXaiOAuthProvider(profile.provider)) {
    try {
      const xaiProfile = await resolveXaiOAuthRuntimeProfile(profile);
      return streamOpenAICompatibleRuntime(xaiProfile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
    } catch (error) {
      return runtimeSessionErrorResponse(runtimeSessionId, error instanceof Error ? error.message : "xAI OAuth setup is incomplete.", 502);
    }
  }
  if (isAdaptiveProviderProfile(profile)) {
    try {
      const adaptiveRoutePlan = await resolveAdaptiveRoutePlan(profile, messages);
      if (adaptiveRoutePlan.profile.runtime === HIVEMIND_OS_RUNTIME) {
        return streamOpenAICompatibleRuntime(adaptiveRoutePlan.profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, adaptiveRoutePlan, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
      }
      // A Hermes-selected plan is always OpenRouter-backed. Re-shape to the
      // adaptive-OpenRouter profile instead of pinning the single selected
      // model, so the run gets the full optimized loop: per-message failover,
      // reliability recording, session resume on retry, keepalives, and
      // quality gates. The fallback model is read from adaptiveRouting.
      profile = { ...profile, provider: "openrouter", model: "adaptive" };
    } catch (error) {
      return runtimeSessionErrorResponse(runtimeSessionId, error instanceof Error ? error.message : "Adaptive provider routing failed.", 502);
    }
  }
  if (isBankrLlmProfile(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
  }
  if (isHivemindosWalletPaidModelProfile(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
  }
  if (isHiveComputeProfile(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
  }
  if (isOpenAICompatibleRuntime(profile)) {
    return streamOpenAICompatibleRuntime(profile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
  }
  if (isOpenRouterProvider(profile) && !isAdaptiveOpenRouterProfile(profile)) {
    try {
      const openRouterProfile = await openRouterCompatibleProfile(profile);
      return streamOpenAICompatibleRuntime(openRouterProfile, messages, userText, sharedVault, agentMode, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, undefined, vaultPromptContext, normalizedPermissionMode, mediaArtifacts, normalizedReasoningEffort);
    } catch (error) {
      return runtimeSessionErrorResponse(runtimeSessionId, error instanceof Error ? error.message : "OpenRouter model selection failed.", 502);
    }
  }
  let runtimeProfile = profile;
  let adaptiveResolvedModel = "";
  if (isBankrAdaptiveModel(profile)) {
    try {
      const [resolvedModel] = await resolveAdaptiveBankrLlmModels(profile, messages);
      runtimeProfile = profileWithResolvedModel(profile, resolvedModel);
    } catch (error) {
      return runtimeSessionErrorResponse(runtimeSessionId, error instanceof Error ? error.message : "Adaptive Bankr model selection failed.", 502);
    }
  }
  if (isAdaptiveOpenRouterProfile(profile) && profile.runtime !== "hermes") {
    try {
      adaptiveResolvedModel = await resolveAdaptiveOpenRouterModel(profile, messages);
      runtimeProfile = profileWithResolvedModel(profile, adaptiveResolvedModel);
    } catch (error) {
      return runtimeSessionErrorResponse(runtimeSessionId, error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed.", 502);
    }
  }
  const url = getRuntimeUrl(profile, profile.chatPath || "/chat");
  const lockKey = interactiveRuntimeLockKey(profile, url, telemetry?.chatStorageKey || runtimeSessionId);
  if (!reserveInteractiveRuntime(lockKey)) {
    const message = `${profile.name || profile.runtime} is already running another interactive request at ${url}. Wait for that run to finish before sending another chat, scheduler run, or Kanban assignment.`;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.busy", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
    });
    return runtimeSessionErrorResponse(runtimeSessionId, message, 409, "blocked");
  }
  if (isAdaptiveOpenRouterProfile(profile) && profile.runtime === "hermes") {
    return streamAdaptiveHermesOpenRouterRuntime(profile, messages, userText, sharedVault, agentMode, url, lockKey, workingDirectory, wallet, honeyLedgerEnabled, runtimeSessionId, telemetry, taskRetrievalContext, sharedBrainMemoryContext, vaultPromptContext);
  }
  const vaultContext = vaultPromptContext;
  const promptEnvelope = buildHivemindPromptEnvelope({
    profile: runtimeProfile,
    agentMode,
    workingDirectory,
    vaultContext,
    sharedBrainMemoryContext,
    taskRetrievalContext,
    wallet,
    runtimeSessionId,
  });
  const hermesSlashCommand = profile.runtime === "hermes" && /^\/[^\s/]*(?:\s|$)/.test(inputCheck.text.trim());
  const runtimeMessages = hermesSlashCommand ? messages : prependHivemindSystemMessage(messages, promptEnvelope);
  const runtimeMessage = inputCheck.text;
  const runtimeSessionKey = runtimeProfile.sessionKey?.trim() || runtimeSessionId || undefined;
  // Local models hosted on a fleet machine resolve automatically: the hosting
  // collector proxies LM Studio and OpenAI-compatible server ports, and the
  // agent's Hermes run gets that base URL for this turn only.
  const lmStudioFleetHost = profile.runtime === "hermes" && telemetry?.request
    ? await resolveLmStudioFleetBaseUrl(runtimeProfile, profile.gatewayUrl || "", telemetry.request.url).catch(() => null)
    : null;
  if (lmStudioFleetHost) {
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "Fleet model routing",
      `${runtimeProfile.model} is hosted on ${lmStudioFleetHost.machineName}; routing this run to that local model server.`,
    ).catch(() => undefined);
  }
  const workspaceBefore = await readWorkspaceSnapshot(workingDirectory);
  let upstream: Response;
  const fetchStartedAt = Date.now();
  let fetchSettled = false;
  const slowTimers = [10_000, 30_000, 60_000].map((waitMs) => setTimeout(() => {
    if (fetchSettled) return;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.slow", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      waitMs,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
  }, waitMs));
  try {
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.start", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      contextLength: hermesSlashCommand ? 0 : promptEnvelope.systemContext.length,
      messageCount: runtimeMessages.length,
      runtimeMessageLength: runtimeMessage.length,
    });
    const coldStartEvent = inferredModalColdStartProcessEvent(runtimeProfile);
    if (coldStartEvent) {
      recordRuntimeTelemetry(telemetry, "agent_runtime.http.cold_start", {
        ...telemetryPayloadForProfile(runtimeProfile),
        url,
        model: runtimeProfile.model || null,
        source: "local-success-window",
      });
      await appendRuntimeChatSessionEvent(
        runtimeSessionId,
        coldStartEvent.label,
        coldStartEvent.detail,
        { type: AGENT_COLD_START_EVENT_TYPE },
      ).catch(() => undefined);
    }
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
      },
      body: JSON.stringify({
        agent: runtimeProfile,
        agentId: runtimeProfile.agentId || runtimeProfile.id,
        sessionKey: runtimeSessionKey,
        provider: runtimeProfile.provider || undefined,
        model: runtimeProfile.model || undefined,
        agentEnv: safeAgentEnv(runtimeProfile.agentEnv),
        rawUserMessage: inputCheck.text,
        agentMode,
        mode: agentMode,
        runtimeSessionId: runtimeSessionId || undefined,
        message: runtimeMessage,
        messages: runtimeMessages,
        stream: true,
        sharedVault,
        obsidianVault: sharedVault,
        workingDirectory,
        controlRoomPath: sharedVault?.controlRoomPath,
        wallet,
        walletTools: buildWalletTools(wallet),
        context: hermesSlashCommand ? undefined : promptEnvelope.systemContext || undefined,
        lmStudioBaseUrl: lmStudioFleetHost?.baseUrl || undefined,
      }),
      signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
    });
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      status: upstream.status,
      ok: upstream.ok,
      contentType: upstream.headers.get("content-type") ?? null,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    if (upstream.ok) recordAgentRuntimeWarm(runtimeProfile);
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.fetch.failed", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      errorName: error instanceof Error ? error.name : null,
      errorMessage: error instanceof Error ? error.message : String(error),
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime fetch failed", runtimeFetchError(profile, url, error)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return Response.json(
      {
        error: runtimeFetchError(profile, url, error),
      },
      { status: 502 },
    );
  } finally {
    fetchSettled = true;
    slowTimers.forEach(clearTimeout);
  }

  if (!upstream.ok) {
    const errorText = await upstream.text().catch(() => "");
    const message = upstream.status === 404 && profile.runtime === "hermes" && profile.telemetryUrl
      ? "This machine's local agent bridge is connected but does not have the Hermes chat bridge yet. Run Update/Setup on that machine, then try again."
      : errorText || `${profile.runtime} returned ${upstream.status}`;
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.upstream_error", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      status: upstream.status,
      bodyPreview: message.slice(0, 500),
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    releaseInteractiveRuntime(lockKey);
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime upstream error", message).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return new Response(
      ssePayload({ error: message }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    recordRuntimeTelemetry(telemetry, "agent_runtime.http.non_stream_response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model: runtimeProfile.model || null,
      adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
      contentType,
      fetchElapsedMs: Date.now() - fetchStartedAt,
    });
    const json = await upstream.json().catch(async () => ({ text: await upstream.text().catch(() => "") }));
    const outputCheck = proxyOutput(extractChunk(json));
    if (outputCheck.verdict === "block") {
      releaseInteractiveRuntime(lockKey);
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime output blocked", outputCheck.reason).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "blocked").catch(() => undefined);
      return new Response(
        ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }) + "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
      );
    }
    const chunk = outputCheck.text;
    const event = await recordChatHoney(runtimeProfile, userText, chunk, honeyLedgerEnabled);
    await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk || JSON.stringify(json), json).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ choices: [{ delta: { content: chunk || JSON.stringify(json) } }] })
      + (event ? ssePayload({ honey: event }) : "")
      + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      let streamClosed = false;
      const safeEnqueue = (payload: string) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          streamClosed = true;
          return false;
        }
      };
      const safeClose = () => {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The browser may have already closed the SSE stream.
        }
      };
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        if (!runtimeSessionId) return;
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      if (runtimeSessionId) {
        safeEnqueue(ssePayload({
          session: { id: runtimeSessionId, runtime: runtimeProfile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        }));
      }
      const preflightProcessPayload = runtimeProcessEventsSsePayload(telemetry?.preflightProcessEvents ?? []);
      if (preflightProcessPayload) safeEnqueue(preflightProcessPayload);
      const reader = upstream.body?.getReader();
      if (!reader) {
        safeEnqueue(ssePayload({ error: "Runtime response body is empty" }));
        safeEnqueue("data: [DONE]\n\n");
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime response body is empty"));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        safeClose();
        return;
      }

      let buffer = "";
      let fullText = "";
      let sawFirstChunk = false;
      let commentEventCount = 0;
      let dataEventCount = 0;
      let textDeltaCount = 0;
      let processEventCount = 0;
      let lastRuntimeError = "";
      let outputBlocked = false;
      const channelMarkupState = createChannelMarkupState();
      recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.start", {
        ...telemetryPayloadForProfile(runtimeProfile),
        url,
        model: runtimeProfile.model || null,
        adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
        fetchElapsedMs: Date.now() - fetchStartedAt,
      });
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!sawFirstChunk) {
            sawFirstChunk = true;
            recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.first_chunk", {
              ...telemetryPayloadForProfile(runtimeProfile),
              url,
              model: runtimeProfile.model || null,
              adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
              byteLength: value.byteLength,
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
          }
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const eventText of events) {
            const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) {
              if (eventText.trim().startsWith(":")) {
                commentEventCount += 1;
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.comment", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  commentEventCount,
                  preview: eventText.replace(/^:\s?/gm, "").trim().slice(0, 240),
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream comment", eventText.replace(/^:\s?/gm, "").trim()));
                safeEnqueue(`${eventText}\n\n`);
              }
              continue;
            }
            dataEventCount += 1;
            const raw = dataLine.replace(/^data:\s*/, "");
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              let parsedRuntimeError = "";
              if (parsed && typeof parsed === "object") {
                const record = parsed as Record<string, unknown>;
                const event = record.event && typeof record.event === "object" ? record.event as Record<string, unknown> : null;
                const rawError = record.error ?? event?.error;
                const rawMessage = record.message ?? event?.message;
                if (typeof rawError === "string" && rawError.trim()) parsedRuntimeError = rawError.trim();
                else if (rawError && typeof rawError === "object") {
                  const nestedError = rawError as Record<string, unknown>;
                  const message = String(nestedError.message ?? nestedError.error ?? nestedError.detail ?? "").trim();
                  if (message) parsedRuntimeError = message;
                } else if (typeof rawMessage === "string" && /error|failed|failure|empty|without returning/i.test(rawMessage)) {
                  parsedRuntimeError = rawMessage.trim();
                }
                if (parsedRuntimeError) lastRuntimeError = parsedRuntimeError;
              }
              const rawOutput = extractChunk(parsed);
              const rawReasoning = extractReasoningChunk(parsed);
              if (parsedRuntimeError && !rawOutput.trim() && !rawReasoning.trim()) {
                processEventCount += 1;
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.error_event", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  processEventCount,
                  message: parsedRuntimeError,
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", parsedRuntimeError, parsed));
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", `Error: ${parsedRuntimeError}`));
                queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
                safeEnqueue(ssePayload({ error: parsedRuntimeError }));
                safeEnqueue("data: [DONE]\n\n");
                return;
              }
              const outputCheck = proxyOutput(rawOutput);
              const reasoningCheck = proxyOutput(rawReasoning);
              if (outputCheck.verdict === "block") {
                outputBlocked = true;
                safeEnqueue(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }));
                continue;
              }
              if (reasoningCheck.verdict === "block") {
                outputBlocked = true;
                safeEnqueue(ssePayload({ error: reasoningCheck.reason ?? "Response blocked by security policy" }));
                continue;
              }
              const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
              const chunk = routed.content;
              if (thinking) {
                processEventCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking }));
              }
              if (chunk) {
                fullText += chunk;
                textDeltaCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, parsed));
                if (textDeltaCount === 1 || textDeltaCount % 20 === 0) {
                  recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.text_delta", {
                    ...telemetryPayloadForProfile(runtimeProfile),
                    url,
                    model: runtimeProfile.model || null,
                    adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                    textDeltaCount,
                    outputLength: fullText.length,
                    streamElapsedMs: Date.now() - fetchStartedAt,
                  });
                }
              } else if (!thinking && isTerminalOpenAiStreamMetadata(parsed)) {
                continue;
              } else if (!thinking) {
                processEventCount += 1;
                const eventDetail = typeof parsed?.message === "string"
                  ? parsed.message
                  : typeof parsed?.error === "string"
                    ? parsed.error
                    : undefined;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(
                  runtimeSessionId,
                  typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : "Runtime event",
                  eventDetail,
                  parsed,
                ));
                recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.process_event", {
                  ...telemetryPayloadForProfile(runtimeProfile),
                  url,
                  model: runtimeProfile.model || null,
                  adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
                  processEventCount,
                  eventType: typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : null,
                  keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12) : [],
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
              }
              if (chunk) {
                safeEnqueue(ssePayload({ choices: [{ delta: { content: chunk } }] }));
              } else if (!thinking) {
                safeEnqueue(ssePayload(parsed));
              }
            } catch {
              const outputCheck = proxyOutput(raw);
              const routed = outputCheck.verdict === "block"
                ? { content: "", thinking: "" }
                : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              if (outputCheck.verdict !== "block" && routed.thinking) {
                processEventCount += 1;
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }));
              }
              if (outputCheck.verdict !== "block") fullText += routed.content;
              if (outputCheck.verdict !== "block" && routed.content) queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
              if (outputCheck.verdict === "block") {
                outputBlocked = true;
                safeEnqueue(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" }));
              } else if (routed.content) {
                safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
              }
            }
          }
        }
        {
          const flushedTail = flushChannelMarkup(channelMarkupState);
          if (flushedTail.thinking) {
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", flushedTail.thinking));
            safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: flushedTail.thinking }));
          }
          if (flushedTail.content) {
            fullText += flushedTail.content;
            textDeltaCount += 1;
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", flushedTail.content));
            safeEnqueue(ssePayload({ choices: [{ delta: { content: flushedTail.content } }] }));
          }
        }
        if (!fullText.trim()) {
          const workspaceAfter = await readWorkspaceSnapshot(workingDirectory);
          const summary = workspaceChangeSummary(workspaceBefore, workspaceAfter);
          if (summary) {
            fullText = summary;
            safeEnqueue(ssePayload({ choices: [{ delta: { content: summary } }] }));
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", summary));
            recordRuntimeTelemetry(telemetry, "agent_runtime.http.workspace_completed", {
              ...telemetryPayloadForProfile(runtimeProfile),
              url,
              model: runtimeProfile.model || null,
              adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
              changedFiles: workspaceAfter?.statusLines.length ?? 0,
              headChanged: Boolean(workspaceBefore?.head && workspaceAfter?.head && workspaceBefore.head !== workspaceAfter.head),
            });
          }
        }
        if (!fullText.trim()) {
          const emptyMessage = lastRuntimeError
            || `${runtimeProfile.runtime === "hermes" ? "Hermes API" : "Runtime"} stream finished without returning any text. Check the active provider, model, and credentials.`;
          recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.empty", {
            ...telemetryPayloadForProfile(runtimeProfile),
            url,
            model: runtimeProfile.model || null,
            adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
            sawFirstChunk,
            commentEventCount,
            dataEventCount,
            textDeltaCount,
            processEventCount,
            message: emptyMessage,
            streamElapsedMs: Date.now() - fetchStartedAt,
          });
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", emptyMessage));
          queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", `Error: ${emptyMessage}`));
          queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
          safeEnqueue(ssePayload({ error: emptyMessage }));
          safeEnqueue("data: [DONE]\n\n");
          return;
        }
        const event = await recordChatHoney(runtimeProfile, userText, fullText, honeyLedgerEnabled);
        if (event) safeEnqueue(ssePayload({ honey: event }));
        recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.completed", {
          ...telemetryPayloadForProfile(runtimeProfile),
          url,
          model: runtimeProfile.model || null,
          adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
          outputLength: fullText.length,
          sawFirstChunk,
          commentEventCount,
          dataEventCount,
          textDeltaCount,
          processEventCount,
          streamElapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, outputBlocked ? "blocked" : "completed"));
        safeEnqueue("data: [DONE]\n\n");
      } catch (error) {
        const message = runtimeStreamErrorMessage(profile, error);
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        recordRuntimeTelemetry(telemetry, "agent_runtime.http.stream.failed", {
          ...telemetryPayloadForProfile(runtimeProfile),
          url,
          model: runtimeProfile.model || null,
          adaptiveOpenRouter: Boolean(adaptiveResolvedModel),
          message,
          streamElapsedMs: Date.now() - fetchStartedAt,
        });
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
      } finally {
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        safeClose();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

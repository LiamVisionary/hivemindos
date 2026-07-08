import { type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { proxyOutput } from "@/lib/services/agent-security-proxy";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { resolveAdaptiveOpenRouterModels } from "@/lib/services/chat/adaptive-openrouter-models";
import { flushChannelMarkup } from "@/lib/services/chat/channel-markup";
import { assessAdaptiveResponseQuality, classifyAdaptiveModelFailure, recordAdaptiveModelOutcome } from "@/lib/services/chat/adaptive-model-reliability";
import {
  buildHivemindPromptEnvelope,
  prependHivemindSystemMessage,
} from "@/lib/services/chat/hivemind-system-prompt";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
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
import { recordRuntimeTelemetry, telemetryPayloadForProfile, type RuntimeRouteTelemetry } from "./route-telemetry";
import {
  buildWalletTools,
  recordChatHoney,
  releaseInteractiveRuntime,
  runtimeFetchError,
  runtimeStreamErrorMessage,
  type AgentMode,
} from "./runtime-helpers";
import {
  buildAdaptiveOpenRouterResolvedModelContext,
  finalAdaptiveHermesOpenRouterError,
  isHermesCliFailureText,
  openRouterApiKey,
  profileWithResolvedModel,
} from "./openai-compat";

const ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS = 5;
// Time allowed for an attempt to produce its first stream byte. Once the
// stream is flowing, silence means the Hermes CLI is still working (the
// collector closes the stream when the CLI exits), so the idle window is much
// longer — just under the collector's 20-minute chat cap.
const ADAPTIVE_HERMES_OPENROUTER_ATTEMPT_TIMEOUT_MS = 45_000;
const ADAPTIVE_HERMES_OPENROUTER_STREAM_IDLE_TIMEOUT_MS = 15 * 60_000;
const ADAPTIVE_HERMES_OPENROUTER_KEEPALIVE_MS = 25_000;
const DEFAULT_ADAPTIVE_HERMES_OPENROUTER_FALLBACK_MODEL = "openai/gpt-4.1-mini";

export async function streamAdaptiveHermesOpenRouterRuntime(
  profile: AgentProfile,
  messages: IncomingMessage[],
  userText: string,
  sharedVault: SharedVaultConfig | null,
  agentMode: AgentMode,
  url: string,
  lockKey: string,
  workingDirectory?: string,
  wallet?: AgentWalletConfig,
  honeyLedgerEnabled = false,
  runtimeSessionId = "",
  telemetry?: RuntimeRouteTelemetry,
  taskRetrievalContext = "",
  sharedBrainMemoryContext = "",
  vaultPromptContext = "",
) {
  let candidateModels: string[];
  try {
    candidateModels = await resolveAdaptiveOpenRouterModels(profile, messages);
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
  }
  const fallbackModel = profile.adaptiveOpenRouter?.fallbackModel?.trim()
    || profile.adaptiveRouting?.fallbackModel?.trim()
    || DEFAULT_ADAPTIVE_HERMES_OPENROUTER_FALLBACK_MODEL;
  if (fallbackModel) {
    const freeModels = candidateModels.filter((model) => model !== fallbackModel);
    candidateModels = [...freeModels.slice(0, ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS), fallbackModel];
  } else {
    candidateModels = candidateModels.slice(0, ADAPTIVE_HERMES_OPENROUTER_FREE_ATTEMPTS);
  }
  const openRouterToken = await openRouterApiKey().catch(() => "");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const fetchStartedAt = Date.now();
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
          session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        }));
      }

      const attemptedModels: string[] = [];
      let lastError = "";
      let hermesCliSessionId = "";
      try {
        for (const candidateModel of candidateModels) {
          const candidateProfile = profileWithResolvedModel(profile, candidateModel);
          const promptEnvelope = buildHivemindPromptEnvelope({
            profile: candidateProfile,
            agentMode,
            workingDirectory,
            vaultContext: vaultPromptContext,
            sharedBrainMemoryContext,
            taskRetrievalContext,
            wallet,
            runtimeSessionId,
            extraDynamicContext: buildAdaptiveOpenRouterResolvedModelContext(profile, candidateModel),
          });
          const runtimeMessages = prependHivemindSystemMessage(messages, promptEnvelope);
          attemptedModels.push(`openrouter/${candidateModel}`);
          recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.fetch.start", {
            ...telemetryPayloadForProfile(candidateProfile),
            url,
            model: candidateModel,
            adaptiveOpenRouter: true,
            attempt: attemptedModels.length,
            remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
          });

          let upstream: Response;
          const attemptController = new AbortController();
          let attemptTimer = setTimeout(() => attemptController.abort(), ADAPTIVE_HERMES_OPENROUTER_ATTEMPT_TIMEOUT_MS);
          const refreshAttemptTimer = (ms: number) => {
            clearTimeout(attemptTimer);
            attemptTimer = setTimeout(() => attemptController.abort(), ms);
          };
          try {
            upstream = await fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(profile.token ? { Authorization: `Bearer ${profile.token}` } : {}),
              },
              body: JSON.stringify({
                agent: candidateProfile,
                agentId: candidateProfile.agentId || candidateProfile.id,
                sessionKey: candidateProfile.sessionKey,
                provider: candidateProfile.provider || undefined,
                model: candidateModel,
                agentEnv: safeAgentEnv({
                  ...candidateProfile.agentEnv,
                  ...(openRouterToken ? { OPENROUTER_API_KEY: openRouterToken } : {}),
                }),
                rawUserMessage: userText,
                forceHermesCli: true,
                // The HivemindOS runtimeSessionId is not a Hermes CLI session id,
                // so resume only once a prior attempt reported the real CLI
                // session — then retries continue its work instead of restarting.
                disableHermesResume: !hermesCliSessionId,
                agentMode,
                mode: agentMode,
                runtimeSessionId: hermesCliSessionId || runtimeSessionId || undefined,
                hermesSessionId: hermesCliSessionId || runtimeSessionId || undefined,
                message: userText,
                messages: runtimeMessages,
                stream: true,
                sharedVault,
                obsidianVault: sharedVault,
                workingDirectory,
                controlRoomPath: sharedVault?.controlRoomPath,
                wallet,
                walletTools: buildWalletTools(wallet),
                context: promptEnvelope.systemContext || undefined,
              }),
              signal: attemptController.signal,
            });
          } catch (error) {
            clearTimeout(attemptTimer);
            lastError = runtimeFetchError(candidateProfile, url, error);
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.fetch.failed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              errorName: error instanceof Error ? error.name : null,
              errorMessage: error instanceof Error ? error.message : String(error),
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              elapsedMs: Date.now() - fetchStartedAt,
            });
            void recordAdaptiveModelOutcome(candidateModel, classifyAdaptiveModelFailure(lastError), lastError);
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", lastError));
            continue;
          }

          if (!upstream.ok || !upstream.body) {
            clearTimeout(attemptTimer);
            const errorText = await upstream.text().catch(() => "");
            lastError = errorText || `Hermes returned ${upstream.status || 502} for ${candidateModel}.`;
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.upstream_error", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              status: upstream.status,
              bodyPreview: lastError.slice(0, 500),
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              elapsedMs: Date.now() - fetchStartedAt,
            });
            void recordAdaptiveModelOutcome(candidateModel, classifyAdaptiveModelFailure(`${upstream.status} ${lastError}`), lastError);
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", lastError));
            continue;
          }

          const reader = upstream.body.getReader();
          let buffer = "";
          let fullText = "";
          let sawFirstChunk = false;
          let textDeltaCount = 0;
          let processEventCount = 0;
          let commentEventCount = 0;
          const channelMarkupState = createChannelMarkupState();
          const recordStreamComment = (commentText: string) => {
            const cleanComment = commentText.trim();
            if (!cleanComment) return;
            commentEventCount += 1;
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.comment", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              attempt: attemptedModels.length,
              commentEventCount,
              commentPreview: cleanComment.slice(0, 160),
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
          };
          const keepaliveTimer = setInterval(() => {
            const commentText = "Hermes Adaptive stream still working";
            recordStreamComment(commentText);
            safeEnqueue(`: ${commentText}\n\n`);
          }, ADAPTIVE_HERMES_OPENROUTER_KEEPALIVE_MS);
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              refreshAttemptTimer(ADAPTIVE_HERMES_OPENROUTER_STREAM_IDLE_TIMEOUT_MS);
              if (!sawFirstChunk) {
                sawFirstChunk = true;
                recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.first_chunk", {
                  ...telemetryPayloadForProfile(candidateProfile),
                  url,
                  model: candidateModel,
                  adaptiveOpenRouter: true,
                  byteLength: value.byteLength,
                  attempt: attemptedModels.length,
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
                    const commentText = eventText
                      .split("\n")
                      .map((line) => line.replace(/^:\s*/, "").trim())
                      .filter(Boolean)
                      .join(" ");
                    recordStreamComment(commentText);
                    safeEnqueue(`${eventText}\n\n`);
                  }
                  continue;
                }
                const raw = dataLine.replace(/^data:\s*/, "");
                if (raw === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(raw);
                  const errorMessage = typeof parsed?.error === "string"
                    ? parsed.error
                    : typeof parsed?.error?.message === "string"
                      ? parsed.error.message
                      : "";
                  if (errorMessage.trim()) {
                    lastError = errorMessage.trim();
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", `${candidateModel}: ${lastError}`, parsed));
                    continue;
                  }
                  const outputCheck = proxyOutput(extractChunk(parsed));
                  const reasoningCheck = proxyOutput(extractReasoningChunk(parsed));
                  if (outputCheck.verdict === "block") {
                    lastError = outputCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError, parsed));
                    continue;
                  }
                  if (reasoningCheck.verdict === "block") {
                    lastError = reasoningCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError, parsed));
                    continue;
                  }
                  const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
                  const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
                  if (thinking) {
                    processEventCount += 1;
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                    safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking }));
                  }
                  if (routed.content) {
                    if (isHermesCliFailureText(routed.content)) {
                      lastError = routed.content.trim();
                      queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", `${candidateModel}: ${lastError}`, parsed));
                    } else {
                      fullText += routed.content;
                      textDeltaCount += 1;
                      queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content, parsed));
                      if (textDeltaCount === 1 || textDeltaCount % 20 === 0) {
                        recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.text_delta", {
                          ...telemetryPayloadForProfile(candidateProfile),
                          url,
                          model: candidateModel,
                          adaptiveOpenRouter: true,
                          attempt: attemptedModels.length,
                          textDeltaCount,
                          outputLength: fullText.length,
                          streamElapsedMs: Date.now() - fetchStartedAt,
                        });
                      }
                      safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
                    }
                  } else if (!thinking && isTerminalOpenAiStreamMetadata(parsed)) {
                    continue;
                  } else if (!thinking && parsed?.session) {
                    const cliSessionId = String(parsed.session?.id ?? parsed.session?.sessionId ?? "").trim();
                    if (cliSessionId) hermesCliSessionId = cliSessionId;
                    safeEnqueue(ssePayload(parsed));
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
                    recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.process_event", {
                      ...telemetryPayloadForProfile(candidateProfile),
                      url,
                      model: candidateModel,
                      adaptiveOpenRouter: true,
                      attempt: attemptedModels.length,
                      processEventCount,
                      eventType: typeof parsed?.type === "string" ? parsed.type : typeof parsed?.event?.type === "string" ? parsed.event.type : null,
                      keys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 12) : [],
                      streamElapsedMs: Date.now() - fetchStartedAt,
                    });
                    safeEnqueue(ssePayload(parsed));
                  }
                } catch {
                  const outputCheck = proxyOutput(raw);
                  const routed = outputCheck.verdict === "block"
                    ? { content: "", thinking: "" }
                    : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
                  if (outputCheck.verdict === "block") {
                    lastError = outputCheck.reason ?? "Response blocked by security policy";
                    queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError));
                  } else {
                    if (routed.thinking) {
                      processEventCount += 1;
                      queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                      safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }));
                    }
                    if (routed.content) {
                      if (isHermesCliFailureText(routed.content)) {
                        lastError = routed.content.trim();
                        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive model failed", lastError));
                      } else {
                        fullText += routed.content;
                        textDeltaCount += 1;
                        queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
                        if (textDeltaCount === 1 || textDeltaCount % 20 === 0) {
                          recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.text_delta", {
                            ...telemetryPayloadForProfile(candidateProfile),
                            url,
                            model: candidateModel,
                            adaptiveOpenRouter: true,
                            attempt: attemptedModels.length,
                            textDeltaCount,
                            outputLength: fullText.length,
                            streamElapsedMs: Date.now() - fetchStartedAt,
                          });
                        }
                        safeEnqueue(ssePayload({ choices: [{ delta: { content: routed.content } }] }));
                      }
                    }
                  }
                }
              }
            }
            const flushedTail = flushChannelMarkup(channelMarkupState);
            if (flushedTail.thinking) {
              processEventCount += 1;
              queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", flushedTail.thinking));
              safeEnqueue(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: flushedTail.thinking }));
            }
            if (flushedTail.content) {
              fullText += flushedTail.content;
              textDeltaCount += 1;
              queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", flushedTail.content));
              if (textDeltaCount === 1 || textDeltaCount % 20 === 0) {
                recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.text_delta", {
                  ...telemetryPayloadForProfile(candidateProfile),
                  url,
                  model: candidateModel,
                  adaptiveOpenRouter: true,
                  attempt: attemptedModels.length,
                  textDeltaCount,
                  outputLength: fullText.length,
                  streamElapsedMs: Date.now() - fetchStartedAt,
                });
              }
              safeEnqueue(ssePayload({ choices: [{ delta: { content: flushedTail.content } }] }));
            }
          } catch (error) {
            lastError = runtimeStreamErrorMessage(candidateProfile, error);
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.failed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              message: lastError,
              attempt: attemptedModels.length,
              remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
              processEventCount,
              commentEventCount,
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", `${candidateModel}: ${lastError}`));
          } finally {
            clearTimeout(attemptTimer);
            clearInterval(keepaliveTimer);
          }

          if (fullText.trim()) {
            // Quality gate: the response already streamed to the user, so a
            // fail can't retry this turn — it grades the model for future
            // routing ("completed but useless" still demotes).
            const quality = assessAdaptiveResponseQuality(userText, fullText);
            void recordAdaptiveModelOutcome(candidateModel, quality.ok ? "success" : "low-quality", quality.reason);
            if (!quality.ok) {
              queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive quality flag", `${candidateModel}: ${quality.reason}`));
            }
            const event = await recordChatHoney(candidateProfile, userText, fullText, honeyLedgerEnabled);
            if (event) safeEnqueue(ssePayload({ honey: event }));
            safeEnqueue("data: [DONE]\n\n");
            recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.stream.completed", {
              ...telemetryPayloadForProfile(candidateProfile),
              url,
              model: candidateModel,
              adaptiveOpenRouter: true,
              attempt: attemptedModels.length,
              outputLength: fullText.length,
              textDeltaCount,
              processEventCount,
              commentEventCount,
              attemptedModels,
              streamElapsedMs: Date.now() - fetchStartedAt,
            });
            queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
            await sessionWrite.catch(() => undefined);
            releaseInteractiveRuntime(lockKey);
            safeClose();
            return;
          }

          lastError ||= `Hermes returned no assistant text for ${candidateModel}.`;
          recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.empty_model", {
            ...telemetryPayloadForProfile(candidateProfile),
            url,
            model: candidateModel,
            adaptiveOpenRouter: true,
            attempt: attemptedModels.length,
            remainingCandidates: Math.max(0, candidateModels.length - attemptedModels.length),
            lastError,
            processEventCount,
            commentEventCount,
            streamElapsedMs: Date.now() - fetchStartedAt,
          });
          void recordAdaptiveModelOutcome(candidateModel, classifyAdaptiveModelFailure(lastError), lastError);
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive retry", `${candidateModel}: ${lastError}`));
        }

        const message = finalAdaptiveHermesOpenRouterError(attemptedModels, lastError);
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
        recordRuntimeTelemetry(telemetry, "agent_runtime.hermes_adaptive_openrouter.failed", {
          ...telemetryPayloadForProfile(profile),
          url,
          adaptiveOpenRouter: true,
          attemptedModels,
          lastError,
          elapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
      } catch (error) {
        const message = runtimeStreamErrorMessage(profile, error);
        safeEnqueue(ssePayload({ error: message }));
        safeEnqueue("data: [DONE]\n\n");
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Hermes Adaptive stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
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

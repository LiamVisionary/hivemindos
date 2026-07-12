import { HIVEMIND_OS_RUNTIME, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { normalizeChatResponseBilling } from "@/lib/types/chat-billing";
import { chatPermissionModeAllowsUnlistedCommands, type ChatPermissionMode } from "@/lib/types/chat-permissions";
import { proxyInput, proxyOutput } from "@/lib/services/agent-security-proxy";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { summarizeUsePodResponseHeaders } from "@/lib/services/usepod";
import { interpretVeniceError, isVeniceProfile, summarizeVeniceResponseHeaders } from "@/lib/services/venice";
import { isBankrAdaptiveModel, isBankrLlmProfile, resolveAdaptiveBankrLlmModels } from "@/lib/services/bankr-llm";
import {
  bankrActionToolDefinition,
  BANKR_ACTION_TOOL_NAME,
  runBankrActionTool,
} from "@/lib/services/bankr-actions";
import { imageGenerationRequest, videoGenerationRequest } from "@/lib/services/chat/task-retrieval-context";
import { semanticVideoIntentCandidate } from "@/lib/services/chat/semantic-video-intent";
import { AGENT_COLD_START_EVENT_TYPE, inferredModalColdStartProcessEvent, recordAgentRuntimeWarm } from "@/lib/services/chat/agent-cold-start";
import { openAICompatibleInferenceCacheHints } from "@/lib/services/chat/inference-cache-hints";
import { resolveAdaptiveOpenRouterModels } from "@/lib/services/chat/adaptive-openrouter-models";
import { flushChannelMarkup, routeChannelMarkupText } from "@/lib/services/chat/channel-markup";
import {
  contentHasLeakedToolCallMarker,
  extractLeakedToolCalls,
  firstLeakedToolCallMarkerIndex,
  stripLeakedToolCallMarkup,
} from "@/lib/services/chat/leaked-tool-call-markup";
import { type AdaptiveRoutePlan } from "@/lib/services/chat/adaptive-model-router";
import { adaptiveReliabilityKey, assessAdaptiveResponseQuality, classifyAdaptiveModelFailure, recordAdaptiveModelOutcome } from "@/lib/services/chat/adaptive-model-reliability";
import { appendRuntimeChatSessionEvent, appendRuntimeChatSessionText, finishRuntimeChatSession, updateRuntimeChatSessionLastAssistantBilling } from "@/lib/services/chat/runtime-session-store";
import { RUN_COMMAND_TOOL_NAME, runAgentCommand, runCommandToolDefinition } from "@/lib/services/agent-shell/command-tool";
import {
  createChannelMarkupState,
  extractChunk,
  extractReasoningChunk,
  extractUserText,
  isTerminalOpenAiStreamMetadata,
  messagesWithCurrentMediaArtifacts,
  routeChannelMarkupDelta,
  ssePayload,
  textOnlyMessagesForTextModel,
  unwrapLatestUserRequest,
  type IncomingMessage,
} from "./messages";
import type { ChatMediaArtifact } from "./media-artifacts";
import { shouldSuppressCommandToolForNativeMedia, videoInputImagesForArgs } from "./media-tool-routing";
import { runtimeProcessEventsSsePayload } from "./process-events";
import { isFreeHivemindosWalletPaidModel } from "@/lib/config/hivemindos-wallet-paid-models";
import { recordRuntimeTelemetry, telemetryPayloadForProfile, type RuntimeRouteTelemetry } from "./route-telemetry";
import { isXaiOAuthProvider, xaiOAuthChatRequestOptions } from "@/lib/services/xai-oauth-inference-contract";
import { reasoningEffortRequestBody, type ChatReasoningEffort } from "@/lib/types/chat-reasoning-effort";
import {
  X_ACCOUNT_RUNTIME_TOOL_DEFINITION,
  X_ACCOUNT_RUNTIME_TOOL_NAME,
  runXAccountRuntimeTool,
  xAccountRuntimeToolAvailable,
} from "./x-account-runtime-tool";
import {
  commandApprovalEvent,
  commandSuccessText,
  execFileAsync,
  interactiveRuntimeLockKey,
  recordChatHoney,
  releaseInteractiveRuntime,
  reserveInteractiveRuntime,
  RUNTIME_FETCH_TIMEOUT_MS,
  runtimeFetchError,
  type AgentMode,
} from "./runtime-helpers";
import {
  buildOpenAICompatibleUrl,
  finalAdaptiveOpenRouterError,
  finalAdaptiveProviderError,
  isAdaptiveOpenRouterProfile,
  isLocalLmStudioProfile,
  isModelUnavailableErrorBody,
  isOpenRouterProvider,
  lmStudioCliEnv,
  lmStudioModelLoadNotice,
  lmStudioModelLoadState,
  lmStudioModelUnavailableMessage,
  openAICompatibleModel,
  providerErrorMessage,
  resolveLmStudioCliBin,
  retryableAdaptiveOpenRouterStatus,
  stripTerminalControls,
} from "./openai-compat";
import {
  commandFailureFallbackText,
  dispatchImageGenerationViaRoute,
  dispatchVideoGenerationViaRoute,
  extractOpenAIToolCalls,
  hivemindosModelsBillingFromHeaders,
  imageGenerationArtifacts,
  imageGenerationToolDefinition,
  IMAGE_GENERATION_TOOL_NAME,
  modelVisibleMediaBytes,
  parseToolCallArguments,
  videoGenerationArtifacts,
  videoGenerationToolDefinition,
  VIDEO_GENERATION_TOOL_NAME,
  type AccumulatedToolCall,
  type NonStreamToolRun,
  type ToolCallOutcome,
} from "./openai-compatible-tools";
import {
  OpenAICompatibleProfileError,
  requestOriginFromUrl,
  resolveOpenAICompatibleProfile,
} from "./openai-compatible-profile";
import { createOpenAICompatibleModelMessagesBuilder } from "./openai-compatible-prompt";
import { INVOKE_HIVE_CAPABILITY_TOOL_NAME, invokeHiveCapabilityRuntimeEvent, invokeHiveCapabilityToolDefinition, runInvokeHiveCapabilityTool } from "./invoke-hive-capability-tool";
import { runNonStreamToolConversation, type NonStreamWinningRequest } from "./non-stream-tool-conversation";
import { streamSemanticVideoClarification } from "./stream-semantic-video-clarification";
import { resolveSemanticVideoRuntimeRoute } from "./semantic-video-runtime-route";
export async function streamOpenAICompatibleRuntime(
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
  adaptiveRoutePlan?: AdaptiveRoutePlan,
  vaultPromptContext = "",
  permissionMode: ChatPermissionMode = "manual",
  mediaArtifacts: ChatMediaArtifact[] = [],
  reasoningEffort: ChatReasoningEffort = "medium",
) {
  const allowUnlistedCommands = chatPermissionModeAllowsUnlistedCommands(permissionMode);
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  const requestOrigin = requestOriginFromUrl(telemetry?.request?.url);
  let resolvedProfile: Awaited<ReturnType<typeof resolveOpenAICompatibleProfile>>;
  try {
    resolvedProfile = await resolveOpenAICompatibleProfile({ profile, wallet, requestOrigin });
  } catch (error) {
    const status = error instanceof OpenAICompatibleProfileError ? error.status : 500;
    return Response.json({
      error: error instanceof Error ? error.message : "Provider setup is incomplete.",
    }, { status });
  }
  const {
    runtimeProfile,
    usePodHeaders,
    providerHeaders,
    usePodEnabled,
    walletPaidModelsEnabled,
  } = resolvedProfile;
  const intentText = extractUserText(unwrapLatestUserRequest(messages)).trim() || userText;
  const offerImageTool = Boolean(requestOrigin) && imageGenerationRequest(intentText);
  const offerVideoTool = Boolean(requestOrigin) && videoGenerationRequest(intentText);
  const freeScoutModel = walletPaidModelsEnabled && isFreeHivemindosWalletPaidModel(runtimeProfile.model);
  const routeMediaViaArtifactHandles = freeScoutModel && offerVideoTool;
  const multimodalModelMessages = messagesWithCurrentMediaArtifacts(messages, mediaArtifacts);
  const modelInputMessages = routeMediaViaArtifactHandles
    ? textOnlyMessagesForTextModel(messages, mediaArtifacts)
    : multimodalModelMessages;
  const url = buildOpenAICompatibleUrl(runtimeProfile);
  const lockKey = interactiveRuntimeLockKey(runtimeProfile, url, telemetry?.chatStorageKey || runtimeSessionId);
  if (!reserveInteractiveRuntime(lockKey)) {
    return Response.json({ error: `${runtimeProfile.name || runtimeProfile.runtime} is already running another interactive request at ${url}.` }, { status: 409 });
  }
  const adaptiveProvider = Boolean(adaptiveRoutePlan);
  const adaptiveOpenRouter = isAdaptiveOpenRouterProfile(runtimeProfile) || (isOpenRouterProvider(runtimeProfile) && Boolean(runtimeProfile.adaptiveOpenRouter));
  if (usePodEnabled) {
    const capLabel = [
      profile.usePod?.maxPriceInputMicrounits ? `input cap ${profile.usePod.maxPriceInputMicrounits}` : "",
      profile.usePod?.maxPriceOutputMicrounits ? `output cap ${profile.usePod.maxPriceOutputMicrounits}` : "",
    ].filter(Boolean).join(", ");
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "UsePod request",
      `UsePod · ${openAICompatibleModel(runtimeProfile)}${capLabel ? ` · ${capLabel}` : ""}`,
    ).catch(() => undefined);
  }
  const modelMessagesFor = createOpenAICompatibleModelMessagesBuilder({
    runtimeProfile,
    modelInputMessages,
    agentMode,
    workingDirectory,
    vaultPromptContext,
    sharedBrainMemoryContext,
    taskRetrievalContext,
    wallet,
    runtimeSessionId,
  });
  let candidateModels: string[];
  try {
    candidateModels = isAdaptiveOpenRouterProfile(runtimeProfile)
      ? await resolveAdaptiveOpenRouterModels(runtimeProfile, messages)
      : isBankrAdaptiveModel(profile)
        ? await resolveAdaptiveBankrLlmModels(profile, messages)
        : [openAICompatibleModel(runtimeProfile)];
  } catch (error) {
    releaseInteractiveRuntime(lockKey);
    return Response.json({ error: error instanceof Error ? error.message : "Adaptive OpenRouter model selection failed." }, { status: 502 });
  }
  const suppressCommandToolForNativeMedia = shouldSuppressCommandToolForNativeMedia({
    messages,
    mediaArtifacts,
    intentText,
    generationToolOffered: offerImageTool || offerVideoTool,
  });
  const offerCommandTool = profile.runtimeCapabilities?.skillActions === true
    && permissionMode !== "plan"
    && !suppressCommandToolForNativeMedia;
  const offerHiveCapabilityTool = Boolean(requestOrigin) && profile.runtimeCapabilities?.skillActions === true && permissionMode !== "plan";
  const offerBankrTool = /\b(bankr|bnkr|polymarket|hyperliquid|token\s+launch|launch\s+a\s+token|swap|dca|twap|nft|portfolio|wallet\s+balance|agent\s+api)\b/i.test(intentText);
  const offerXAccountTool = xAccountRuntimeToolAvailable();
  const baseToolDefinitions = [
    ...(offerImageTool ? [imageGenerationToolDefinition()] : []),
    ...(offerVideoTool ? [videoGenerationToolDefinition()] : []),
    ...(offerBankrTool ? [bankrActionToolDefinition()] : []),
    ...(offerCommandTool ? [runCommandToolDefinition()] : []),
    ...(offerHiveCapabilityTool ? [invokeHiveCapabilityToolDefinition()] : []),
    ...(offerXAccountTool ? [X_ACCOUNT_RUNTIME_TOOL_DEFINITION] : []),
  ];
  let activeToolDefinitions = baseToolDefinitions;
  let winningRequest: NonStreamWinningRequest | null = null;
  const runNonStreamToolCalls = async (toolCalls: AccumulatedToolCall[]): Promise<NonStreamToolRun> => {
    const events: string[] = [];
    const assistantToolCalls: Array<Record<string, unknown>> = [];
    const toolResultMessages: Array<Record<string, unknown>> = [];
    const fallbacks: string[] = [];
    const finalTexts: string[] = [];
    const failures: string[] = [];
    for (const call of toolCalls) {
      const callId = call.id || `call_${call.name}`;
      assistantToolCalls.push({ id: callId, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } });
      if (call.name === X_ACCOUNT_RUNTIME_TOOL_NAME) {
        const outcome = await runXAccountRuntimeTool(call.arguments);
        toolResultMessages.push({ role: "tool", tool_call_id: callId, content: outcome.toolResultContent });
        fallbacks.push(outcome.fallbackText);
        continue;
      }
      if (call.name === INVOKE_HIVE_CAPABILITY_TOOL_NAME) {
        const outcome = await runInvokeHiveCapabilityTool(call.arguments, { origin: requestOrigin, permissionMode: permissionMode, userText: intentText });
        const runtimeEvent = invokeHiveCapabilityRuntimeEvent(outcome);
        events.push(ssePayload(runtimeEvent));
        await appendRuntimeChatSessionEvent(runtimeSessionId, runtimeEvent.message, runtimeEvent.detail).catch(() => undefined);
        if (!outcome.ok && !outcome.approvalRequired) {
          recordRuntimeTelemetry(telemetry, "agent_runtime.hive_capability.failed", {
            ...telemetryPayloadForProfile(profile),
            error: outcome.fallbackText,
            nonStream: true,
          });
        }
        toolResultMessages.push({ role: "tool", tool_call_id: callId, content: outcome.toolResultContent });
        fallbacks.push(outcome.fallbackText);
        if (!outcome.ok && !outcome.approvalRequired) failures.push(outcome.fallbackText);
        if (outcome.approvalRequired) {
          return { events, assistantToolCalls, toolResultMessages, fallbacks, finalTexts, failures, prompted: true };
        }
        continue;
      }
      if (call.name === VIDEO_GENERATION_TOOL_NAME) {
        const args = parseToolCallArguments(call.arguments);
        const videoPrompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : userText;
        const inputImages = videoInputImagesForArgs(args, mediaArtifacts);
        events.push(ssePayload({ applicationGeneration: { status: "running", kind: "video", prompt: videoPrompt, title: "Video generation", createdAt: Date.now() } }));
        await appendRuntimeChatSessionEvent(runtimeSessionId, "Video generation", `Dispatching ${inputImages.length ? "attached-image" : "text"} video request to a connected video app.`).catch(() => undefined);
        try {
          const result = await dispatchVideoGenerationViaRoute(requestOrigin, videoPrompt, inputImages, telemetry?.request?.signal);
          const artifacts = videoGenerationArtifacts(result.videos);
          events.push(ssePayload({ applicationGeneration: {
            status: "ready",
            kind: "video",
            prompt: result.prompt || videoPrompt,
            title: "Video generation",
            appName: result.app?.name,
            machineName: result.app?.machineName,
            artifacts,
            completedAt: Date.now(),
          } }));
          await appendRuntimeChatSessionEvent(runtimeSessionId, "Video generation completed", `${artifacts.length} video${artifacts.length === 1 ? "" : "s"} from ${result.app?.name ?? "connected app"}.`).catch(() => undefined);
          toolResultMessages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ ok: true, app: result.app?.name, endpoint: result.endpoint, videos: artifacts.map((artifact) => artifact.url) }) });
          fallbacks.push(artifacts.length ? `Generated ${artifacts.length} video${artifacts.length === 1 ? "" : "s"} with ${result.app?.name ?? "the connected app"}.` : "The video generation finished.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Video generation failed.";
          events.push(ssePayload({ applicationGeneration: { status: "error", kind: "video", prompt: videoPrompt, title: "Video generation", error: message, completedAt: Date.now() } }));
          await appendRuntimeChatSessionEvent(runtimeSessionId, "Video generation failed", message).catch(() => undefined);
          toolResultMessages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ ok: false, error: message }) });
          fallbacks.push(`I couldn't complete the video generation: ${message}`);
          failures.push(message);
        }
        continue;
      }
      if (call.name !== RUN_COMMAND_TOOL_NAME) {
        const message = `Tool ${call.name} is not available for this non-streamed HivemindOS Models response.`;
        events.push(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: call.name,
          name: call.name,
          message: "Tool unavailable",
          detail: message,
          status: "failed",
        }));
        await appendRuntimeChatSessionEvent(runtimeSessionId, "Tool unavailable", message).catch(() => undefined);
        toolResultMessages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ ok: false, error: message }) });
        fallbacks.push(message);
        failures.push(message);
        continue;
      }
      const args = parseToolCallArguments(call.arguments);
      const command = typeof args.command === "string" ? args.command : "";
      const commandArgs = Array.isArray(args.args) ? args.args.filter((item): item is string => typeof item === "string") : [];
      const commandLine = [command, ...commandArgs].filter(Boolean).join(" ");
      const label = typeof args.reason === "string" && args.reason.trim()
        ? args.reason.trim()
        : `Run ${command || "command"}`;
      events.push(ssePayload({
        type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
        toolName: RUN_COMMAND_TOOL_NAME,
        name: RUN_COMMAND_TOOL_NAME,
        message: label,
        detail: commandLine,
        status: "running",
      }));
      await appendRuntimeChatSessionEvent(runtimeSessionId, label, commandLine).catch(() => undefined);
      if (!command) {
        const message = "Command tool call did not include a command.";
        events.push(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: RUN_COMMAND_TOOL_NAME,
          name: RUN_COMMAND_TOOL_NAME,
          message: "Command failed",
          detail: message,
          status: "failed",
        }));
        await appendRuntimeChatSessionEvent(runtimeSessionId, "Command failed", message).catch(() => undefined);
        toolResultMessages.push({ role: "tool", tool_call_id: callId, content: JSON.stringify({ ok: false, error: message }) });
        fallbacks.push("I couldn't run that command because the tool call did not include a command.");
        failures.push(message);
        continue;
      }
      recordRuntimeTelemetry(telemetry, "agent_runtime.command_tool.dispatch", {
        ...telemetryPayloadForProfile(profile),
        command,
        argCount: commandArgs.length,
        nonStream: true,
      });
      const result = await runAgentCommand({
        command,
        args: commandArgs,
        cwd: workingDirectory,
        permissionMode: permissionMode,
        signal: telemetry?.request?.signal,
      });
      if (result.blockedByPolicy && !allowUnlistedCommands) {
        const approvalEvent = commandApprovalEvent({
          command,
          args: commandArgs,
          commandLine,
          label,
          error: result.error,
        });
        events.push(ssePayload(approvalEvent));
        await appendRuntimeChatSessionEvent(runtimeSessionId, "Command permission required", commandLine, approvalEvent).catch(() => undefined);
        recordRuntimeTelemetry(telemetry, "agent_runtime.command_tool.permission_required", {
          ...telemetryPayloadForProfile(profile),
          command,
          argCount: commandArgs.length,
          permissionMode: permissionMode,
          nonStream: true,
        });
        return {
          events,
          assistantToolCalls,
          toolResultMessages,
          fallbacks,
          finalTexts,
          failures,
          prompted: true,
        };
      }
      const detail = result.ok
        ? (result.stdout?.split("\n").find(Boolean)?.slice(0, 200) || "Done")
        : (result.error || result.stderr || "Failed");
      events.push(ssePayload({
        type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
        toolName: RUN_COMMAND_TOOL_NAME,
        name: RUN_COMMAND_TOOL_NAME,
        message: result.ok ? "Command finished" : "Command failed",
        detail,
        status: result.ok ? "completed" : "failed",
      }));
      await appendRuntimeChatSessionEvent(
        runtimeSessionId,
        result.ok ? "Command finished" : "Command failed",
        (result.stdout || result.stderr || result.error || "").slice(0, 500),
      ).catch(() => undefined);
      recordRuntimeTelemetry(telemetry, result.ok ? "agent_runtime.command_tool.completed" : "agent_runtime.command_tool.failed", {
        ...telemetryPayloadForProfile(profile),
        command: result.command || command,
        exitCode: result.exitCode ?? null,
        elapsedMs: result.elapsedMs,
        nonStream: true,
      });
      toolResultMessages.push({
        role: "tool",
        tool_call_id: callId,
        content: JSON.stringify({
          ok: result.ok,
          command: result.command,
          args: result.args,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
        }),
      });
      fallbacks.push(result.ok
        ? commandSuccessText(label, commandLine)
        : commandFailureFallbackText(commandLine, result));
      if (!result.ok) failures.push(result.error || result.stderr || "Command failed.");
    }
    return { events, assistantToolCalls, toolResultMessages, fallbacks, finalTexts, failures, prompted: false };
  };
  const fetchStartedAt = Date.now();
  const preflightProcessPayload = runtimeProcessEventsSsePayload(telemetry?.preflightProcessEvents ?? []);
  let upstream: Response | null = null;
  let model = candidateModels[0] ?? openAICompatibleModel(profile);
  let lastStatus = 0;
  let lastFetchError: unknown = null;
  const attemptedModels: string[] = [];
  const adaptiveRouteCandidates = adaptiveRoutePlan?.candidates.filter((candidate) => candidate.runtime === HIVEMIND_OS_RUNTIME) ?? [];
  const routeAttempts = adaptiveRouteCandidates.length
    ? adaptiveRouteCandidates
    : candidateModels.map((candidateModel) => ({
      provider: runtimeProfile.provider || "openai-compatible",
      providerName: runtimeProfile.provider || "OpenAI-compatible",
      model: candidateModel,
      gatewayUrl: runtimeProfile.gatewayUrl,
      chatPath: runtimeProfile.chatPath || "/v1/chat/completions",
      token: runtimeProfile.token,
      headers: {} as Record<string, string>,
    }));
  let semanticVideoClassified = false;
  const startLmStudioServerForProfile = async (candidateProfile: AgentProfile, failedUrl: string, error: unknown) => {
    if (!isLocalLmStudioProfile(candidateProfile) || adaptiveProvider || adaptiveOpenRouter || usePodEnabled || isBankrLlmProfile(candidateProfile)) return false;
    let port = "1234";
    try {
      const parsed = new URL(candidateProfile.gatewayUrl);
      port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    } catch {
      return false;
    }
    if (!/^\d+$/.test(port)) return false;
    recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start", {
      ...telemetryPayloadForProfile(candidateProfile),
      failedUrl,
      port,
      originalError: error instanceof Error ? error.message : String(error),
    });
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "Starting LM Studio server",
      `LM Studio has the model loaded, but ${failedUrl} is not listening. Starting the local LM Studio OpenAI-compatible server on port ${port}.`,
    ).catch(() => undefined);
    try {
      const { stdout, stderr } = await execFileAsync(await resolveLmStudioCliBin(), ["server", "start", "--port", port, "--bind", "127.0.0.1"], {
        timeout: 20_000,
        maxBuffer: 1_000_000,
        env: lmStudioCliEnv(),
        signal: telemetry?.request.signal,
      });
      const detail = stripTerminalControls([stdout, stderr].filter(Boolean).join("\n"));
      recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.started", {
        ...telemetryPayloadForProfile(candidateProfile),
        port,
        detail: detail.slice(0, 500),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      return true;
    } catch (serverError) {
      recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio_server.start_failed", {
        ...telemetryPayloadForProfile(candidateProfile),
        port,
        errorName: serverError instanceof Error ? serverError.name : null,
        errorMessage: serverError instanceof Error ? serverError.message : String(serverError),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      await appendRuntimeChatSessionEvent(
        runtimeSessionId,
        "LM Studio server start failed",
        serverError instanceof Error ? serverError.message : "Could not start LM Studio server.",
      ).catch(() => undefined);
      return false;
    }
  };
  for (const routeAttempt of routeAttempts) {
    const candidateModel = routeAttempt.model;
    model = candidateModel;
    const candidateProfile = {
      ...runtimeProfile,
      provider: routeAttempt.provider,
      model: candidateModel,
      gatewayUrl: routeAttempt.gatewayUrl,
      chatPath: routeAttempt.chatPath,
      token: routeAttempt.token ?? runtimeProfile.token,
    };
    const candidateUrl = buildOpenAICompatibleUrl(candidateProfile);
    attemptedModels.push(`${routeAttempt.provider}/${candidateModel}`);
    const modelMessages = modelMessagesFor(candidateProfile, candidateModel);
    const cacheHints = openAICompatibleInferenceCacheHints({
      provider: candidateProfile.provider,
      model,
      cacheScope: `${candidateProfile.id || runtimeProfile.id || "agent"}:${runtimeSessionId || candidateProfile.sessionKey || "session"}`,
    });
    const inferenceBody = isXaiOAuthProvider(candidateProfile.provider)
      ? xaiOAuthChatRequestOptions(model) : reasoningEffortRequestBody(candidateProfile.provider, model, reasoningEffort);
    const attemptHeaders = {
      "Content-Type": "application/json",
      ...(candidateProfile.token ? { Authorization: `Bearer ${candidateProfile.token}` } : {}),
      ...usePodHeaders,
      ...providerHeaders,
      ...cacheHints.headers,
      ...(routeAttempt.headers ?? {}),
    };
    if (semanticVideoIntentCandidate(intentText) && !semanticVideoClassified) {
      semanticVideoClassified = true;
      const semanticRoute = await resolveSemanticVideoRuntimeRoute({
        enabled: true,
        url: candidateUrl,
        headers: attemptHeaders,
        model,
        messages,
        signal: telemetry?.request?.signal,
        toolDefinitions: baseToolDefinitions,
      });
      const decision = semanticRoute.decision;
      recordRuntimeTelemetry(telemetry, "agent_runtime.video_intent.semantic", {
        ...telemetryPayloadForProfile(candidateProfile),
        intent: decision?.intent ?? null,
        confidence: decision?.confidence ?? null,
      });
      activeToolDefinitions = semanticRoute.toolDefinitions;
      if (semanticRoute.modelContext) modelMessages.splice(Math.max(0, modelMessages.length - 1), 0, { role: "system", content: semanticRoute.modelContext });
      if (semanticRoute.clarifyMethod) {
        releaseInteractiveRuntime(lockKey);
        return streamSemanticVideoClarification({ requestText: intentText, runtimeSessionId, runtime: profile.runtime, startedAt: fetchStartedAt, preflightProcessPayload });
      }
    }
    let sentTools = activeToolDefinitions.length > 0;
    const requestBodyFor = (withTools: boolean) => JSON.stringify({
      model,
      messages: modelMessages,
      stream: true,
      ...cacheHints.body,
      ...inferenceBody,
      ...(withTools && activeToolDefinitions.length ? { tools: activeToolDefinitions, tool_choice: "auto" } : {}),
    });
    let requestBody = requestBodyFor(sentTools);
    const requestBodyBytes = () => Buffer.byteLength(requestBody);
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.start", {
      ...telemetryPayloadForProfile(candidateProfile),
      url: candidateUrl,
      model,
      adaptiveOpenRouter,
      adaptiveProvider,
      usePod: usePodEnabled,
      offerImageTool: sentTools,
      messageCount: modelMessages.length,
      requestBodyBytes: requestBodyBytes(),
      modelVisibleMediaBytes: modelVisibleMediaBytes(mediaArtifacts),
    });
    // Tell the session up front so polling clients can show what's happening.
    if (isLocalLmStudioProfile(candidateProfile) && !adaptiveOpenRouter && !adaptiveProvider && !usePodEnabled && !isBankrLlmProfile(candidateProfile)) {
      const loadState = await lmStudioModelLoadState(candidateProfile.gatewayUrl, candidateModel);
      if (loadState === "not-loaded" || loadState === "not-local") {
        recordRuntimeTelemetry(telemetry, "agent_runtime.lm_studio.model_not_loaded", {
          ...telemetryPayloadForProfile(candidateProfile),
          model: candidateModel,
          loadState,
        });
        await appendRuntimeChatSessionEvent(
          runtimeSessionId,
          "Loading model",
          lmStudioModelLoadNotice(candidateModel, loadState),
        ).catch(() => undefined);
      }
    }
    const coldStartEvent = inferredModalColdStartProcessEvent(candidateProfile);
    if (coldStartEvent) {
      recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.cold_start", {
        ...telemetryPayloadForProfile(candidateProfile),
        url: candidateUrl,
        model,
        source: "local-success-window",
      });
      await appendRuntimeChatSessionEvent(
        runtimeSessionId,
        coldStartEvent.label,
        coldStartEvent.detail,
        { type: AGENT_COLD_START_EVENT_TYPE },
      ).catch(() => undefined);
    }
    let upstreamErrorText: string | null = null;
    try {
      upstream = await fetch(candidateUrl, {
        method: "POST",
        headers: attemptHeaders,
        body: requestBody,
        signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
      });
      // Some OpenAI-compatible providers reject a `tools` array with a 400. Retry the
      // same candidate once without tools so image chats still get a normal text reply.
      // A model-unavailable 400 is not a tools problem — retrying would only start a
      // second doomed JIT load, so surface it as-is.
      if (sentTools && !upstream.ok && upstream.status === 400) {
        upstreamErrorText = await upstream.text().catch(() => "");
        if (!isModelUnavailableErrorBody(upstreamErrorText)) {
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.tools_unsupported", {
            ...telemetryPayloadForProfile(candidateProfile),
            url: candidateUrl,
            model,
            status: upstream.status,
            elapsedMs: Date.now() - fetchStartedAt,
          });
          sentTools = false;
          upstreamErrorText = null;
          requestBody = requestBodyFor(false);
          upstream = await fetch(candidateUrl, {
            method: "POST",
            headers: attemptHeaders,
            body: requestBody,
            signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
          });
        }
      }
    } catch (error) {
      lastFetchError = error;
      recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.failed", {
        ...telemetryPayloadForProfile(candidateProfile),
        url: candidateUrl,
        model,
        adaptiveOpenRouter,
        adaptiveProvider,
        usePod: usePodEnabled,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        attempt: attemptedModels.length,
        remainingCandidates: Math.max(0, routeAttempts.length - attemptedModels.length),
        elapsedMs: Date.now() - fetchStartedAt,
      });
      if ((adaptiveOpenRouter || adaptiveProvider) && attemptedModels.length < routeAttempts.length) {
        const detail = error instanceof Error ? error.message : String(error);
        void recordAdaptiveModelOutcome(adaptiveReliabilityKey(routeAttempt.provider, candidateModel), classifyAdaptiveModelFailure(detail), detail);
        continue;
      }
      if (await startLmStudioServerForProfile(candidateProfile, candidateUrl, error)) {
        try {
          upstream = await fetch(candidateUrl, {
            method: "POST",
            headers: attemptHeaders,
            body: requestBody,
            signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
          });
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.retry_response", {
            ...telemetryPayloadForProfile(candidateProfile),
            url: candidateUrl,
            model,
            status: upstream.status,
            ok: upstream.ok,
            elapsedMs: Date.now() - fetchStartedAt,
          });
          if (upstream.ok) {
            winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, provider: routeAttempt.provider, sentTools, cacheBody: cacheHints.body, inferenceBody };
            break;
          }
        } catch (retryError) {
          lastFetchError = retryError;
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.retry_failed", {
            ...telemetryPayloadForProfile(candidateProfile),
            url: candidateUrl,
            model,
            errorName: retryError instanceof Error ? retryError.name : null,
            errorMessage: retryError instanceof Error ? retryError.message : String(retryError),
            elapsedMs: Date.now() - fetchStartedAt,
          });
        }
      }
      await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible fetch failed", runtimeFetchError(candidateProfile, candidateUrl, error)).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      releaseInteractiveRuntime(lockKey);
      return Response.json({ error: runtimeFetchError(candidateProfile, candidateUrl, error) }, { status: 502 });
    }
    if (upstream.ok) {
      recordAgentRuntimeWarm(candidateProfile);
      winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, provider: routeAttempt.provider, sentTools, cacheBody: cacheHints.body, inferenceBody };
      break;
    }
    lastStatus = upstream.status;
    const errorText = upstreamErrorText ?? await upstream.text().catch(() => "");
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.upstream_error", {
      ...telemetryPayloadForProfile(candidateProfile),
      url: candidateUrl,
      model,
      adaptiveOpenRouter,
      adaptiveProvider,
      usePod: usePodEnabled,
      status: upstream.status,
      bodyPreview: errorText.slice(0, 500),
      attempt: attemptedModels.length,
      remainingCandidates: Math.max(0, routeAttempts.length - attemptedModels.length),
      elapsedMs: Date.now() - fetchStartedAt,
    });
    if (adaptiveOpenRouter || adaptiveProvider) {
      void recordAdaptiveModelOutcome(
        adaptiveReliabilityKey(routeAttempt.provider, candidateModel),
        classifyAdaptiveModelFailure(`${upstream.status} ${errorText}`),
        errorText || `HTTP ${upstream.status}`,
      );
    }
    if ((adaptiveOpenRouter || adaptiveProvider) && retryableAdaptiveOpenRouterStatus(upstream.status) && attemptedModels.length < routeAttempts.length) {
      continue;
    }
    const upstreamErrorMessage = isLocalLmStudioProfile(candidateProfile) && isModelUnavailableErrorBody(errorText)
      ? lmStudioModelUnavailableMessage(model)
      : isVeniceProfile(profile)
        ? interpretVeniceError(upstream.status, providerErrorMessage(errorText, upstream.status, model)).message
        : providerErrorMessage(errorText, upstream.status, model);
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible upstream error", upstreamErrorMessage).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: adaptiveOpenRouter && retryableAdaptiveOpenRouterStatus(upstream.status)
        ? finalAdaptiveOpenRouterError(upstream.status, attemptedModels)
        : adaptiveProvider && retryableAdaptiveOpenRouterStatus(upstream.status)
          ? finalAdaptiveProviderError(upstream.status, attemptedModels)
        : upstreamErrorMessage }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  if (!upstream?.ok) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible upstream error", lastFetchError ? "Network issue while trying provider models." : finalAdaptiveOpenRouterError(lastStatus || 502, attemptedModels)).catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: lastFetchError
        ? `${adaptiveProvider ? "Adaptive" : "OpenRouter"} had a network issue while trying configured models. Adaptive tried ${attemptedModels.length || 1} route${attemptedModels.length === 1 ? "" : "s"}. Try again shortly or disable the failing provider in Adaptive settings.`
        : adaptiveProvider
          ? finalAdaptiveProviderError(lastStatus || 502, attemptedModels)
        : finalAdaptiveOpenRouterError(lastStatus || 502, attemptedModels) }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const usePodResponse = usePodEnabled ? summarizeUsePodResponseHeaders(upstream.headers) : null;
  if (usePodResponse) {
    const detail = [
      usePodResponse.route ? `Route: ${usePodResponse.route}` : "",
      usePodResponse.balanceRemaining ? `Balance remaining: ${usePodResponse.balanceRemaining}` : "",
    ].filter(Boolean).join(" · ");
    recordRuntimeTelemetry(telemetry, "agent_runtime.usepod.response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model,
      route: usePodResponse.route || null,
      balanceRemaining: usePodResponse.balanceRemaining || null,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "UsePod inference metadata", detail).catch(() => undefined);
  }
  const veniceResponse = isVeniceProfile(profile) ? summarizeVeniceResponseHeaders(upstream.headers) : null;
  // Forwarded on the SSE response so the dashboard can refresh the stored
  // prepaid balance right after the chat instead of waiting for a settings
  // refresh.
  const providerBalanceHeader = veniceResponse?.balanceRemaining || usePodResponse?.balanceRemaining || "";
  let responseBilling = walletPaidModelsEnabled ? hivemindosModelsBillingFromHeaders(upstream.headers) : null;
  if (veniceResponse?.balanceRemaining) {
    recordRuntimeTelemetry(telemetry, "agent_runtime.venice.response", {
      ...telemetryPayloadForProfile(runtimeProfile),
      url,
      model,
      balanceRemaining: veniceResponse.balanceRemaining,
    });
    await appendRuntimeChatSessionEvent(
      runtimeSessionId,
      "Venice inference metadata",
      `Balance remaining: ${veniceResponse.balanceRemaining}`,
    ).catch(() => undefined);
  }

  if (!upstream.body) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible response body is empty").catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    releaseInteractiveRuntime(lockKey);
    return new Response(
      ssePayload({ error: "OpenAI-compatible runtime response body is empty" }) + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const json = await upstream.json().catch(async () => ({ text: await upstream.text().catch(() => "") }));
    const rawChunk = extractChunk(json);
    const leakedToolCalls = winningRequest?.sentTools ? extractLeakedToolCalls(rawChunk) : [];
    const toolCalls = winningRequest?.sentTools ? [...extractOpenAIToolCalls(json), ...leakedToolCalls] : [];
    if (toolCalls.length && winningRequest) {
      const toolRun = await runNonStreamToolConversation({
        initialToolCalls: toolCalls,
        request: winningRequest,
        toolDefinitions: activeToolDefinitions,
        maxToolRounds: offerCommandTool ? 6 : offerXAccountTool ? 3 : 1,
        timeoutMs: RUNTIME_FETCH_TIMEOUT_MS,
        runToolCalls: runNonStreamToolCalls,
      });
      if (toolRun.prompted) {
        await finishRuntimeChatSession(runtimeSessionId, toolRun.failed ? "failed" : "completed").catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        return new Response(
          preflightProcessPayload
          + toolRun.events.join("")
          + (responseBilling ? ssePayload({ billing: responseBilling }) : "")
          + "data: [DONE]\n\n",
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              ...(providerBalanceHeader ? { "X-Provider-Balance-Remaining": providerBalanceHeader } : {}),
            },
          },
        );
      }
      const outputCheck = proxyOutput(toolRun.text);
      const routed = outputCheck.verdict === "block"
        ? { content: "", thinking: "" }
        : routeChannelMarkupText(outputCheck.text);
      const chunk = routed.content;
      const event = outputCheck.verdict === "block" ? null : await recordChatHoney(profile, userText, chunk, honeyLedgerEnabled);
      if (outputCheck.verdict === "block") {
        await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible response blocked", outputCheck.reason ?? "Response blocked by security policy").catch(() => undefined);
        await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      } else {
        await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, toolRun.raw ?? json, responseBilling ? { billing: responseBilling } : undefined).catch(() => undefined);
        await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
      }
      releaseInteractiveRuntime(lockKey);
      return new Response(
        preflightProcessPayload
        + toolRun.events.join("")
        + (routed.thinking ? ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }) : "")
        + ssePayload(outputCheck.verdict === "block"
          ? { error: outputCheck.reason ?? "Response blocked by security policy" }
          : { choices: [{ delta: { content: chunk } }] })
        + (event ? ssePayload({ honey: event }) : "")
        + (responseBilling ? ssePayload({ billing: responseBilling }) : "")
        + "data: [DONE]\n\n",
        { headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          ...(providerBalanceHeader ? { "X-Provider-Balance-Remaining": providerBalanceHeader } : {}),
        } },
      );
    }
    const visibleRawChunk = stripLeakedToolCallMarkup(rawChunk);
    const outputCheck = proxyOutput(visibleRawChunk);
    const routed = outputCheck.verdict === "block"
      ? { content: "", thinking: "" }
      : routeChannelMarkupText(outputCheck.text || (contentHasLeakedToolCallMarker(rawChunk) ? "" : JSON.stringify(json)));
    const chunk = routed.content;
    const event = outputCheck.verdict === "block" ? null : await recordChatHoney(profile, userText, chunk, honeyLedgerEnabled);
    if (outputCheck.verdict === "block") {
      await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenAI-compatible response blocked", outputCheck.reason ?? "Response blocked by security policy").catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    } else {
      await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, json, responseBilling ? { billing: responseBilling } : undefined).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
    }
    releaseInteractiveRuntime(lockKey);
    return new Response(
      preflightProcessPayload
      + (routed.thinking ? ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }) : "")
      +
      ssePayload(outputCheck.verdict === "block"
        ? { error: outputCheck.reason ?? "Response blocked by security policy" }
        : { choices: [{ delta: { content: chunk } }] })
      + (event ? ssePayload({ honey: event }) : "")
      + (responseBilling ? ssePayload({ billing: responseBilling }) : "")
      + "data: [DONE]\n\n",
      { headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...(providerBalanceHeader ? { "X-Provider-Balance-Remaining": providerBalanceHeader } : {}),
      } },
    );
  }
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        if (!runtimeSessionId) return;
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      if (runtimeSessionId) {
        controller.enqueue(encoder.encode(ssePayload({
          session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: fetchStartedAt },
        })));
      }
      if (preflightProcessPayload) controller.enqueue(encoder.encode(preflightProcessPayload));
      let fullText = "";
      // Consume one upstream SSE stream: emit content/thinking to the client exactly as
      // before, and (when allowed) accumulate any tool_calls instead of leaking them as
      // raw deltas. Returns the completed tool calls so the caller can run the tool loop.
      const consume = async (stream: Response, allowTools: boolean): Promise<{ toolCalls: AccumulatedToolCall[] }> => {
        const streamReader = stream.body?.getReader();
        if (!streamReader) return { toolCalls: [] };
        let buffer = "";
        let leakedToolCallBuffer = "";
        const channelMarkupState = createChannelMarkupState();
        const toolAcc = new Map<number, AccumulatedToolCall>();
        const appendVisibleContent = (content: string, parsed?: unknown) => {
          if (!content) return;
          if (leakedToolCallBuffer) {
            leakedToolCallBuffer += content;
            return;
          }
          const marker = firstLeakedToolCallMarkerIndex(content);
          if (marker >= 0) {
            const visible = content.slice(0, marker);
            leakedToolCallBuffer = content.slice(marker);
            if (!visible) return;
            content = visible;
          }
          fullText += content;
          if (runtimeSessionId) queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", content, parsed));
          controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content } }] })));
        };
        while (true) {
          const { value, done } = await streamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const eventText of events) {
            const dataLine = eventText.split("\n").find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const raw = dataLine.replace(/^data:\s*/, "");
            if (raw === "[DONE]") continue;
            try {
              const parsed = JSON.parse(raw);
              const managedBilling = normalizeChatResponseBilling(parsed?.hivemindos_billing);
              if (managedBilling) {
                responseBilling = managedBilling;
                continue;
              }
              const toolDeltas = parsed?.choices?.[0]?.delta?.tool_calls;
              if (Array.isArray(toolDeltas) && toolDeltas.length) {
                if (allowTools) {
                  for (const toolDelta of toolDeltas) {
                    const index = typeof toolDelta?.index === "number" ? toolDelta.index : 0;
                    const slot = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
                    if (typeof toolDelta?.id === "string" && toolDelta.id) slot.id = toolDelta.id;
                    if (typeof toolDelta?.function?.name === "string" && toolDelta.function.name) slot.name = toolDelta.function.name;
                    if (typeof toolDelta?.function?.arguments === "string") slot.arguments += toolDelta.function.arguments;
                    toolAcc.set(index, slot);
                  }
                }
                continue;
              }
              const outputCheck = proxyOutput(extractChunk(parsed));
              const reasoningCheck = proxyOutput(extractReasoningChunk(parsed));
              if (outputCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" })));
                continue;
              }
              if (reasoningCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: reasoningCheck.reason ?? "Response blocked by security policy" })));
                continue;
              }
              const routed = routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              const thinking = [reasoningCheck.text, routed.thinking].filter(Boolean).join("");
              if (thinking) {
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", thinking, parsed));
                controller.enqueue(encoder.encode(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: thinking })));
              }
              if (!routed.content && !thinking && isTerminalOpenAiStreamMetadata(parsed)) continue;
              if (!routed.content && !thinking) queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime event", String(parsed?.type ?? parsed?.event?.type ?? "").trim(), parsed));
              if (routed.content) {
                appendVisibleContent(routed.content, parsed);
              } else if (!thinking && !outputCheck.text) {
                controller.enqueue(encoder.encode(ssePayload(parsed)));
              }
            } catch {
              const outputCheck = proxyOutput(raw);
              const routed = outputCheck.verdict === "block"
                ? { content: "", thinking: "" }
                : routeChannelMarkupDelta(outputCheck.text, channelMarkupState);
              if (outputCheck.verdict === "block") {
                controller.enqueue(encoder.encode(ssePayload({ error: outputCheck.reason ?? "Response blocked by security policy" })));
              }
              if (routed.thinking) {
                queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", routed.thinking));
                controller.enqueue(encoder.encode(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking })));
              }
              if (routed.content) {
                appendVisibleContent(routed.content);
              }
            }
          }
        }
        const flushedTail = flushChannelMarkup(channelMarkupState);
        if (flushedTail.thinking) {
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Thinking", flushedTail.thinking));
          controller.enqueue(encoder.encode(ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: flushedTail.thinking })));
        }
        if (flushedTail.content) {
          appendVisibleContent(flushedTail.content);
        }
        if (allowTools && leakedToolCallBuffer) {
          for (const call of extractLeakedToolCalls(leakedToolCallBuffer)) {
            const index = toolAcc.size;
            toolAcc.set(index, call);
          }
        }
        return { toolCalls: [...toolAcc.values()].filter((call) => call.name) };
      };

      // Execute the generate_image tool: stream a running card, dispatch to the connected
      // image app (which runs the appScore endpoint-strength ranking), then a ready/error
      // card. Returns the tool-result payload and a fallback line for the continuation turn.
      const runImageToolCall = async (call: AccumulatedToolCall) => {
        const args = parseToolCallArguments(call.arguments);
        const imagePrompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : userText;
        controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: { status: "running", prompt: imagePrompt, title: "Image generation" } })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation", "Dispatching the prompt to the best reachable connected image app."));
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          url,
          model,
          promptLength: imagePrompt.length,
        });
        // Image dispatch can poll for up to ~2 minutes. Emit an inert keepalive every 20s
        // so the client's 130s stall-abort timer never fires mid-generation.
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(ssePayload({})));
          } catch {
            // controller already closed; nothing to keep alive
          }
        }, 20_000);
        try {
          const result = await dispatchImageGenerationViaRoute(requestOrigin, imagePrompt, telemetry?.request?.signal);
          clearInterval(heartbeat);
          const artifacts = imageGenerationArtifacts(result.images);
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: {
            status: "ready",
            prompt: result.prompt || imagePrompt,
            title: "Image generation",
            appName: result.app?.name,
            machineName: result.app?.machineName,
            artifacts,
            completedAt: Date.now(),
          } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation completed", `${artifacts.length} image${artifacts.length === 1 ? "" : "s"} from ${result.app?.name ?? "connected app"}.`));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.completed", {
            ...telemetryPayloadForProfile(profile),
            appName: result.app?.name ?? null,
            endpoint: result.endpoint ?? null,
            imageCount: artifacts.length,
          });
          return {
            toolResultContent: JSON.stringify({ ok: true, app: result.app?.name, endpoint: result.endpoint, images: artifacts.map((artifact) => artifact.url) }),
            fallbackText: artifacts.length
              ? `Generated ${artifacts.length} image${artifacts.length === 1 ? "" : "s"} with ${result.app?.name ?? "the connected app"}.`
              : "The image generation finished.",
          };
        } catch (error) {
          clearInterval(heartbeat);
          const message = error instanceof Error ? error.message : "Image generation failed.";
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: { status: "error", prompt: imagePrompt, title: "Image generation", error: message } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Image generation failed", message));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.image_tool.failed", {
            ...telemetryPayloadForProfile(profile),
            errorMessage: message,
          });
          return {
            toolResultContent: JSON.stringify({ ok: false, error: message }),
            fallbackText: `I couldn't complete the image generation: ${message}`,
          };
        }
      };

      const runVideoToolCall = async (call: AccumulatedToolCall) => {
        const args = parseToolCallArguments(call.arguments);
        const videoPrompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : userText;
        const inputImages = videoInputImagesForArgs(args, mediaArtifacts);
        controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: {
          status: "running",
          prompt: videoPrompt,
          title: "Video generation",
          kind: "video",
          createdAt: Date.now(),
        } })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(
          runtimeSessionId,
          "Video generation",
          inputImages.length
            ? `Dispatching the prompt with ${inputImages.length} source image to the best reachable connected video app.`
            : "Dispatching the prompt to the best reachable connected video app.",
        ));
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.video_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          url,
          model,
          promptLength: videoPrompt.length,
          inputImageCount: inputImages.length,
        });
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(ssePayload({})));
          } catch {
            // controller already closed; nothing to keep alive
          }
        }, 20_000);
        try {
          const result = await dispatchVideoGenerationViaRoute(requestOrigin, videoPrompt, inputImages, telemetry?.request?.signal);
          clearInterval(heartbeat);
          const artifacts = videoGenerationArtifacts(result.videos);
          const completedAt = Date.now();
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: {
            status: "ready",
            kind: "video",
            prompt: result.prompt || videoPrompt,
            title: "Video generation",
            appName: result.app?.name,
            machineName: result.app?.machineName,
            artifacts,
            completedAt,
          } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Video generation completed", `${artifacts.length} video${artifacts.length === 1 ? "" : "s"} from ${result.app?.name ?? "connected app"}.`));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.video_tool.completed", {
            ...telemetryPayloadForProfile(profile),
            appName: result.app?.name ?? null,
            endpoint: result.endpoint ?? null,
            videoCount: artifacts.length,
          });
          return {
            toolResultContent: JSON.stringify({ ok: true, app: result.app?.name, endpoint: result.endpoint, videos: artifacts.map((artifact) => artifact.url) }),
            fallbackText: artifacts.length
              ? `Generated ${artifacts.length} video${artifacts.length === 1 ? "" : "s"} with ${result.app?.name ?? "the connected app"}.`
              : "The video generation finished.",
          };
        } catch (error) {
          clearInterval(heartbeat);
          const message = error instanceof Error ? error.message : "Video generation failed.";
          controller.enqueue(encoder.encode(ssePayload({ applicationGeneration: { status: "error", kind: "video", prompt: videoPrompt, title: "Video generation", error: message, completedAt: Date.now() } })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Video generation failed", message));
          recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.video_tool.failed", {
            ...telemetryPayloadForProfile(profile),
            errorMessage: message,
          });
          return {
            toolResultContent: JSON.stringify({ ok: false, error: message }),
            fallbackText: `I couldn't complete the video generation: ${message}`,
          };
        }
      };

      // Execute a run_command tool call: stream a running/finished tool card (the
      // same chat.tool.* shape the dashboard + mobile client render), run the
      // allowlisted command, then return the tool-result payload for the
      // continuation turn. Real local execution — see command-tool.ts.
      const runCommandToolCall = async (call: AccumulatedToolCall) => {
        const args = parseToolCallArguments(call.arguments);
        const commandLine = [
          typeof args.command === "string" ? args.command : "",
          ...(Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : []),
        ].filter(Boolean).join(" ");
        const label = typeof args.reason === "string" && args.reason.trim()
          ? args.reason.trim()
          : `Run ${typeof args.command === "string" && args.command ? args.command : "command"}`;
        controller.enqueue(encoder.encode(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
          toolName: RUN_COMMAND_TOOL_NAME,
          name: RUN_COMMAND_TOOL_NAME,
          message: label,
          detail: commandLine,
          status: "running",
        })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, label, commandLine));
        recordRuntimeTelemetry(telemetry, "agent_runtime.command_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          command: typeof args.command === "string" ? args.command : null,
          argCount: Array.isArray(args.args) ? args.args.length : 0,
        });
        const result = await runAgentCommand({
          command: args.command,
          args: args.args,
          cwd: workingDirectory,
          permissionMode: permissionMode,
          signal: telemetry?.request?.signal,
        });
        if (result.blockedByPolicy && !allowUnlistedCommands) {
          const command = typeof args.command === "string" ? args.command.trim() : "";
          const commandArgs = Array.isArray(args.args) ? args.args.filter((a): a is string => typeof a === "string") : [];
          const approvalEvent = commandApprovalEvent({
            command,
            args: commandArgs,
            commandLine,
            label,
            error: result.error,
          });
          controller.enqueue(encoder.encode(ssePayload({
            type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
            toolName: RUN_COMMAND_TOOL_NAME,
            name: RUN_COMMAND_TOOL_NAME,
            message: "Command needs permission",
            detail: commandLine || result.error || "Command blocked by permissions",
            status: "running",
          })));
          controller.enqueue(encoder.encode(ssePayload(approvalEvent)));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Command permission required", commandLine || result.error, approvalEvent));
          recordRuntimeTelemetry(telemetry, "agent_runtime.command_tool.permission_required", {
            ...telemetryPayloadForProfile(profile),
            command,
            argCount: commandArgs.length,
            permissionMode: permissionMode,
          });
          return {
            toolResultContent: JSON.stringify({ ok: false, approvalRequired: true, error: result.error }),
            fallbackText: "",
            prompted: true,
          };
        }
        controller.enqueue(encoder.encode(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          toolName: RUN_COMMAND_TOOL_NAME,
          name: RUN_COMMAND_TOOL_NAME,
          message: label,
          detail: result.ok
            ? (result.stdout?.split("\n").find(Boolean)?.slice(0, 200) || "Done")
            : (result.error || result.stderr || "Failed"),
          status: result.ok ? "completed" : "failed",
        })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(
          runtimeSessionId,
          result.ok ? "Command finished" : "Command failed",
          (result.stdout || result.stderr || result.error || "").slice(0, 500),
        ));
        recordRuntimeTelemetry(telemetry, result.ok ? "agent_runtime.command_tool.completed" : "agent_runtime.command_tool.failed", {
          ...telemetryPayloadForProfile(profile),
          command: result.command || null,
          exitCode: result.exitCode ?? null,
          elapsedMs: result.elapsedMs,
        });
        return {
          toolResultContent: JSON.stringify({
            ok: result.ok,
            command: result.command,
            args: result.args,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            error: result.error,
          }),
          fallbackText: result.ok
            ? `Ran \`${commandLine}\`.`
            : commandFailureFallbackText(commandLine, result),
        };
      };

      const runBankrToolCall = async (call: AccumulatedToolCall): Promise<ToolCallOutcome> => {
        const args = parseToolCallArguments(call.arguments);
        const prompt = typeof args.prompt === "string" && args.prompt.trim() ? args.prompt.trim() : userText;
        const label = "Bankr action";
        controller.enqueue(encoder.encode(ssePayload({
          type: RUNTIME_STREAM_EVENT_TYPES.TOOL_START,
          toolName: BANKR_ACTION_TOOL_NAME,
          name: BANKR_ACTION_TOOL_NAME,
          message: label,
          detail: prompt,
          status: "running",
        })));
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, label, prompt));
        recordRuntimeTelemetry(telemetry, "agent_runtime.bankr_action_tool.dispatch", {
          ...telemetryPayloadForProfile(profile),
          intent: typeof args.intent === "string" ? args.intent : null,
          hasJobId: typeof args.jobId === "string" && Boolean(args.jobId.trim()),
        });
        try {
          const outcome = await runBankrActionTool({ ...args, prompt });
          const message = typeof outcome.message === "string" && outcome.message.trim()
            ? outcome.message.trim()
            : outcome.ok
              ? "Bankr action complete."
              : `Bankr action failed: ${typeof outcome.error === "string" ? outcome.error : "unknown error"}`;
          controller.enqueue(encoder.encode(ssePayload({
            type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
            toolName: BANKR_ACTION_TOOL_NAME,
            name: BANKR_ACTION_TOOL_NAME,
            message: outcome.ok ? "Bankr action ready" : "Bankr action failed",
            detail: message.slice(0, 500),
            status: outcome.ok ? "completed" : "failed",
          })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, outcome.ok ? "Bankr action finished" : "Bankr action failed", message.slice(0, 500)));
          recordRuntimeTelemetry(telemetry, outcome.ok ? "agent_runtime.bankr_action_tool.completed" : "agent_runtime.bankr_action_tool.failed", {
            ...telemetryPayloadForProfile(profile),
            prepared: outcome.ok && "prepared" in outcome ? outcome.prepared === true : false,
            errorMessage: outcome.ok ? null : outcome.error ?? null,
          });
          return {
            toolResultContent: JSON.stringify(outcome),
            fallbackText: message,
            finalText: message,
          };
        } catch (error) {
          const message = `Bankr action failed: ${error instanceof Error ? error.message : String(error)}`;
          controller.enqueue(encoder.encode(ssePayload({
            type: RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
            toolName: BANKR_ACTION_TOOL_NAME,
            name: BANKR_ACTION_TOOL_NAME,
            message: "Bankr action failed",
            detail: message,
            status: "failed",
          })));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Bankr action failed", message));
          recordRuntimeTelemetry(telemetry, "agent_runtime.bankr_action_tool.failed", {
            ...telemetryPayloadForProfile(profile),
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          return {
            toolResultContent: JSON.stringify({ ok: false, error: message }),
            fallbackText: message,
            finalText: message,
          };
        }
      };

      // Dispatch one accumulated tool call by name. Unknown tools return an
      // error result so the model can recover instead of stalling.
      const runToolCall = async (call: AccumulatedToolCall): Promise<ToolCallOutcome> => {
        if (call.name === IMAGE_GENERATION_TOOL_NAME) return runImageToolCall(call);
        if (call.name === VIDEO_GENERATION_TOOL_NAME) return runVideoToolCall(call);
        if (call.name === BANKR_ACTION_TOOL_NAME) return runBankrToolCall(call);
        if (call.name === X_ACCOUNT_RUNTIME_TOOL_NAME) return runXAccountRuntimeTool(call.arguments);
        if (call.name === INVOKE_HIVE_CAPABILITY_TOOL_NAME) {
          const outcome = await runInvokeHiveCapabilityTool(call.arguments, { origin: requestOrigin, permissionMode: permissionMode, userText: intentText });
          const runtimeEvent = invokeHiveCapabilityRuntimeEvent(outcome);
          controller.enqueue(encoder.encode(ssePayload(runtimeEvent)));
          queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, runtimeEvent.message, runtimeEvent.detail));
          if (!outcome.ok && !outcome.approvalRequired) {
            recordRuntimeTelemetry(telemetry, "agent_runtime.hive_capability.failed", {
              ...telemetryPayloadForProfile(profile),
              error: outcome.fallbackText,
              nonStream: false,
            });
          }
          return outcome;
        }
        if (call.name === RUN_COMMAND_TOOL_NAME) return runCommandToolCall(call);
        return {
          toolResultContent: JSON.stringify({ ok: false, error: `Unknown tool: ${call.name}` }),
          fallbackText: "",
        };
      };

      try {
        let active: Response = upstream as Response;
        // The image tool needs a single round; the command tool can chain
        // several (inspect → act → verify), so allow a bounded number when it
        // is on offer. Each round consumes the model's tool_calls, runs them,
        // and feeds the results back for a continuation turn.
        let toolRoundsLeft = winningRequest?.sentTools
          ? offerCommandTool ? 6 : offerXAccountTool ? 3 : 1
          : 0;
        const conversation: Array<Record<string, unknown>> = winningRequest
          ? [...(winningRequest.messages as unknown as Array<Record<string, unknown>>)]
          : [];
        while (true) {
          const { toolCalls: returnedToolCalls } = await consume(active, toolRoundsLeft > 0);
          const toolCalls = returnedToolCalls;
          if (!toolCalls.length || toolRoundsLeft <= 0 || !winningRequest) break;
          toolRoundsLeft -= 1;
          // Run every tool call the model emitted this round and collect the
          // assistant tool_calls + tool results for the continuation request.
          const assistantToolCalls: Array<Record<string, unknown>> = [];
          const toolResultMessages: Array<Record<string, unknown>> = [];
          const fallbacks: string[] = [];
          const finalTexts: string[] = [];
          let toolPrompted = false;
          for (const call of toolCalls) {
            const callId = call.id || `call_${call.name}`;
            const outcome = await runToolCall(call);
            if (outcome.prompted) {
              toolPrompted = true;
              break;
            }
            assistantToolCalls.push({ id: callId, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } });
            toolResultMessages.push({ role: "tool", tool_call_id: callId, content: outcome.toolResultContent });
            if (outcome.fallbackText) fallbacks.push(outcome.fallbackText);
            if (outcome.finalText) finalTexts.push(outcome.finalText);
          }
          if (toolPrompted) break;
          if (finalTexts.length) {
            const finalText = finalTexts.join("\n\n");
            controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: finalText } }] })));
            fullText += finalText;
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", finalText));
            break;
          }
          conversation.push({ role: "assistant", content: "", tool_calls: assistantToolCalls });
          conversation.push(...toolResultMessages);
          // Keep offering tools on the continuation so the model can chain
          // another command; stop offering once the round budget is spent.
          const continuationBody: Record<string, unknown> = {
            model: winningRequest.model,
            messages: conversation,
            stream: true,
            ...winningRequest.cacheBody,
            ...winningRequest.inferenceBody,
            ...(toolRoundsLeft > 0 && activeToolDefinitions.length ? { tools: activeToolDefinitions, tool_choice: "auto" } : {}),
          };
          let continuation: Response | null = null;
          try {
            continuation = await fetch(winningRequest.url, {
              method: "POST",
              headers: winningRequest.headers,
              body: JSON.stringify(continuationBody),
              signal: AbortSignal.timeout(RUNTIME_FETCH_TIMEOUT_MS),
            });
          } catch {
            continuation = null;
          }
          if (!continuation || !continuation.ok || !continuation.body) {
            const fallbackText = fallbacks.join(" ") || "The tool finished.";
            controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: fallbackText } }] })));
            fullText += fallbackText;
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", fallbackText));
            break;
          }
          active = continuation;
        }
        if ((adaptiveOpenRouter || adaptiveProvider) && winningRequest && fullText.trim()) {
          // Same quality gate as the Hermes adaptive loop: success only counts
          // once the completed text survives the garbage checks; a fail grades
          // the model down for future routing without touching this response.
          const quality = assessAdaptiveResponseQuality(userText, fullText);
          const reliabilityKey = adaptiveReliabilityKey(winningRequest.provider, winningRequest.model);
          void recordAdaptiveModelOutcome(reliabilityKey, quality.ok ? "success" : "low-quality", quality.reason);
          if (!quality.ok) {
            queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Adaptive quality flag", `${reliabilityKey}: ${quality.reason}`));
          }
        }
        const event = await recordChatHoney(profile, userText, fullText, honeyLedgerEnabled);
        if (event) controller.enqueue(encoder.encode(ssePayload({ honey: event })));
        if (responseBilling) {
          const billing = responseBilling;
          queueSessionWrite(() => updateRuntimeChatSessionLastAssistantBilling(runtimeSessionId, billing));
          controller.enqueue(encoder.encode(ssePayload({ billing })));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.stream.done", {
          ...telemetryPayloadForProfile(profile),
          url,
          model,
          adaptiveOpenRouter,
          outputLength: fullText.length,
          elapsedMs: Date.now() - fetchStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "OpenAI-compatible stream failed";
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime stream failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        controller.enqueue(encoder.encode(ssePayload({ error: message })));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await sessionWrite.catch(() => undefined);
        releaseInteractiveRuntime(lockKey);
        controller.close();
      }
    },
  });
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(providerBalanceHeader ? { "X-Provider-Balance-Remaining": providerBalanceHeader } : {}),
    },
  });
}

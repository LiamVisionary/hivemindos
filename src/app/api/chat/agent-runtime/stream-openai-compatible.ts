import { HIVEMIND_OS_RUNTIME, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { internalApiAuthHeaders } from "@/lib/utils/internal-api-auth";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";
import { proxyInput, proxyOutput } from "@/lib/services/agent-security-proxy";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import { isUsePodProfile, resolveUsePodRuntimeConfig, summarizeUsePodResponseHeaders } from "@/lib/services/usepod";
import { interpretVeniceError, isVeniceProfile, resolveVeniceRuntimeConfig, summarizeVeniceResponseHeaders } from "@/lib/services/venice";
import {
  isBankrAdaptiveModel,
  isBankrLlmProfile,
  resolveBankrLlmRuntimeProfile,
  resolveAdaptiveBankrLlmModels,
} from "@/lib/services/bankr-llm";
import {
  isHivemindosWalletPaidModelProfile,
  resolveHivemindosWalletPaidModelRuntimeConfig,
} from "@/lib/services/hivemindos-wallet-paid-models";
import {
  bankrActionToolDefinition,
  BANKR_ACTION_TOOL_NAME,
  runBankrActionTool,
} from "@/lib/services/bankr-actions";
import { imageGenerationRequest } from "@/lib/services/chat/task-retrieval-context";
import {
  buildHivemindPromptEnvelope,
  prependHivemindSystemMessage,
} from "@/lib/services/chat/hivemind-system-prompt";
import { resolveAdaptiveOpenRouterModels } from "@/lib/services/chat/adaptive-openrouter-models";
import {
  flushChannelMarkup,
  routeChannelMarkupText,
} from "@/lib/services/chat/channel-markup";
import { type AdaptiveRoutePlan } from "@/lib/services/chat/adaptive-model-router";
import { adaptiveReliabilityKey, assessAdaptiveResponseQuality, classifyAdaptiveModelFailure, recordAdaptiveModelOutcome } from "@/lib/services/chat/adaptive-model-reliability";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
  updateRuntimeChatSessionLastAssistantBilling,
} from "@/lib/services/chat/runtime-session-store";
import { RUN_COMMAND_TOOL_NAME, runAgentCommand, runCommandToolDefinition } from "@/lib/services/agent-shell/command-tool";
import {
  createChannelMarkupState,
  extractChunk,
  extractReasoningChunk,
  extractUserText,
  isTerminalOpenAiStreamMetadata,
  routeChannelMarkupDelta,
  ssePayload,
  unwrapLatestUserRequest,
  type IncomingMessage,
} from "./messages";
import { recordRuntimeTelemetry, telemetryPayloadForProfile, type RuntimeRouteTelemetry } from "./route-telemetry";
import {
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
  buildAdaptiveOpenRouterResolvedModelContext,
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

function numericHeader(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stringHeader(headers: Headers, name: string) {
  const value = headers.get(name)?.trim();
  return value || undefined;
}

function hivemindosModelsBillingFromHeaders(headers: Headers): ChatResponseBilling | null {
  const creditDebitUsd = numericHeader(headers, "X-HivemindOS-Models-Credit-Debited-Usd");
  const creditBalanceUsd = numericHeader(headers, "X-HivemindOS-Models-Credit-Balance-Usd");
  const walletDebitUsd = numericHeader(headers, "X-HivemindOS-Wallet-Paid-Amount-Usd");
  const paidHeader = stringHeader(headers, "X-HivemindOS-Wallet-Paid");
  const costUsd = creditDebitUsd ?? walletDebitUsd;
  if (costUsd === undefined && creditBalanceUsd === undefined && !paidHeader) return null;
  return {
    provider: "hivemindos-models",
    label: "HivemindOS Models",
    source: creditDebitUsd !== undefined ? "prepaid-credit" : paidHeader === "x402" ? "x402" : undefined,
    costUsd,
    balanceUsd: creditBalanceUsd,
    paid: creditDebitUsd !== undefined || walletDebitUsd !== undefined || paidHeader === "x402",
    network: stringHeader(headers, "X-HivemindOS-Wallet-Paid-Network"),
  };
}

const IMAGE_TOOL_DISPATCH_TIMEOUT_MS = 190_000;
const IMAGE_GENERATION_TOOL_NAME = "generate_image";

// Single tool offered to OpenAI-compatible models when the user is asking for an
// image. The model only supplies the prompt; HivemindOS picks the best reachable
// connected app server-side (see appScore in /api/chat/image-generation), so the
// "strongest endpoint wins" ranking applies instead of a name-only model guess.
function imageGenerationToolDefinition() {
  return {
    type: "function",
    function: {
      name: IMAGE_GENERATION_TOOL_NAME,
      description: "Generate an image from a text prompt using a connected HivemindOS image-generation app (for example Open Generative AI, ComfyUI, or Z-Image). Call this whenever the user asks to generate, create, draw, or render an image. HivemindOS automatically routes to the best reachable connected app, so do not pick an app yourself — just pass the full prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The complete image-generation prompt to render." },
        },
        required: ["prompt"],
      },
    },
  };
}

type AccumulatedToolCall = { id: string; name: string; arguments: string };
type ToolCallOutcome = { toolResultContent: string; fallbackText: string; finalText?: string };

function parseToolCallArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractOpenAIToolCalls(payload: unknown): AccumulatedToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as {
    choices?: Array<{
      message?: { tool_calls?: unknown };
      delta?: { tool_calls?: unknown };
    }>;
    message?: { tool_calls?: unknown };
    tool_calls?: unknown;
  };
  const rawCalls = record.choices?.flatMap((choice) => (
    Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls
      : Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls
        : []
  )) ?? (Array.isArray(record.message?.tool_calls) ? record.message.tool_calls : Array.isArray(record.tool_calls) ? record.tool_calls : []);
  return rawCalls
    .map((toolCall, index): AccumulatedToolCall | null => {
      if (!toolCall || typeof toolCall !== "object") return null;
      const entry = toolCall as { id?: unknown; function?: { name?: unknown; arguments?: unknown }; name?: unknown; arguments?: unknown };
      const name = typeof entry.function?.name === "string" ? entry.function.name : typeof entry.name === "string" ? entry.name : "";
      if (!name.trim()) return null;
      const args = typeof entry.function?.arguments === "string" ? entry.function.arguments : typeof entry.arguments === "string" ? entry.arguments : "";
      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : `call_${index}`,
        name,
        arguments: args,
      };
    })
    .filter((call): call is AccumulatedToolCall => Boolean(call));
}

type ImageGenerationDispatchResult = {
  ok: boolean;
  error?: string;
  prompt?: string;
  app?: { id?: string; name?: string; machineName?: string; serviceKind?: string };
  endpoint?: string;
  images?: Array<{ url: string; width?: number; height?: number; seed?: string | number }>;
};

async function dispatchImageGenerationViaRoute(origin: string, prompt: string, signal?: AbortSignal): Promise<ImageGenerationDispatchResult> {
  const response = await fetch(new URL("/api/chat/image-generation", origin), {
    method: "POST",
    // Self-fetches 401 without the server's own device token since the API
    // auth gate moved to src/proxy.ts.
    headers: { "Content-Type": "application/json", ...internalApiAuthHeaders() },
    body: JSON.stringify({ prompt }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(IMAGE_TOOL_DISPATCH_TIMEOUT_MS),
  });
  const json = await response.json().catch(() => null) as ImageGenerationDispatchResult | null;
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Image generation failed (${response.status}).`);
  }
  return json;
}

function imageGenerationArtifacts(images?: Array<{ url: string }>) {
  const urls = (images ?? []).map((image) => image?.url).filter((url): url is string => Boolean(url));
  return urls.map((url, index) => ({
    kind: "image",
    url,
    label: urls.length === 1 ? "Generated image" : `Generated image ${index + 1}`,
  }));
}

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
) {
  const inputCheck = proxyInput(userText);
  if (inputCheck.verdict === "block") {
    return Response.json({ error: inputCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  let runtimeProfile = profile;
  let usePodHeaders: Record<string, string> = {};
  let providerHeaders: Record<string, string> = {};
  const usePodEnabled = isUsePodProfile(profile);
  const walletPaidModelsEnabled = isHivemindosWalletPaidModelProfile(profile);
  const requestOrigin = (() => {
    try {
      return new URL(telemetry?.request?.url ?? "").origin;
    } catch {
      return "";
    }
  })();
  try {
    const usePodConfig = await resolveUsePodRuntimeConfig(profile);
    if (usePodConfig) {
      runtimeProfile = {
        ...profile,
        gatewayUrl: usePodConfig.baseUrl,
        chatPath: usePodConfig.chatPath,
        statusPath: usePodConfig.statusPath,
        token: "",
      };
      usePodHeaders = usePodConfig.headers;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "UsePod setup is incomplete." }, { status: 502 });
  }
  if (isVeniceProfile(profile)) {
    try {
      const veniceConfig = await resolveVeniceRuntimeConfig(profile);
      if (veniceConfig) {
        runtimeProfile = {
          ...profile,
          gatewayUrl: veniceConfig.baseUrl,
          chatPath: veniceConfig.chatPath,
          statusPath: veniceConfig.statusPath,
          token: "",
        };
        // Wallet mode signs a short-lived Sign-In-With-X header per request;
        // API-key mode is a plain bearer token. Either way the profile token
        // must stay empty so no stale Authorization header is added.
        providerHeaders = veniceConfig.headers;
      }
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Venice setup is incomplete." }, { status: 502 });
    }
  }
  if (isBankrLlmProfile(profile)) {
    const resolved = await resolveBankrLlmRuntimeProfile(runtimeProfile);
    if (resolved.error) return Response.json({ error: resolved.error }, { status: 400 });
    runtimeProfile = resolved.profile;
    providerHeaders = resolved.headers;
  }
  if (walletPaidModelsEnabled) {
    try {
      const walletPaidConfig = resolveHivemindosWalletPaidModelRuntimeConfig(profile, wallet, requestOrigin);
      runtimeProfile = {
        ...profile,
        gatewayUrl: walletPaidConfig.baseUrl,
        chatPath: walletPaidConfig.chatPath,
        statusPath: walletPaidConfig.statusPath,
        model: walletPaidConfig.model,
        token: "",
        telemetryUrl: "",
      };
      providerHeaders = {
        ...providerHeaders,
        ...walletPaidConfig.headers,
      };
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "HivemindOS Models setup is incomplete." }, { status: 400 });
    }
  }
  const url = buildOpenAICompatibleUrl(runtimeProfile);
  const lockKey = interactiveRuntimeLockKey(runtimeProfile, url);
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
  const modelMessagesFor = (candidateProfile: AgentProfile, candidateModel: string) => {
    const promptEnvelope = buildHivemindPromptEnvelope({
      profile: candidateProfile,
      agentMode,
      workingDirectory,
      vaultContext: vaultPromptContext,
      sharedBrainMemoryContext,
      taskRetrievalContext,
      wallet,
      runtimeSessionId,
      extraDynamicContext: buildAdaptiveOpenRouterResolvedModelContext(runtimeProfile, candidateModel),
    });
    return prependHivemindSystemMessage(messages, promptEnvelope);
  };
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
  // Tool offers key on the user's bare request: FAB briefings and the Queen
  // voice pipeline's flattened persona/history would otherwise re-trigger an
  // offer on every turn (weak local models then CALL the offered tool even for
  // "nothing much"). Falls back to the full text for ordinary chat messages.
  const intentText = extractUserText(unwrapLatestUserRequest(messages)).trim() || userText;
  // Only advertise the image tool when the user is actually asking for an image and we
  // can reach our own dispatch route. Every other chat is byte-for-byte unchanged.
  const offerImageTool = Boolean(requestOrigin) && imageGenerationRequest(intentText);
  // Advertise the real-command tool to agents whose profile declares the
  // skillActions runtime capability. This gives a hivemind-os chat agent an
  // actual local-execution loop (allowlisted commands) instead of letting it
  // role-play "I ran osascript…". Agents without the capability are unchanged.
  const offerCommandTool = profile.runtimeCapabilities?.skillActions === true;
  const offerBankrTool = /\b(bankr|bnkr|polymarket|hyperliquid|token\s+launch|launch\s+a\s+token|swap|dca|twap|nft|portfolio|wallet\s+balance|agent\s+api)\b/i.test(intentText);
  // Tool definitions advertised on every request attempt. Empty → no tools
  // field is sent and the chat path is byte-for-byte unchanged.
  const toolDefinitions = [
    ...(offerImageTool ? [imageGenerationToolDefinition()] : []),
    ...(offerBankrTool ? [bankrActionToolDefinition()] : []),
    ...(offerCommandTool ? [runCommandToolDefinition()] : []),
  ];
  const commandSuccessText = (label: string, commandLine: string) => {
    const cleanLabel = label.trim();
    if (/^open\b/i.test(cleanLabel)) {
      const sentence = cleanLabel.replace(/^open\b/i, "Opened");
      return sentence.endsWith(".") ? sentence : `${sentence}.`;
    }
    if (cleanLabel && !/^run\b/i.test(cleanLabel)) return cleanLabel.endsWith(".") ? cleanLabel : `${cleanLabel}.`;
    return `Ran \`${commandLine}\`.`;
  };
  const runNonStreamToolCalls = async (toolCalls: AccumulatedToolCall[]) => {
    const events: string[] = [];
    const finalTexts: string[] = [];
    for (const call of toolCalls) {
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
        finalTexts.push(message);
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
        finalTexts.push(`Command failed: ${message}`);
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
        signal: telemetry?.request?.signal,
      });
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
      finalTexts.push(result.ok
        ? commandSuccessText(label, commandLine)
        : `Command failed: ${result.error ?? result.stderr ?? "unknown error"}`);
    }
    return { events, text: finalTexts.filter(Boolean).join("\n\n") || "Done." };
  };
  let winningRequest: { url: string; headers: Record<string, string>; messages: IncomingMessage[]; model: string; provider: string; sentTools: boolean } | null = null;
  const fetchStartedAt = Date.now();
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
    const attemptHeaders = {
      "Content-Type": "application/json",
      ...(candidateProfile.token ? { Authorization: `Bearer ${candidateProfile.token}` } : {}),
      ...usePodHeaders,
      ...providerHeaders,
      ...(routeAttempt.headers ?? {}),
    };
    let sentTools = toolDefinitions.length > 0;
    const requestBodyFor = (withTools: boolean) => JSON.stringify({
      model,
      messages: modelMessages,
      stream: true,
      ...(withTools && toolDefinitions.length ? { tools: toolDefinitions, tool_choice: "auto" } : {}),
    });
    recordRuntimeTelemetry(telemetry, "agent_runtime.openai_compatible.fetch.start", {
      ...telemetryPayloadForProfile(candidateProfile),
      url: candidateUrl,
      model,
      adaptiveOpenRouter,
      adaptiveProvider,
      usePod: usePodEnabled,
      offerImageTool: sentTools,
      messageCount: modelMessages.length,
    });
    // A cold LM Studio model makes the chat fetch block on a JIT load with
    // zero feedback (a dead LM Link host holds it ~70s before failing).
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
    let upstreamErrorText: string | null = null;
    try {
      upstream = await fetch(candidateUrl, {
        method: "POST",
        headers: attemptHeaders,
        body: requestBodyFor(sentTools),
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
          upstream = await fetch(candidateUrl, {
            method: "POST",
            headers: attemptHeaders,
            body: requestBodyFor(false),
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
            body: requestBodyFor(sentTools),
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
            winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, provider: routeAttempt.provider, sentTools };
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
      winningRequest = { url: candidateUrl, headers: attemptHeaders, messages: modelMessages, model, provider: routeAttempt.provider, sentTools };
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
  const responseBilling = walletPaidModelsEnabled ? hivemindosModelsBillingFromHeaders(upstream.headers) : null;
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
    const toolCalls = winningRequest?.sentTools ? extractOpenAIToolCalls(json) : [];
    if (toolCalls.length) {
      const toolRun = await runNonStreamToolCalls(toolCalls);
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
        await appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk, json, responseBilling ? { billing: responseBilling } : undefined).catch(() => undefined);
        await finishRuntimeChatSession(runtimeSessionId, "completed").catch(() => undefined);
      }
      releaseInteractiveRuntime(lockKey);
      return new Response(
        toolRun.events.join("")
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
    const outputCheck = proxyOutput(extractChunk(json));
    const routed = outputCheck.verdict === "block"
      ? { content: "", thinking: "" }
      : routeChannelMarkupText(outputCheck.text || JSON.stringify(json));
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
      (routed.thinking ? ssePayload({ type: RUNTIME_STREAM_EVENT_TYPES.THINKING, delta: routed.thinking }) : "")
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
      let fullText = "";
      // Consume one upstream SSE stream: emit content/thinking to the client exactly as
      // before, and (when allowed) accumulate any tool_calls instead of leaking them as
      // raw deltas. Returns the completed tool calls so the caller can run the tool loop.
      const consume = async (stream: Response, allowTools: boolean): Promise<{ toolCalls: AccumulatedToolCall[] }> => {
        const streamReader = stream.body?.getReader();
        if (!streamReader) return { toolCalls: [] };
        let buffer = "";
        const channelMarkupState = createChannelMarkupState();
        const toolAcc = new Map<number, AccumulatedToolCall>();
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
              if (routed.content) fullText += routed.content;
              if (routed.content) queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content, parsed));
              if (!routed.content && !thinking && isTerminalOpenAiStreamMetadata(parsed)) continue;
              if (!routed.content && !thinking) queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime event", String(parsed?.type ?? parsed?.event?.type ?? "").trim(), parsed));
              if (routed.content || (!thinking && !outputCheck.text)) {
                controller.enqueue(encoder.encode(routed.content
                  ? ssePayload({ choices: [{ delta: { content: routed.content } }] })
                  : ssePayload(parsed)));
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
                controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: routed.content } }] })));
                fullText += routed.content;
                queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", routed.content));
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
          fullText += flushedTail.content;
          queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", flushedTail.content));
          controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: flushedTail.content } }] })));
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
          signal: telemetry?.request?.signal,
        });
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
            : `Command failed: ${result.error ?? result.stderr ?? "unknown error"}`,
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
        if (call.name === BANKR_ACTION_TOOL_NAME) return runBankrToolCall(call);
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
        let toolRoundsLeft = winningRequest?.sentTools ? (offerCommandTool ? 6 : 1) : 0;
        const conversation: Array<Record<string, unknown>> = winningRequest
          ? [...(winningRequest.messages as unknown as Array<Record<string, unknown>>)]
          : [];
        while (true) {
          const { toolCalls } = await consume(active, toolRoundsLeft > 0);
          if (!toolCalls.length || toolRoundsLeft <= 0 || !winningRequest) break;
          toolRoundsLeft -= 1;
          // Run every tool call the model emitted this round and collect the
          // assistant tool_calls + tool results for the continuation request.
          const assistantToolCalls: Array<Record<string, unknown>> = [];
          const toolResultMessages: Array<Record<string, unknown>> = [];
          const fallbacks: string[] = [];
          const finalTexts: string[] = [];
          for (const call of toolCalls) {
            const callId = call.id || `call_${call.name}`;
            const outcome = await runToolCall(call);
            assistantToolCalls.push({ id: callId, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } });
            toolResultMessages.push({ role: "tool", tool_call_id: callId, content: outcome.toolResultContent });
            if (outcome.fallbackText) fallbacks.push(outcome.fallbackText);
            if (outcome.finalText) finalTexts.push(outcome.finalText);
          }
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
            ...(toolRoundsLeft > 0 && toolDefinitions.length ? { tools: toolDefinitions, tool_choice: "auto" } : {}),
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
          queueSessionWrite(() => updateRuntimeChatSessionLastAssistantBilling(runtimeSessionId, responseBilling));
          controller.enqueue(encoder.encode(ssePayload({ billing: responseBilling })));
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

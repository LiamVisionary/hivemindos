import { NextRequest } from "next/server";
import { normalizeAgentRuntime, type AgentProfile, type SharedVaultConfig } from "@/lib/types/agent-runtime";
import { sendMessageViaGateway } from "@/lib/services/openclaw/gateway-client";
import { getGatewayAuthToken } from "@/lib/services/openclaw/gateway-health";
import { proxyInput } from "@/lib/services/agent-security-proxy";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { getRuntimeAdapter } from "@/lib/services/runtime-adapters/registry";
import { chatTelemetrySession, chatTelemetryValue } from "@/lib/services/telemetry/chat-dev-telemetry";
import { isFusionProfile, streamFusionResponse } from "@/lib/services/fusion/route-stream";
import { isBankrLlmProfile } from "@/lib/services/bankr-llm";
import {
  HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
  isFreeHivemindosWalletPaidModel,
} from "@/lib/config/hivemindos-wallet-paid-models";
import { normalizeChatPermissionMode } from "@/lib/types/chat-permissions";
import type { ChatPermissionMode } from "@/lib/types/chat-permissions";
import { activeSharedVault } from "@/lib/services/chat/shared-vault-context";
import { buildBankrCapabilityContext } from "@/lib/services/chat/bankr-capability-context";
import { buildClawbankCapabilityContext } from "@/lib/services/chat/clawbank-capability-context";
import { buildNansenCapabilityContext } from "@/lib/services/chat/nansen-capability-context";
import { buildXMcpCapabilityContext } from "@/lib/services/chat/x-mcp-capability-context";
import { buildSharedBrainMemoryContext } from "@/lib/services/chat/shared-brain-memory-context";
import {
  buildTaskRetrievalContextResult,
  buildTaskRetrievalFallbackContext,
  formatTaskRetrievalFallbackProcessDetail,
  formatTaskRetrievalProcessDetail,
  requiresCapabilityRouting,
  type TaskRetrievalTelemetry,
} from "@/lib/services/chat/task-retrieval-context";
import { runtimeImageGenerationCapabilityContext } from "@/lib/services/chat/runtime-image-generation-capability";
import { maybeCreateTeachHiveReviewProposal } from "@/lib/services/chat/teach-hive";
import {
  buildHivemindPromptEnvelope,
  buildHivemindUserContextText,
} from "@/lib/services/chat/hivemind-system-prompt";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  createRuntimeChatSessionId,
  finishRuntimeChatSession,
  startRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { streamMobileAgentTurn } from "@/lib/services/mobile-agents/chat-turn";
import { isMobileAgentGatewayUrl } from "@/lib/types/mobile-agents";
import {
  attachmentPromptSummary,
  extractUserText,
  latestUserMessage,
  ssePayload,
  type IncomingMessage,
} from "./messages";
import {
  formatChatMediaArtifactContext,
  materializeChatMediaArtifacts,
  type ChatMediaArtifact,
} from "./media-artifacts";
import {
  recordRouteTelemetry,
  telemetryPayloadForProfile,
} from "./route-telemetry";
import {
  bestEffortPreflight,
  buildChatVaultContext,
  collectorChatProfile,
  normalizeAgentMode,
  recordChatHoney,
  userFacingMachineName,
  validateHttpRuntimeProfile,
  type AgentMode,
} from "./runtime-helpers";
import { coerceActingWalletSourceHint, type ActingWalletSourceHint } from "./wallet-transfer-rails";
import { dispatchWalletAndTradeIntents } from "./wallet-trade-rails";
import { streamHttpRuntime } from "./stream-http-runtime";
import { localAdminPrincipal } from "@/lib/types/principal";
import { verifyAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const maxDuration = 600;

const CHAT_PREFLIGHT_RUNTIME_CAPABILITY_TIMEOUT_MS = 150;
const CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS = 900;
// Capability-shaped prompts ("what can you do with X", trading, wallet, token
// launch, …) are exactly the turns where dropping the retrieval result leaves
// the agent blind to its own powers, so they get a larger preflight budget.
const CHAT_PREFLIGHT_CAPABILITY_ROUTING_TIMEOUT_MS = 2_500;
const CHAT_PREFLIGHT_MEMORY_TIMEOUT_MS = 650;

const FULL_CONTEXT_FREE_SCOUT_PATTERNS = [
  /\b(?:capabilit(?:y|ies)|connected app|tool|api|workflow|skill|what\b[\s\S]{0,40}\bcan you do|can you do with)\b/i,
  /\b(?:wallet|payment|pay|paid|spend|crypto|usdc|x402|usepod|moneyclaw|bankr|clawbank|trade|trading|fund|funding|token|swap|portfolio|polymarket|hyperliquid)\b/i,
  /\b(?:x|twitter|tweet|tweets|post|social|miroshark|simulation|simulate|rehearsal|prediction market)\b/i,
  /\b(?:generate|create|make|draw|render|produce|imagine)\b[\s\S]{0,80}\b(?:image|picture|photo|visual|art|illustration)\b/i,
  /\b(?:image|picture|photo|visual|art|illustration)\b[\s\S]{0,80}\b(?:generate|generation|create|make|draw|render|produce|imagine)\b/i,
  /\b(?:txt2img|text\s*to\s*image|image[-\s]?gen|image generation)\b/i,
  /\b(?:generate|create|make|render|produce|animate)\b[\s\S]{0,100}\b(?:video|movie|clip|animation|reel)\b/i,
  /\b(?:image[-\s]?to[-\s]?video|img2vid|text[-\s]?to[-\s]?video|txt2vid|video generation)\b/i,
];

function isFreeHivemindosScoutProfile(profile: AgentProfile) {
  return profile.provider?.trim().toLowerCase() === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER
    && isFreeHivemindosWalletPaidModel(profile.model);
}

function shouldUseCompactFreeScoutContext(profile: AgentProfile, userPrompt: string) {
  if (!isFreeHivemindosScoutProfile(profile)) return false;
  const trimmed = userPrompt.trim();
  if (!trimmed) return false;
  if (requiresCapabilityRouting(trimmed)) return false;
  return !FULL_CONTEXT_FREE_SCOUT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  let profile: AgentProfile;
  let messages: IncomingMessage[];
  let sharedVault: SharedVaultConfig | undefined;
  let workingDirectory: string | undefined;
  let wallet: AgentWalletConfig | undefined;
  let honeyLedgerEnabled = false;
  let runtimeSessionId = "";
  let chatStorageKey = "";
  let clientRunId = "";
  let agentMode: AgentMode = "act";
  let latencyMode = "";
  let actingWalletSource: ActingWalletSourceHint | undefined;
  let suppressWalletIntents = false;
  let permissionMode: ChatPermissionMode = "manual";
  let requestAttachments: unknown[] = [];
  let mediaArtifacts: ChatMediaArtifact[] = [];
  try {
    const body = (await request.json()) as {
      agent?: AgentProfile;
      messages?: IncomingMessage[];
      attachments?: unknown[];
      sharedVault?: SharedVaultConfig;
      workingDirectory?: string;
      wallet?: AgentWalletConfig;
      honeyLedgerEnabled?: boolean;
      agentMode?: string;
      runtimeSessionId?: string;
      hermesSessionId?: string;
      chatStorageKey?: string;
      clientRunId?: string;
      latencyMode?: string;
      actingWalletSource?: unknown;
      suppressWalletIntents?: boolean;
      permissionMode?: unknown;
    };
    if (!body.agent || !Array.isArray(body.messages)) throw new Error("Missing agent or messages");
    profile = { ...body.agent, runtime: normalizeAgentRuntime(body.agent.runtime) };
    messages = body.messages;
    requestAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    sharedVault = body.sharedVault;
    workingDirectory = body.workingDirectory;
    wallet = body.wallet;
    honeyLedgerEnabled = body.honeyLedgerEnabled === true;
    agentMode = normalizeAgentMode(body.agentMode);
    runtimeSessionId = typeof body.runtimeSessionId === "string"
      ? body.runtimeSessionId
      : typeof body.hermesSessionId === "string"
        ? body.hermesSessionId
        : "";
    chatStorageKey = typeof body.chatStorageKey === "string" ? body.chatStorageKey : "";
    clientRunId = typeof body.clientRunId === "string" ? body.clientRunId : "";
    latencyMode = typeof body.latencyMode === "string" ? body.latencyMode : "";
    actingWalletSource = coerceActingWalletSourceHint(body.actingWalletSource);
    suppressWalletIntents = body.suppressWalletIntents === true;
    permissionMode = normalizeChatPermissionMode(body.permissionMode);
  } catch {
    await recordRouteTelemetry(request, "agent_runtime.request.invalid", { elapsedMs: Date.now() - routeStartedAt });
    return Response.json({ error: "Expected { agent, messages }" }, { status: 400 });
  }
  await recordRouteTelemetry(request, "agent_runtime.request.received", {
    ...telemetryPayloadForProfile(profile),
    messageCount: messages.length,
    workingDirectorySet: Boolean(workingDirectory?.trim()),
    runtimeSessionIdSet: Boolean(runtimeSessionId.trim()),
    runtimeSessionId: runtimeSessionId || null,
    chatStorageKey: chatStorageKey || null,
    clientRunId: clientRunId || null,
    agentMode,
    latencyMode: latencyMode || null,
    suppressWalletIntents,
    permissionMode,
    sharedVaultEnabled: Boolean(sharedVault?.enabled),
    honeyLedgerEnabled,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const userMessage = latestUserMessage(messages);
  const userText = extractUserText(messages).trim();
  const userPrompt = userText || attachmentPromptSummary(userMessage);
  if (!userMessage || !userPrompt) {
    await recordRouteTelemetry(request, "agent_runtime.request.invalid", {
      reason: "empty-user-message",
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ error: "User message is empty" }, { status: 400 });
  }
  const promptCheck = proxyInput(userPrompt);
  if (promptCheck.verdict === "block") {
    await recordRouteTelemetry(request, "agent_runtime.security.blocked", {
      reason: promptCheck.reason ?? null,
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ error: promptCheck.reason ?? "Message blocked by security policy" }, { status: 400 });
  }
  const auth = await verifyAuth(request);
  const principal = auth.principal ?? localAdminPrincipal(auth.userId ?? "local-user", "fallback");
  const vault = activeSharedVault(profile, sharedVault);
  runtimeSessionId = createRuntimeChatSessionId(profile, runtimeSessionId || clientRunId);
  try {
    mediaArtifacts = await materializeChatMediaArtifacts({
      attachments: requestAttachments,
      messages,
      runtimeSessionId,
    });
  } catch (error) {
    await recordRouteTelemetry(request, "agent_runtime.media_artifacts.failed", {
      ...telemetryPayloadForProfile(profile),
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      errorName: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - routeStartedAt,
    });
    return Response.json({ error: error instanceof Error ? error.message : "Could not prepare attached media for tool routing." }, { status: 400 });
  }
  const teachHiveProposal = await maybeCreateTeachHiveReviewProposal({
    userPrompt,
    principal,
    runtimeSessionId,
    chatStorageKey,
  }).catch(() => null);
  if (teachHiveProposal) {
    await recordRouteTelemetry(request, "agent_runtime.teach_hive.proposed", {
      ...telemetryPayloadForProfile(profile),
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      proposalId: teachHiveProposal.id,
      elapsedMs: Date.now() - routeStartedAt,
    });
  }
  if (isFusionProfile(profile)) {
    // Hive Fusion compound model: fan out to a panel of configured models,
    // judge their responses, and stream a synthesized answer. Runs before the
    // heavy single-model preflight since Fusion orchestrates its own panel.
    await recordRouteTelemetry(request, "agent_runtime.dispatch.fusion", {
      ...telemetryPayloadForProfile(profile),
      promptLength: userPrompt.length,
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamFusionResponse({ profile, messages, runtimeSessionId, request, routeStartedAt });
  }
  if (isMobileAgentGatewayUrl(profile.gatewayUrl)) {
    // Phone-hosted agent: the hub cannot call the phone, so the turn is queued
    // as a job the phone app polls for (see lib/services/mobile-agents) and
    // this stream replays the on-device run back to the dashboard.
    await recordRouteTelemetry(request, "agent_runtime.dispatch.mobile", {
      ...telemetryPayloadForProfile(profile),
      promptLength: userPrompt.length,
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamMobileAgentTurn({
      profile,
      messages,
      userPrompt,
      runtimeSessionId,
      chatStorageKey,
      sharedVaultPath: vault?.vaultPath,
      routeStartedAt,
    });
  }
  // Run the deterministic wallet / trade rails BEFORE the low-latency voice fast
  // path below - that path streams the raw agent, which has no deterministic money
  // path, so without this a spoken/typed "swap / send / buy ..." returns nothing.
  // Conversational turns fall through (handlers parse + return null synchronously).
  if (!suppressWalletIntents) {
    const walletIntentResponse = await dispatchWalletAndTradeIntents({
      request,
      routeStartedAt,
      profile,
      messages,
      wallet,
      actingWalletSource,
      runtimeSessionId,
    });
    if (walletIntentResponse) return walletIntentResponse;
  }
  const lowLatencyVoiceTurn = latencyMode === "voice";
  if (lowLatencyVoiceTurn) {
    const effectiveProfile = isBankrLlmProfile(profile) ? profile : await collectorChatProfile(profile) ?? profile;
    const profileError = isBankrLlmProfile(effectiveProfile) ? null : validateHttpRuntimeProfile(effectiveProfile);
    if (profileError) {
      await recordRouteTelemetry(request, "agent_runtime.voice.validation_failed", {
        reason: "profile-error",
        message: profileError,
        ...telemetryPayloadForProfile(effectiveProfile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      return Response.json({ error: profileError }, { status: 400 });
    }
    await recordRouteTelemetry(request, "agent_runtime.voice.fast_path.dispatch", {
      ...telemetryPayloadForProfile(effectiveProfile),
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamHttpRuntime(effectiveProfile, messages, promptCheck.text, null, agentMode, workingDirectory, undefined, false, runtimeSessionId, {
      request,
      routeStartedAt,
      runtimeSessionId,
      chatStorageKey,
    }, "", "", "", permissionMode, mediaArtifacts);
  }
  const fallbackRuntimeCapabilityContext: Awaited<ReturnType<typeof runtimeImageGenerationCapabilityContext>> = {
    runtime: profile.runtime,
    hasRuntimeImageGeneration: false,
    runtimeImageGenerationSource: undefined,
  };
  const emptyTaskRetrievalResult = { context: "", telemetry: null as TaskRetrievalTelemetry | null };
  const compactFreeScoutContext = shouldUseCompactFreeScoutContext(profile, userPrompt);
  const capabilitySearchTimeoutMs = !lowLatencyVoiceTurn && !compactFreeScoutContext && requiresCapabilityRouting(userPrompt)
    ? CHAT_PREFLIGHT_CAPABILITY_ROUTING_TIMEOUT_MS
    : CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS;
  const runtimeCapabilityPreflight = lowLatencyVoiceTurn || compactFreeScoutContext
    ? { value: fallbackRuntimeCapabilityContext, timedOut: false, failed: false }
    : await bestEffortPreflight(
      runtimeImageGenerationCapabilityContext(profile),
      CHAT_PREFLIGHT_RUNTIME_CAPABILITY_TIMEOUT_MS,
      fallbackRuntimeCapabilityContext,
    );
  const runtimeCapabilityContext = runtimeCapabilityPreflight.value;
  const [taskRetrievalPreflight, sharedBrainMemoryPreflight] = await Promise.all([
    compactFreeScoutContext
      ? Promise.resolve({ value: emptyTaskRetrievalResult, timedOut: false, failed: false })
      : bestEffortPreflight(
        buildTaskRetrievalContextResult({
          origin: request.url,
          query: userPrompt,
          sharedVault: vault,
          runtime: runtimeCapabilityContext,
          agent: {
            workerClass: profile.workerClass,
            preferredSkillSlugs: profile.preferredSkillSlugs,
            taskPreferences: profile.taskPreferences,
          },
          recordContextXray: true,
          runId: runtimeSessionId,
          threadId: chatStorageKey,
          model: [profile.runtime, profile.model].filter(Boolean).join(":"),
        }),
        capabilitySearchTimeoutMs,
        emptyTaskRetrievalResult,
      ),
    lowLatencyVoiceTurn || compactFreeScoutContext
      ? Promise.resolve({ value: "", timedOut: false, failed: false })
      : bestEffortPreflight(
        buildSharedBrainMemoryContext(vault, userPrompt),
        CHAT_PREFLIGHT_MEMORY_TIMEOUT_MS,
        "",
      ),
  ]);
  const taskRetrievalResult = taskRetrievalPreflight.value;
  const sharedBrainMemoryContext = sharedBrainMemoryPreflight.value;
  // Bankr knowledge is key-gated, not profile-gated: any runtime/provider/model
  // can use the shared Bankr key, and the briefing must survive a timed-out
  // capability search, so it rides along with whatever retrieval produced
  // (results or the fallback notice). Presence check is cached; never the value.
  // ClawBank knowledge is credential-gated like Bankr (not profile-gated): any
  // runtime can use the shared ClawBank token, and the briefing must survive a
  // timed-out capability search. Presence check is cached; never the value.
  // X knowledge is connection-gated like Bankr/ClawBank (not profile-gated): any
  // runtime can use the shared X MCP credentials or the managed X gateway, and
  // the briefing must survive a timed-out capability search. Presence check is
  // cached; never the value.
  const [bankrCapabilityContext, clawbankCapabilityContext, xMcpCapabilityContext, nansenCapabilityContext] = compactFreeScoutContext
    ? ["", "", "", ""]
    : await Promise.all([
      buildBankrCapabilityContext().catch(() => ""),
      buildClawbankCapabilityContext().catch(() => ""),
      buildXMcpCapabilityContext().catch(() => ""),
      buildNansenCapabilityContext().catch(() => ""),
    ]);
  const mediaArtifactContext = formatChatMediaArtifactContext(mediaArtifacts);
  const taskRetrievalContext = [
    mediaArtifactContext,
    taskRetrievalResult.context || buildTaskRetrievalFallbackContext({
      query: userPrompt,
      origin: request.url,
      timeoutMs: capabilitySearchTimeoutMs,
      timedOut: taskRetrievalPreflight.timedOut,
      failed: taskRetrievalPreflight.failed,
    }),
    bankrCapabilityContext,
    clawbankCapabilityContext,
    xMcpCapabilityContext,
    nansenCapabilityContext,
  ].filter(Boolean).join("\n\n");
  await recordRouteTelemetry(request, "agent_runtime.capability_search.completed", {
    ...telemetryPayloadForProfile(profile),
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    skipped: compactFreeScoutContext,
    lowLatencyVoiceTurn,
    compactFreeScoutContext,
    runtimeCapabilityTimedOut: runtimeCapabilityPreflight.timedOut,
    runtimeCapabilityFailed: runtimeCapabilityPreflight.failed,
    capabilitySearchTimedOut: taskRetrievalPreflight.timedOut,
    capabilitySearchFailed: taskRetrievalPreflight.failed,
    sharedBrainMemoryTimedOut: sharedBrainMemoryPreflight.timedOut,
    sharedBrainMemoryFailed: sharedBrainMemoryPreflight.failed,
    contextInjected: Boolean(taskRetrievalContext),
    mediaArtifactCount: mediaArtifacts.length,
    telemetry: taskRetrievalResult.telemetry,
    elapsedMs: Date.now() - routeStartedAt,
  });
  const runtimeSession = await startRuntimeChatSession({
    sessionId: runtimeSessionId,
    agent: profile,
    chatStorageKey,
    sharedVaultPath: vault?.vaultPath,
    userContent: userPrompt,
    startedAt: routeStartedAt,
  }).catch(() => null);
  await recordRouteTelemetry(request, "agent_runtime.session.started", {
    ...telemetryPayloadForProfile(profile),
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    session: chatTelemetrySession(runtimeSession),
    elapsedMs: Date.now() - routeStartedAt,
  });
  const capabilitySearchProcessDetail = taskRetrievalResult.telemetry?.queryCount
    ? formatTaskRetrievalProcessDetail(taskRetrievalResult.telemetry)
    : formatTaskRetrievalFallbackProcessDetail({
      timeoutMs: capabilitySearchTimeoutMs,
      timedOut: taskRetrievalPreflight.timedOut,
      failed: taskRetrievalPreflight.failed,
    });
  if (capabilitySearchProcessDetail) {
    await appendRuntimeChatSessionEvent(runtimeSessionId, "Hive capability search", capabilitySearchProcessDetail).catch(() => undefined);
  }
  // Wallet / trade intents already ran via dispatchWalletAndTradeIntents() before the
  // voice fast path above (so voice + typed chat share one money path); nothing to
  // re-dispatch here. Continue to the conversational agent stream.
  const vaultPromptContext = compactFreeScoutContext ? "" : buildChatVaultContext(vault, userPrompt);
  const promptWallet = compactFreeScoutContext ? undefined : wallet;
  const promptEnvelope = buildHivemindPromptEnvelope({
    profile,
    agentMode,
    workingDirectory,
    vaultContext: vaultPromptContext,
    sharedBrainMemoryContext,
    taskRetrievalContext,
    wallet: promptWallet,
    runtimeSessionId,
    chatStorageKey,
  });
  const textWithVaultContext = buildHivemindUserContextText(promptEnvelope, userPrompt) || promptCheck.text;
  if (profile.runtime !== "openclaw" || isBankrLlmProfile(profile)) {
    const adapter = getRuntimeAdapter(profile.runtime);
    if (!isBankrLlmProfile(profile) && adapter && !adapter.capabilities.chat) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "adapter-chat-unavailable",
        adapterKind: adapter.kind,
        adapterLabel: adapter.label,
        ...telemetryPayloadForProfile(profile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime chat unavailable", `${adapter.label} is configured as a ${adapter.kind} runtime here.`).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({
        error: `${adapter.label} is configured as a ${adapter.kind} runtime here and does not expose interactive chat. Use Scheduler, skills, or runs for this runtime.`,
      }, { status: 400 });
    }
    if (!isBankrLlmProfile(profile) && profile.runtime === "hermes" && profile.telemetryUrl?.trim() && profile.collectorCapabilities?.chat === false) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "collector-chat-unavailable",
        ...telemetryPayloadForProfile(profile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime chat bridge unavailable", `${userFacingMachineName(profile)} needs setup/update.`).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({
        error: `${userFacingMachineName(profile)} is connected, but its local agent bridge does not have the Hermes chat bridge installed yet. Run setup/update on that machine after these dashboard changes are available there.`,
      }, { status: 400 });
    }
    const effectiveProfile = isBankrLlmProfile(profile) ? profile : await collectorChatProfile(profile) ?? profile;
    const profileError = isBankrLlmProfile(effectiveProfile) ? null : validateHttpRuntimeProfile(effectiveProfile);
    if (profileError) {
      await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
        reason: "profile-error",
        message: profileError,
        ...telemetryPayloadForProfile(effectiveProfile),
        elapsedMs: Date.now() - routeStartedAt,
      });
      await appendRuntimeChatSessionEvent(runtimeSessionId, "Runtime profile invalid", profileError).catch(() => undefined);
      await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
      return Response.json({ error: profileError }, { status: 400 });
    }
    await recordRouteTelemetry(request, "agent_runtime.dispatch.http", {
      ...telemetryPayloadForProfile(effectiveProfile),
      promptLength: userPrompt.length,
      contextLength: promptEnvelope.systemContext.length,
      runtimeSessionId,
      chatStorageKey: chatStorageKey || null,
      agentMode,
      elapsedMs: Date.now() - routeStartedAt,
    });
    return streamHttpRuntime(effectiveProfile, messages, promptCheck.text, vault, agentMode, workingDirectory, promptWallet, honeyLedgerEnabled, runtimeSessionId, {
      request,
      routeStartedAt,
      runtimeSessionId,
      chatStorageKey,
    }, taskRetrievalContext, sharedBrainMemoryContext, vaultPromptContext, permissionMode, mediaArtifacts);
  }

  const token = await getGatewayAuthToken(profile.token);
  if (!profile.gatewayUrl || !token) {
    await recordRouteTelemetry(request, "agent_runtime.validation_failed", {
      reason: "missing-openclaw-gateway-or-token",
      ...telemetryPayloadForProfile(profile),
      elapsedMs: Date.now() - routeStartedAt,
    });
    await appendRuntimeChatSessionEvent(runtimeSessionId, "OpenClaw gateway unavailable", "Missing OpenClaw gateway URL or token.").catch(() => undefined);
    await finishRuntimeChatSession(runtimeSessionId, "failed").catch(() => undefined);
    return Response.json({ error: "Missing OpenClaw gateway URL or token" }, { status: 400 });
  }
  await recordRouteTelemetry(request, "agent_runtime.dispatch.openclaw", {
    ...telemetryPayloadForProfile(profile),
    promptLength: userPrompt.length,
    contextLength: promptEnvelope.systemContext.length,
    runtimeSessionId,
    chatStorageKey: chatStorageKey || null,
    agentMode,
    elapsedMs: Date.now() - routeStartedAt,
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      let sessionWrite = Promise.resolve();
      const queueSessionWrite = (operation: () => Promise<void>) => {
        sessionWrite = sessionWrite.then(operation, operation).catch(() => undefined);
      };
      controller.enqueue(encoder.encode(ssePayload({
        session: { id: runtimeSessionId, runtime: profile.runtime, source: "hivemindos-chat", startedAt: routeStartedAt },
      })));
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 5_000);

      try {
        let fullText = "";
        let contentChunkCount = 0;
        let statusEventCount = 0;
        let toolEventCount = 0;
        await sendMessageViaGateway(
          {
            gatewayUrl: profile.gatewayUrl,
            token,
            text: textWithVaultContext,
            agentId: profile.agentId,
            ...(runtimeSessionId || profile.sessionKey ? { sessionKey: runtimeSessionId || profile.sessionKey } : {}),
          },
          (chunk) => {
            fullText += chunk;
            contentChunkCount += 1;
            if (contentChunkCount === 1 || contentChunkCount % 5 === 0) {
              void recordRouteTelemetry(request, "agent_runtime.openclaw.content", {
                ...telemetryPayloadForProfile(profile),
                runtimeSessionId,
                chatStorageKey: chatStorageKey || null,
                contentChunkCount,
                outputLength: fullText.length,
                elapsedMs: Date.now() - routeStartedAt,
              });
            }
            queueSessionWrite(() => appendRuntimeChatSessionText(runtimeSessionId, "assistant", chunk));
            controller.enqueue(encoder.encode(ssePayload({ choices: [{ delta: { content: chunk } }] })));
          },
          undefined,
          (toolData) => {
            toolEventCount += 1;
            void recordRouteTelemetry(request, "agent_runtime.openclaw.tool_call", {
              ...telemetryPayloadForProfile(profile),
              runtimeSessionId,
              chatStorageKey: chatStorageKey || null,
              toolEventCount,
              toolName: typeof toolData.name === "string" ? toolData.name : typeof toolData.tool === "string" ? toolData.tool : null,
              toolData: chatTelemetryValue(toolData),
              elapsedMs: Date.now() - routeStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(
              runtimeSessionId,
              typeof toolData.name === "string" ? toolData.name : typeof toolData.tool === "string" ? toolData.tool : "Tool call",
              typeof toolData.message === "string" ? toolData.message : undefined,
              toolData,
            ));
            controller.enqueue(encoder.encode(ssePayload({ tool_call: toolData })));
          },
          (status) => {
            statusEventCount += 1;
            void recordRouteTelemetry(request, "agent_runtime.openclaw.status", {
              ...telemetryPayloadForProfile(profile),
              runtimeSessionId,
              chatStorageKey: chatStorageKey || null,
              statusEventCount,
              statusType: status.type,
              status: chatTelemetryValue(status),
              elapsedMs: Date.now() - routeStartedAt,
            });
            queueSessionWrite(() => appendRuntimeChatSessionEvent(
              runtimeSessionId,
              typeof status.data?.message === "string" ? status.data.message : status.type ?? "Runtime status",
              typeof status.data?.detail === "string" ? status.data.detail : typeof status.data?.phase === "string" ? status.data.phase : undefined,
              status,
            ));
            controller.enqueue(encoder.encode(ssePayload({ status })));
          },
        );
        const event = await recordChatHoney(profile, textWithVaultContext, fullText, honeyLedgerEnabled);
        if (event) controller.enqueue(encoder.encode(ssePayload({ honey: event })));
        await recordRouteTelemetry(request, "agent_runtime.openclaw.completed", {
          ...telemetryPayloadForProfile(profile),
          runtimeSessionId,
          chatStorageKey: chatStorageKey || null,
          outputLength: fullText.length,
          contentChunkCount,
          statusEventCount,
          toolEventCount,
          elapsedMs: Date.now() - routeStartedAt,
        });
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "completed"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent runtime error";
        queueSessionWrite(() => appendRuntimeChatSessionEvent(runtimeSessionId, "OpenClaw runtime failed", message));
        queueSessionWrite(() => finishRuntimeChatSession(runtimeSessionId, "failed"));
        await recordRouteTelemetry(request, "agent_runtime.openclaw.failed", {
          ...telemetryPayloadForProfile(profile),
          runtimeSessionId,
          chatStorageKey: chatStorageKey || null,
          errorName: error instanceof Error ? error.name : "unknown",
          message,
          elapsedMs: Date.now() - routeStartedAt,
        });
        controller.enqueue(encoder.encode(ssePayload({ error: message })));
      } finally {
        await sessionWrite.catch(() => undefined);
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

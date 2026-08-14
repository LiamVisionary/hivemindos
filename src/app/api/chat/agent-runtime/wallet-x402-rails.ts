import { NextRequest } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_X402_CONFIRMATION,
} from "@/lib/config/veil-cash";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { callVeilMcpTool } from "@/lib/services/wallet/veil-mcp";
import { executeX402Fetch, type X402FetchPolicy, type X402FetchResult } from "@/lib/services/wallet/x402-agent-fetch";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  platformFeeReceiptDetail,
  quoteTradingPlatformFee,
  type PlatformFeeCollection,
} from "@/lib/services/wallet/platform-fees";
import {
  buildMiroSharkChatCard,
  executeMiroSharkChatRun,
  extractMiroSharkRunId,
  findMiroSharkChatRunRequest,
  MIROSHARK_X402_SIMULATION_PRICE_USD,
  validateMiroSharkChatRun,
  waitForMiroSharkCompletion,
  type MiroSharkChatRunDraft,
} from "@/lib/services/miroshark/x402-chat-run";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { latestUserMessage, messageText, ssePayload, type IncomingMessage } from "./messages";
import { recordRouteTelemetry, telemetryPayloadForProfile } from "./route-telemetry";
import { baseScanTxUrl, formatDuration, formatMoney, privateTransferSse } from "./wallet-transfer-rails";

const privateX402Executions = new Map<string, { status: "running" | "completed"; startedAt: number; message?: string }>();
const MIROSHARK_TERMINAL_STATUS_PATTERN = /\b(?:complete|completed|success|succeeded|ready|failed|failure|error|cancelled|canceled|stopped)\b/i;
type PrivateX402Draft = { url: string; method: "GET" | "POST"; maxPayment: string };
type PublicX402Draft = { url: string; method: "GET" | "POST"; maxPayment: string };
type VeilMcpX402Quote = {
  requiresPayment?: boolean;
  supported?: boolean;
  amount?: string;
  network?: string;
  asset?: string;
  message?: string;
};
type VeilMcpX402Result = {
  action?: string;
  success?: boolean;
  settled?: boolean;
  reused?: boolean;
  status?: number;
  url?: string;
  maxPayment?: string;
  requiredAmount?: string;
  requiredAmountAtomic?: string;
  candidates?: Array<{
    payerIndex?: string;
    payerAddress?: string;
    usdc?: string;
    usdcAtomic?: string;
    fundedFor?: string | null;
  }>;
  message?: string;
  receipt?: {
    payerAddress?: string;
    payerIndex?: string;
    amount?: string;
    relayTransactionHash?: string;
    paymentTransactionHash?: string;
  };
  payerAddress?: string;
  payerIndex?: string;
  amount?: string;
  relayTransactionHash?: string;
  relayBlockNumber?: string;
  paymentTransactionHash?: string;
  body?: unknown;
};
type VeilMcpX402ExecutionResult = VeilMcpX402Result & { platformFee?: PlatformFeeCollection };

export async function maybePrepareNaturalPrivateX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPrivateX402Request(input.messages, input.wallet);
  if (!draft) return null;

  const validation = await validatePrivateX402(input.wallet, draft, false);
  const quote = validation ? null : await readPrivateX402Quote(draft);
  const message = privateX402DraftMessage(draft, input.wallet, quote, validation);
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, quote ?? undefined).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.draft", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    hasValidationError: Boolean(validation),
    quoteAmount: quote?.amount ?? null,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

export async function maybeExecuteConfirmedPrivateX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|pay it|run it|execute)$/i.test(latestText)) return null;

  const draft = findPrivateX402Draft(input.messages, input.wallet);
  if (!draft) return null;

  const validation = await validatePrivateX402(input.wallet, draft, true);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }

  const executionKey = privateX402ExecutionKey(input.profile, draft);
  prunePrivateX402Executions();
  const existing = privateX402Executions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private x402 payment is already running. I will not submit a duplicate payment.");
  }
  if (existing?.status === "completed" && existing.message) {
    return privateTransferSse(`That private x402 payment was already submitted.\n${existing.message}`);
  }
  privateX402Executions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.confirmed", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    confirmation: VEIL_CASH_X402_CONFIRMATION,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  return privateX402ExecutionSse({ ...input, draft, executionKey });
}

export async function maybeExecuteConfirmedPublicX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|pay it|run it|execute)$/i.test(latestText)) return null;

  const draft = findPublicX402Draft(input.messages);
  if (!draft) return null;
  return publicX402ExecutionSse({ ...input, draft });
}

export async function maybePrepareNaturalPublicX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPublicX402Request(input.messages, input.wallet);
  if (!draft) return null;

  const validation = validatePublicX402Draft(input.wallet, draft);
  const message = publicX402DraftMessage(draft, input.wallet, validation);
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.draft", {
    ...telemetryPayloadForProfile(input.profile),
    url: draft.url,
    method: draft.method,
    maxPayment: draft.maxPayment,
    hasValidationError: Boolean(validation),
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

export async function maybeExecuteNaturalMiroSharkX402(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const draft = findMiroSharkChatRunRequest(input.messages, input.wallet);
  if (!draft) return null;

  const validation = validateMiroSharkChatRun(input.wallet, draft);
  if (validation) {
    const message = [
      "**MiroShark x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the simulation request again.",
    ].join("\n");
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.validation_failed", {
      ...telemetryPayloadForProfile(input.profile),
      seedKind: draft.seedKind,
      hasMarketUrl: Boolean(draft.marketUrl),
      maxPaymentUsd: draft.maxPaymentUsd,
      validation,
      elapsedMs: Date.now() - input.routeStartedAt,
    });
    return privateTransferSse(message);
  }

  return miroSharkX402ExecutionSse({
    request: input.request,
    routeStartedAt: input.routeStartedAt,
    profile: input.profile,
    draft,
    wallet: input.wallet!,
    runtimeSessionId: input.runtimeSessionId,
  });
}

function findLatestPrivateX402Request(messages: IncomingMessage[], wallet?: AgentWalletConfig): PrivateX402Draft | null {
  const latest = latestUserMessage(messages);
  return parsePrivateX402Request(messageText(latest), wallet);
}

function findLatestPublicX402Request(messages: IncomingMessage[], wallet?: AgentWalletConfig): PublicX402Draft | null {
  const latest = latestUserMessage(messages);
  return parsePublicX402Request(messageText(latest), wallet);
}

function findPrivateX402Draft(messages: IncomingMessage[], wallet?: AgentWalletConfig): PrivateX402Draft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (isPublicX402DraftText(text)) return null;
    if (!isPrivateX402DraftText(text)) continue;
    return parsePrivateX402Request(text, wallet);
  }
  return null;
}

function findPublicX402Draft(messages: IncomingMessage[]): PublicX402Draft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (isPrivateX402DraftText(text)) return null;
    if (!isPublicX402DraftText(text)) continue;
    return parsePublicX402Draft(text);
  }
  return null;
}

function isPrivateX402DraftText(text: string) {
  return /\*{0,2}Private x402 ready\*{0,2}/i.test(text) || /Reply\s+`?confirm`?\s+to\s+pay\s+privately/i.test(text);
}

function isPublicX402DraftText(text: string) {
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return false;
  if (/\*{0,2}Private x402 ready\*{0,2}|Reply\s+`?confirm`?\s+to\s+pay\s+privately|private x402/i.test(text)) return false;
  return /\*{0,2}Public x402 ready\*{0,2}/i.test(text)
    || /Draft:\s*x402 payment to\s+https?:\/\//i.test(text)
    || /Reply\s*:?\s*`?confirm`?(?:\s|$)/i.test(text)
    || /Reply\s+`?confirm`?\s+to\s+pay\.(?:\s|$)/i.test(text);
}

function parsePublicX402Draft(text: string): PublicX402Draft | null {
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:cap|spend|payment|of))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USDG|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USDG|USD)?/i);
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment: maxMatch?.[1] ?? "0.5",
  };
}

function parsePublicX402Request(text: string, wallet?: AgentWalletConfig): PublicX402Draft | null {
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return null;
  if (/(private|privately|veil)/i.test(text)) return null;
  if (wallet?.provider === "veil" && wallet.veilAutoPrivateX402 !== false) return null;
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:cap|spend|payment|of))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USDG|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USDG|USD)?/i);
  const maxPayment = maxMatch?.[1] ?? formatMoney(Math.max(0, Number(wallet?.maxPaymentUsd) || 0.5));
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment,
  };
}

function parsePrivateX402Request(text: string, wallet?: AgentWalletConfig): PrivateX402Draft | null {
  if (isPublicX402DraftText(text)) return null;
  if (!/(x402|paid endpoint|paywall|paid-content)/i.test(text)) return null;
  if (!/(private|privately|veil)/i.test(text) && !(wallet?.provider === "veil" && wallet.veilAutoPrivateX402 !== false)) return null;
  const url = sanitizePrivateX402Url(text.match(/https?:\/\/[^\s<>"'`)\]]+/i)?.[0]);
  if (!url) return null;
  const maxMatch = text.match(/\bmax(?:imum)?(?:\s+(?:spend|payment|of|cap))?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i)
    ?? text.match(/\bcap(?:ped)?(?:\s+at)?\s*(?:is|:|=)?\s*\$?(\d+(?:\.\d{1,6})?)\s*(?:USDC|USD)?/i);
  const maxPayment = maxMatch?.[1] ?? formatMoney(Math.max(0, Number(wallet?.maxPaymentUsd) || 0.5));
  return {
    url,
    method: /\bPOST\b/i.test(text) ? "POST" : "GET",
    maxPayment,
  };
}

function sanitizePrivateX402Url(value: string | undefined) {
  return value?.trim().replace(/[`\]).,;:]+$/, "") ?? "";
}

async function validatePrivateX402(wallet: AgentWalletConfig | undefined, draft: PrivateX402Draft, executing: boolean) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (wallet.provider !== "veil") return "This agent is not configured for Veil private x402 payments.";
  if (wallet.network !== VEIL_CASH_NETWORK) return "Veil private x402 payments are only supported on Base mainnet.";
  if (executing && !wallet.enabled) return "Wallet spending is off for this agent. Enable Spend on before executing private x402 payments.";
  if (!/^https?:\/\//i.test(draft.url)) return "Private x402 requires a valid HTTP(S) endpoint URL.";
  const maxPayment = Number(draft.maxPayment);
  const asset = stableAssetForNetwork(wallet.network);
  if (!Number.isFinite(maxPayment) || maxPayment <= 0) return `Max payment must be a positive ${asset} value.`;
  if (maxPayment > wallet.maxPaymentUsd) return `Max payment exceeds this agent's ${asset} spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  if (!await veilEnvValue("VEIL_KEY")) return "VEIL_KEY is not configured. Run Veil setup before private x402 payments.";
  return "";
}

function validatePublicX402Draft(wallet: AgentWalletConfig | undefined, draft: PublicX402Draft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) return "";
  if (!/^https?:\/\//i.test(draft.url)) return "x402 requires a valid HTTP(S) endpoint URL.";
  const maxPayment = Number(draft.maxPayment);
  if (!Number.isFinite(maxPayment) || maxPayment <= 0) return "Max payment must be a positive USDC value.";
  if (maxPayment > wallet.maxPaymentUsd) return `Max payment exceeds this agent's USDC spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  return "";
}

function publicX402DraftMessage(draft: PublicX402Draft, wallet: AgentWalletConfig | undefined, validation?: string) {
  if (validation) {
    return [
      "**Public x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the payment request again.",
    ].join("\n");
  }
  const asset = stableAssetForNetwork(wallet?.network || "");
  return [
    "**Public x402 ready**",
    "",
    `Endpoint \`${draft.url}\``,
    `Max cap **${draft.maxPayment} ${asset}**`,
    `Network **${publicX402NetworkLabel(wallet?.network || "")}**`,
    "",
    wallet?.enabled
      ? "Reply `confirm` to pay."
      : "Wallet spending is off for this agent, so I prepared the draft only. Turn Spend on before execution.",
  ].filter(Boolean).join("\n");
}

async function readPrivateX402Quote(draft: PrivateX402Draft) {
  try {
    return await callVeilMcpTool<VeilMcpX402Quote>("veil_x402_quote", {
      url: draft.url,
      method: draft.method,
      maxPayment: draft.maxPayment,
    }, 4_000);
  } catch {
    return null;
  }
}

function privateX402ExecutionKey(profile: AgentProfile, draft: PrivateX402Draft) {
  return [
    profile.id,
    draft.method,
    draft.url.toLowerCase(),
    Number(draft.maxPayment).toFixed(6),
  ].join(":");
}

function prunePrivateX402Executions() {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of privateX402Executions.entries()) {
    if (value.startedAt < cutoff) privateX402Executions.delete(key);
  }
}

function privateX402DraftMessage(
  draft: PrivateX402Draft,
  wallet: AgentWalletConfig | undefined,
  quote: VeilMcpX402Quote | null,
  validation?: string,
) {
  if (validation) {
    return [
      "**Private x402 unavailable**",
      "",
      validation,
      "",
      "Fix this blocker, then send the payment request again.",
    ].join("\n");
  }
  const price = quote?.amount
    ? `Price **${quote.amount} USDC**`
    : "Price will be checked before payment";
  return [
    "**Private x402 ready**",
    "",
    `Endpoint \`${draft.url}\``,
    `${price} · max **${draft.maxPayment} USDC**`,
    "",
    wallet?.enabled
      ? "Reply `confirm` to pay privately."
      : "Wallet spending is off for this agent, so I prepared the draft only. Turn Spend on before execution.",
  ].filter(Boolean).join("\n");
}

function privateX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PrivateX402Draft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
  executionKey: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "privateX402", name: "privateX402", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing private x402 payment", input.draft.url);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          input.wallet ? `Spend on; cap ${formatMoney(input.wallet.maxPaymentUsd)} ${stableAssetForNetwork(input.wallet.network)}; max ${input.draft.maxPayment} ${stableAssetForNetwork(input.wallet.network)}.` : "Spend policy already validated.",
          "completed",
        );
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Execute Veil x402 payment",
          "Selecting a private payer EOA, then settling x402.",
          "running",
        );
        let feeWallet: Awaited<ReturnType<typeof getWalletSecret>> | null = null;
        const maxPaymentUsd = Number(input.draft.maxPayment);
        if (Number.isFinite(maxPaymentUsd) && maxPaymentUsd > 0) {
          const feeQuote = await quoteTradingPlatformFee({ source: "veil-x402", network: VEIL_CASH_NETWORK, amountUsd: maxPaymentUsd });
          if (feeQuote.enabled) {
            feeWallet = await getWalletSecret(input.wallet?.agentId?.trim() || input.profile.id);
            if (!feeWallet) throw new Error("No local wallet exists for this agent, so the HivemindOS platform fee cannot be collected.");
            await assertTradingPlatformFeeReady({ source: "veil-x402", network: feeWallet.info.network, amountUsd: maxPaymentUsd });
          }
        }
        const startedAt = Date.now();
        let result: VeilMcpX402ExecutionResult = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          confirm: true,
        });
        if (result.action === "reuse_available") {
          const payerIndex = reusableX402PayerIndex(result);
          if (!payerIndex) throw new Error(result.message ?? "A funded x402 payer is available but no reusable payer index was returned.");
          await sendTool(
            RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
            "Reuse funded x402 payer",
            `Using payer index ${payerIndex}; no new private withdrawal needed.`,
            "running",
          );
          result = await callVeilMcpTool<VeilMcpX402Result>("veil_pay_x402", {
            url: input.draft.url,
            method: input.draft.method,
            maxPayment: input.draft.maxPayment,
            payerIndex,
            confirm: true,
          });
        }
        if (result.success === false) throw new Error(result.message ?? "Veil private x402 payment was not submitted.");
        const amountUsd = Number(result.amount ?? result.receipt?.amount ?? 0);
        if (feeWallet && amountUsd > 0) {
          result = {
            ...result,
            platformFee: await collectTradingPlatformFee({
              agentId: input.wallet?.agentId?.trim() || input.profile.id,
              network: feeWallet.info.network,
              secret: feeWallet.secret,
              fromAddress: feeWallet.info.address,
              amountUsd,
              source: "veil-x402",
            }),
          };
        }
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Execute Veil x402 payment",
          `Settled in ${formatDuration(Date.now() - startedAt)}.`,
          "completed",
        );
        const message = privateX402ResultMessage(result, input.draft, Date.now() - startedAt);
        privateX402Executions.set(input.executionKey, { status: "completed", startedAt: Date.now(), message });
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.completed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          amount: result.amount ?? result.receipt?.amount ?? null,
          relayTransactionHash: result.relayTransactionHash ?? result.receipt?.relayTransactionHash ?? null,
          paymentTransactionHash: result.paymentTransactionHash ?? result.receipt?.paymentTransactionHash ?? null,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private x402 finished", `Total ${formatDuration(Date.now() - input.routeStartedAt)}.`, "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        privateX402Executions.delete(input.executionKey);
        const errorMessage = privateX402ErrorMessage(error);
        const noPaymentRequested = /Endpoint did not return HTTP 402/i.test(errorMessage);
        const message = noPaymentRequested
          ? `No x402 payment was requested by that endpoint, so no funds were withdrawn.\n\nEndpoint \`${input.draft.url}\``
          : `Private x402 failed: ${errorMessage}`;
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          error: errorMessage,
          noPaymentRequested,
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          noPaymentRequested ? "No x402 payment requested" : "Private x402 failed",
          errorMessage,
          noPaymentRequested ? "completed" : "failed",
        );
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, noPaymentRequested ? "completed" : "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
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
    },
  });
}

function miroSharkX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: MiroSharkChatRunDraft;
  wallet: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "MiroShark x402", name: "MiroShark x402", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        send({ session: { id: input.runtimeSessionId, runtime: input.profile.runtime, source: "hivemindos-miroshark-x402", startedAt: input.routeStartedAt } });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing MiroShark simulation", `question: ${input.draft.title}`);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Paying MiroShark x402 endpoint",
          `Cap ${formatMoney(Math.min(input.wallet.maxPaymentUsd, Math.max(MIROSHARK_X402_SIMULATION_PRICE_USD, input.draft.maxPaymentUsd)))} ${stableAssetForNetwork(input.wallet.network)} · ${input.draft.seedKind}`,
        );
        const paidStartedAt = Date.now();
        const paidRun = await executeMiroSharkChatRun(input.wallet.agentId?.trim() || input.profile.id, input.wallet, input.draft);
        const runId = extractMiroSharkRunId(paidRun.miroshark, paidRun.result.bodyJson);
        await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.started", {
          ...telemetryPayloadForProfile(input.profile),
          seedKind: input.draft.seedKind,
          hasMarketUrl: Boolean(input.draft.marketUrl),
          maxPaymentUsd: input.draft.maxPaymentUsd,
          amountUsd: paidRun.result.amountUsd,
          paid: paidRun.result.paid,
          runId: runId || null,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "MiroShark simulation started",
          runId ? `Run ${runId} · paid in ${formatDuration(Date.now() - paidStartedAt)}` : "Paid run accepted; waiting for run id.",
          "running",
        );

        const snapshot = runId
          ? await waitForMiroSharkCompletion(runId, async (_status, statusLabel) => {
            await sendTool(
              RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
              "MiroShark status",
              statusLabel || `Polling ${runId}`,
              MIROSHARK_TERMINAL_STATUS_PATTERN.test(statusLabel) ? "completed" : "running",
            );
          })
          : { status: paidRun.miroshark, timedOut: true };
        const card = buildMiroSharkChatCard({
          draft: input.draft,
          elapsedMs: Date.now() - input.routeStartedAt,
          paidRun,
          runId,
          snapshot,
        });
        const completed = /\b(?:complete|completed|success|succeeded|ready)\b/i.test(card.miroshark.status);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE,
          completed ? "MiroShark report ready" : snapshot.timedOut ? "MiroShark still running" : "MiroShark run finished",
          `Total ${formatDuration(Date.now() - input.routeStartedAt)}${runId ? ` · ${runId}` : ""}`,
          completed ? "completed" : "running",
        );
        const message = JSON.stringify(card);
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, card).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "MiroShark x402 run failed.";
        const message = `MiroShark x402 failed: ${detail}`;
        await recordRouteTelemetry(input.request, "agent_runtime.miroshark_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          seedKind: input.draft.seedKind,
          hasMarketUrl: Boolean(input.draft.marketUrl),
          error: detail,
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "MiroShark x402 failed", detail, "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
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
    },
  });
}

function publicX402ExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PublicX402Draft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "x402Fetch", name: "x402Fetch", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing public x402 payment", input.draft.url);
        const wallet = input.wallet;
        if (!wallet) throw new Error("No wallet is configured for this agent.");
        const approvedMax = Number(input.draft.maxPayment);
        if (!Number.isFinite(approvedMax) || approvedMax <= 0) throw new Error("Confirmed x402 draft has no valid max payment.");
        const walletId = wallet.agentId?.trim() || input.profile.id;
        const stored = await getWalletSecret(walletId);
        if (!stored) throw new Error("No local wallet exists for this agent.");
        const policy = publicX402Policy(wallet, stored.info.network, approvedMax);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          `Spend ${policy.enabled ? "on" : "off"}; cap ${formatMoney(policy.maxPaymentUsd)} ${stableAssetForNetwork(policy.network)}; public x402.`,
          "completed",
        );
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, "Execute public x402 payment", "Signing from the local wallet vault.", "running");
        const startedAt = Date.now();
        const result = await executeX402Fetch({
          agentId: walletId,
          network: stored.info.network,
          secret: stored.secret,
          fromAddress: stored.info.address,
          url: input.draft.url,
          method: input.draft.method,
          policy,
          confirmation: "PAY_X402",
          approvalContext: {
            summary: "This is a public x402 paid API call requested during an agent chat turn.",
            whyNow: "The agent prepared a paid x402 draft and the wallet governance policy requires review before spending.",
            impact: "Approving lets the runtime retry the paid HTTP call. Rejecting keeps this chat turn from making the paid request.",
            requestedAction: "Approve only if this public URL, method, and maximum payment match what you asked the agent to do.",
            evidence: [
              `URL: ${input.draft.url}`,
              `Method: ${input.draft.method}`,
              `Approved max: ${formatMoney(policy.maxPaymentUsd)}`,
              `Wallet: ${walletId}`,
            ],
            source: "Agent runtime public x402",
          },
        });
        const message = publicX402ResultMessage(result, Date.now() - startedAt);
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.completed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          amountUsd: result.amountUsd,
          status: result.status,
          paid: result.paid,
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Public x402 finished", `Total ${formatDuration(Date.now() - input.routeStartedAt)}.`, "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        const message = `Public x402 failed: ${publicX402ErrorMessage(error)}`;
        await recordRouteTelemetry(input.request, "agent_runtime.wallet.public_x402.failed", {
          ...telemetryPayloadForProfile(input.profile),
          url: input.draft.url,
          method: input.draft.method,
          maxPayment: input.draft.maxPayment,
          error: publicX402ErrorMessage(error),
          elapsedMs: Date.now() - input.routeStartedAt,
        }).catch(() => undefined);
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Public x402 failed", publicX402ErrorMessage(error), "failed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
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
    },
  });
}

function publicX402Policy(wallet: AgentWalletConfig, storedNetwork: string, approvedMax: number): X402FetchPolicy {
  const provider = wallet.provider === "veil" && wallet.veilAutoPrivateX402 === false ? "x402" : wallet.provider;
  return {
    enabled: wallet.enabled,
    provider,
    network: wallet.network || storedNetwork,
    maxPaymentUsd: Math.max(0, Math.min(wallet.maxPaymentUsd, approvedMax)),
    approvalRequiredOverUsd: wallet.approvalRequiredOverUsd,
    autoPayEnabled: false,
    x402BaseUrl: wallet.x402BaseUrl,
  };
}

function publicX402ResultMessage(result: X402FetchResult, executionMs: number) {
  const body = summarizePaidContent(result.bodyJson ?? result.bodyPreview);
  const asset = stableAssetForNetwork(result.network);
  return [
    `**Public x402 complete** · **${formatMoney(result.amountUsd)} ${asset}**`,
    "",
    `Endpoint \`${result.url}\``,
    result.paid ? "Payment settled from the local wallet." : "No payment was required.",
    platformFeeReceiptDetail(result.platformFee),
    `HTTP status \`${result.status}\``,
    "",
    body ? `Content received:\n${body}` : "Content received.",
    "",
    `Timing **${formatDuration(executionMs)}**`,
  ].filter(Boolean).join("\n");
}

function publicX402ErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stableAssetForNetwork(network: string): "USDC" | "USDG" {
  return network === "eip155:4663" ? "USDG" : "USDC";
}

function publicX402NetworkLabel(network: string): string {
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network.startsWith("solana:")) return "Solana";
  return "Base";
}

function privateX402ResultMessage(result: VeilMcpX402ExecutionResult, draft: PrivateX402Draft, executionMs: number) {
  const amount = result.amount ?? result.receipt?.amount ?? result.requiredAmount ?? "";
  const relayTx = result.relayTransactionHash ?? result.receipt?.relayTransactionHash ?? "";
  const paymentTx = result.paymentTransactionHash ?? result.receipt?.paymentTransactionHash ?? "";
  const payerAddress = result.payerAddress ?? result.receipt?.payerAddress ?? "";
  const payerIndex = result.payerIndex ?? result.receipt?.payerIndex ?? "";
  const body = summarizePaidContent(result.body);
  const payerLabel = result.reused === true ? "Reused payer" : "Fresh payer";
  return [
    `**Private x402 complete** · **${amount || "paid"} USDC**`,
    "",
    `Endpoint \`${result.url ?? draft.url}\``,
    payerAddress ? `${payerLabel} \`${payerAddress}\`${payerIndex ? ` · index \`${payerIndex}\`` : ""}` : "",
    relayTx ? `Private withdraw ${baseScanTxUrl(relayTx)}` : "",
    paymentTx ? `x402 payment ${baseScanTxUrl(paymentTx)}` : "",
    platformFeeReceiptDetail(result.platformFee),
    result.status ? `HTTP status \`${result.status}\`` : "",
    "",
    body ? `Content received:\n${body}` : "Content received.",
    "",
    `Timing **${formatDuration(executionMs)}**`,
  ].filter(Boolean).join("\n");
}

function reusableX402PayerIndex(result: VeilMcpX402Result) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const candidate = candidates.find((item) => typeof item?.payerIndex === "string" && /^\d+$/.test(item.payerIndex));
  return candidate?.payerIndex ?? "";
}

function summarizePaidContent(value: unknown) {
  if (value == null) return "";
  const rawText = typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2);
  if (!rawText.trim()) return "";
  const jsonText = typeof value === "string"
    ? prettyJsonText(rawText)
    : rawText;
  const text = jsonText || rawText;
  const clipped = text.length > 1_200 ? `${text.slice(0, 1_200).trimEnd()}\n...` : text;
  return jsonText
    ? `\`\`\`json\n${clipped}\n\`\`\``
    : clipped;
}

function prettyJsonText(value: string) {
  const trimmed = value.trim();
  const candidates = [
    trimmed,
    extractBalancedJsonText(trimmed),
    /^"[^"]+"\s*:/.test(trimmed) ? `{${trimmed}}` : "",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.stringify(JSON.parse(candidate), null, 2);
    } catch {
      // Try the next candidate.
    }
  }
  return "";
}

function extractBalancedJsonText(value: string) {
  const start = value.search(/[{\[]/);
  if (start < 0) return "";
  const open = value[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth === 0) return value.slice(start, index + 1);
  }
  return "";
}

function privateX402ErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Veil private x402 payment failed.";
  if (message === "VEIL_MCP_MISSING") return "Veil MCP is not installed. Run Setup Veil to install @veil-cash/mcp before private x402 payments.";
  if (message === "VEIL_CLI_MISSING" || /ENOENT/.test(message)) return "Veil CLI is not installed. Run Setup Veil before private x402 payments.";
  if (/^fetch failed$/i.test(message)) return "Veil MCP fetch failed while reaching the x402 endpoint or payment service.";
  return message.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}

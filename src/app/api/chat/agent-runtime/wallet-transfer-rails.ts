import { NextRequest } from "next/server";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  VEIL_CASH_NETWORK,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
} from "@/lib/config/veil-cash";
import { veilEnvValue } from "@/lib/services/wallet/veil-cli";
import { executeVeilPrivateTransfer, veilPrivateTransferErrorMessage } from "@/lib/services/wallet/veil-private-transfer";
import { getWalletBalance } from "@/lib/services/wallet/chain-wallet";
import { getWalletInfo, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { executeGovernedUsdcSend } from "@/lib/services/wallet/governed-send";
import {
  assertTradingPlatformFeeReady,
  collectTradingPlatformFee,
  platformFeeReceiptDetail,
  quoteTradingPlatformFee,
  type PlatformFeeCollection,
} from "@/lib/services/wallet/platform-fees";
import { SWAP_CONFIRMATION, MAX_SWAP_USD, quoteDexSwap, executeDexSwap } from "@/lib/services/trading/dex-swap";
import {
  SEND_CONFIRMATION,
  parseSendRequest,
  isSendDraftText,
  parseSendDraft,
  buildSendDraftMessage,
  validateSend,
  sendCapUsd,
  networkChainLabel,
  parseSwapRequest,
  hasLocalSwapIntent,
  isSwapDraftText,
  parseSwapDraft,
  buildSwapDraftMessage,
} from "@/lib/services/chat/wallet-action-intents";
import { resolveWalletSource } from "@/lib/services/chat/wallet-source-resolver";
import {
  B20_ISSUER_CONFIRMATION,
  b20IssuerResultMessage,
  executeB20IssuerDraft,
  hasB20IssuerConversationContext,
  hasB20IssuerIntent,
  parseB20IssuerDraftMessage,
  prepareB20IssuerProofFromMessages,
} from "@/lib/services/crypto/b20-issuer-proof";
import { DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS } from "@/lib/utils/agent-wallet";
import { RUNTIME_STREAM_EVENT_TYPES } from "@/lib/services/runtime-stream-events";
import {
  appendRuntimeChatSessionEvent,
  appendRuntimeChatSessionText,
  finishRuntimeChatSession,
} from "@/lib/services/chat/runtime-session-store";
import { latestUserMessage, messageText, ssePayload, type IncomingMessage } from "./messages";
import { recordRouteTelemetry, telemetryPayloadForProfile } from "./route-telemetry";

const privateTransferExecutions = new Map<string, { status: "running" | "completed"; startedAt: number; message?: string }>();
type PrivateTransferDraft = { asset: "USDC"; amount: string; recipient: string };
type PrivateTransferExecutionResult = Awaited<ReturnType<typeof executeVeilPrivateTransfer>> & { platformFee?: PlatformFeeCollection };

export async function maybeExecuteConfirmedPrivateTransfer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latest = latestUserMessage(input.messages);
  const latestText = messageText(latest).trim().toLowerCase();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|send it)$/i.test(latestText)) return null;

  const draft = findPrivateTransferDraft(input.messages);
  if (!draft) return null;

  const validation = await validateConfirmedPrivateTransfer(input.wallet, draft);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }
  const executionKey = privateTransferExecutionKey(input.profile, draft);
  prunePrivateTransferExecutions();
  const existing = privateTransferExecutions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private send confirmation is already running. I will not submit a duplicate transfer.");
  }
  if (existing?.status === "completed" && existing.message) {
    if (isPendingShieldMessage(existing.message) || isIncompletePrivateTransferMessage(existing.message)) {
      privateTransferExecutions.delete(executionKey);
    } else if (duplicatePaymentGuardEnabled(input.wallet)) {
      return privateTransferSse(`That private send was already submitted.\n${existing.message}`);
    } else {
      privateTransferExecutions.delete(executionKey);
    }
  }
  privateTransferExecutions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_transfer.confirmed", {
    ...telemetryPayloadForProfile(input.profile),
    asset: draft.asset,
    amount: draft.amount,
    recipient: draft.recipient,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  try {
    return privateTransferExecutionSse({ ...input, draft, executionKey, telemetryType: "agent_runtime.wallet.private_transfer.confirmed" });
  } catch (error) {
    privateTransferExecutions.delete(executionKey);
    const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }
}

export async function maybeExecuteNaturalPrivateTransfer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const draft = findLatestPrivateTransferRequest(input.messages);
  if (!draft) return null;

  const validation = await validateNaturalPrivateTransfer(input.wallet, draft);
  if (validation) {
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", validation).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(validation);
  }

  const executionKey = privateTransferExecutionKey(input.profile, draft);
  prunePrivateTransferExecutions();
  const existing = privateTransferExecutions.get(executionKey);
  if (existing?.status === "running") {
    return privateTransferSse("That private send is already running. I will not submit a duplicate transfer.");
  }
  if (existing?.status === "completed" && existing.message) {
    if (isPendingShieldMessage(existing.message) || isIncompletePrivateTransferMessage(existing.message)) {
      privateTransferExecutions.delete(executionKey);
    } else if (duplicatePaymentGuardEnabled(input.wallet)) {
      return privateTransferSse(`That private send was already submitted.\n${existing.message}`);
    } else {
      privateTransferExecutions.delete(executionKey);
    }
  }
  privateTransferExecutions.set(executionKey, { status: "running", startedAt: Date.now() });

  await recordRouteTelemetry(input.request, "agent_runtime.wallet.private_transfer.requested", {
    ...telemetryPayloadForProfile(input.profile),
    asset: draft.asset,
    amount: draft.amount,
    recipient: draft.recipient,
    elapsedMs: Date.now() - input.routeStartedAt,
  });

  try {
    return privateTransferExecutionSse({ ...input, draft, executionKey, telemetryType: "agent_runtime.wallet.private_transfer.requested" });
  } catch (error) {
    privateTransferExecutions.delete(executionKey);
    const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }
}

// ---- B20 issuer proof rail (Base Sepolia precompile) ------------------------

export async function maybePrepareNaturalB20Issuer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages));
  if (!hasB20IssuerIntent(latestText) && !hasB20IssuerConversationContext(chatMessagesForB20(input.messages))) return null;

  const source = await resolveB20IssuerSource(input.profile, input.wallet);
  let message: string;
  if ("error" in source) {
    message = source.error;
  } else {
    const prepared = await prepareB20IssuerProofFromMessages({
      messages: chatMessagesForB20(input.messages),
      agentId: source.agentId,
      deployerAddress: source.address,
    });
    message = prepared.message;
  }

  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.b20_issuer.draft", {
    ...telemetryPayloadForProfile(input.profile),
    hasWallet: !("error" in source),
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

export async function maybeExecuteConfirmedB20Issuer(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages)).trim();
  if (!/^(confirm|confirmed|yes|yes,? confirm|go ahead|create it|deploy it|make it|execute)$/i.test(latestText)) return null;
  const draft = findB20IssuerDraft(input.messages);
  if (!draft) return null;

  const signer = await getWalletSecret(draft.agentId);
  if (!signer) {
    const message = "**B20 creation failed**\n\nNo encrypted local signer exists for this agent wallet.";
    await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
    await finishRuntimeChatSession(input.runtimeSessionId, "failed").catch(() => undefined);
    return privateTransferSse(message);
  }

  let message: string;
  let ok = false;
  try {
    const result = await executeB20IssuerDraft({
      draft,
      secret: signer.secret,
      confirmation: B20_ISSUER_CONFIRMATION,
    });
    ok = result.ok;
    message = b20IssuerResultMessage(result);
  } catch (error) {
    message = `**B20 creation failed**\n\n${error instanceof Error ? error.message : "Could not create the B20 token."}`;
  }
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, ok ? "completed" : "failed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.b20_issuer.execute", {
    ...telemetryPayloadForProfile(input.profile),
    ok,
    tokenAddress: draft.predictedAddress,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

function findB20IssuerDraft(messages: IncomingMessage[]) {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const draft = parseB20IssuerDraftMessage(messageText(message));
    if (draft) return draft;
  }
  return null;
}

async function resolveB20IssuerSource(profile: AgentProfile, wallet?: AgentWalletConfig): Promise<{ agentId: string; address: string } | { error: string }> {
  const agentId = profile.id;
  if (wallet?.walletAddress?.startsWith("0x")) {
    return { agentId, address: wallet.walletAddress };
  }
  const stored = await getWalletInfo(agentId);
  if (stored?.address?.startsWith("0x")) {
    return { agentId: stored.agentId, address: stored.address };
  }
  return {
    error: "**B20 issuer setup**\n\nThis agent needs an encrypted EVM wallet before it can create a B20 token. Create or import a Base wallet for this agent in Wallets, then ask again.",
  };
}

function chatMessagesForB20(messages: IncomingMessage[]) {
  return messages.map((message) => ({ role: message.role, content: messageText(message) }));
}

// ---- Plain stablecoin send rail (/api/wallet/send, incl. personal wallets) --

function agentWalletFallback(profile: AgentProfile, wallet?: AgentWalletConfig) {
  return wallet?.walletAddress
    ? { agentId: profile.id, address: wallet.walletAddress, network: wallet.network }
    : undefined;
}

/** The user's selected acting wallet (Trade desk / Wallets screen), relayed from
 *  the app-wide hive chat so a "send/swap" with no explicit "from …" defaults to
 *  it instead of the executing agent's own wallet. */
export type ActingWalletSourceHint = { agentId: string; address: string; network: string; kind: string };

export function coerceActingWalletSourceHint(value: unknown): ActingWalletSourceHint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  if (!agentId) return undefined;
  return {
    agentId,
    address: typeof record.address === "string" ? record.address.trim() : "",
    network: typeof record.network === "string" ? record.network.trim() : "",
    kind: typeof record.kind === "string" ? record.kind.trim() : "",
  };
}

/** Build a resolver fallback from the acting wallet. Bankr is managed (no local
 *  signer), so it returns undefined for Bankr — those defer to the Bankr/LLM path. */
function actingWalletFallback(source: ActingWalletSourceHint | undefined) {
  if (source && source.kind !== "bankr" && source.address && source.agentId && source.network) {
    return { agentId: source.agentId, address: source.address, network: source.network };
  }
  return undefined;
}

function findSendDraft(messages: IncomingMessage[]) {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (!isSendDraftText(text)) continue;
    return parseSendDraft(text);
  }
  return null;
}

export async function maybePrepareNaturalSend(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  actingWalletSource?: ActingWalletSourceHint;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const parsed = parseSendRequest(messageText(latestUserMessage(input.messages)));
  if (!parsed) return null;

  // A Bankr-managed acting wallet has no local signer; with no explicit "from …"
  // bow out so the Bankr/LLM path owns the send instead of drafting a local one.
  const explicitSource = Boolean(parsed.source.address || parsed.source.personal || parsed.source.chain);
  if (input.actingWalletSource?.kind === "bankr" && !explicitSource) return null;

  // Stablecoin sends to a 0x recipient must come from an EVM wallet. With no
  // explicit "from", default to the user's acting wallet, else this agent's own wallet.
  const fallback = actingWalletFallback(input.actingWalletSource) ?? agentWalletFallback(input.profile, input.wallet);
  const resolved = await resolveWalletSource(parsed.source, fallback, "evm");
  const error = "error" in resolved ? resolved.error : "";
  const validation = error || validateSend(parsed.amountUsd, "error" in resolved ? 0 : (resolved.isPersonal ? 0 : sendCapUsd(input.wallet)));
  const message = buildSendDraftMessage({
    source: "error" in resolved ? undefined : resolved,
    recipient: parsed.recipient,
    amountUsd: parsed.amountUsd,
    validation: validation || undefined,
  });
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, validation ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.send.draft", {
    ...telemetryPayloadForProfile(input.profile),
    amountUsd: parsed.amountUsd,
    isPersonal: "error" in resolved ? null : resolved.isPersonal,
    hasValidationError: Boolean(validation),
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

export async function maybeExecuteConfirmedSend(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  actingWalletSource?: ActingWalletSourceHint;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages)).trim();
  if (latestText.toUpperCase() !== SEND_CONFIRMATION) return null;
  const draft = findSendDraft(input.messages);
  if (!draft) return null;

  // Re-resolve the source from the draft's own From address — never trust a
  // client-supplied agentId; resolveWalletSource looks the address up in the
  // wallet vault. Personal wallets are gated to explicit confirmation here (this
  // branch only runs on the SEND_USDC token) and never auto-send.
  const fallback = actingWalletFallback(input.actingWalletSource) ?? agentWalletFallback(input.profile, input.wallet);
  const resolved = await resolveWalletSource({ address: draft.sourceAddress }, fallback, "evm");
  if ("error" in resolved) return privateTransferSse(`**Send failed**\n\n${resolved.error}`);

  const result = await executeGovernedUsdcSend({ agentId: resolved.agentId, toAddress: draft.recipient, amountUsd: draft.amountUsd });
  const message = result.ok
    ? [
        "**Send complete**",
        "",
        `Sent **$${draft.amountUsd.toFixed(2)} ${result.assetSymbol}** on **${networkChainLabel(resolved.network)}**`,
        `To \`${draft.recipient}\``,
        `From \`${resolved.address}\`${resolved.isPersonal ? " (personal)" : ""}`,
        `Tx \`${result.signature}\``,
      ].join("\n")
    : result.status === "pending_approval"
      ? `**Approval required**\n\n${result.error}`
      : `**Send failed**\n\n${result.error}`;
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, result.ok ? "completed" : "failed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.send.execute", {
    ...telemetryPayloadForProfile(input.profile),
    ok: result.ok,
    isPersonal: resolved.isPersonal,
    amountUsd: draft.amountUsd,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

// ---- Local DEX swap rail (0x on Base/Robinhood Chain, Jupiter on Solana) ----

function findSwapDraft(messages: IncomingMessage[]) {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = messageText(message);
    if (!isSwapDraftText(text)) continue;
    return parseSwapDraft(text);
  }
  return null;
}

export async function maybePrepareNaturalSwap(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  actingWalletSource?: ActingWalletSourceHint;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const text = messageText(latestUserMessage(input.messages));
  const parsed = parseSwapRequest(text);
  if (!parsed) return null;
  // A Bankr-managed acting wallet has no local signer — let Bankr own the swap.
  if (input.actingWalletSource?.kind === "bankr"
    && !parsed.source.address && !parsed.source.personal && !parsed.source.chain) return null;
  // A selected non-Bankr acting wallet (a personal "user" or "agent" wallet, which
  // carries a local signing key) is itself the local-swap intent: the user picked
  // where to swap, so a bare "swap X to Y" should run on THAT wallet via the DEX
  // rail. Without this, the swap falls through to the ungated Bankr handler below
  // (maybeHandleNaturalBankrAction) and runs on Bankr instead of the wallet the
  // user selected. Swaps with no wallet context at all still fall through to Bankr.
  const actingIsLocalWallet = Boolean(
    input.actingWalletSource
    && input.actingWalletSource.kind !== "bankr"
    && input.actingWalletSource.address.trim(),
  );
  if (!hasLocalSwapIntent(text, parsed.source) && !actingIsLocalWallet) return null;

  const fallback = actingWalletFallback(input.actingWalletSource) ?? agentWalletFallback(input.profile, input.wallet);
  const resolved = await resolveWalletSource(parsed.source, fallback, parsed.family);
  let message: string;
  let failed = true;
  if ("error" in resolved) {
    message = buildSwapDraftMessage({ sellToken: parsed.sellToken, buyToken: parsed.buyToken, amountHuman: parsed.amountHuman, maxUsd: MAX_SWAP_USD, validation: resolved.error });
  } else {
    const stored = await getWalletSecret(resolved.agentId);
    if (!stored) {
      message = buildSwapDraftMessage({ sellToken: parsed.sellToken, buyToken: parsed.buyToken, amountHuman: parsed.amountHuman, maxUsd: MAX_SWAP_USD, validation: "That wallet has no signing key available." });
    } else {
      let quoteLine = "";
      let validation = "";
      try {
        const quote = await quoteDexSwap({ agentId: resolved.agentId, network: stored.info.network, fromAddress: stored.info.address, secret: stored.secret, sellToken: parsed.sellToken, buyToken: parsed.buyToken, amountHuman: parsed.amountHuman });
        quoteLine = `You get ≈ **${quote.buyAmount.toPrecision(6)} ${quote.buy}** for ${quote.sellAmount} ${quote.sell} (≈ $${quote.valueUsd.toFixed(2)})`;
      } catch (error) {
        validation = error instanceof Error ? error.message : "Could not price this swap.";
      }
      failed = Boolean(validation);
      message = buildSwapDraftMessage({ source: resolved, sellToken: parsed.sellToken, buyToken: parsed.buyToken, amountHuman: parsed.amountHuman, quoteLine, maxUsd: MAX_SWAP_USD, validation: validation || undefined });
    }
  }
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, failed ? "failed" : "completed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.swap.draft", {
    ...telemetryPayloadForProfile(input.profile),
    sellToken: parsed.sellToken,
    buyToken: parsed.buyToken,
    amountHuman: parsed.amountHuman,
    isPersonal: "error" in resolved ? null : resolved.isPersonal,
    failed,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

export async function maybeExecuteConfirmedSwap(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  messages: IncomingMessage[];
  wallet?: AgentWalletConfig;
  actingWalletSource?: ActingWalletSourceHint;
  runtimeSessionId: string;
}): Promise<Response | null> {
  const latestText = messageText(latestUserMessage(input.messages)).trim();
  if (latestText.toUpperCase() !== SWAP_CONFIRMATION) return null;
  const draft = findSwapDraft(input.messages);
  if (!draft) return null;

  const family = draft.sourceAddress.startsWith("0x") ? "evm" : "solana";
  const fallback = actingWalletFallback(input.actingWalletSource) ?? agentWalletFallback(input.profile, input.wallet);
  const resolved = await resolveWalletSource({ address: draft.sourceAddress }, fallback, family);
  if ("error" in resolved) return privateTransferSse(`**Swap failed**\n\n${resolved.error}`);
  const stored = await getWalletSecret(resolved.agentId);
  if (!stored) return privateTransferSse("**Swap failed**\n\nNo signing key for that wallet.");

  let message: string;
  let ok = false;
  try {
    const result = await executeDexSwap({
      agentId: resolved.agentId,
      network: stored.info.network,
      fromAddress: stored.info.address,
      secret: stored.secret,
      sellToken: draft.sellToken,
      buyToken: draft.buyToken,
      amountHuman: draft.amountHuman,
      confirmation: SWAP_CONFIRMATION,
    });
    ok = true;
    const fee = result.platformFee;
    const feeLine = fee && fee.amountUsd > 0
      ? `**Fee** ${fee.amountUsd.toFixed(2)} ${fee.assetSymbol}${fee.signature ? ` · [receipt](${txExplorerUrl(result.network, fee.signature)})` : ""}`
      : "";
    message = [
      "**Swap complete**",
      "",
      `**Swapped** ${result.sellAmount} ${result.sell} → ≈${trimAmount(result.buyAmount)} ${result.buy}`,
      `**Network** ${networkChainLabel(result.network)}`,
      `**Wallet** \`${shortHex(resolved.address)}\`${resolved.isPersonal ? " (personal)" : ""}`,
      feeLine,
      `**Tx** [${shortHex(result.reference)}](${txExplorerUrl(result.network, result.reference)})`,
    ].filter(Boolean).join("\n");
  } catch (error) {
    message = `**Swap failed**\n\n${error instanceof Error ? error.message : "Swap failed."}`;
  }
  await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message).catch(() => undefined);
  await finishRuntimeChatSession(input.runtimeSessionId, ok ? "completed" : "failed").catch(() => undefined);
  await recordRouteTelemetry(input.request, "agent_runtime.wallet.swap.execute", {
    ...telemetryPayloadForProfile(input.profile),
    ok,
    isPersonal: resolved.isPersonal,
    sellToken: draft.sellToken,
    buyToken: draft.buyToken,
    amountHuman: draft.amountHuman,
    elapsedMs: Date.now() - input.routeStartedAt,
  });
  return privateTransferSse(message);
}

function privateTransferExecutionKey(profile: AgentProfile, draft: PrivateTransferDraft) {
  return [
    profile.id,
    draft.asset,
    Number(draft.amount).toFixed(6),
    draft.recipient.toLowerCase(),
  ].join(":");
}

function prunePrivateTransferExecutions() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, value] of privateTransferExecutions.entries()) {
    if (value.startedAt < cutoff) privateTransferExecutions.delete(key);
  }
}

function duplicatePaymentGuardEnabled(wallet: AgentWalletConfig | undefined) {
  return wallet?.duplicatePaymentGuardEnabled !== false && duplicatePaymentGuardSeconds(wallet) > 0;
}

function duplicatePaymentGuardSeconds(wallet: AgentWalletConfig | undefined) {
  const seconds = Number(wallet?.duplicatePaymentGuardSeconds);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS;
}

function isPendingShieldMessage(message: string) {
  return /shielding (started|is already queued)|will complete the private send after veil accepts/i.test(message);
}

function isIncompletePrivateTransferMessage(message: string) {
  return /private send submitted/i.test(message) && (!/\bproof:\s*https:\/\/basescan\.org\/tx\//i.test(message) || !/remaining spend balance:/i.test(message));
}

function findLatestPrivateTransferRequest(messages: IncomingMessage[]): PrivateTransferDraft | null {
  const latest = latestUserMessage(messages);
  return parsePrivateTransferRequest(messageText(latest));
}

function findPrivateTransferDraft(messages: IncomingMessage[]): PrivateTransferDraft | null {
  for (let index = messages.length - 2; index >= 0; index -= 1) {
    const draft = parsePrivateTransferRequest(messageText(messages[index]));
    if (draft) return draft;
  }
  return null;
}

function parsePrivateTransferRequest(text: string): PrivateTransferDraft | null {
  if (!/private|privately/i.test(text)) return null;
  const recipient = text.match(/0x[a-fA-F0-9]{40}/)?.[0];
  const amountMatch = text.match(/(?:send(?:ing)?|private send:?)?\s*\$?(\d+(?:\.\d{1,6})?)\s*USDC/i)
    ?? text.match(/\bUSDC\s+(\d+(?:\.\d{1,6})?)/i);
  if (!recipient || !amountMatch) return null;
  return { asset: "USDC", amount: amountMatch[1], recipient };
}

async function validateNaturalPrivateTransfer(wallet: AgentWalletConfig | undefined, draft: PrivateTransferDraft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) {
    return [
      `Private send draft: ${draft.amount} ${draft.asset} to ${draft.recipient} on Base.`,
      "Wallet spending is off for this agent, so I did not submit a transaction.",
      "Turn Spend on for this agent to let HivemindOS execute the private send automatically.",
    ].join("\n");
  }
  return validateConfirmedPrivateTransfer(wallet, draft);
}

async function validateConfirmedPrivateTransfer(wallet: AgentWalletConfig | undefined, draft: PrivateTransferDraft) {
  if (!wallet) return "No wallet is configured for this agent.";
  if (!wallet.enabled) return "Wallet spending is off for this agent. Enable Spend on before executing private transfers.";
  if (wallet.provider !== "veil") return "This agent is not configured for the Veil private-transfer rail.";
  if (wallet.network !== VEIL_CASH_NETWORK) return "Veil private transfers are only supported on Base mainnet.";
  if (!/^0x[a-fA-F0-9]{40}$/.test(draft.recipient)) return "Recipient must be a valid 0x Ethereum address.";
  const amount = Number(draft.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "Amount must be a positive USDC value.";
  if (amount < VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM) return `Veil public-recipient USDC withdrawals currently require at least ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC.`;
  if (amount > wallet.maxPaymentUsd) return `Amount exceeds this agent's USDC spend cap ($${wallet.maxPaymentUsd.toFixed(2)}).`;
  if (!await veilEnvValue("VEIL_KEY")) return "VEIL_KEY is not configured. Run Veil setup before private transfers.";
  return "";
}

export function privateTransferSse(message: string) {
  return new Response(
    ssePayload({ choices: [{ delta: { content: message } }] }) + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
  );
}

function privateTransferExecutionSse(input: {
  request: NextRequest;
  routeStartedAt: number;
  profile: AgentProfile;
  draft: PrivateTransferDraft;
  wallet?: AgentWalletConfig;
  runtimeSessionId: string;
  executionKey: string;
  telemetryType: string;
}) {
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(ssePayload(payload)));
      const sendTool = async (type: string, label: string, detail?: string, status: "running" | "completed" | "failed" = "running") => {
        const event = { type, toolName: "privateTransfer", name: "privateTransfer", message: label, detail, status };
        send(event);
        await appendRuntimeChatSessionEvent(input.runtimeSessionId, label, detail, event).catch(() => undefined);
      };
      try {
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_START, "Preparing private transfer", `${input.draft.amount} ${input.draft.asset} to ${input.draft.recipient}`);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Validate spend policy",
          input.wallet ? `Spend on; cap ${formatMoney(input.wallet.maxPaymentUsd)} USDC; duplicate guard ${duplicatePaymentGuardEnabled(input.wallet) ? "on" : "off"}.` : "Spend policy already validated.",
          "completed",
        );
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Prepare private withdraw",
          `Using the configured Veil rail on Base for ${input.draft.amount} ${input.draft.asset}.`,
          "completed",
        );
        let feeWallet: Awaited<ReturnType<typeof getWalletSecret>> | null = null;
        const feeNotionalUsd = Number(input.draft.amount);
        if (Number.isFinite(feeNotionalUsd) && feeNotionalUsd > 0) {
          const feeQuote = await quoteTradingPlatformFee({ source: "veil-transfer", network: VEIL_CASH_NETWORK, amountUsd: feeNotionalUsd });
          if (feeQuote.enabled) {
            feeWallet = await getWalletSecret(input.profile.id);
            if (!feeWallet) throw new Error("No local wallet exists for this agent, so the HivemindOS platform fee cannot be collected.");
            await assertTradingPlatformFeeReady({ source: "veil-transfer", network: feeWallet.info.network, amountUsd: feeNotionalUsd });
          }
        }
        let result: PrivateTransferExecutionResult = await executeVeilPrivateTransfer({
          agentId: input.profile.id,
          asset: input.draft.asset,
          amount: input.draft.amount,
          recipient: input.draft.recipient,
          autoShield: true,
          waitForShieldCompletion: true,
          duplicateGuardEnabled: duplicatePaymentGuardEnabled(input.wallet),
          duplicateGuardSeconds: duplicatePaymentGuardSeconds(input.wallet),
          onProgress: (event) => {
            const eventType = event.status === "started"
              ? RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS
              : event.status === "failed"
                ? RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE
                : RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS;
            const detail = event.detail ? `${event.detail} · total ${formatDuration(event.elapsedMs)}` : `total ${formatDuration(event.elapsedMs)}`;
            const status = event.status === "started" ? "running" : event.status === "failed" ? "failed" : "completed";
            send({ type: eventType, toolName: "privateTransfer", name: "privateTransfer", message: event.label, detail, status });
            void appendRuntimeChatSessionEvent(input.runtimeSessionId, event.label, detail, { ...event, status }).catch(() => undefined);
          },
        });
        if (feeWallet && feeNotionalUsd > 0) {
          result = {
            ...result,
            platformFee: await collectTradingPlatformFee({
              agentId: input.profile.id,
              network: feeWallet.info.network,
              secret: feeWallet.secret,
              fromAddress: feeWallet.info.address,
              amountUsd: feeNotionalUsd,
              source: "veil-transfer",
            }),
          };
        }
        await recordRouteTelemetry(input.request, input.telemetryType, {
          ...telemetryPayloadForProfile(input.profile),
          asset: input.draft.asset,
          amount: input.draft.amount,
          recipient: input.draft.recipient,
          resultStatus: result.status,
          transferHash: result.status === "submitted" ? result.transfer.transactionHash : null,
          timingTotalMs: result.timings.totalMs ?? null,
          timings: result.timings.events.map((event) => ({
            label: event.label,
            elapsedMs: event.elapsedMs,
            status: event.status,
          })),
          elapsedMs: Date.now() - input.routeStartedAt,
        });
        if (result.status === "submitted") {
          await sendTool(
            RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
            "Confirm on Base",
            [result.transfer.transactionHash, result.transfer.blockNumber ? `block ${result.transfer.blockNumber}` : ""].filter(Boolean).join(" · "),
            "completed",
          );
        }
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS, "Read remaining spend balance", "Checking live agent spend balance.", "running");
        const remainingBalance = await readRemainingSpendBalance(input.wallet);
        await sendTool(
          RUNTIME_STREAM_EVENT_TYPES.TOOL_PROGRESS,
          "Read remaining spend balance",
          remainingBalance ? `Remaining ${remainingBalance}.` : "Remaining balance unavailable.",
          "completed",
        );
        const message = privateTransferResultMessage(result, input.draft, remainingBalance);
        privateTransferExecutions.set(input.executionKey, { status: "completed", startedAt: Date.now(), message });
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private transfer finished", privateTransferTimingSummary(result.timings), "completed");
        await appendRuntimeChatSessionText(input.runtimeSessionId, "assistant", message, result).catch(() => undefined);
        await finishRuntimeChatSession(input.runtimeSessionId, "completed").catch(() => undefined);
        send({ choices: [{ delta: { content: message } }] });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (error) {
        privateTransferExecutions.delete(input.executionKey);
        const message = `Private send failed: ${veilPrivateTransferErrorMessage(error)}`;
        await sendTool(RUNTIME_STREAM_EVENT_TYPES.TOOL_DONE, "Private transfer failed", veilPrivateTransferErrorMessage(error), "failed");
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

function privateTransferResultMessage(
  result: PrivateTransferExecutionResult,
  draft: PrivateTransferDraft,
  remainingBalance?: string,
) {
  if (result.status === "shielding") {
    return [
      `**Private send shielding** · **${draft.amount} ${draft.asset}**`,
      "",
      `Recipient \`${draft.recipient}\``,
      result.shield.transactionHash ? `Shield proof ${baseScanTxUrl(result.shield.transactionHash)}` : "",
      result.shield.transactionHash ? `Shield tx \`${result.shield.transactionHash}\`` : "",
      result.shield.blockNumber ? `Shield block \`${result.shield.blockNumber}\`` : "",
      platformFeeReceiptDetail(result.platformFee),
      "",
      "HivemindOS will complete the private send after Veil accepts the deposit into the private pool.",
      [remainingBalance ? `Remaining **${remainingBalance}**` : "", `Timing **${privateTransferTimingCompact(result.timings)}**`].filter(Boolean).join(" · "),
    ].filter(Boolean).join("\n");
  }
  return [
    `**Private send complete** · **${draft.amount} ${draft.asset}**`,
    "",
    `Recipient \`${draft.recipient}\``,
    result.transfer.transactionHash ? `Proof ${baseScanTxUrl(result.transfer.transactionHash)}` : "",
    result.transfer.transactionHash ? `Tx \`${result.transfer.transactionHash}\`` : "",
    result.transfer.blockNumber ? `Block \`${result.transfer.blockNumber}\`` : "",
    platformFeeReceiptDetail(result.platformFee),
    "",
    [remainingBalance ? `Remaining **${remainingBalance}**` : "", `Timing **${privateTransferTimingCompact(result.timings)}**`].filter(Boolean).join(" · "),
  ].filter(Boolean).join("\n");
}

async function readRemainingSpendBalance(wallet: AgentWalletConfig | undefined) {
  const address = wallet?.walletAddress?.trim() || wallet?.vaultAddress?.trim();
  if (!address || !wallet?.network) return "";
  try {
    const balance = await getWalletBalance(address, wallet.network);
    return `${formatMoney(balance.tokenBalance)} ${balance.tokenSymbol}`;
  } catch {
    const fallback = Number(wallet.currentBalanceUsd);
    return Number.isFinite(fallback) ? `${formatMoney(fallback)} ${wallet.tokenSymbol || "USDC"}` : "";
  }
}

export function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

export function baseScanTxUrl(hash: string) {
  return `https://basescan.org/tx/${hash}`;
}

// Middle-truncate a long hash/address for a tidy card: 0xC42e…147bE9.
function shortHex(value: string, head = 6, tail = 6) {
  const v = value.trim();
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

// Block explorer for a tx, by network family (Solana vs EVM/Base default).
function txExplorerUrl(network: string, hash: string) {
  if (/sol/i.test(network)) return `https://solscan.io/tx/${hash}`;
  if (network === "eip155:4663") return `https://robinhoodchain.blockscout.com/tx/${hash}`;
  return baseScanTxUrl(hash);
}

// Trim trailing-zero noise from a fixed-precision amount: 0.000635500 -> 0.0006355.
function trimAmount(value: number) {
  return value.toPrecision(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function privateTransferTimingSummary(timings: Awaited<ReturnType<typeof executeVeilPrivateTransfer>>["timings"]) {
  const parts = timings.events
    .filter((event) => event.status === "completed")
    .map((event) => `${event.label}: ${formatDuration(event.elapsedMs)}`);
  return [`Timing: total ${formatDuration(timings.totalMs ?? 0)}`, parts.length ? parts.join("; ") : ""].filter(Boolean).join(" · ");
}

function privateTransferTimingCompact(timings: Awaited<ReturnType<typeof executeVeilPrivateTransfer>>["timings"]) {
  const parts = timings.events
    .filter((event) => event.status === "completed")
    .map((event) => `${event.label}: ${formatDuration(event.elapsedMs)}`);
  return [`total ${formatDuration(timings.totalMs ?? 0)}`, ...parts].join(" · ");
}

export function formatDuration(ms: number) {
  if (ms < 1_000) return `${ms}ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

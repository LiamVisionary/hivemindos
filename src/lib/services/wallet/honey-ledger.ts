import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "node:path";

import type { HoneyTreasuryConfig } from "@/lib/types/agent-wallet";
import { calculateHoneyForTokens, createDefaultHoneyTreasuryConfig } from "@/lib/utils/agent-wallet";
import { honeyComputeGatewayUrl, honeyLedgerUrl, isHoneyEconomyEnabled } from "@/lib/services/wallet/honey-economy-config";

export type HoneyLedgerEvent = {
  id: string;
  agentId: string;
  agentName?: string;
  kind: "usage" | "exchange" | "managed-credit" | "managed-spend";
  source:
    | "chat"
    | "kanban-chat"
    | "scheduler"
    | "manual"
    | "observed-hermes-usage"
    | "observed-openclaw-usage"
    | "observed-runtime-usage"
    | "managed-agent"
    | "managed-agent-stripe"
    | "managed-agent-x402"
    | "managed-agent-bankr"
    | "managed-agent-wallet";
  tokensUsed: number;
  honeyDelta: number;
  hiveDelta: number;
  createdAt: string;
};

export type HoneyLedger = HoneyTreasuryConfig & {
  events: HoneyLedgerEvent[];
  updatedAt: string;
};

const LEDGER_PATH = join(homedir(), ".hivemindos", "honey-ledger.json");
const INSTALL_ID_PATH = join(homedir(), ".hivemindos", "install-id");
const REMOTE_HONEY_TIMEOUT_MS = 8_000;
const BANKR_API_URL = "https://api.bankr.bot";

export type BankrHoneyClaim = {
  ledger: HoneyLedger;
  txHash: string;
  recipientAddress: string;
  amount: number;
  tokenAddress: string;
  events: HoneyLedgerEvent[];
};

export type ManagedHoneyBillingKind = "credit" | "debit";

export type ManagedHoneyBillingEvent = {
  eventId: string;
  issuerId: string;
  workspaceId?: string;
  agentId: string;
  kind: ManagedHoneyBillingKind;
  honeyAmount: number;
  usdAmount?: number;
  provider: string;
  sku: string;
  units?: number;
  unitUsd?: number;
  markupBps?: number;
  source: Extract<HoneyLedgerEvent["source"], `managed-agent${string}`>;
  timestamp?: string;
  idempotencyKey?: string;
  metadataHash?: string;
  signature?: string;
};

export type ManagedHoneyBillingResult = {
  ledger: HoneyLedger;
  event: HoneyLedgerEvent;
  balance?: NonNullable<HoneyLedger["balances"]>[number] | null;
  duplicate?: boolean;
};

class HoneyClaimError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readHoneyLedger(): Promise<HoneyLedger> {
  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const remoteLedger = await readRemoteHoneyLedger(remote).catch(() => null);
    if (remoteLedger) return remoteLedger;
  }

  const fallback = createDefaultLedger();
  try {
    const raw = await readFile(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<HoneyLedger>;
    return normalizeLedger(parsed);
  } catch {
    return fallback;
  }
}

export async function recordHoneyUsage(input: {
  agentId: string;
  agentName?: string;
  source?: HoneyLedgerEvent["source"];
  model?: string;
  inputText: string;
  outputText: string;
}) {
  const tokensUsed = estimateTokens([input.inputText, input.outputText].join("\n"));
  const ledger = await readHoneyLedger();
  if (tokensUsed <= 0) return { ledger, event: null };

  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const model = input.model ?? "hivemindos/private-runtime";
    const timestamp = new Date().toISOString();
    const remoteResult = remote.signingSecret
      ? await recordRemoteHoneyUsage(remote, {
        agentId: input.agentId,
        model,
        source: input.source ?? "chat",
        tokensUsed,
      }).catch(() => null)
      : await recordRemoteHoneyObservation(remote, {
        eventId: randomUUID(),
        agentId: input.agentId,
        model,
        source: "observed-runtime-usage",
        tokensUsed,
        timestamp,
      }).catch(() => null);
    if (remoteResult) {
      return {
        ledger: remoteResult.ledger,
        event: {
          id: remoteResult.eventId,
          agentId: input.agentId,
          agentName: input.agentName,
          kind: "usage" as const,
          source: remote.signingSecret ? input.source ?? "chat" : "observed-runtime-usage",
          tokensUsed: remote.signingSecret ? tokensUsed : remoteResult.acceptedTokens,
          honeyDelta: remoteResult.honeyDelta,
          hiveDelta: 0,
          createdAt: remoteResult.createdAt,
        },
      };
    }
  }

  const targetHoneyDelta = calculateHoneyForTokens(tokensUsed, ledger.honeyPerThousandTokens);
  const remainingPool = Math.max(0, ledger.rewardPoolHive - ledger.rewardPoolEmittedHive);
  const honeyDelta = Math.min(targetHoneyDelta, remainingPool);
  const event: HoneyLedgerEvent = {
    id: randomUUID(),
    agentId: input.agentId,
    agentName: input.agentName,
    kind: "usage",
    source: input.source ?? "chat",
    tokensUsed,
    honeyDelta,
    hiveDelta: 0,
    createdAt: new Date().toISOString(),
  };

  ledger.agentTokenUsage[input.agentId] = (ledger.agentTokenUsage[input.agentId] ?? 0) + tokensUsed;
  ledger.rewardPoolEmittedHive = Math.round((ledger.rewardPoolEmittedHive + honeyDelta) * 1_000_000) / 1_000_000;
  ledger.rewardPoolRemainingHive = Math.max(0, Math.round((ledger.rewardPoolHive - ledger.rewardPoolEmittedHive) * 1_000_000) / 1_000_000);
  ledger.events.unshift(event);
  ledger.updatedAt = event.createdAt;
  await writeHoneyLedger(ledger);
  return { ledger, event };
}

export async function recordObservedHoneyUsage(input: {
  eventId: string;
  agentId: string;
  agentName?: string;
  source: Extract<HoneyLedgerEvent["source"], "observed-hermes-usage" | "observed-openclaw-usage" | "observed-runtime-usage">;
  model: string;
  tokensUsed: number;
  timestamp?: string;
}) {
  const tokensUsed = Math.max(0, Math.round(input.tokensUsed));
  const ledger = await readHoneyLedger();
  if (!input.eventId.trim() || tokensUsed <= 0) return { ledger, event: null };

  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const remoteResult = await recordRemoteHoneyObservation(remote, {
      eventId: input.eventId,
      agentId: input.agentId,
      model: input.model,
      source: input.source,
      tokensUsed,
      timestamp: input.timestamp ?? new Date().toISOString(),
    }).catch(() => null);
    if (remoteResult) {
      return {
        ledger: remoteResult.ledger,
        event: remoteResult.acceptedTokens > 0 ? {
          id: input.eventId,
          agentId: input.agentId,
          agentName: input.agentName,
          kind: "usage" as const,
          source: input.source,
          tokensUsed: remoteResult.acceptedTokens,
          honeyDelta: remoteResult.honeyDelta,
          hiveDelta: 0,
          createdAt: remoteResult.createdAt,
        } : null,
      };
    }
  }

  if (ledger.events.some((event) => event.id === input.eventId)) return { ledger, event: null };
  const targetHoneyDelta = calculateHoneyForTokens(tokensUsed, ledger.honeyPerThousandTokens);
  const remainingPool = Math.max(0, ledger.rewardPoolHive - ledger.rewardPoolEmittedHive);
  const honeyDelta = Math.min(targetHoneyDelta, remainingPool);
  const event: HoneyLedgerEvent = {
    id: input.eventId,
    agentId: input.agentId,
    agentName: input.agentName,
    kind: "usage",
    source: input.source,
    tokensUsed,
    honeyDelta,
    hiveDelta: 0,
    createdAt: input.timestamp ?? new Date().toISOString(),
  };

  ledger.agentTokenUsage[input.agentId] = (ledger.agentTokenUsage[input.agentId] ?? 0) + tokensUsed;
  ledger.rewardPoolEmittedHive = Math.round((ledger.rewardPoolEmittedHive + honeyDelta) * 1_000_000) / 1_000_000;
  ledger.rewardPoolRemainingHive = Math.max(0, Math.round((ledger.rewardPoolHive - ledger.rewardPoolEmittedHive) * 1_000_000) / 1_000_000);
  ledger.events.unshift(event);
  ledger.updatedAt = event.createdAt;
  await writeHoneyLedger(ledger);
  return { ledger, event };
}

export async function exchangeHoneyForHive(agentId?: string) {
  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const remoteResult = await exchangeRemoteHoneyForHive(remote, agentId).catch(() => null);
    if (remoteResult) return remoteResult;
  }

  const ledger = await readHoneyLedger();
  const agentIds = agentId ? [agentId] : Object.keys(ledger.agentTokenUsage);
  const events: HoneyLedgerEvent[] = [];
  const now = new Date().toISOString();

  for (const id of agentIds) {
    const honeyEarned = calculateHoneyForTokens(ledger.agentTokenUsage[id] ?? 0, ledger.honeyPerThousandTokens);
    const honeyExchanged = Math.min(honeyEarned, Math.max(0, ledger.agentHoneyExchanged[id] ?? 0));
    const remainingPool = Math.max(0, ledger.rewardPoolHive - ledger.rewardPoolEmittedHive);
    const honeyAvailable = Math.max(0, Math.min(remainingPool, Math.round((honeyEarned - honeyExchanged) * 1_000_000) / 1_000_000));
    if (honeyAvailable <= 0) continue;
    const hiveDelta = Math.round(honeyAvailable * ledger.tokenPerHoney * 1_000_000) / 1_000_000;
    ledger.agentHoneyExchanged[id] = Math.round((honeyExchanged + honeyAvailable) * 1_000_000) / 1_000_000;
    ledger.agentHiveBalances[id] = Math.round(((ledger.agentHiveBalances[id] ?? 0) + hiveDelta) * 1_000_000) / 1_000_000;
    ledger.rewardPoolExchangedHive = Math.round((ledger.rewardPoolExchangedHive + hiveDelta) * 1_000_000) / 1_000_000;
    events.push({
      id: randomUUID(),
      agentId: id,
      kind: "exchange",
      source: "manual",
      tokensUsed: 0,
      honeyDelta: -honeyAvailable,
      hiveDelta,
      createdAt: now,
    });
  }

  if (events.length) {
    ledger.events.unshift(...events);
    ledger.updatedAt = now;
    await writeHoneyLedger(ledger);
  }
  return { ledger, events };
}

export async function returnHiveToHoney(agentId?: string) {
  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const remoteResult = await returnRemoteHiveToHoney(remote, agentId).catch(() => null);
    if (remoteResult) return remoteResult;
  }

  const ledger = await readHoneyLedger();
  const agentIds = agentId ? [agentId] : [...new Set([
    ...Object.keys(ledger.agentTokenUsage),
    ...Object.keys(ledger.agentHiveBalances),
  ])];
  const events: HoneyLedgerEvent[] = [];
  const now = new Date().toISOString();
  const tokenPerHoney = Math.max(0, Number(ledger.tokenPerHoney) || 0);

  for (const id of agentIds) {
    const hiveBalance = Math.max(0, Number(ledger.agentHiveBalances[id] ?? 0));
    const honeyExchanged = Math.max(0, Number(ledger.agentHoneyExchanged[id] ?? 0));
    if (hiveBalance <= 0 || honeyExchanged <= 0 || tokenPerHoney <= 0) continue;

    const honeyDelta = Math.min(honeyExchanged, Math.round((hiveBalance / tokenPerHoney) * 1_000_000) / 1_000_000);
    const hiveDelta = Math.min(hiveBalance, Math.round(honeyDelta * tokenPerHoney * 1_000_000) / 1_000_000);
    if (honeyDelta <= 0 || hiveDelta <= 0) continue;

    ledger.agentHoneyExchanged[id] = Math.max(0, Math.round((honeyExchanged - honeyDelta) * 1_000_000) / 1_000_000);
    ledger.agentHiveBalances[id] = Math.max(0, Math.round((hiveBalance - hiveDelta) * 1_000_000) / 1_000_000);
    ledger.rewardPoolExchangedHive = Math.max(0, Math.round((ledger.rewardPoolExchangedHive - hiveDelta) * 1_000_000) / 1_000_000);
    events.push({
      id: randomUUID(),
      agentId: id,
      kind: "exchange",
      source: "manual",
      tokensUsed: 0,
      honeyDelta,
      hiveDelta: -hiveDelta,
      createdAt: now,
    });
  }

  if (events.length) {
    ledger.events.unshift(...events);
    ledger.updatedAt = now;
    await writeHoneyLedger(ledger);
  }
  return { ledger, events };
}

export async function claimHoneyToBankrHive(input: { agentId?: string; recipientAddress?: string } = {}): Promise<BankrHoneyClaim> {
  const ledger = await readHoneyLedger();
  const amount = claimableHiveAmount(ledger, input.agentId);
  if (amount <= 0) throw new HoneyClaimError("No Honey conversion is available.", 400);

  const recipientAddress = normalizeEvmAddress(
    input.recipientAddress || process.env.HONEY_BANKR_RECIPIENT_ADDRESS || process.env.BANKR_RECIPIENT_ADDRESS,
  );
  if (!recipientAddress) throw new HoneyClaimError("Enter a Bankr EVM receiving address before claiming HIVE.", 400);

  const remote = await getRemoteLedgerConfig();
  if (remote) return claimRemoteHoneyToBankrHive(remote, { agentId: input.agentId, recipientAddress });

  const tokenAddress = (process.env.HIVE_TOKEN_ADDRESS?.trim() || ledger.hiveTokenAddress?.trim() || "");
  if (!tokenAddress) throw new HoneyClaimError("Set HIVE_TOKEN_ADDRESS before claiming Bankr HIVE.", 500);

  const treasuryApiKey = process.env.HONEY_REWARD_BANKR_API_KEY?.trim() || process.env.BANKR_REWARD_TREASURY_API_KEY?.trim() || "";
  if (!treasuryApiKey) throw new HoneyClaimError("Set HONEY_REWARD_BANKR_API_KEY to the funded reward treasury Bankr key.", 500);

  const txHash = await transferBankrHive({
    apiKey: treasuryApiKey,
    tokenAddress,
    recipientAddress,
    amount,
  });

  const exchanged = await exchangeHoneyForHive(input.agentId);
  return {
    ledger: exchanged.ledger,
    events: exchanged.events,
    txHash,
    recipientAddress,
    amount,
    tokenAddress,
  };
}

export async function recordManagedHoneyBillingEvent(input: Omit<ManagedHoneyBillingEvent, "workspaceId" | "timestamp" | "signature"> & {
  workspaceId?: string;
  timestamp?: string;
}): Promise<ManagedHoneyBillingResult> {
  const event = normalizeManagedBillingEvent({
    ...input,
    workspaceId: input.workspaceId || await getWorkspaceId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  });

  const remote = await getRemoteLedgerConfig();
  if (remote) {
    const remoteResult = await recordRemoteManagedHoneyBillingEvent(remote, event).catch(() => null);
    if (remoteResult) return remoteResult;
    throw new HoneyClaimError("Official Honey ledger did not accept the managed billing event.", 502);
  }

  return recordLocalManagedHoneyBillingEvent(event);
}

function estimateTokens(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function claimableHiveAmount(ledger: HoneyLedger, agentId?: string) {
  const tokenPerHoney = Math.max(0, Number(ledger.tokenPerHoney) || 0);
  if (tokenPerHoney <= 0) return 0;
  const balances = ledger.balances?.filter((balance) => !agentId || balance.agentId === agentId);
  if (balances?.length) {
    return roundHive(balances.reduce((total, balance) => total + Math.max(0, Number(balance.availableHoney) || 0), 0) * tokenPerHoney);
  }

  const agentIds = agentId ? [agentId] : Object.keys(ledger.agentTokenUsage);
  return roundHive(agentIds.reduce((total, id) => {
    const honeyEarned = calculateHoneyForTokens(ledger.agentTokenUsage[id] ?? 0, ledger.honeyPerThousandTokens);
    const honeyExchanged = Math.min(honeyEarned, Math.max(0, ledger.agentHoneyExchanged[id] ?? 0));
    const honeyAvailable = Math.max(0, Math.round((honeyEarned - honeyExchanged) * 1_000_000) / 1_000_000);
    return total + honeyAvailable * tokenPerHoney;
  }, 0));
}

function roundHive(value: number) {
  return Math.max(0, Math.round(value * 1_000_000) / 1_000_000);
}

function normalizeEvmAddress(address: unknown) {
  if (typeof address !== "string") return "";
  const trimmed = address.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : "";
}

async function transferBankrHive(input: {
  apiKey: string;
  tokenAddress: string;
  recipientAddress: string;
  amount: number;
}) {
  const response = await fetch(`${BANKR_API_URL}/wallet/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": input.apiKey,
    },
    body: JSON.stringify({
      tokenAddress: input.tokenAddress,
      recipientAddress: input.recipientAddress,
      amount: input.amount.toFixed(6).replace(/\.?0+$/, ""),
      isNativeToken: false,
    }),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null) as {
    success?: boolean;
    txHash?: string;
    error?: string;
    message?: string;
  } | null;
  if (!response.ok || !data?.success || !data.txHash) {
    throw new HoneyClaimError(data?.message || data?.error || "Bankr HIVE transfer failed.", response.status || 502);
  }
  return data.txHash;
}

type RemoteLedgerConfig = {
  url: string;
  issuerId: string;
  signingSecret?: string;
  billingSigningSecret?: string;
  readToken?: string;
  adminToken?: string;
  // Value-moving operations (exchange / return / claim) are signed server-side by the
  // compute gateway, which authenticates the workspace by its Bankr LLM key. The app
  // never holds HONEY_LEDGER_SECRET, so it reaches those routes only through the gateway.
  gatewayUrl?: string;
  bankrKey?: string;
};

type RemoteUsageReceipt = {
  eventId: string;
  issuerId: string;
  workspaceId: string;
  agentId: string;
  tokensUsed: number;
  model: string;
  source: string;
  timestamp: string;
  signature?: string;
};

// Gated behind the remote Honey-economy kill-switch. When disabled (the default), this
// returns null and every honey flow falls back to the local ledger — identical to the
// pre-economy behavior. The official worker URLs are baked in (public, non-secret) so
// the packaged app needs no env to reach them once the flag is flipped on.
async function getRemoteLedgerConfig(): Promise<RemoteLedgerConfig | null> {
  if (!(await isHoneyEconomyEnabled())) return null;
  return {
    url: honeyLedgerUrl(),
    signingSecret: process.env.HONEY_LEDGER_SIGNING_SECRET?.trim(),
    billingSigningSecret: process.env.HONEY_BILLING_SIGNING_SECRET?.trim() || process.env.HONEY_LEDGER_SIGNING_SECRET?.trim(),
    issuerId: process.env.HONEY_LEDGER_ISSUER_ID?.trim() || "hivemindos",
    readToken: process.env.HONEY_LEDGER_READ_TOKEN?.trim(),
    adminToken: process.env.HONEY_LEDGER_ADMIN_TOKEN?.trim(),
    gatewayUrl: honeyComputeGatewayUrl(),
    bankrKey: (process.env.BANKR_LLM_KEY || process.env.BANKR_API_KEY || process.env.BANKR_MANAGEMENT_KEY)?.trim(),
  };
}

// The reward key carries the workspace identity to the gateway, which extracts the
// workspaceId and the Bankr key, then verifies the key owns that workspace before signing.
function honeyRewardKey(remote: RemoteLedgerConfig, workspaceId: string) {
  return remote.bankrKey ? `hive-v1.${workspaceId}.${remote.bankrKey}` : "";
}

function honeyGatewayConfigured(remote: RemoteLedgerConfig) {
  return Boolean(remote.gatewayUrl && remote.bankrKey);
}

async function readRemoteHoneyLedger(remote: RemoteLedgerConfig): Promise<HoneyLedger | null> {
  const workspaceId = await getWorkspaceId();
  const response = await fetch(`${remote.url}/ledger?workspaceId=${encodeURIComponent(workspaceId)}`, {
    headers: authHeaders(remote.readToken),
    cache: "no-store",
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as { ok?: boolean; ledger?: Partial<HoneyLedger> } | null;
  return data?.ok && data.ledger ? normalizeLedger(data.ledger) : null;
}

async function recordRemoteHoneyUsage(
  remote: RemoteLedgerConfig,
  input: { agentId: string; tokensUsed: number; model: string; source: HoneyLedgerEvent["source"] },
) {
  if (!remote.signingSecret) return null;

  const timestamp = new Date().toISOString();
  const receipt: Omit<RemoteUsageReceipt, "signature"> = {
    eventId: randomUUID(),
    issuerId: remote.issuerId,
    workspaceId: await getWorkspaceId(),
    agentId: input.agentId,
    tokensUsed: input.tokensUsed,
    model: input.model,
    source: input.source,
    timestamp,
  };
  const signedReceipt: RemoteUsageReceipt = {
    ...receipt,
    ...(remote.signingSecret ? { signature: signReceipt(receipt, remote.signingSecret) } : {}),
  };
  const response = await fetch(`${remote.url}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedReceipt),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    honeyDelta?: number;
  } | null;
  const ledger = await readRemoteHoneyLedger(remote);
  if (!data?.ok || !ledger) return null;
  return {
    ledger,
    eventId: receipt.eventId,
    honeyDelta: Number(data.honeyDelta) || 0,
    acceptedTokens: input.tokensUsed,
    createdAt: timestamp,
  };
}

async function recordRemoteHoneyObservation(
  remote: RemoteLedgerConfig,
  input: { eventId: string; agentId: string; tokensUsed: number; model: string; source: HoneyLedgerEvent["source"]; timestamp: string },
) {
  const receipt: Omit<RemoteUsageReceipt, "issuerId"> & { issuerId?: string } = {
    eventId: input.eventId,
    workspaceId: await getWorkspaceId(),
    agentId: input.agentId,
    tokensUsed: input.tokensUsed,
    model: input.model,
    source: input.source,
    timestamp: input.timestamp,
  };
  const response = await fetch(`${remote.url}/observations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(receipt),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    honeyDelta?: number;
    acceptedTokens?: number;
  } | null;
  const ledger = await readRemoteHoneyLedger(remote);
  if (!data?.ok || !ledger) return null;
  return {
    ledger,
    eventId: input.eventId,
    honeyDelta: Number(data.honeyDelta) || 0,
    acceptedTokens: Math.max(0, Math.round(Number(data.acceptedTokens ?? input.tokensUsed) || 0)),
    createdAt: input.timestamp,
  };
}

async function exchangeRemoteHoneyForHive(remote: RemoteLedgerConfig, agentId?: string) {
  if (!honeyGatewayConfigured(remote)) return null;
  const workspaceId = await getWorkspaceId();
  const response = await fetch(`${remote.gatewayUrl}/honey/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${honeyRewardKey(remote, workspaceId)}` },
    body: JSON.stringify({ agentId }),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    ledger?: Partial<HoneyLedger>;
    events?: HoneyLedgerEvent[];
  } | null;
  if (!data?.ok || !data.ledger) return null;
  return { ledger: normalizeLedger(data.ledger), events: Array.isArray(data.events) ? data.events : [] };
}

async function returnRemoteHiveToHoney(remote: RemoteLedgerConfig, agentId?: string) {
  if (!honeyGatewayConfigured(remote)) return null;
  const workspaceId = await getWorkspaceId();
  const response = await fetch(`${remote.gatewayUrl}/honey/return`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${honeyRewardKey(remote, workspaceId)}` },
    body: JSON.stringify({ agentId }),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    ledger?: Partial<HoneyLedger>;
    events?: HoneyLedgerEvent[];
  } | null;
  if (!data?.ok || !data.ledger) return null;
  return { ledger: normalizeLedger(data.ledger), events: Array.isArray(data.events) ? data.events : [] };
}

async function claimRemoteHoneyToBankrHive(
  remote: RemoteLedgerConfig,
  input: { agentId?: string; recipientAddress: string },
): Promise<BankrHoneyClaim> {
  if (!honeyGatewayConfigured(remote)) {
    throw new HoneyClaimError("Official Honey claims require the HivemindOS compute gateway and a Bankr LLM key.", 400);
  }
  const workspaceId = await getWorkspaceId();
  const response = await fetch(`${remote.gatewayUrl}/honey/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${honeyRewardKey(remote, workspaceId)}` },
    body: JSON.stringify({
      agentId: input.agentId,
      recipientAddress: input.recipientAddress,
    }),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    ledger?: Partial<HoneyLedger>;
    events?: HoneyLedgerEvent[];
    txHash?: string;
    amount?: number;
    recipientAddress?: string;
    tokenAddress?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || !data.ledger || !data.txHash) {
    throw new HoneyClaimError(data?.error || "Official Bankr HIVE claim failed.", response.status || 502);
  }
  return {
    ledger: normalizeLedger(data.ledger),
    events: Array.isArray(data.events) ? data.events : [],
    txHash: data.txHash,
    amount: Number(data.amount ?? 0) || 0,
    recipientAddress: data.recipientAddress ?? input.recipientAddress,
    tokenAddress: data.tokenAddress ?? "",
  };
}

async function recordRemoteManagedHoneyBillingEvent(
  remote: RemoteLedgerConfig,
  input: ManagedHoneyBillingEvent,
): Promise<ManagedHoneyBillingResult | null> {
  const unsignedEvent = {
    ...input,
    workspaceId: input.workspaceId || await getWorkspaceId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
  const body: ManagedHoneyBillingEvent = remote.billingSigningSecret
    ? { ...unsignedEvent, signature: signManagedBillingEvent(unsignedEvent, remote.billingSigningSecret) }
    : unsignedEvent;
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(remote.billingSigningSecret ? undefined : remote.adminToken),
  };
  const response = await fetch(`${remote.url}/managed-billing/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REMOTE_HONEY_TIMEOUT_MS),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    ledger?: Partial<HoneyLedger>;
    event?: HoneyLedgerEvent;
    balance?: NonNullable<HoneyLedger["balances"]>[number] | null;
    duplicate?: boolean;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || !data.ledger || !data.event) {
    if (data?.error) throw new HoneyClaimError(data.error, response.status || 502);
    return null;
  }
  return {
    ledger: normalizeLedger(data.ledger),
    event: data.event,
    balance: data.balance ?? null,
    duplicate: data.duplicate === true,
  };
}

async function recordLocalManagedHoneyBillingEvent(input: ManagedHoneyBillingEvent): Promise<ManagedHoneyBillingResult> {
  const ledger = await readHoneyLedger();
  if (ledger.events.some((event) => event.id === input.eventId)) {
    const existing = ledger.events.find((event) => event.id === input.eventId);
    return {
      ledger,
      event: existing ?? managedBillingLedgerEvent(input),
      balance: ledger.balances?.find((balance) => balance.agentId === input.agentId) ?? null,
      duplicate: true,
    };
  }

  const amount = roundHive(input.honeyAmount);
  if (amount <= 0) throw new HoneyClaimError("Managed Honey billing amount must be greater than zero.", 400);
  const balances = [...(ledger.balances ?? [])];
  const balanceIndex = balances.findIndex((balance) => balance.agentId === input.agentId);
  const existing = balanceIndex >= 0
    ? balances[balanceIndex]
    : {
      workspaceId: input.workspaceId ?? "",
      agentId: input.agentId,
      tokensUsed: 0,
      lifetimeHoney: 0,
      availableHoney: 0,
      hiveBalance: 0,
      managedHoneyBalance: 0,
      managedHoneyLifetimeCredits: 0,
      managedHoneySpent: 0,
      updatedAt: input.timestamp ?? new Date().toISOString(),
    };
  const managedBalance = Math.max(0, Number(existing.managedHoneyBalance ?? 0));
  if (input.kind === "debit" && managedBalance < amount) {
    throw new HoneyClaimError("Insufficient Hivemind Cloud credits.", 402);
  }

  const nextBalance = {
    ...existing,
    workspaceId: existing.workspaceId || input.workspaceId || "",
    managedHoneyBalance: input.kind === "credit"
      ? roundHive(managedBalance + amount)
      : roundHive(managedBalance - amount),
    managedHoneyLifetimeCredits: input.kind === "credit"
      ? roundHive(Number(existing.managedHoneyLifetimeCredits ?? 0) + amount)
      : roundHive(Number(existing.managedHoneyLifetimeCredits ?? 0)),
    managedHoneySpent: input.kind === "debit"
      ? roundHive(Number(existing.managedHoneySpent ?? 0) + amount)
      : roundHive(Number(existing.managedHoneySpent ?? 0)),
    updatedAt: input.timestamp ?? new Date().toISOString(),
  };
  if (balanceIndex >= 0) balances[balanceIndex] = nextBalance;
  else balances.push(nextBalance);

  const event = managedBillingLedgerEvent(input);
  ledger.balances = balances;
  ledger.events.unshift(event);
  ledger.events = ledger.events.slice(0, 500);
  ledger.updatedAt = event.createdAt;
  await writeHoneyLedger(ledger);
  return { ledger, event, balance: nextBalance, duplicate: false };
}

function signReceipt(receipt: Omit<RemoteUsageReceipt, "signature">, secret: string) {
  return createHmac("sha256", secret).update(canonicalReceipt(receipt)).digest("hex");
}

function canonicalReceipt(receipt: Omit<RemoteUsageReceipt, "signature">) {
  return [
    receipt.issuerId,
    receipt.eventId,
    receipt.workspaceId,
    receipt.agentId,
    receipt.tokensUsed,
    receipt.model,
    receipt.source,
    receipt.timestamp,
  ].join(".");
}

function signManagedBillingEvent(event: Omit<ManagedHoneyBillingEvent, "signature">, secret: string) {
  return createHmac("sha256", secret).update(canonicalManagedBillingEvent(event)).digest("hex");
}

function canonicalManagedBillingEvent(event: Omit<ManagedHoneyBillingEvent, "signature">) {
  return [
    event.issuerId,
    event.eventId,
    event.workspaceId ?? "",
    event.agentId,
    event.kind,
    roundHive(event.honeyAmount),
    roundHive(event.usdAmount ?? 0),
    event.provider,
    event.sku,
    Math.max(0, Number(event.units ?? 0) || 0),
    roundHive(event.unitUsd ?? 0),
    Math.max(0, Math.round(Number(event.markupBps ?? 0) || 0)),
    event.source,
    event.timestamp ?? "",
    event.idempotencyKey ?? "",
    event.metadataHash ?? "",
  ].join(".");
}

function normalizeManagedBillingEvent(input: ManagedHoneyBillingEvent): ManagedHoneyBillingEvent {
  const honeyAmount = roundHive(input.honeyAmount);
  if (!input.eventId.trim()) throw new HoneyClaimError("Missing managed Honey billing event id.", 400);
  if (!input.agentId.trim()) throw new HoneyClaimError("Missing managed Honey billing agent id.", 400);
  if (input.kind !== "credit" && input.kind !== "debit") throw new HoneyClaimError("Unsupported managed Honey billing kind.", 400);
  if (honeyAmount <= 0) throw new HoneyClaimError("Managed Honey billing amount must be greater than zero.", 400);
  return {
    ...input,
    eventId: input.eventId.trim(),
    issuerId: input.issuerId.trim() || "hivemindos-managed-billing",
    workspaceId: input.workspaceId?.trim(),
    agentId: input.agentId.trim(),
    honeyAmount,
    usdAmount: roundHive(input.usdAmount ?? 0),
    provider: input.provider.trim().slice(0, 80) || "auto",
    sku: input.sku.trim().slice(0, 120) || "managed-agent",
    units: Math.max(0, Number(input.units ?? 0) || 0),
    unitUsd: roundHive(input.unitUsd ?? 0),
    markupBps: Math.max(0, Math.round(Number(input.markupBps ?? 0) || 0)),
    source: input.source,
    timestamp: input.timestamp?.trim() || new Date().toISOString(),
    idempotencyKey: input.idempotencyKey?.trim().slice(0, 200),
    metadataHash: input.metadataHash?.trim().slice(0, 128),
  };
}

function managedBillingLedgerEvent(input: ManagedHoneyBillingEvent): HoneyLedgerEvent {
  return {
    id: input.eventId,
    agentId: input.agentId,
    kind: input.kind === "credit" ? "managed-credit" : "managed-spend",
    source: input.source,
    tokensUsed: 0,
    honeyDelta: input.kind === "credit" ? input.honeyAmount : -input.honeyAmount,
    hiveDelta: 0,
    createdAt: input.timestamp ?? new Date().toISOString(),
  };
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getHoneyWorkspaceId() {
  const explicit = process.env.HONEY_LEDGER_WORKSPACE_ID?.trim();
  if (explicit) return explicit;

  try {
    const current = (await readFile(INSTALL_ID_PATH, "utf8")).trim();
    if (current) return current;
  } catch {
    // Create a random install id below; no local machine details are sent.
  }

  const id = `ws_${randomUUID()}`;
  await mkdir(dirname(INSTALL_ID_PATH), { recursive: true });
  await writeIfChanged(INSTALL_ID_PATH, `${id}\n`);
  return id;
}

async function getWorkspaceId() {
  return getHoneyWorkspaceId();
}

async function writeHoneyLedger(ledger: HoneyLedger) {
  await mkdir(dirname(LEDGER_PATH), { recursive: true });
  await writeIfChanged(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function writeIfChanged(path: string, content: string) {
  const current = await readFile(path, "utf8").catch(() => null);
  if (current === content) return;
  await writeFile(path, content, "utf8");
}

function createDefaultLedger(): HoneyLedger {
  return {
    ...createDefaultHoneyTreasuryConfig(),
    events: [],
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeLedger(parsed: Partial<HoneyLedger>): HoneyLedger {
  const fallback = createDefaultLedger();
  const rewardPoolHive = positiveNumber(parsed.rewardPoolHive, fallback.rewardPoolHive);
  const rewardPoolEmittedHive = positiveNumber(parsed.rewardPoolEmittedHive, fallback.rewardPoolEmittedHive);
  const agentTokenUsage = plainNumberRecord(parsed.agentTokenUsage);
  const agentHoneyExchanged = plainNumberRecord(parsed.agentHoneyExchanged);
  const agentHiveBalances = plainNumberRecord(parsed.agentHiveBalances);
  return {
    ...fallback,
    ...parsed,
    honeyPerThousandTokens: positiveNumber(parsed.honeyPerThousandTokens, fallback.honeyPerThousandTokens),
    tokenPerHoney: positiveNumber(parsed.tokenPerHoney, fallback.tokenPerHoney),
    agentTokenUsage,
    agentHoneyExchanged,
    agentHiveBalances,
    balances: normalizeBalances(parsed.balances, agentHoneyExchanged, agentHiveBalances),
    rewardPoolHive,
    rewardPoolRemainingHive: positiveNumber(parsed.rewardPoolRemainingHive, Math.max(0, rewardPoolHive - rewardPoolEmittedHive)),
    rewardPoolEmittedHive,
    rewardPoolExchangedHive: positiveNumber(parsed.rewardPoolExchangedHive, fallback.rewardPoolExchangedHive),
    rewardPoolUsd: positiveNumber(parsed.rewardPoolUsd, fallback.rewardPoolUsd),
    rewardPoolVolumeUsd: positiveNumber(parsed.rewardPoolVolumeUsd, fallback.rewardPoolVolumeUsd),
    rewardPoolShareOfVolume: positiveNumber(parsed.rewardPoolShareOfVolume, fallback.rewardPoolShareOfVolume),
    hivePerMillionTokens: positiveNumber(parsed.hivePerMillionTokens, fallback.hivePerMillionTokens),
    hiveTokenAddress: typeof parsed.hiveTokenAddress === "string" ? parsed.hiveTokenAddress : fallback.hiveTokenAddress,
    events: Array.isArray(parsed.events) ? parsed.events.filter(isLedgerEvent).slice(0, 500) : [],
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : fallback.updatedAt,
  };
}

function normalizeBalances(
  value: unknown,
  agentHoneyExchanged: Record<string, number> = {},
  agentHiveBalances: Record<string, number> = {},
): HoneyTreasuryConfig["balances"] {
  if (!Array.isArray(value)) return undefined;
  const balances: NonNullable<HoneyTreasuryConfig["balances"]> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const balance = raw as Partial<NonNullable<HoneyTreasuryConfig["balances"]>[number]>;
    if (typeof balance.agentId !== "string" || !balance.agentId.trim()) continue;
    const lifetimeHoney = positiveNumber(balance.lifetimeHoney, 0);
    const exchanged = agentHoneyExchanged[balance.agentId];
    const hiveBalance = agentHiveBalances[balance.agentId];
    balances.push({
      workspaceId: typeof balance.workspaceId === "string" ? balance.workspaceId : "",
      agentId: balance.agentId,
      tokensUsed: Math.max(0, Math.round(Number(balance.tokensUsed ?? 0) || 0)),
      lifetimeHoney,
      availableHoney: exchanged == null
        ? positiveNumber(balance.availableHoney, 0)
        : Math.max(0, Math.round((lifetimeHoney - exchanged) * 1_000_000) / 1_000_000),
      hiveBalance: hiveBalance == null ? positiveNumber(balance.hiveBalance, 0) : hiveBalance,
      managedHoneyBalance: positiveNumber(balance.managedHoneyBalance, 0),
      managedHoneyLifetimeCredits: positiveNumber(balance.managedHoneyLifetimeCredits, 0),
      managedHoneySpent: positiveNumber(balance.managedHoneySpent, 0),
      updatedAt: typeof balance.updatedAt === "string" ? balance.updatedAt : new Date(0).toISOString(),
    });
  }
  return balances;
}

function positiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function plainNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, Math.max(0, Number(raw) || 0)] as const)
      .filter(([key]) => Boolean(key)),
  );
}

function isLedgerEvent(value: unknown): value is HoneyLedgerEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<HoneyLedgerEvent>;
  return Boolean(event.id && event.agentId && event.kind && event.createdAt);
}

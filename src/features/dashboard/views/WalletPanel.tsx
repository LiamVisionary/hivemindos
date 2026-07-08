"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WalletsView } from "@/components/wallets-drop-in/WalletsView";
import { AGENT_PAYMENT_PROVIDER_FEATURES, type WalletDropInGroup } from "@/lib/config/agent-payments";
import { HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER } from "@/lib/config/hivemindos-wallet-paid-models";
import { fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import { loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";
import { switchBrowserWalletToBase } from "@/lib/services/hive-staking-client";
import { sendApprovedWalletUsdc, type WalletSendUsdcRequest } from "@/lib/services/wallet/send-usdc-client";
import { getSurvivalSnapshot, hasConfiguredAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import { exportAgentWalletSecret, exportPersonalWalletGroupSecret } from "./wallet-secret-export-actions";
import { fetchBankrWallet, type BankrWalletInfo } from "./trade/trade-api";
import { WalletSelectModal, type PickableWallet } from "./trade/WalletSelectModal";
import { agentPickable, groupedUserPickables, isLocalPaymentSigningWallet, resolvePickableAccount } from "./trade/wallet-pickables";
import {
  buildGroupedPersonalWallets,
  mergePersonalWalletList,
  mergePersonalWalletSources,
  nativeSymbolForWallet,
  personalWalletAccountKey,
} from "@/lib/utils/personal-wallet-grouping";

const RAIL_ENABLED_KEY_PREFIX = "hivemindos.walletRail.enabled.";
const USEPOD_ROUTING_MODE_KEY = "hivemindos.walletRail.usepod.routingMode";
const VEIL_TRANSFER_NETWORK = "eip155:8453";
const BANKR_RECIPIENT_STORAGE_KEY = "hivemindos.bankrRecipientAddress";
const BANKR_RAIL_ENV_NAMES = ["BANKR_API_KEY", "BANKR_LLM_KEY", "BANKR_MANAGEMENT_KEY"] as const;
const PERSONAL_WALLET_TOKEN_REFRESH_MS = 15 * 60_000;

type DropInTokenPrice = { price: number; name?: string; color?: string; chg?: number };
type WalletActivityRecord = {
  id: string;
  agentId: string;
  kind: string;
  asset: string;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  status: string;
  createdAt: string;
  createdAtMs: number;
};
type HoneyLedgerRuntime = {
  honeyPerThousandTokens?: number;
  tokenPerHoney?: number;
  agentTokenUsage?: Record<string, number>;
  agentHoneyExchanged?: Record<string, number>;
  agentHiveBalances?: Record<string, number>;
  balances?: Array<{ agentId: string; tokensUsed: number; lifetimeHoney: number; availableHoney: number; hiveBalance: number }>;
  events?: Array<{ id: string; agentId: string; agentName?: string; kind: string; source: string; tokensUsed: number; honeyDelta: number; hiveDelta: number; createdAt: string }>;
};

const ESTIMATED_RUNTIME_TOKEN_USD = 0.000002;

function compactAge(input: unknown): string {
  const time = typeof input === "number" ? input : Date.parse(String(input || ""));
  if (!Number.isFinite(time)) return "now";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${Math.max(1, seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function roundUsd(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function estimateRuntimeCostUsd(tokens: number): number {
  return Math.round(Math.max(0, Number(tokens) || 0) * ESTIMATED_RUNTIME_TOKEN_USD * 10_000) / 10_000;
}

function normalizeSourceLabel(value: string): string {
  return value.split(/[-_]/g).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || "Runtime";
}

function buildAgentLookup(agents: any[]) {
  return new Map(agents.map((agent) => [String(agent.id), agent]));
}

function activityTypeForKind(kind: string): string {
  if (kind === "trade") return "trade";
  if (kind === "platform-fee") return "send";
  if (kind === "send" || kind === "veil-transfer") return "send";
  return "x402";
}

function activityLabelForKind(kind: string): string {
  if (kind === "platform-fee") return "Platform fee";
  if (kind === "x402-private") return "Private x402";
  if (kind === "veil-transfer") return "Veil private transfer";
  if (kind === "send") return "Wallet transfer";
  if (kind === "trade") return "Trade";
  return "x402 payment";
}

function buildActivityLedger(records: WalletActivityRecord[] | null, agents: any[]) {
  const agentById = buildAgentLookup(agents);
  return (Array.isArray(records) ? records : []).map((record) => {
    const agent = agentById.get(record.agentId);
    const asset = String(record.asset || "USDC").toUpperCase();
    const amountUsd = Number(record.amountUsd) || 0;
    const assetAmount = Number(record.assetAmount) || 0;
    const target = record.target ? ` · ${record.target}` : "";
    const assetNote = amountUsd > 0 || !assetAmount ? "" : ` · ${assetAmount} ${asset}`;
    return {
      id: record.id,
      agent: agent?.name || record.agentId,
      type: activityTypeForKind(record.kind),
      what: `${activityLabelForKind(record.kind)}${target}${assetNote}`,
      amt: record.status === "failed" ? 0 : -roundUsd(amountUsd),
      token: "USDC",
      at: compactAge(record.createdAtMs || record.createdAt),
      state: record.status === "failed" ? "failed" : "ok",
    };
  });
}

function todayStartMs(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today.getTime();
}

function dayLabel(date: Date): string {
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? "Today"
    : date.toLocaleDateString(undefined, { weekday: "short" });
}

function runtimeUsagePointRows(runtimeUsage: any, honeyLedger: HoneyLedgerRuntime | null) {
  const rows = Array.isArray(runtimeUsage?.rows) ? runtimeUsage.rows : [];
  if (rows.length) {
    return rows.map((row: any) => ({
      agentId: String(row.agentId || row.runtime || "runtime"),
      model: String(row.model || row.runtime || "runtime"),
      runtime: String(row.runtime || "runtime"),
      source: String(row.source || "runtime"),
      tokens: Math.max(0, Math.round(Number(row.totalTokens) || 0)),
      updatedAt: row.updatedAt,
    })).filter((row: any) => row.tokens > 0);
  }
  return (honeyLedger?.events ?? []).filter((event) => Number(event.tokensUsed) > 0).map((event) => ({
    agentId: String(event.agentId || "honey-ledger"),
    model: normalizeSourceLabel(String(event.source || "honey-ledger")),
    runtime: "honey",
    source: String(event.source || "honey-ledger"),
    tokens: Math.max(0, Math.round(Number(event.tokensUsed) || 0)),
    updatedAt: event.createdAt,
  }));
}

function buildUsageRows(runtimeUsage: any, honeyLedger: HoneyLedgerRuntime | null, agents: any[]) {
  const agentById = buildAgentLookup(agents);
  const todayMs = todayStartMs();
  const grouped = new Map<string, any>();
  for (const row of runtimeUsagePointRows(runtimeUsage, honeyLedger)) {
    const key = `${row.agentId}:${row.model}`;
    const current = grouped.get(key) ?? { id: key, agentId: row.agentId, model: row.model, runtime: row.runtime, source: row.source, tokens: 0, today: 0 };
    current.tokens += row.tokens;
    if (Date.parse(String(row.updatedAt || "")) >= todayMs) current.today += estimateRuntimeCostUsd(row.tokens);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => {
    const agent = agentById.get(row.agentId);
    return {
      id: row.id,
      agentId: row.agentId,
      name: agent?.name || row.agentId,
      runtime: agent?.runtime || normalizeSourceLabel(row.runtime),
      machine: agent?.machineName || agent?.machineKey || normalizeSourceLabel(row.source),
      state: agent ? "ready" : "scheduled",
      model: row.model,
      tokens: row.tokens,
      today: roundUsd(row.today),
      enabled: true,
    };
  }).sort((left, right) => right.tokens - left.tokens);
}

function buildUsageSeries(runtimeUsage: any, honeyLedger: HoneyLedgerRuntime | null) {
  const points = runtimeUsagePointRows(runtimeUsage, honeyLedger);
  if (!points.length) return [];
  const buckets = new Map<string, { spend: number; tokens: number }>();
  for (const point of points) {
    const parsed = Date.parse(String(point.updatedAt || ""));
    if (!Number.isFinite(parsed)) continue;
    const date = new Date(parsed);
    date.setHours(0, 0, 0, 0);
    const key = date.toISOString().slice(0, 10);
    const current = buckets.get(key) ?? { spend: 0, tokens: 0 };
    current.spend += estimateRuntimeCostUsd(point.tokens);
    current.tokens += point.tokens;
    buckets.set(key, current);
  }
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const current = buckets.get(date.toISOString().slice(0, 10)) ?? { spend: 0, tokens: 0 };
    return { day: dayLabel(date), spend: roundUsd(current.spend), tokens: Math.round(current.tokens / 100_000) / 10 };
  });
}

function calculateHoneyForTokens(tokens: number, honeyPerThousandTokens: number): number {
  return Math.round(Math.max(0, tokens) / 1_000 * Math.max(0, honeyPerThousandTokens || 0) * 1_000_000) / 1_000_000;
}

function buildHoneyByAgentRows(ledger: HoneyLedgerRuntime | null, agents: any[]) {
  const agentById = buildAgentLookup(agents);
  const balances = Array.isArray(ledger?.balances) ? ledger!.balances : [];
  const rows = balances.length ? balances.map((balance) => ({
    id: String(balance.agentId),
    tokensUsed: Math.max(0, Math.round(Number(balance.tokensUsed) || 0)),
    honeyEarned: Math.max(0, Number(balance.lifetimeHoney) || 0),
    honey: Math.max(0, Number(balance.availableHoney) || 0),
  })) : Object.entries(ledger?.agentTokenUsage ?? {}).map(([agentId, tokens]) => {
    const tokensUsed = Math.max(0, Math.round(Number(tokens) || 0));
    const honeyEarned = calculateHoneyForTokens(tokensUsed, Number(ledger?.honeyPerThousandTokens) || 0);
    const exchanged = Math.min(honeyEarned, Math.max(0, Number(ledger?.agentHoneyExchanged?.[agentId]) || 0));
    return { id: agentId, tokensUsed, honeyEarned, honey: Math.max(0, honeyEarned - exchanged) };
  });
  return rows.filter((row) => row.tokensUsed > 0 || row.honeyEarned > 0 || row.honey > 0).map((row) => {
    const agent = agentById.get(row.id);
    return { id: row.id, name: agent?.name || row.id, runtime: agent?.runtime || "Agent", honey: Math.round(row.honey * 1_000_000) / 1_000_000, billed: row.tokensUsed, state: agent ? "ready" : "scheduled" };
  }).sort((left, right) => right.honey - left.honey);
}

function honeyEventNote(event: NonNullable<HoneyLedgerRuntime["events"]>[number]): string {
  if (event.kind === "usage") return `${normalizeSourceLabel(event.source)} · ${Math.round(Number(event.tokensUsed) || 0).toLocaleString()} tokens`;
  if (event.kind === "exchange") return Number(event.hiveDelta) > 0 ? "Converted Honey to HIVE" : "Returned HIVE to Honey";
  if (event.kind === "managed-credit") return `${normalizeSourceLabel(event.source)} credit`;
  if (event.kind === "managed-spend") return `${normalizeSourceLabel(event.source)} spend`;
  return normalizeSourceLabel(event.kind);
}

function buildHoneyLedgerRows(ledger: HoneyLedgerRuntime | null, agents: any[]) {
  const agentById = buildAgentLookup(agents);
  return (ledger?.events ?? []).map((event) => {
    const honeyDelta = Number(event.honeyDelta) || 0;
    return {
      id: event.id,
      agent: event.agentName || agentById.get(event.agentId)?.name || event.agentId,
      kind: honeyDelta >= 0 ? "earn" : Number(event.hiveDelta) > 0 ? "convert" : "redeem",
      note: honeyEventNote(event),
      amt: Math.round(honeyDelta * 1_000_000) / 1_000_000,
      at: compactAge(event.createdAt),
    };
  });
}

function buildHoneySummary(ledger: HoneyLedgerRuntime | null, byAgent: any[], honeyStats: any) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  const events = ledger?.events ?? [];
  const earned = events.filter((event) => Date.parse(event.createdAt) >= weekAgo && Number(event.honeyDelta) > 0).reduce((sum, event) => sum + Number(event.honeyDelta || 0), 0);
  const out = events.filter((event) => Number(event.honeyDelta) < 0).reduce((sum, event) => sum + Number(event.honeyDelta || 0), 0);
  const fallbackRedeemed = Math.max(0, Number(honeyStats?.totalHoney || 0) - Number(honeyStats?.availableHoney || 0));
  return {
    balance: Math.round((byAgent.length ? byAgent.reduce((sum, row) => sum + Number(row.honey || 0), 0) : Number(honeyStats?.availableHoney) || 0) * 1_000_000) / 1_000_000,
    earned: Math.round((ledger ? earned : Number(honeyStats?.totalHoney) || 0) * 1_000_000) / 1_000_000,
    redeemed: Math.round((ledger ? Math.abs(out) : fallbackRedeemed) * 1_000_000) / 1_000_000,
    billed: byAgent.reduce((sum, row) => sum + Number(row.billed || 0), 0),
    holders: byAgent.filter((row) => Number(row.honey) > 0).length,
  };
}

async function fetchWalletActivityRecords(): Promise<WalletActivityRecord[]> {
  const response = await fetch("/api/wallet/activity?limit=100", { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean; records?: WalletActivityRecord[] } | null;
  return response?.ok && data?.ok && Array.isArray(data.records) ? data.records : [];
}

async function fetchHoneyLedger(): Promise<HoneyLedgerRuntime | null> {
  const response = await fetch("/api/honey-ledger", { headers: { accept: "application/json" }, cache: "no-store" }).catch(() => null);
  const data = await response?.json().catch(() => null) as { ok?: boolean; ledger?: HoneyLedgerRuntime } | null;
  return response?.ok && data?.ok && data.ledger ? data.ledger : null;
}

function walletViewForShelf(id: string): string {
  if (id === "agents") return "agents";
  if (id === "maintenance") return "diagnostics";
  return id;
}

function walletProviderForDropIn(wallet: any): WalletDropInGroup {
  const provider = String(wallet?.provider || "").toLowerCase();
  if (provider === "cards") return "cards"; // legacy stored value predating provider ids
  if (provider in AGENT_PAYMENT_PROVIDER_FEATURES) {
    return AGENT_PAYMENT_PROVIDER_FEATURES[provider as keyof typeof AGENT_PAYMENT_PROVIDER_FEATURES].walletDropInGroup;
  }
  return "crypto";
}

function walletNetworkForDropIn(wallet: any): "base" | "base-sepolia" | "solana" | "robinhood" {
  const network = String(wallet?.network ?? "").toLowerCase();
  if (network.includes("solana")) return "solana";
  if (network.includes("4663")) return "robinhood";
  if (network.includes("sepolia")) return "base-sepolia";
  return "base";
}

function walletBalanceUsd(wallet: any): number {
  return Number(wallet?.currentBalanceUsd ?? wallet?.balanceUsd ?? wallet?.spendableBalanceUsd ?? wallet?.tokenBalance ?? 0) || 0;
}

function chainToNetwork(chain: string): string {
  const normalized = chain.toLowerCase();
  if (normalized.includes("solana")) return "solana:mainnet";
  if (normalized.includes("robinhood")) return "eip155:4663";
  if (normalized.includes("sepolia")) return "eip155:84532";
  return "eip155:8453";
}

function stableSendAssetForNetwork(network: string): "USDC" | "USDG" {
  return String(network || "").toLowerCase() === "eip155:4663" ? "USDG" : "USDC";
}

function isStableSendAsset(asset: string): asset is "USDC" | "USDG" {
  return asset === "USDC" || asset === "USDG";
}

function tokenBalanceForAsset(wallet: any, asset: string): number {
  const tokens = Array.isArray(wallet?.tokens) ? wallet.tokens : [];
  const match = tokens.find((token: any) => tokenSymbol(token) === asset);
  return Number(match?.balance ?? 0) || 0;
}

function personalWalletSupportsAsset(wallet: any, asset: string): boolean {
  if (tokenBalanceForAsset(wallet, asset) > 0) return true;
  return stableSendAssetForNetwork(String(wallet?.network || "")) === asset;
}

function resolvePersonalWalletAgentIdForAsset(source: any, asset: string, wallets: any[]): string {
  const ids = new Set<string>([
    String(source?.spendId || ""),
    String(source?.id || ""),
    ...(Array.isArray(source?.accounts) ? source.accounts.map((account: any) => String(account?.id || "")) : []),
  ].filter(Boolean));
  const addresses = new Set<string>([
    String(source?.addr || "").toLowerCase(),
    ...(Array.isArray(source?.addresses) ? source.addresses.map((row: any) => String(row?.[1] || "").toLowerCase()) : []),
  ].filter(Boolean));
  const candidates = wallets.filter((wallet: any) => {
    const id = String(wallet?.id || wallet?.agentId || "");
    const address = String(wallet?.address || "").toLowerCase();
    return (id && ids.has(id)) || (address && addresses.has(address));
  });
  const localCandidates = candidates.filter((wallet: any) => wallet?.custodyMode === "local");
  const funded = localCandidates.find((wallet: any) => tokenBalanceForAsset(wallet, asset) > 0);
  const supported = localCandidates.find((wallet: any) => personalWalletSupportsAsset(wallet, asset));
  return String((funded ?? supported)?.id || (funded ?? supported)?.agentId || source?.spendId || source?.id || "");
}

function tokenSymbol(token: any): string {
  return String(token?.symbol || "").trim().toUpperCase();
}

function tokenPriceUsd(token: any): number {
  const balance = Number(token?.balance ?? 0) || 0;
  const explicit = Number(token?.priceUsd);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const value = Number(token?.valueUsd);
  if (balance > 0 && Number.isFinite(value) && value >= 0) return value / balance;
  return NaN;
}

function addTokenPriceHint(prices: Record<string, DropInTokenPrice>, token: any) {
  const symbol = tokenSymbol(token);
  const price = tokenPriceUsd(token);
  if (!symbol || !Number.isFinite(price) || price < 0) return;
  prices[symbol] = {
    price,
    name: String(token?.name || symbol),
    chg: Number(token?.priceChange24hPct) || 0,
  };
}

function addWalletTokenPriceHints(prices: Record<string, DropInTokenPrice>, wallet: any) {
  const tokens = Array.isArray(wallet?.tokens) ? wallet.tokens : [];
  tokens.forEach((token: any) => addTokenPriceHint(prices, token));
  if (tokens.length) return;
  const nativeBalance = Number(wallet?.nativeBalance ?? 0) || 0;
  const currentBalanceUsd = Number(wallet?.currentBalanceUsd ?? wallet?.balanceUsd ?? 0) || 0;
  if (nativeBalance <= 0 || currentBalanceUsd <= 0) return;
  const symbol = nativeSymbolForWallet(String(wallet?.network || ""));
  prices[symbol] = {
    price: currentBalanceUsd / nativeBalance,
    name: symbol === "SOL" ? "Solana" : "Ether",
  };
}

function walletTokenRows(wallet: any, fallbackSymbol: string, fallbackUsd: number, prices: Record<string, DropInTokenPrice>): Array<[string, number]> {
  const tokens = Array.isArray(wallet?.tokens) ? wallet.tokens : [];
  const rows = tokens
    .map((token: any): [string, number] => {
      addTokenPriceHint(prices, token);
      return [tokenSymbol(token), Number(token?.balance ?? 0) || 0];
    })
    .filter((row: [string, number]) => Boolean(row[0]) && row[1] > 0);
  if (rows.length) return rows;
  return fallbackUsd > 0 ? [[fallbackSymbol === "USD" ? "USD" : "USDC", fallbackUsd]] : [];
}

function parseUsePodTokenFromInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("token") || url.searchParams.get("api_key") || url.searchParams.get("key") || "";
  } catch {
    return trimmed;
  }
}

function mergeWalletsByAgentWithFresh(base: Record<string, any> | undefined, fresh: Record<string, any>) {
  const next = { ...(base ?? {}) };
  for (const [agentId, wallet] of Object.entries(fresh)) {
    const existing = next[agentId];
    const existingUpdated = Number(existing?.updatedAt ?? existing?.lastOnchainSyncAt ?? 0) || 0;
    const freshUpdated = Number(wallet?.updatedAt ?? wallet?.lastOnchainSyncAt ?? 0) || 0;
    if (!existing || freshUpdated >= existingUpdated) next[agentId] = wallet;
  }
  return next;
}

function personalWalletNeedsTokenRefresh(wallet: any) {
  const tokens = Array.isArray(wallet?.tokens) ? wallet.tokens : [];
  const lastSync = Number(wallet?.lastOnchainSyncAt ?? 0) || 0;
  return !tokens.length || Date.now() - lastSync > PERSONAL_WALLET_TOKEN_REFRESH_MS;
}

// Configured-wallet detection is shared with the Trade tab's wallet picker via
// hasConfiguredAgentWallet so both screens agree on what "set up" means.
function agentWalletSortTier(agent: any, wallet: any, balanceUsd: number): number {
  if (balanceUsd > 0) return 0;
  if (hasConfiguredAgentWallet(agent, wallet)) return 1;
  return 2;
}

function compareRuntimeAgentWalletRows(left: any, right: any): number {
  return left.sortTier - right.sortTier
    || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || left.id.localeCompare(right.id, undefined, { sensitivity: "base" });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function hasHiveEnvKey(props: any, key: string): boolean {
  const envName = key.trim();
  if (!envName) return false;
  const env = props?.hiveEnv;
  const sources = [env?.source, env?.sharedSource, ...(Array.isArray(env?.runtimeSources) ? env.runtimeSources : [])].filter(Boolean);
  return sources.some((source: any) => {
    const values = source?.values;
    return values && Object.prototype.hasOwnProperty.call(values, envName) && String(values[envName] ?? "").trim().length > 0;
  });
}

function firstPresentHiveEnvKey(props: any, keys: readonly string[]): string {
  return keys.find((key) => hasHiveEnvKey(props, key)) ?? "";
}

function shortPublicRef(value: unknown): string {
  const text = stringValue(value);
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text;
}

function shortWalletAddress(value: unknown): string {
  const text = stringValue(value);
  if (!text) return "";
  return text.length > 18 ? `${text.slice(0, 8)}...${text.slice(-6)}` : text;
}

function fundingNetworkLabel(network: string): string {
  if (network === "eip155:8453") return "Base";
  if (network === "eip155:84532") return "Base Sepolia";
  if (network === "eip155:4663") return "Robinhood Chain";
  if (network === "eip155:46630") return "Robinhood Chain Testnet";
  if (network === "solana:mainnet") return "Solana";
  if (network === "solana:devnet") return "Solana devnet";
  if (network.startsWith("eip155:")) return "EVM";
  if (network.startsWith("solana:")) return "Solana";
  return network || "Unknown network";
}

function fundingDetail(network: string, address: string): string {
  return [network ? fundingNetworkLabel(network) : "", shortWalletAddress(address)].filter(Boolean).join(" · ");
}

function walletAddress(value: any): string {
  return firstStringValue(value?.walletAddress, value?.vaultAddress, value?.address);
}

function findPersonalWalletById(personalWallets: any[] | null, walletId: string) {
  return (Array.isArray(personalWallets) ? personalWallets : []).find((wallet) => firstStringValue(wallet?.id, wallet?.agentId) === walletId);
}

function buildLlmFundingSourceMeta(agent: any, wallet: any, agentsById: Map<string, any>, walletsByAgent: Record<string, any>, personalWallets: any[] | null) {
  const config = agent?.hivemindosModels ?? {};
  const configuredId = firstStringValue(config.walletVaultId);
  const creditAccountId = firstStringValue(config.creditAccountId);
  const usesHivemindosModels = agent?.provider === HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER || Boolean(configuredId || creditAccountId);
  if (!usesHivemindosModels) return null;
  if ((config.fundingMode === "credits" || creditAccountId) && !configuredId) {
    return {
      id: creditAccountId || agent.id,
      title: "Hosted model credits",
      detail: firstStringValue(config.lastCreditBalanceLabel) || "Tap to choose a crypto funding wallet.",
    };
  }
  const sourceId = configuredId || agent.id;
  const configuredAddress = firstStringValue(config.walletAddress);
  const configuredNetwork = firstStringValue(config.walletNetwork);
  if (!configuredId || sourceId === agent.id) {
    const address = configuredAddress || walletAddress(wallet);
    const network = configuredNetwork || firstStringValue(wallet?.network);
    return {
      id: sourceId,
      title: "This agent wallet",
      detail: fundingDetail(network, address) || "Tap to choose a different funding wallet.",
    };
  }
  if (sourceId.startsWith("user:")) {
    const personal = findPersonalWalletById(personalWallets, sourceId);
    const address = configuredAddress || firstStringValue(personal?.address);
    const network = configuredNetwork || firstStringValue(personal?.network);
    return {
      id: sourceId,
      title: firstStringValue(config.fundingWalletLabel, personal?.name, "Personal wallet"),
      detail: fundingDetail(network, address) || "Personal wallet",
    };
  }
  const sourceAgent = agentsById.get(sourceId);
  const sourceWallet = sourceAgent ? resolveAgentWallet(sourceAgent, walletsByAgent[sourceId] ?? sourceAgent.wallet) : null;
  const address = configuredAddress || walletAddress(sourceWallet);
  const network = configuredNetwork || firstStringValue(sourceWallet?.network);
  return {
    id: sourceId,
    title: firstStringValue(config.fundingWalletLabel, sourceAgent?.name, "Agent wallet"),
    detail: fundingDetail(network, address) || "Agent wallet",
  };
}

function normalizedRailStatus(value: string, credentialPresent: boolean): string {
  const status = value.toLowerCase();
  if (status === "ok" || status === "healthy" || status === "operational") return "ready";
  if (status === "ready" || status === "configured" || status === "needs-funding" || status === "error") return status;
  return credentialPresent ? "configured" : "missing";
}

function collectUsePodAgentConfigs(props: any, agents: any[]) {
  const walletsByAgent = props?.walletsByAgent ?? {};
  return agents
    .filter((agent) => agent?.usePod || walletProviderForDropIn(resolveAgentWallet(agent, walletsByAgent[agent.id] ?? agent.wallet)) === "usepod")
    .map((agent) => agent?.usePod ?? {});
}

function buildUsePodRuntimeData(props: any, agents: any[]) {
  const configs = collectUsePodAgentConfigs(props, agents);
  const tokenEnv = firstStringValue(...configs.map((config) => config.tokenEnvName), "USEPOD_TOKEN");
  const tokenPresent = configs.some((config) => config.lastTokenPresent === true) || hasHiveEnvKey(props, tokenEnv);
  const modelCounts = configs.map((config) => Number(config.lastModelCount)).filter((value) => Number.isFinite(value) && value > 0);
  const models = modelCounts.length ? Math.max(...modelCounts) : 0;
  const rawStatus = firstStringValue(...configs.map((config) => config.lastTestStatus));
  const status = normalizedRailStatus(rawStatus, tokenPresent);
  const fundingRef = firstStringValue(...configs.map((config) => config.depositCode), ...configs.map((config) => config.depositAddress));
  return {
    status,
    credentialPresent: tokenPresent,
    message: firstStringValue(...configs.map((config) => config.lastStatusMessage)),
    models,
    route: firstStringValue(...configs.map((config) => config.lastRoute), tokenPresent ? "Not checked" : "No token"),
    tokenEnv,
    tokenFp: tokenPresent ? "Present" : "Missing",
    tokenSource: firstStringValue(...configs.map((config) => config.lastTokenSource), tokenPresent ? "HivemindOS env" : "Shared env"),
    fundingRef: fundingRef ? shortPublicRef(fundingRef) : "Not available",
  };
}

function railEnabled(id: string, fallback: boolean, railEnabledOverrides: Record<string, boolean>): boolean {
  return Object.prototype.hasOwnProperty.call(railEnabledOverrides, id) ? Boolean(railEnabledOverrides[id]) : fallback;
}

function buildRailRuntimeOverrides(props: any, agents: any[], railEnabledOverrides: Record<string, boolean>) {
  const usePod = buildUsePodRuntimeData(props, agents);
  const usePodReady = usePod.credentialPresent && (usePod.status === "ready" || usePod.status === "configured");
  const usePodHealth = !usePod.credentialPresent ? "Missing USEPOD_TOKEN" : usePod.status === "needs-funding" ? "Needs funding" : usePod.status === "error" ? (usePod.message || "UsePod check failed") : usePod.models > 0 ? `Configured · ${usePod.models} models` : "Configured";
  const usePodModelCap = usePod.models > 0 ? `${usePod.models} models` : "Models not checked";
  const walletsByAgent = props?.walletsByAgent ?? {};
  const moneyClawEnv = firstStringValue(...agents.map((agent) => resolveAgentWallet(agent, walletsByAgent[agent.id] ?? agent.wallet)?.moneyClawEnvName), "MONEYCLAW_API_KEY");
  const moneyStatus = props?.moneyClawStatusByEnvName?.[moneyClawEnv];
  const moneyError = firstStringValue(...Object.values(moneyStatus?.errors ?? {}));
  const moneyCred = Boolean(moneyStatus?.configured || hasHiveEnvKey(props, moneyClawEnv));
  const moneyReady = moneyCred && !moneyError;
  const veilCred = hasHiveEnvKey(props, "VEIL_KEY");
  const veniceEnv = firstStringValue(...agents.map((agent) => agent?.venice?.apiKeyEnvName), "VENICE_API_KEY");
  const veniceCred = hasHiveEnvKey(props, veniceEnv) || agents.some((agent) => agent?.venice?.lastKeyPresent === true || agent?.venice?.walletVaultId || agent?.venice?.walletAddress);
  const bankrEnv = firstPresentHiveEnvKey(props, BANKR_RAIL_ENV_NAMES);
  const bankrCred = Boolean(bankrEnv);
  return {
    moneyclaw: { enabled: railEnabled("moneyclaw", moneyReady, railEnabledOverrides), setup: moneyReady ? "ready" : "needs", env: moneyClawEnv, cred: moneyCred, health: moneyError || (moneyCred ? "Configured" : `Missing ${moneyClawEnv}`) },
    x402: { enabled: railEnabled("x402", true, railEnabledOverrides), setup: "ready", cred: true, health: "Operational" },
    veil: { enabled: railEnabled("veil", veilCred, railEnabledOverrides), setup: veilCred ? "ready" : "needs", cred: veilCred, health: veilCred ? "Configured" : "Missing VEIL_KEY" },
    usepod: { enabled: railEnabled("usepod", usePodReady, railEnabledOverrides), setup: usePodReady ? "ready" : "needs", cred: usePod.credentialPresent, caps: [usePodModelCap, "Provider x402", "Price ceilings"], health: usePodHealth },
    venice: { enabled: railEnabled("venice", veniceCred, railEnabledOverrides), setup: veniceCred ? "ready" : "needs", env: veniceEnv, cred: veniceCred, health: veniceCred ? "Configured" : `Missing ${veniceEnv}` },
    bankr: { enabled: railEnabled("bankr", bankrCred, railEnabledOverrides), setup: bankrCred ? "ready" : "needs", env: bankrEnv || "BANKR_API_KEY", cred: bankrCred, health: bankrCred ? `Configured via ${bankrEnv}` : `Missing ${BANKR_RAIL_ENV_NAMES.join(", ")}` },
  };
}

function buildDropInRuntimeData(props: any, personalWallets: any[] | null, railEnabledOverrides: Record<string, boolean>, usePodRoutingMode: string, walletActivity: WalletActivityRecord[] | null, honeyLedger: HoneyLedgerRuntime | null, bankrWallet: BankrWalletInfo | null) {
  const agents = Array.isArray(props?.displayAgents) ? props.displayAgents : [];
  const agentsById = buildAgentLookup(agents);
  const walletsByAgent = props?.walletsByAgent ?? {};
  const walletActionsByAgent = props?.walletActionsByAgent ?? {};
  const machineGroups = new Map<string, any[]>();
  const walletMeta: Record<string, any> = {};
  const balances: Record<string, Array<[string, number]>> = {};
  const rewards: Record<string, { gas: number; used: number }> = {};
  const tokenPrices: Record<string, DropInTokenPrice> = {};
  const usageRows = buildUsageRows(props?.runtimeUsage, honeyLedger, agents);
  const usageTokensByAgent = new Map<string, number>();
  usageRows.forEach((row) => usageTokensByAgent.set(row.agentId, (usageTokensByAgent.get(row.agentId) ?? 0) + Number(row.tokens || 0)));
  const honeyByAgent = buildHoneyByAgentRows(honeyLedger, agents);
  const honeyByAgentMap = new Map(honeyByAgent.map((row) => [row.id, Number(row.honey) || 0]));

  if (Array.isArray(personalWallets)) {
    personalWallets.forEach((wallet) => addWalletTokenPriceHints(tokenPrices, wallet));
  }

  agents
    .map((agent: any) => {
      const wallet = resolveAgentWallet(agent, walletsByAgent[agent.id] ?? agent.wallet);
      const balanceUsd = walletBalanceUsd(wallet);
      const address = String(wallet?.walletAddress || wallet?.vaultAddress || (wallet as any)?.address || "");
      return {
        agent,
        wallet,
        balanceUsd,
        address,
        sortTier: agentWalletSortTier(agent, wallet, balanceUsd),
        name: agent.name || agent.id,
        id: agent.id,
      };
    })
    .sort(compareRuntimeAgentWalletRows)
    .forEach(({ agent, wallet, balanceUsd, address, sortTier }: any) => {
      const machine = agent.machineName || agent.machineKey || "This Mac";
      const provider = walletProviderForDropIn(wallet);
      const symbol = String(wallet?.tokenSymbol || "USDC").toUpperCase();
      const balanceRows = walletTokenRows(wallet, symbol, balanceUsd, tokenPrices);
      const burn = Number(wallet?.dailyComputeBurnUsd ?? wallet?.dailySpendUsd ?? wallet?.burnUsdPerDay ?? wallet?.dailyBudgetUsd ?? 0) || 0;
      const maxPay = Number(wallet?.maxPaymentUsd ?? wallet?.spendLimitUsd ?? wallet?.maxPayUsd ?? Math.max(10, burn * 2)) || 10;
      const enabled = wallet?.enabled !== false && !wallet?.disabled;
      const configured = hasConfiguredAgentWallet(agent, wallet);
      const action = walletActionsByAgent[agent.id] ?? {};
      const llmFundingSource = buildLlmFundingSourceMeta(agent, wallet, agentsById, walletsByAgent, personalWallets);

      const row = {
        id: agent.id,
        name: agent.name || agent.id,
        runtime: props?.RUNTIME_LABELS?.[agent.runtime] || agent.runtime || "Agent",
        state: wallet?.setupRequired || !configured ? "setup" : enabled ? "ready" : "scheduled",
        role: agent.role || agent.workerClass || "Agent",
        wallet: balanceUsd ? `$${Math.round(balanceUsd).toLocaleString()}` : "—",
        task: agent.currentTask || agent.task || "Ready for wallet work",
        since: agent.lastSeenLabel || "now",
      };
      machineGroups.set(machine, [...(machineGroups.get(machine) ?? []), row]);
      walletMeta[agent.id] = {
        enabled,
        autoUse: Boolean(wallet?.autoPayEnabled ?? wallet?.autoUse ?? wallet?.allowAutoUse),
        provider,
        rawProvider: provider,
        network: walletNetworkForDropIn(wallet),
        burn,
        maxPay,
        askOver: Number(wallet?.approvalRequiredOverUsd ?? wallet?.approvalThresholdUsd ?? wallet?.askOverUsd ?? Math.max(5, maxPay / 2)) || 5,
        dailyBudget: Number(wallet?.dailyBudgetUsd ?? 0) || 0,
        monthlyBudget: Number(wallet?.monthlyBudgetUsd ?? 0) || 0,
        addr: address,
        honey: honeyByAgentMap.get(agent.id) ?? (Number(wallet?.honey ?? 0) || 0),
        setup: wallet?.setupRequired || !configured,
        sortTier,
        trading: Boolean(wallet?.trading || wallet?.bankrEnabled),
        duplicateGuard: wallet?.duplicatePaymentGuardEnabled !== false,
        veilAutoSend: wallet?.veilAutoSendEnabled === true,
        assetSpendCaps: wallet?.assetSpendCaps ?? {},
        notes: wallet?.notes || "",
        actionBusy: Boolean(action.busy),
        actionMessage: action.message || "",
        actionError: action.error || "",
        llmFundingSource: llmFundingSource?.title || "",
        llmFundingSourceDetail: llmFundingSource?.detail || "",
        llmFundingSourceId: llmFundingSource?.id || "",
      };
      balances[agent.id] = balanceRows;
      rewards[agent.id] = { gas: Number(wallet?.nativeBalance ?? wallet?.gasBalance ?? 0) || 0, used: usageTokensByAgent.get(agent.id) ?? (Number(wallet?.tokensUsed ?? 0) || 0) };
    });

  return {
    machines: [...machineGroups.entries()].map(([machine, machineAgents], index) => ({
      id: machine.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `machine-${index}`,
      name: machine,
      kind: "Agent host",
      role: "Runtime",
      os: "",
      chip: "",
      place: machine,
      city: "",
      version: "",
      versionState: "current",
      agents: machineAgents,
    })),
    myWallets: buildGroupedPersonalWallets(personalWallets),
    bankrWallet: bankrWallet?.configured
      ? { configured: true, address: bankrWallet.address || "", balanceUsd: Number(bankrWallet.balanceUsd) || 0, tokens: Array.isArray(bankrWallet.tokens) ? bankrWallet.tokens : [] }
      : null,
    walletMeta,
    balances,
    rewards,
    tokenPrices,
    activityLedger: buildActivityLedger(walletActivity, agents),
    usageRows,
    usageSeries: buildUsageSeries(props?.runtimeUsage, honeyLedger),
    honeyLedger: buildHoneyLedgerRows(honeyLedger, agents),
    honeyByAgent,
    honeySummary: buildHoneySummary(honeyLedger, honeyByAgent, props?.honeyStats),
    honeyLedgerEnabled: Boolean(props?.honeyLedgerEnabled),
    railOverrides: buildRailRuntimeOverrides(props, agents, railEnabledOverrides),
    usePod: buildUsePodRuntimeData(props, agents),
    usePodRoutingMode,
  };
}

function WalletPanelComponent(props: any) {
  const [personalWallets, setPersonalWallets] = useState<any[] | null>(null);
  const [walletActivity, setWalletActivity] = useState<WalletActivityRecord[]>([]);
  const [honeyLedger, setHoneyLedger] = useState<HoneyLedgerRuntime | null>(null);
  const [railEnabledOverrides, setRailEnabledOverrides] = useState<Record<string, boolean>>({});
  const [usePodRoutingMode, setUsePodRoutingMode] = useState("");
  const [bankrRecipientAddress, setBankrRecipientAddress] = useState("");
  const [bankrWallet, setBankrWallet] = useState<BankrWalletInfo | null>(null);
  const [freshWalletsByAgent, setFreshWalletsByAgent] = useState<Record<string, any>>({});
  const [llmFundingAgentId, setLlmFundingAgentId] = useState("");
  const refreshedUsePodAgentIds = useRef<Set<string>>(new Set());
  const refreshedPersonalWalletKeys = useRef<Set<string>>(new Set());
  const refreshedAgentWalletKeys = useRef<Set<string>>(new Set());
  const vaultPath = props?.sharedVault?.enabled ? String(props.sharedVault.vaultPath || "").trim() : "";
  const activeView = props.activeView, displayAgents = props.displayAgents, refreshRuntimeIntegrations = props.refreshRuntimeIntegrations, refreshRuntimeUsage = props.refreshRuntimeUsage, refreshWalletBalance = props.refreshWalletBalance, selectedAgent = props.selectedAgent;
  const refreshRuntimeUsageRef = useRef(refreshRuntimeUsage);
  useEffect(() => {
    refreshRuntimeUsageRef.current = refreshRuntimeUsage;
  }, [refreshRuntimeUsage]);
  const fetchPersonalWallets = useCallback(() => fetchPersonalWalletRecords(vaultPath), [vaultPath]);
  const effectiveWalletsByAgent = useMemo(() => mergeWalletsByAgentWithFresh(props.walletsByAgent, freshWalletsByAgent), [freshWalletsByAgent, props.walletsByAgent]);
  const refreshPersonalWalletBalances = useCallback(async (targets: any[]) => {
    const refreshed = (await Promise.all(targets.map(async (wallet) => {
      const address = String(wallet?.address || "").trim();
      const network = String(wallet?.network || "").trim();
      if (!address || !network) return null;
      const response = await fetch("/api/wallet/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, network }),
      }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; balance?: { tokenBalance: number; nativeBalance: number; totalValueUsd?: number | null; tokens?: any[]; fetchedAt: number } } | null;
      if (!response?.ok || !data?.ok || !data.balance) return null;
      const totalValueUsd = Number(data.balance.totalValueUsd);
      return {
        ...wallet,
        currentBalanceUsd: Number.isFinite(totalValueUsd) && totalValueUsd >= 0 ? totalValueUsd : Number(data.balance.tokenBalance) || 0,
        nativeBalance: Number(data.balance.nativeBalance) || 0,
        tokens: Array.isArray(data.balance.tokens) ? data.balance.tokens : [],
        lastOnchainSyncAt: Number(data.balance.fetchedAt) || Date.now(),
        updatedAt: Date.now(),
      };
    }))).filter(Boolean);
    if (!refreshed.length) return;
    setPersonalWallets((current) => mergePersonalWalletList([...(Array.isArray(current) ? current : []), ...refreshed]));
    await fetch("/api/wallet/personal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vaultPath: vaultPath || undefined, wallets: refreshed }),
    }).catch(() => null);
  }, [vaultPath]);
  const loadPersonalWallets = useCallback(async () => setPersonalWallets(await fetchPersonalWallets()), [fetchPersonalWallets]);
  const refreshPersonalWalletSourceBalance = useCallback(async (source: any) => {
    const ids = new Set<string>([
      String(source?.spendId || ""),
      String(source?.id || ""),
      ...(Array.isArray(source?.accounts) ? source.accounts.map((account: any) => String(account?.id || "")) : []),
    ].map((value) => value.trim()).filter(Boolean));
    const addresses = new Set<string>([
      String(source?.addr || ""),
      ...(Array.isArray(source?.addresses) ? source.addresses.map((row: any) => String(row?.[1] || "")) : []),
      ...(Array.isArray(source?.accounts) ? source.accounts.map((account: any) => String(account?.address || "")) : []),
    ].map((value) => value.trim().toLowerCase()).filter(Boolean));
    if (!ids.size && !addresses.size) { await loadPersonalWallets(); return; }
    const matchesSource = (wallet: any) => {
      const id = String(wallet?.id || wallet?.agentId || "").trim();
      const address = String(wallet?.address || "").trim().toLowerCase();
      return (id && ids.has(id)) || (address && addresses.has(address));
    };
    let targets = mergePersonalWalletSources(personalWallets, effectiveWalletsByAgent).filter(matchesSource);
    if (!targets.length) {
      const latest = await fetchPersonalWallets();
      targets = mergePersonalWalletSources(latest, effectiveWalletsByAgent).filter(matchesSource);
      if (!targets.length) { setPersonalWallets(latest); return; }
    }
    await refreshPersonalWalletBalances(targets);
  }, [effectiveWalletsByAgent, fetchPersonalWallets, loadPersonalWallets, personalWallets, refreshPersonalWalletBalances]);
  const loadWalletActivity = useCallback(async () => setWalletActivity(await fetchWalletActivityRecords()), []);
  const loadHoneyLedger = useCallback(async () => setHoneyLedger(await fetchHoneyLedger()), []);
  const loadBankrWallet = useCallback(async () => {
    const info = await fetchBankrWallet();
    setBankrWallet(info);
    return info;
  }, []);
  useEffect(() => {
    let ignore = false;
    void fetchPersonalWallets().then((wallets) => { if (!ignore) setPersonalWallets(wallets); });
    return () => { ignore = true; };
  }, [fetchPersonalWallets]);
  useEffect(() => {
    if (activeView !== "wallet" || !Array.isArray(personalWallets) || !personalWallets.length) return;
    const targets = mergePersonalWalletSources(personalWallets, effectiveWalletsByAgent)
      .filter(personalWalletNeedsTokenRefresh)
      .filter((wallet) => {
        const key = personalWalletAccountKey(wallet);
        if (!key || refreshedPersonalWalletKeys.current.has(key)) return false;
        refreshedPersonalWalletKeys.current.add(key);
        return true;
      });
    if (targets.length) void refreshPersonalWalletBalances(targets);
  }, [activeView, effectiveWalletsByAgent, personalWallets, refreshPersonalWalletBalances]);
  useEffect(() => {
    if (activeView !== "wallet" || !refreshWalletBalance) return;
    const targets = (Array.isArray(displayAgents) ? displayAgents : []).filter((agent: any) => {
      const wallet = effectiveWalletsByAgent?.[agent.id];
      const address = String(wallet?.walletAddress || wallet?.vaultAddress || wallet?.address || "").trim();
      const network = String(wallet?.network || "eip155:8453").trim();
      if (!address || !network) return false;
      const key = `${agent.id}:${network}:${address.toLowerCase()}`;
      if (refreshedAgentWalletKeys.current.has(key)) return false;
      refreshedAgentWalletKeys.current.add(key);
      return true;
    });
    if (!targets.length) return;
    let ignore = false;
    void Promise.all(targets.map(async (agent: any) => [agent.id, await refreshWalletBalance(agent.id)] as const))
      .then((rows) => {
        if (ignore) return;
        const fresh = Object.fromEntries(rows.filter(([, wallet]) => Boolean(wallet)));
        if (Object.keys(fresh).length) setFreshWalletsByAgent((current) => mergeWalletsByAgentWithFresh(current, fresh));
      });
    return () => { ignore = true; };
  }, [activeView, displayAgents, effectiveWalletsByAgent, refreshWalletBalance]);
  useEffect(() => {
    if (activeView !== "wallet") return;
    let ignore = false;
    void fetchWalletActivityRecords().then((records) => { if (!ignore) setWalletActivity(records); });
    void fetchHoneyLedger().then((ledger) => { if (!ignore) setHoneyLedger(ledger); });
    void fetchBankrWallet().then((info) => { if (!ignore) setBankrWallet(info); });
    void refreshRuntimeUsageRef.current?.();
    return () => { ignore = true; };
  }, [activeView]);
  useEffect(() => {
    let ignore = false;
    void loadDashboardStateSnapshot().then((snapshot) => {
      if (ignore) return;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(snapshot)) {
        if (key.startsWith(RAIL_ENABLED_KEY_PREFIX)) next[key.slice(RAIL_ENABLED_KEY_PREFIX.length)] = value !== "0";
      }
      setRailEnabledOverrides(next);
      setUsePodRoutingMode(snapshot[USEPOD_ROUTING_MODE_KEY] || "");
      setBankrRecipientAddress(snapshot[BANKR_RECIPIENT_STORAGE_KEY] || "");
    }).catch(() => undefined);
    return () => { ignore = true; };
  }, []);
  useEffect(() => {
    if (activeView !== "wallet") return;
    for (const agent of displayAgents ?? []) {
      if (agent.provider !== "usepod" || refreshedUsePodAgentIds.current.has(agent.id)) continue;
      refreshedUsePodAgentIds.current.add(agent.id);
      void refreshRuntimeIntegrations?.(agent);
    }
  }, [activeView, displayAgents, refreshRuntimeIntegrations]);
  const refreshUsePodTargets = useCallback(async (agentId?: string) => {
    const agents = Array.isArray(displayAgents) ? displayAgents : [];
    const target = agentId ? agents.find((agent: any) => agent.id === agentId) : selectedAgent?.provider === "usepod" ? selectedAgent : null;
    const targets = target ? [target] : agents.filter((agent: any) => agent.provider === "usepod");
    if (!targets.length) {
      await refreshRuntimeIntegrations?.(selectedAgent);
      return;
    }
    await Promise.all(targets.map((agent: any) => refreshRuntimeIntegrations?.(agent)));
  }, [displayAgents, refreshRuntimeIntegrations, selectedAgent]);
  const runtimeDataSource = useMemo(() => ({
    RUNTIME_LABELS: props.RUNTIME_LABELS,
    displayAgents,
    hiveEnv: props.hiveEnv,
    honeyLedgerEnabled: props.honeyLedgerEnabled,
    honeyStats: props.honeyStats,
    moneyClawStatusByEnvName: props.moneyClawStatusByEnvName,
    runtimeUsage: props.runtimeUsage,
    walletActionsByAgent: props.walletActionsByAgent,
    walletsByAgent: effectiveWalletsByAgent,
  }), [displayAgents, effectiveWalletsByAgent, props.RUNTIME_LABELS, props.hiveEnv, props.honeyLedgerEnabled, props.honeyStats, props.moneyClawStatusByEnvName, props.runtimeUsage, props.walletActionsByAgent]);
  const mergedPersonalWallets = useMemo(() => mergePersonalWalletSources(personalWallets, effectiveWalletsByAgent), [effectiveWalletsByAgent, personalWallets]);
  const llmFundingPickables = useMemo<PickableWallet[]>(() => {
    const userPickables = groupedUserPickables(mergedPersonalWallets, { accountFilter: isLocalPaymentSigningWallet });
    const agentPickables = (Array.isArray(displayAgents) ? displayAgents : []).flatMap((agent: any) => {
      const pickable = agentPickable(agent, effectiveWalletsByAgent);
      if (!hasConfiguredAgentWallet(agent, pickable.wallet)) return [];
      if ((pickable.wallet as unknown as { setupRequired?: boolean }).setupRequired) return [];
      if (!isLocalPaymentSigningWallet(pickable.wallet)) return [];
      return [{ ...pickable, statusOverride: { tone: "ok" as const, text: "Agent wallet" } }];
    });
    return [...userPickables, ...agentPickables];
  }, [displayAgents, effectiveWalletsByAgent, mergedPersonalWallets]);
  const llmFundingTarget = useMemo(
    () => (Array.isArray(displayAgents) ? displayAgents : []).find((agent: any) => agent.id === llmFundingAgentId),
    [displayAgents, llmFundingAgentId],
  );
  const llmFundingCurrentId = firstStringValue(llmFundingTarget?.hivemindosModels?.walletVaultId, llmFundingAgentId);
  const setLlmFundingSource = useCallback(async (selectedId: string) => {
    const target = (Array.isArray(displayAgents) ? displayAgents : []).find((agent: any) => agent.id === llmFundingAgentId);
    const picked = resolvePickableAccount(llmFundingPickables, selectedId);
    if (!target || !picked) return;
    props.updateWalletAction?.(target.id, { busy: true, error: "", message: "Updating LLM funding source..." });
    try {
      const response = await fetch("/api/hivemindos/models/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          walletVaultId: picked.id,
          agentId: target.id,
          agentName: target.name,
          vaultPath: vaultPath || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; wallet?: { vaultId: string; address: string; network: string; kind?: "personal" | "agent" } } | null;
      if (!response.ok || !data?.ok || !data.wallet) {
        throw new Error(data?.error || `Could not update LLM funding source (HTTP ${response.status}).`);
      }
      await props.updateAgentProfile?.(target.id, {
        provider: HIVEMINDOS_WALLET_PAID_MODELS_PROVIDER,
        hivemindosModels: {
          ...(target.hivemindosModels ?? {}),
          fundingMode: "wallet",
          walletVaultId: data.wallet.vaultId,
          walletAddress: data.wallet.address,
          walletNetwork: data.wallet.network,
          fundingWalletKind: data.wallet.kind ?? (picked.kind === "user" ? "personal" : "agent"),
          fundingWalletLabel: picked.name,
          lastCheckedAt: new Date().toISOString(),
          lastTestStatus: "ready",
          lastStatusMessage: "LLM funding source updated.",
        },
      });
      props.updateWalletAction?.(target.id, { busy: false, error: "", message: "LLM funding source updated." });
    } catch (error) {
      props.updateWalletAction?.(target.id, { busy: false, error: error instanceof Error ? error.message : "Could not update LLM funding source.", message: "" });
    } finally {
      setLlmFundingAgentId("");
    }
  }, [displayAgents, llmFundingAgentId, llmFundingPickables, props, vaultPath]);
  const runtimeData = useMemo(() => buildDropInRuntimeData(runtimeDataSource, mergedPersonalWallets, railEnabledOverrides, usePodRoutingMode, walletActivity, honeyLedger, bankrWallet), [runtimeDataSource, mergedPersonalWallets, railEnabledOverrides, usePodRoutingMode, walletActivity, honeyLedger, bankrWallet]);
  const walletActions = useMemo(() => ({
    bankrRewards: { honeyStats: props.honeyStats, honeyLedgerEnabled: props.honeyLedgerEnabled },
    bankrRecipientAddress,
    walletVaultBackup: { status: props.walletVaultBackupStatus, busy: props.walletVaultBackupBusy, message: props.walletVaultBackupMessage },
    formatHiveAmount: props.formatHiveAmount,
    onConnectBankrWallet: async () => {
      const provider = (window as any).ethereum;
      if (!provider) throw new Error("No browser wallet found. Paste your Bankr receiving address instead.");
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts.find((account) => /^0x[a-fA-F0-9]{40}$/.test(account));
      if (!address) throw new Error("Wallet connected, but no EVM address was returned.");
      await switchBrowserWalletToBase(provider);
      setBankrRecipientAddress(address);
      await saveDashboardStateValue(BANKR_RECIPIENT_STORAGE_KEY, address);
      return address;
    },
    onClaimBankrHive: async (recipientAddress: string) => {
      const address = recipientAddress.trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return { ok: false, error: "Enter a valid Bankr EVM receiving address first." };
      setBankrRecipientAddress(address);
      await saveDashboardStateValue(BANKR_RECIPIENT_STORAGE_KEY, address);
      const result = await props.claimAllHoneyToBankrHive?.(address);
      await loadHoneyLedger();
      return result;
    },
    onReturnAllHiveToHoney: async () => {
      const result = await props.returnAllHiveToHoney?.();
      await loadHoneyLedger();
      return result;
    },
    onRunWalletVaultBackupAction: (action: "refresh" | "restore") => props.runWalletVaultBackupAction?.(action),
    onToggleAgentSpend: (agentId: string, enabled: boolean) => props.updateWallet?.(agentId, { enabled }),
    onUpdateAgentWallet: (agentId: string, patch: any) => props.updateWallet?.(agentId, patch),
    onCreateAgentWallet: (agentId: string, network: string) => props.createLocalWallet?.(agentId, chainToNetwork(network)),
    onRefreshAgentWallet: async (agentId: string) => {
      const refreshed = await refreshWalletBalance?.(agentId);
      if (refreshed) setFreshWalletsByAgent((current) => mergeWalletsByAgentWithFresh(current, { [agentId]: refreshed }));
      return refreshed;
    },
    onResetAgentRunway: (agentId: string) => props.resetWalletBurnClock?.(agentId),
    onCopyAgentPrompt: (agentId: string) => effectiveWalletsByAgent?.[agentId] ? props.copyPaymentPrompt?.(effectiveWalletsByAgent[agentId]) : undefined,
    onOpenLlmFundingSource: (agentId: string) => setLlmFundingAgentId(agentId),
    onExportAgentWallet: (agentId: string, confirmation?: string) => {
      const agent = props.displayAgents?.find((item: any) => item.id === agentId);
      if (!agent) return { ok: false, error: "Could not find this agent wallet." };
      return exportAgentWalletSecret(agent, props.exportWalletSecrets, props.updateWalletAction, { confirmation });
    },
    onExportPersonalWallet: (walletId: string, confirmation?: string) => {
      const group = buildGroupedPersonalWallets(mergedPersonalWallets).find((wallet) => wallet.id === walletId || wallet.spendId === walletId);
      if (!group) return { ok: false, error: "Could not find this personal wallet." };
      return exportPersonalWalletGroupSecret(group, props.exportWalletSecrets, props.updateWalletAction, { confirmation });
    },
    onSendAgentPayment: async (input: any) => {
      const wallet = effectiveWalletsByAgent?.[input.agentId] || {};
      const recipientWallet = input.recipientAgentId ? effectiveWalletsByAgent?.[input.recipientAgentId] : null;
      const recipient = input.toAddress || recipientWallet?.walletAddress || recipientWallet?.vaultAddress || recipientWallet?.address || "";
      const provider = walletProviderForDropIn(wallet);
      const asset = String(input.asset || "USDC").toUpperCase();
      const amount = Number(input.amount);
      const amountUsd = Number(input.amountUsd);
      const directEnabled = wallet.enabled !== false && !wallet.disabled, autoPayEnabled = Boolean(wallet.autoPayEnabled ?? wallet.autoUse ?? wallet.allowAutoUse);
      const veilAutoSendEnabled = wallet.veilAutoSendEnabled === true;
      const walletStableAsset = stableSendAssetForNetwork(String(wallet.network || ""));
      if (!recipient) throw new Error("Recipient address is required.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
      if (provider !== "veil" && asset !== walletStableAsset) throw new Error(`This wallet sends ${walletStableAsset} on ${fundingNetworkLabel(String(wallet.network || ""))}.`);
      props.updateWalletAction?.(input.agentId, { busy: true, error: "", message: provider === "veil" ? "Submitting Veil private transfer..." : `Sending ${asset}...` });
      const endpoint = provider === "veil" ? "/api/wallet/veil/transfer" : "/api/wallet/send";
      const maxAssetAmount = Number(wallet.assetSpendCaps?.[asset] ?? (asset === "ETH" ? 0.01 : wallet.maxPaymentUsd) ?? amount);
      const body = endpoint === "/api/wallet/veil/transfer"
        ? { agentId: input.agentId, enabled: directEnabled, provider: "veil", network: VEIL_TRANSFER_NETWORK, asset, recipientAddress: recipient, amount: input.amount, amountUsd: asset === "USDC" ? amount : Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : undefined, maxPaymentUsd: wallet.maxPaymentUsd, maxAssetAmount, confirmation: input.confirmation, autoSendEnabled: veilAutoSendEnabled, autoShield: true, duplicateGuardEnabled: wallet.duplicatePaymentGuardEnabled !== false, duplicateGuardSeconds: wallet.duplicatePaymentGuardSeconds }
        : { agentId: input.agentId, toAddress: recipient, amountUsd: amount, maxPaymentUsd: wallet.maxPaymentUsd, autoPayEnabled, confirmation: input.confirmation };
      let data: { ok?: boolean; signature?: string; transfer?: { transactionHash?: string }; shield?: { transactionHash?: string }; status?: string; error?: string } | null;
      if (endpoint === "/api/wallet/send") {
        data = await sendApprovedWalletUsdc(body as WalletSendUsdcRequest);
      } else {
        data = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then((response) => response.json())
          .catch(() => null) as { ok?: boolean; signature?: string; transfer?: { transactionHash?: string }; shield?: { transactionHash?: string }; status?: string; error?: string } | null;
      }
      if (!data?.ok) {
        props.updateWalletAction?.(input.agentId, { busy: false, error: data?.error ?? "Payment failed.", message: "" });
        throw new Error(data?.error || "Payment failed.");
      }
      const tx = data.signature || data.transfer?.transactionHash || data.shield?.transactionHash || "";
      props.updateWalletAction?.(input.agentId, { busy: false, error: "", message: tx ? `Sent. Transaction: ${tx}` : data.status === "shielding" ? "Shielding started. HivemindOS will finish the private send after Veil accepts the deposit." : "Sent.", confirmation: "" });
      const [refreshed] = await Promise.all([refreshWalletBalance?.(input.agentId), loadWalletActivity()]);
      if (refreshed) setFreshWalletsByAgent((current) => mergeWalletsByAgentWithFresh(current, { [input.agentId]: refreshed }));
      return data;
    },
    onSaveRailConfig: async (input: any) => {
      const firstAgentId = props.displayAgents?.[0]?.id || Object.keys(effectiveWalletsByAgent || {})[0] || "";
      if (input.rail?.id) {
        setRailEnabledOverrides((current) => ({ ...current, [input.rail.id]: Boolean(input.enabled) }));
        await saveDashboardStateValue(`${RAIL_ENABLED_KEY_PREFIX}${input.rail.id}`, input.enabled ? "1" : "0");
      }
      if (input.rail?.id === "moneyclaw" && input.key?.trim() && firstAgentId) {
        const result = await props.saveMoneyClawKey?.(firstAgentId, input.key, { shareWithAllAgents: Boolean(input.share) });
        return { ...(result ?? { ok: true }), rail: { ...input.rail, enabled: Boolean(input.enabled), cred: true, setup: input.enabled ? "ready" : input.rail?.setup } };
      }
      if (input.key?.trim() && input.rail?.env && input.rail.env !== "—") {
        const response = await fetch("/api/env", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: "shared", key: input.rail.env, value: input.key.trim(), promoteToShared: true }) }).catch(() => null);
        const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!response?.ok || !data?.ok) return { ok: false, error: data?.error || `Could not save ${input.rail.env}.` };
      }
      await refreshUsePodTargets();
      return { ok: true, rail: { ...input.rail, enabled: Boolean(input.enabled), cred: input.key?.trim() ? true : input.rail?.cred, setup: input.enabled && (input.key?.trim() || input.rail?.cred || input.rail?.env === "—") ? "ready" : input.rail?.setup } };
    },
    onRefreshUsePod: (agentId?: string) => refreshUsePodTargets(agentId),
    onSetUsePodRoutingMode: (mode: string) => { setUsePodRoutingMode(mode); return saveDashboardStateValue(USEPOD_ROUTING_MODE_KEY, mode); },
    onSaveUsePodRepair: async (value: string) => {
      const token = parseUsePodTokenFromInput(value);
      if (token.length < 12) throw new Error("Paste a UsePod API token, or a dashboard URL with a token parameter.");
      const response = await fetch("/api/env", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: "shared", key: "USEPOD_TOKEN", value: token, promoteToShared: true }) }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) throw new Error(data?.error || "Could not save USEPOD_TOKEN.");
      await refreshUsePodTargets();
      return { ok: true };
    },
    onFundAgent: async (input: any) => {
      const asset = String(input.asset || "USDC").toUpperCase();
      if (!isStableSendAsset(asset)) throw new Error("Agent funding is wired for USDC or USDG transfers only.");
      if (input.source?.canSpend === false) throw new Error("This personal wallet is watch-only. Reimport it locally before funding agents.");
      const wallet = effectiveWalletsByAgent?.[input.agentId] || {};
      const toAddress = wallet.walletAddress || wallet.vaultAddress || wallet.address || "";
      if (!toAddress) throw new Error("That agent does not have a deposit address yet.");
      const recipientAsset = stableSendAssetForNetwork(String(wallet.network || ""));
      if (asset !== recipientAsset) throw new Error(`That agent wallet receives ${recipientAsset} on ${fundingNetworkLabel(String(wallet.network || ""))}.`);
      const sourceAgentId = resolvePersonalWalletAgentIdForAsset(input.source, asset, mergedPersonalWallets);
      if (!sourceAgentId) throw new Error(`No local ${asset} wallet is available to fund this agent.`);
      const data = await sendApprovedWalletUsdc({ agentId: sourceAgentId, toAddress, amountUsd: Number(input.amount), autoPayEnabled: false, confirmation: input.confirmation, maxPaymentUsd: Number(input.amount) || undefined });
      if (!data?.ok) throw new Error(data?.error || "Could not fund agent.");
      const [recipientWallet] = await Promise.all([refreshWalletBalance?.(input.agentId), refreshPersonalWalletSourceBalance(input.source), loadWalletActivity()]);
      if (recipientWallet) {
        setFreshWalletsByAgent((current) => mergeWalletsByAgentWithFresh(current, { [input.agentId]: recipientWallet }));
      }
      return {
        ...data,
        recipientWallet,
        recipientBalanceUsd: Number(recipientWallet?.currentBalanceUsd ?? recipientWallet?.onchainBalanceUsd),
      };
    },
    onSendPersonalWallet: async (input: any) => {
      const asset = String(input.asset || "USDC").toUpperCase();
      if (!isStableSendAsset(asset)) throw new Error("Personal wallet send is wired for USDC or USDG transfers only.");
      if (input.source?.canSpend === false) throw new Error("This personal wallet is watch-only. Reimport it locally before sending.");
      const sourceAgentId = resolvePersonalWalletAgentIdForAsset(input.source, asset, mergedPersonalWallets);
      if (!sourceAgentId) throw new Error(`No local ${asset} wallet is available to send from.`);
      const data = await sendApprovedWalletUsdc({ agentId: sourceAgentId, toAddress: input.toAddress, amountUsd: Number(input.amount), autoPayEnabled: false, confirmation: input.confirmation, maxPaymentUsd: Number(input.amount) || undefined });
      if (!data?.ok) throw new Error(data?.error || `Could not send ${asset}.`);
      await Promise.all([
        refreshPersonalWalletSourceBalance(input.source),
        input.recipient ? refreshPersonalWalletSourceBalance(input.recipient) : undefined,
        loadWalletActivity(),
      ]);
      return data;
    },
    onRefreshPersonalWallet: async (source: any) => refreshPersonalWalletSourceBalance(source),
    onRefreshBankrWallet: loadBankrWallet,
    onRenamePersonalWallet: async (input: any) => {
      const name = String(input?.name || "").trim();
      if (!name) throw new Error("Enter a name for this wallet.");
      const source = input?.source || {};
      // A "my wallet" card groups one record per chain; match every underlying
      // record by address so a multi-chain wallet is renamed consistently.
      const addresses = new Set([
        String(source.addr || "").toLowerCase(),
        ...(Array.isArray(source.addresses) ? source.addresses.map((row: any) => String(row?.[1] || "").toLowerCase()) : []),
      ].filter(Boolean));
      const targets = mergedPersonalWallets.filter((wallet: any) => addresses.has(String(wallet?.address || "").toLowerCase()));
      if (!targets.length) throw new Error("Could not find this wallet to rename.");
      const now = Date.now();
      const renamed = targets.map((wallet: any) => ({ ...wallet, name, updatedAt: now }));
      // (1) Ledger source — drives the optimistic My-wallets list + /api/wallet/personal GET.
      setPersonalWallets((current) => mergePersonalWalletList([...(Array.isArray(current) ? current : []), ...renamed]));
      // (2) Dashboard-state source. The card name resolves through mergePersonalWalletSources,
      // where a non-generic dashboard-state name (e.g. the generated "My Base mainnet wallet"
      // fallback for a nameless stored wallet) wins over the ledger name — so without writing
      // the new name here too, the rename is reverted on the next re-merge. updateWallet also
      // persists walletsByAgent to dashboard state, so the rename survives a reload.
      for (const wallet of targets) {
        const agentId = String(wallet?.id || wallet?.agentId || "");
        if (agentId && effectiveWalletsByAgent?.[agentId]) props.updateWallet?.(agentId, { name });
      }
      // (3) Persist to the wallet ledger so every other consumer sees the new name on reload.
      const writable = renamed.filter((wallet: any) => String(wallet?.id || "").startsWith("user:") && wallet.address && wallet.network);
      if (writable.length) {
        const response = await fetch("/api/wallet/personal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultPath: vaultPath || undefined, wallets: writable }) }).catch(() => null);
        const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (!response?.ok || !data?.ok) throw new Error(data?.error || "Could not save the wallet name.");
      }
      return { ok: true, name };
    },
    onCreateWallet: async (input: any) => {
      const chain = String(input.chain || "Base + Robinhood Chain + Solana");
      const normalizedChain = chain.toLowerCase();
      const multiChain = normalizedChain.includes("base") && normalizedChain.includes("solana") && normalizedChain.includes("robinhood");
      const response = await fetch("/api/wallet/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: `user:${globalThis.crypto?.randomUUID?.() || Date.now()}`, createKind: multiChain ? "multi-chain" : "single-network", network: multiChain ? undefined : chainToNetwork(chain), name: input.name, vaultPath: vaultPath || undefined }) }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) throw new Error(data?.error || "Could not create wallet.");
      await loadPersonalWallets();
      return data;
    },
    onImportWallet: async (input: any) => {
      const secret = String(input.secret || "").trim();
      const response = await fetch("/api/wallet/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: input.wallet?.id || `user:${globalThis.crypto?.randomUUID?.() || Date.now()}`, network: chainToNetwork(input.chain || "Base"), name: input.name, secret, importKind: secret.split(/\s+/).length >= 12 ? "recovery-phrase" : "private-key", vaultPath: vaultPath || undefined }) }).catch(() => null);
      const data = await response?.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response?.ok || !data?.ok) throw new Error(data?.error || "Could not import wallet.");
      await loadPersonalWallets();
      return data;
    },
    onOpenRailDocs: (rail: any) => { const base = String(rail?.baseUrl || "").replace(/^—$/, ""); if (base) window.open(base.startsWith("http") ? base : `https://${base}`, "_blank", "noopener,noreferrer"); },
    onToggleHoneyLedger: async (enabled: boolean) => {
      const result = enabled ? await props.enableHoneyLedger?.() : await props.setHoneyLedgerEnabled?.(false);
      await loadHoneyLedger();
      return result;
    },
    onMessageHive: (text: string) => {
      try { window.sessionStorage.setItem("hivemindos.walletDraftMessage", text); } catch {}
      window.dispatchEvent(new CustomEvent("hivemindos:wallet-message", { detail: { text } }));
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("view", "chat");
      window.location.assign(nextUrl.toString());
    },
  }), [bankrRecipientAddress, effectiveWalletsByAgent, loadBankrWallet, loadHoneyLedger, loadPersonalWallets, loadWalletActivity, mergedPersonalWallets, props, refreshPersonalWalletSourceBalance, refreshUsePodTargets, refreshWalletBalance, vaultPath]);
  const navigateFromDropInShelf = useCallback((id: string) => {
    if (typeof window === "undefined") return;
    const nextView = walletViewForShelf(id);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("view", nextView);
    window.location.assign(nextUrl.toString());
  }, []);

  return (
    <section aria-label="Wallets" style={{ position: "fixed", inset: 0, zIndex: 90, background: "#0c0d11" }}>
      <WalletsView runtimeData={runtimeData} actions={walletActions} onNavigate={navigateFromDropInShelf} />
      {llmFundingAgentId ? (
        <WalletSelectModal
          pickables={llmFundingPickables}
          getSurvivalSnapshot={getSurvivalSnapshot}
          currentId={llmFundingCurrentId}
          onConfirm={setLlmFundingSource}
          onClose={() => setLlmFundingAgentId("")}
          title="LLM Funding Source"
          subtitle="Choose which local wallet pays HivemindOS Models for this agent. Personal wallets and configured agent wallets can both be used."
          confirmLabel="Use for LLM calls"
        />
      ) : null}
    </section>
  );
}

export const WalletPanel = memo(WalletPanelComponent);

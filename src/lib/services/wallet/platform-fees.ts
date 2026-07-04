import "server-only";

import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { sendUsdStable } from "@/lib/services/wallet/chain-wallet";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export const PLATFORM_FEE_CONFIRMATION_NOTE = "Platform fee collected as a separate stablecoin transfer.";

const DEFAULT_FEE_BPS = 100; // 1%
const DEFAULT_COMPANY_REVENUE_FEE_BPS = 200; // 2%
const DEFAULT_MIN_FEE_USD = 0.01;
const DEFAULT_MAX_FEE_USD = 0;
const DEFAULT_OFFICIAL_POLICY_URL = "https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/platform-fees/config";
const USDC_MICROS = 1_000_000;
const BPS_DENOMINATOR = 10_000;
const POLICY_CACHE_MS = 60_000;

const ENABLED_KEYS = [
  "HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED",
  "HIVEMINDOS_PLATFORM_FEES_ENABLED",
] as const;

const FEE_BPS_KEYS = [
  "HIVEMINDOS_TRADING_PLATFORM_FEE_BPS",
  "HIVEMINDOS_PLATFORM_FEE_BPS",
] as const;

const COMPANY_REVENUE_FEE_BPS_KEYS = [
  "HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS",
  "HIVEMINDOS_ZHC_REVENUE_SHARE_BPS",
] as const;

const MIN_FEE_KEYS = [
  "HIVEMINDOS_TRADING_PLATFORM_MIN_FEE_USD",
  "HIVEMINDOS_PLATFORM_MIN_FEE_USD",
] as const;

const MAX_FEE_KEYS = [
  "HIVEMINDOS_TRADING_PLATFORM_MAX_FEE_USD",
  "HIVEMINDOS_PLATFORM_MAX_FEE_USD",
] as const;

const EVM_RECIPIENT_KEYS = [
  "HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM",
  "HIVEMINDOS_PLATFORM_FEE_RECIPIENT",
  "HIVEMINDOS_PAID_AGENT_PAY_TO",
] as const;

const SOLANA_RECIPIENT_KEYS = [
  "HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA",
  "HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SVM",
] as const;

const LOCAL_POLICY_KEYS = [
  ...ENABLED_KEYS,
  ...EVM_RECIPIENT_KEYS,
  ...SOLANA_RECIPIENT_KEYS,
] as const;

export type PlatformFeeSource =
  | "wallet-send"
  | "dex-swap"
  | "xstocks"
  | "robinhood-chain"
  | "alpaca-live"
  | "bankr-action"
  | "moneyclaw"
  | "x402-paid-api"
  | "company-revenue"
  | "veil-transfer"
  | "veil-x402";

export type PlatformFeeQuote = {
  enabled: boolean;
  configured: boolean;
  source: PlatformFeeSource;
  network: string;
  amountUsd: number;
  basisPoints: number;
  minFeeUsd: number;
  maxFeeUsd?: number;
  assetSymbol: "USDC" | "USDG";
  recipient?: string;
  recipientKey?: string;
  reason?: string;
};

export type PlatformFeeCollection = PlatformFeeQuote & {
  signature: string;
};

type PlatformFeePolicy = {
  source: "local-env" | "hosted" | "disabled";
  enabled: boolean;
  basisPoints: number;
  companyRevenueBasisPoints?: number;
  minFeeUsd: number;
  maxFeeUsd: number;
  recipient?: string;
  recipientKey?: string;
  reason?: string;
};

type HostedPolicyResponse = {
  ok?: boolean;
  enabled?: unknown;
  basisPoints?: unknown;
  feeBps?: unknown;
  companyRevenueBasisPoints?: unknown;
  companyRevenueFeeBps?: unknown;
  sourceBasisPoints?: Record<string, unknown>;
  minFeeUsd?: unknown;
  maxFeeUsd?: unknown;
  recipients?: {
    evm?: unknown;
    solana?: unknown;
  };
  recipient?: unknown;
  recipientEvm?: unknown;
  recipientSolana?: unknown;
};

let hostedPolicyCache: { expiresAt: number; url: string; policy: HostedPolicyResponse | null } | null = null;

export async function quoteTradingPlatformFee(input: {
  source: PlatformFeeSource;
  network: string;
  amountUsd: number;
}): Promise<PlatformFeeQuote> {
  const policy = await resolvePlatformFeePolicy(input.network);
  const enabled = policy.enabled;
  const basisPoints = await basisPointsForSource(input.source, policy);
  const minFeeUsd = policy.minFeeUsd;
  const maxFeeUsd = policy.maxFeeUsd;
  const assetSymbol = stableAssetSymbol(input.network);
  const amountUsd = feeAmountUsd(input.amountUsd, basisPoints, minFeeUsd, maxFeeUsd);
  if (!enabled) {
    return {
      enabled: false,
      configured: false,
      source: input.source,
      network: input.network,
      amountUsd: 0,
      basisPoints,
      minFeeUsd,
      maxFeeUsd: maxFeeUsd > 0 ? maxFeeUsd : undefined,
      assetSymbol,
      reason: policy.reason || "Platform fees are disabled.",
    };
  }

  if (amountUsd <= 0) {
    return {
      enabled,
      configured: false,
      source: input.source,
      network: input.network,
      amountUsd: 0,
      basisPoints,
      minFeeUsd,
      maxFeeUsd: maxFeeUsd > 0 ? maxFeeUsd : undefined,
      assetSymbol,
      reason: "No fee is due for this zero-value action.",
    };
  }

  if (!policy.recipient) {
    return {
      enabled,
      configured: false,
      source: input.source,
      network: input.network,
      amountUsd,
      basisPoints,
      minFeeUsd,
      maxFeeUsd: maxFeeUsd > 0 ? maxFeeUsd : undefined,
      assetSymbol,
      reason: policy.reason || `No platform fee recipient is configured for ${networkFamily(input.network)}.`,
    };
  }

  return {
    enabled,
    configured: true,
    source: input.source,
    network: input.network,
    amountUsd,
    basisPoints,
    minFeeUsd,
    maxFeeUsd: maxFeeUsd > 0 ? maxFeeUsd : undefined,
    assetSymbol,
    recipient: policy.recipient,
    recipientKey: policy.recipientKey,
  };
}

export async function collectTradingPlatformFee(input: {
  agentId: string;
  network: string;
  secret: string;
  fromAddress: string;
  amountUsd: number;
  source: PlatformFeeSource;
  companyId?: string;
}): Promise<PlatformFeeCollection | undefined> {
  const quote = await quoteTradingPlatformFee(input);
  if (!quote.enabled) return undefined;
  assertPlatformFeeCollectable(quote);

  try {
    const result = await sendUsdStable({
      network: input.network,
      secret: input.secret,
      fromAddress: input.fromAddress,
      toAddress: quote.recipient,
      amountUsd: quote.amountUsd,
    });
    await appendSpend({
      agentId: input.agentId,
      companyId: input.companyId,
      kind: "platform-fee",
      asset: result.assetSymbol,
      amountUsd: quote.amountUsd,
      target: shortTarget(quote.recipient),
      status: "executed",
      transactionHash: result.signature,
    }).catch(() => {});
    return { ...quote, assetSymbol: result.assetSymbol, signature: result.signature };
  } catch (error) {
    await appendSpend({
      agentId: input.agentId,
      companyId: input.companyId,
      kind: "platform-fee",
      asset: quote.assetSymbol,
      amountUsd: quote.amountUsd,
      target: quote.recipient ? shortTarget(quote.recipient) : undefined,
      status: "failed",
    }).catch(() => {});
    throw new Error(`Action succeeded, but platform fee collection failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

export async function assertTradingPlatformFeeReady(input: {
  source: PlatformFeeSource;
  network: string;
  amountUsd: number;
}): Promise<PlatformFeeQuote | undefined> {
  const quote = await quoteTradingPlatformFee(input);
  if (!quote.enabled) return undefined;
  assertPlatformFeeCollectable(quote);
  return quote;
}

export function platformFeeDetail(fee?: PlatformFeeQuote | PlatformFeeCollection): string {
  if (!fee?.enabled) return "";
  if (!fee.configured) return fee.reason ? ` Platform fee unavailable: ${fee.reason}` : " Platform fee unavailable.";
  return ` Platform fee ${formatFeeUsd(fee.amountUsd)} ${fee.assetSymbol} (${fee.basisPoints / 100}%).`;
}

export function platformFeeReceiptDetail(fee?: PlatformFeeCollection): string {
  if (!fee) return "";
  return ` ${PLATFORM_FEE_CONFIRMATION_NOTE} Fee ${formatFeeUsd(fee.amountUsd)} ${fee.assetSymbol}, tx ${fee.signature}.`;
}

function formatFeeUsd(amountUsd: number): string {
  return amountUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function assertPlatformFeeCollectable(quote: PlatformFeeQuote): asserts quote is PlatformFeeQuote & { recipient: string } {
  if (!quote.configured || !quote.recipient || quote.amountUsd <= 0) {
    throw new Error(quote.reason || "Platform fee is enabled but not configured.");
  }
}

async function platformFeesEnabled(): Promise<boolean> {
  for (const key of ENABLED_KEYS) {
    const value = (await hiveEnvValue(key).catch(() => "")).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
  }
  return false;
}

async function resolvePlatformFeePolicy(network: string): Promise<PlatformFeePolicy> {
  if (await hasLocalPolicyOverride()) return localEnvPlatformFeePolicy(network);
  return hostedPlatformFeePolicy(network);
}

async function hasLocalPolicyOverride(): Promise<boolean> {
  for (const key of LOCAL_POLICY_KEYS) {
    if ((await hiveEnvValue(key).catch(() => "")).trim()) return true;
  }
  return false;
}

async function localEnvPlatformFeePolicy(network: string): Promise<PlatformFeePolicy> {
  const enabled = await platformFeesEnabled();
  const basisPoints = await firstNumber(FEE_BPS_KEYS, DEFAULT_FEE_BPS);
  const minFeeUsd = await firstNumber(MIN_FEE_KEYS, DEFAULT_MIN_FEE_USD);
  const maxFeeUsd = await firstNumber(MAX_FEE_KEYS, DEFAULT_MAX_FEE_USD);
  const recipient = await recipientForNetwork(network);
  return {
    source: "local-env",
    enabled,
    basisPoints,
    minFeeUsd,
    maxFeeUsd,
    recipient: recipient?.value,
    recipientKey: recipient?.key,
  };
}

async function hostedPlatformFeePolicy(network: string): Promise<PlatformFeePolicy> {
  const url = await hostedPolicyUrl();
  const fallback: PlatformFeePolicy = {
    source: "hosted",
    enabled: false,
    basisPoints: DEFAULT_FEE_BPS,
    minFeeUsd: DEFAULT_MIN_FEE_USD,
    maxFeeUsd: DEFAULT_MAX_FEE_USD,
    reason: "Hosted platform fee policy is unavailable.",
  };
  if (!url) return { ...fallback, source: "disabled", reason: "Hosted platform fee policy is disabled." };

  const policy = await fetchHostedPolicy(url).catch(() => null);
  if (!policy?.ok) return fallback;
  const basisPoints = numberFrom(policy.basisPoints ?? policy.feeBps, DEFAULT_FEE_BPS);
  const companyRevenueBasisPoints = numberFromOptional(
    policy.sourceBasisPoints?.["company-revenue"] ?? policy.companyRevenueBasisPoints ?? policy.companyRevenueFeeBps,
  );
  const minFeeUsd = numberFrom(policy.minFeeUsd, DEFAULT_MIN_FEE_USD);
  const maxFeeUsd = numberFrom(policy.maxFeeUsd, DEFAULT_MAX_FEE_USD);
  const recipient = hostedRecipientForNetwork(network, policy);
  const enabled = booleanFrom(policy.enabled, false) && Boolean(recipient);
  return {
    source: "hosted",
    enabled,
    basisPoints,
    companyRevenueBasisPoints,
    minFeeUsd,
    maxFeeUsd,
    recipient: recipient?.value,
    recipientKey: recipient?.key,
    reason: enabled ? undefined : recipient ? "Hosted platform fees are disabled." : `No hosted platform fee recipient is configured for ${networkFamily(network)}.`,
  };
}

async function hostedPolicyUrl(): Promise<string> {
  const configured = (await hiveEnvValue("HIVEMINDOS_PLATFORM_FEE_POLICY_URL").catch(() => "")).trim();
  if (["0", "false", "off", "none", "disabled"].includes(configured.toLowerCase())) return "";
  return configured || DEFAULT_OFFICIAL_POLICY_URL;
}

async function fetchHostedPolicy(url: string): Promise<HostedPolicyResponse | null> {
  const now = Date.now();
  if (hostedPolicyCache && hostedPolicyCache.url === url && hostedPolicyCache.expiresAt > now) {
    return hostedPolicyCache.policy;
  }
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Hosted platform fee policy returned HTTP ${response.status}.`);
  const parsed = (await response.json().catch(() => null)) as HostedPolicyResponse | null;
  hostedPolicyCache = { url, expiresAt: now + POLICY_CACHE_MS, policy: parsed };
  return parsed;
}

function hostedRecipientForNetwork(network: string, policy: HostedPolicyResponse): { key: string; value: string } | null {
  const family = networkFamily(network);
  const raw = family === "evm"
    ? policy.recipients?.evm ?? policy.recipientEvm ?? policy.recipient
    : family === "solana"
      ? policy.recipients?.solana ?? policy.recipientSolana
      : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  if (family === "evm" && /^0x[a-fA-F0-9]{40}$/.test(value)) return { key: "hosted:eip155", value };
  if (family === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { key: "hosted:solana", value };
  throw new Error(`Hosted platform fee recipient is not a valid ${family === "evm" ? "EVM" : "Solana"} address.`);
}

async function firstNumber(keys: readonly string[], fallback: number): Promise<number> {
  for (const key of keys) {
    const raw = await hiveEnvValue(key).catch(() => "");
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
}

async function firstNumberOptional(keys: readonly string[]): Promise<number | undefined> {
  for (const key of keys) {
    const raw = await hiveEnvValue(key).catch(() => "");
    if (!raw.trim()) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

async function basisPointsForSource(source: PlatformFeeSource, policy: PlatformFeePolicy): Promise<number> {
  if (source !== "company-revenue") return policy.basisPoints;
  const explicitCompanyOverride = await firstNumberOptional(COMPANY_REVENUE_FEE_BPS_KEYS);
  if (explicitCompanyOverride !== undefined) return explicitCompanyOverride;
  return policy.companyRevenueBasisPoints ?? DEFAULT_COMPANY_REVENUE_FEE_BPS;
}

function feeAmountUsd(amountUsd: number, basisPoints: number, minFeeUsd: number, maxFeeUsd: number): number {
  const baseAmount = Number(amountUsd);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0 || basisPoints <= 0) return 0;
  let micros = Math.ceil((baseAmount * basisPoints * USDC_MICROS) / BPS_DENOMINATOR);
  if (minFeeUsd > 0) micros = Math.max(micros, Math.ceil(minFeeUsd * USDC_MICROS));
  if (maxFeeUsd > 0) micros = Math.min(micros, Math.floor(maxFeeUsd * USDC_MICROS));
  return micros / USDC_MICROS;
}

function booleanFrom(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function numberFrom(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function numberFromOptional(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

async function recipientForNetwork(network: string): Promise<{ key: string; value: string } | null> {
  const family = networkFamily(network);
  const keys = family === "evm" ? EVM_RECIPIENT_KEYS : family === "solana" ? SOLANA_RECIPIENT_KEYS : [];
  for (const key of keys) {
    const value = (await hiveEnvValue(key).catch(() => "")).trim();
    if (!value) continue;
    if (family === "evm" && /^0x[a-fA-F0-9]{40}$/.test(value)) return { key, value };
    if (family === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { key, value };
    throw new Error(`${key} is not a valid ${family === "evm" ? "EVM" : "Solana"} address.`);
  }
  return null;
}

function networkFamily(network: string): "evm" | "solana" | "unsupported" {
  if (network.startsWith("eip155:")) return "evm";
  if (network.startsWith("solana")) return "solana";
  return "unsupported";
}

function stableAssetSymbol(network: string): "USDC" | "USDG" {
  return network === "eip155:4663" ? "USDG" : "USDC";
}

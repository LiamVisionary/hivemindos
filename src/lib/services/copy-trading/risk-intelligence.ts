import type {
  CopyTradeCounterfactual,
  CopyTradeNetwork,
} from "@/lib/types/copy-trading";
import type { TokenMarket } from "./market";

const GOPLUS_BASE_URL = "https://api.gopluslabs.io/api/v1";
const SECURITY_TIMEOUT_MS = 5_000;
const SECURITY_CACHE_MS = 5 * 60_000;

export type CopyTradeSecurityCoverage = "complete" | "partial" | "unavailable";

export type CopyTradeTokenSecurity = {
  provider: "goplus";
  coverage: CopyTradeSecurityCoverage;
  hardRiskFlags: string[];
  cautionFlags: string[];
  holderConcentrationPct: number | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
};

export type CopyTradeWalletIntelligence = {
  maturedTrades: number;
  winRatePct: number | null;
  meanReturnPct: number | null;
  maxDrawdownPct: number | null;
};

export type CopyTradeIntelligence = {
  security: CopyTradeTokenSecurity;
  wallet: CopyTradeWalletIntelligence;
};

export type CopyTradeRiskGate = {
  path: "risk-close" | "sol-adjudication";
  score: number;
  reasons: string[];
  hardClose: boolean;
};

type CachedSecurity = { at: number; value: Promise<CopyTradeTokenSecurity> };
const securityCache = new Map<string, CachedSecurity>();

export async function getCopyTradeIntelligence(input: {
  network: CopyTradeNetwork;
  token: string;
  counterfactuals: CopyTradeCounterfactual[];
  currentBatch?: number;
  fetchImpl?: typeof fetch;
}): Promise<CopyTradeIntelligence> {
  const security = await fetchGoPlusTokenSecurity(input.network, input.token, input.fetchImpl);
  return {
    security,
    wallet: buildWalletIntelligence(input.counterfactuals, input.currentBatch),
  };
}

/** Starts the same cached read before the copied fill completes. */
export function warmCopyTradeIntelligence(input: {
  network: CopyTradeNetwork;
  token: string;
  counterfactuals: CopyTradeCounterfactual[];
  currentBatch?: number;
  fetchImpl?: typeof fetch;
}): Promise<CopyTradeIntelligence> {
  return getCopyTradeIntelligence(input);
}

export async function fetchGoPlusTokenSecurity(
  network: CopyTradeNetwork,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CopyTradeTokenSecurity> {
  const key = `${network}:${network === "eip155:8453" ? token.toLowerCase() : token}`;
  const cached = securityCache.get(key);
  if (cached && Date.now() - cached.at < SECURITY_CACHE_MS) return cached.value;
  const value = (async () => {
    try {
      const url = network === "solana:mainnet"
        ? new URL(`${GOPLUS_BASE_URL}/solana/token_security`)
        : new URL(`${GOPLUS_BASE_URL}/token_security/8453`);
      url.searchParams.set("contract_addresses", token);
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(SECURITY_TIMEOUT_MS),
        cache: "no-store",
      });
      if (!response.ok) return unavailableSecurity();
      return normalizeGoPlusSecurity(network, token, await response.json().catch(() => null));
    } catch {
      return unavailableSecurity();
    }
  })();
  securityCache.set(key, { at: Date.now(), value });
  return value;
}

export function normalizeGoPlusSecurity(
  network: CopyTradeNetwork,
  token: string,
  payload: unknown,
): CopyTradeTokenSecurity {
  const envelope = asRecord(payload);
  const result = asRecord(envelope?.result);
  const raw = result?.[token]
    ?? result?.[token.toLowerCase()]
    ?? Object.entries(result ?? {}).find(([address]) => address.toLowerCase() === token.toLowerCase())?.[1];
  const data = asRecord(raw);
  if (!data) return unavailableSecurity();

  return network === "solana:mainnet" ? normalizeSolanaSecurity(data) : normalizeEvmSecurity(data);
}

export function evaluatePostFillRisk(input: {
  spentUsd: number;
  market: TokenMarket;
  security: CopyTradeTokenSecurity;
  now?: number;
}): CopyTradeRiskGate {
  const reasons: string[] = [];
  const hardReasons = [...input.security.hardRiskFlags];
  let score = hardReasons.length ? 100 : 0;
  if (hardReasons.length) reasons.push(`Security flags: ${hardReasons.join(", ")}.`);

  if (input.security.sellTaxPct != null && input.security.sellTaxPct >= 20) {
    hardReasons.push("sell-tax-at-least-20-percent");
    reasons.push(`Sell tax is ${round(input.security.sellTaxPct, 2)}%.`);
    score = 100;
  } else if (input.security.sellTaxPct != null && input.security.sellTaxPct >= 5) {
    score += 20;
    reasons.push(`Elevated sell tax is ${round(input.security.sellTaxPct, 2)}%.`);
  }

  const liquidityUsd = input.market.liquidityUsd;
  if (liquidityUsd != null && liquidityUsd > 0) {
    const impactPct = (Math.max(0, input.spentUsd) / liquidityUsd) * 100;
    if (liquidityUsd < Math.max(250, input.spentUsd * 10)) {
      hardReasons.push("critically-thin-liquidity");
      reasons.push(`Liquidity is only $${Math.round(liquidityUsd)}.`);
      score = 100;
    } else if (impactPct >= 1) {
      score += 25;
      reasons.push(`Estimated one-way price impact is ${round(impactPct, 2)}%.`);
    } else if (impactPct >= 0.25) {
      score += 10;
      reasons.push(`Estimated one-way price impact is ${round(impactPct, 2)}%.`);
    }
  } else {
    score += 20;
    reasons.push("Liquidity evidence is unavailable.");
  }

  if (input.security.coverage === "unavailable") {
    score += 20;
    reasons.push("Contract or mint security evidence is unavailable.");
  } else if (input.security.coverage === "partial") {
    score += 10;
    reasons.push("Contract or mint security evidence is partial.");
  }
  if ((input.security.holderConcentrationPct ?? 0) >= 50) {
    score += 20;
    reasons.push(`Largest reported holder controls ${round(input.security.holderConcentrationPct!, 2)}%.`);
  }
  if (input.security.cautionFlags.length) {
    score += Math.min(20, input.security.cautionFlags.length * 5);
    reasons.push(`Caution flags: ${input.security.cautionFlags.join(", ")}.`);
  }
  const now = input.now ?? Date.now();
  if (input.market.pairCreatedAt != null && now - input.market.pairCreatedAt < 60 * 60_000) {
    score += 10;
    reasons.push("Deepest pool is less than one hour old.");
  }
  if (
    input.market.buys24h != null
    && input.market.sells24h != null
    && input.market.sells24h > Math.max(10, input.market.buys24h * 2)
  ) {
    score += 10;
    reasons.push("Reported 24-hour sells are more than double buys.");
  }
  return {
    path: hardReasons.length ? "risk-close" : "sol-adjudication",
    score: clamp(Math.round(score), 0, 100),
    reasons,
    hardClose: hardReasons.length > 0,
  };
}

export function buildWalletIntelligence(
  records: CopyTradeCounterfactual[],
  currentBatch = Number.POSITIVE_INFINITY,
): CopyTradeWalletIntelligence {
  const returns = records
    .filter((record) => record.evaluationBatch < currentBatch)
    .map((record) => record.horizons["24h"].holdReturnPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!returns.length) {
    return { maturedTrades: 0, winRatePct: null, meanReturnPct: null, maxDrawdownPct: null };
  }
  const wins = returns.filter((value) => value > 0).length;
  return {
    maturedTrades: returns.length,
    winRatePct: round((wins / returns.length) * 100, 2),
    meanReturnPct: round(returns.reduce((sum, value) => sum + value, 0) / returns.length, 2),
    maxDrawdownPct: round(maxDrawdownPct(returns), 2),
  };
}

function normalizeEvmSecurity(data: Record<string, unknown>): CopyTradeTokenSecurity {
  const hardRiskFlags: string[] = [];
  if (flag(data.is_honeypot)) hardRiskFlags.push("honeypot");
  if (flag(data.cannot_sell_all)) hardRiskFlags.push("cannot-sell-all");
  if (flag(data.owner_change_balance)) hardRiskFlags.push("owner-can-change-balances");
  if (flag(data.fake_token)) hardRiskFlags.push("fake-token");
  const cautionFlags: string[] = [];
  if (flag(data.cannot_buy)) cautionFlags.push("buy-restrictions");
  if (flag(data.is_blacklisted)) cautionFlags.push("blacklist-authority");
  if (flag(data.is_mintable)) cautionFlags.push("mintable");
  if (flag(data.is_proxy)) cautionFlags.push("proxy-upgradable");
  if (flag(data.slippage_modifiable)) cautionFlags.push("modifiable-slippage");
  if (flag(data.is_anti_whale)) cautionFlags.push("anti-whale-controls");
  return {
    provider: "goplus",
    coverage: "complete",
    hardRiskFlags,
    cautionFlags,
    holderConcentrationPct: topHolderPct(data.holders),
    buyTaxPct: taxPct(data.buy_tax),
    sellTaxPct: taxPct(data.sell_tax),
  };
}

function normalizeSolanaSecurity(data: Record<string, unknown>): CopyTradeTokenSecurity {
  const hardRiskFlags: string[] = [];
  if (flag(data.non_transferable) || flag(data.none_transferable)) {
    hardRiskFlags.push("non-transferable");
  }
  const creators = Array.isArray(data.creators) ? data.creators.map(asRecord).filter(Boolean) : [];
  if (creators.some((creator) => flag(creator?.malicious_address))) hardRiskFlags.push("malicious-creator");
  const cautionFlags: string[] = [];
  if (nestedStatus(data.closable)) cautionFlags.push("closable-authority");
  if (nestedStatus(data.freezable)) cautionFlags.push("freeze-authority");
  if (nestedStatus(data.mintable)) cautionFlags.push("mintable");
  if (nestedStatus(data.metadata_mutable)) cautionFlags.push("mutable-metadata");
  if (Array.isArray(data.transfer_hook) && data.transfer_hook.length) cautionFlags.push("transfer-hook");
  if (nestedStatus(data.transfer_hook_upgradable)) cautionFlags.push("upgradable-transfer-hook");
  return {
    provider: "goplus",
    coverage: "complete",
    hardRiskFlags,
    cautionFlags,
    holderConcentrationPct: topHolderPct(data.holders),
    buyTaxPct: null,
    sellTaxPct: null,
  };
}

function unavailableSecurity(): CopyTradeTokenSecurity {
  return {
    provider: "goplus",
    coverage: "unavailable",
    hardRiskFlags: [],
    cautionFlags: [],
    holderConcentrationPct: null,
    buyTaxPct: null,
    sellTaxPct: null,
  };
}

function topHolderPct(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const percentages = value
    .map(asRecord)
    .map((holder) => numeric(holder?.percent))
    .filter((percent): percent is number => percent != null && percent >= 0);
  if (!percentages.length) return null;
  const top = Math.max(...percentages);
  return round(top <= 1 ? top * 100 : top, 2);
}

function taxPct(value: unknown): number | null {
  const parsed = numeric(recordValue(value));
  if (parsed == null) return null;
  return round(parsed <= 1 ? parsed * 100 : parsed, 2);
}

function nestedStatus(value: unknown): boolean {
  return flag(asRecord(value)?.status);
}

function flag(value: unknown): boolean {
  const actual = recordValue(value);
  return actual === true || actual === 1 || actual === "1" || actual === "true";
}

function recordValue(value: unknown): unknown {
  const record = asRecord(value);
  return record && "value" in record ? record.value : value;
}

function numeric(value: unknown): number | null {
  const parsed = Number(recordValue(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function maxDrawdownPct(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }
  return maxDrawdown;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

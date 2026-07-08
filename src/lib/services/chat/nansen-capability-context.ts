import { nansenCredentialStatus, NANSEN_API_KEY_ENV } from "@/lib/services/nansen";

const NANSEN_STATUS_TTL_MS = 30_000;

let statusCache: { configured: boolean; checkedAt: number } | null = null;

async function nansenConfigured(): Promise<boolean> {
  const now = Date.now();
  if (statusCache && now - statusCache.checkedAt < NANSEN_STATUS_TTL_MS) return statusCache.configured;
  const status = await nansenCredentialStatus();
  const configured = status.configured;
  statusCache = { configured, checkedAt: now };
  return configured;
}

export function clearNansenCapabilityContextCache() {
  statusCache = null;
}

export const NANSEN_HIVEMIND_INTEGRATION_FACTS = [
  "Nansen is a read/analysis capability for onchain intelligence in HivemindOS: token briefs, wallet/portfolio briefs, Hyperliquid context, market scout briefs, simple template workflows, complex template workflows, and Nansen Agent research. It informs decisions; it does not execute trades or move funds.",
  "Use POST /api/nansen/token-brief before token buys/swaps; POST /api/nansen/wallet-brief for wallet due diligence; POST /api/nansen/hyperliquid-brief before Hyperliquid orders; POST /api/nansen/market-scout for discovery; POST /api/nansen/simple-template for DeFi positions, Smart Money holdings, token top holders, and token screener discovery; POST /api/nansen/complex-template for token tracking, Hyperliquid wallet discovery, related-wallet clustering, top-wallet token research, and CEX-health monitoring; POST /api/nansen/agent for managed or BYOK Nansen Agent research.",
  "Simple template ids are defi-positions, smart-money-holdings, token-top-holders, and token-screener-discovery.",
  "Complex template ids are token-tracking-smart-money, hyperliquid-wallet-discovery, related-wallets-scale, top-wallet-copytrade-research, and cex-health-monitor.",
  "Authentication prefers NANSEN_API_KEY from shared hive env. If no key is configured, routes use HivemindOS hosted credits through the managed Nansen broker; direct Nansen x402 is not the HivemindOS cloud product path.",
  "Compliance rule: return derived HivemindOS analysis, not raw Smart Money tables, real-time feeds, public trader leaderboards, or copy-trading signals. Attribute displayed Nansen-derived data when the route source says attribution is required.",
] as const;

export async function buildNansenCapabilityContext(): Promise<string> {
  const configured = await nansenConfigured();
  const header = configured
    ? "Nansen capability briefing (configured through shared env):"
    : `Nansen capability briefing (${NANSEN_API_KEY_ENV} is not set; managed cloud requires hosted HivemindOS credits):`;
  return [
    header,
    ...NANSEN_HIVEMIND_INTEGRATION_FACTS.map((fact) => `- ${fact}`),
  ].join("\n");
}

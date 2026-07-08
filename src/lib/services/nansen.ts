import "server-only";

import { hiveEnvPresence, hiveEnvValue, type HiveEnvPresence } from "@/lib/services/shared-hive-env";
import { HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID } from "@/lib/config/hivemindos-wallet-paid-models";
import { resolvePooledHivemindosModelCreditToken } from "@/lib/services/hivemindos-model-credit-vault";
import { managedNansenBaseUrl } from "@/lib/services/paid-agent-cloud-client";

export const NANSEN_API_KEY_ENV = "NANSEN_API_KEY";
export const NANSEN_API_BASE_URL = "https://api.nansen.ai";
export const NANSEN_MCP_URL = "https://mcp.nansen.ai/ra/mcp";
export const NANSEN_MANAGED_CREDIT_SLUG = "default";

export type NansenBriefKind = "token" | "wallet" | "hyperliquid" | "market-scout" | "agent" | "simple-template" | "complex-template";
export type NansenTransport = "api-key" | "managed-cloud";
export type NansenRedistributionStatus = "allowed" | "attribution-required" | "restricted" | "prohibited" | "internal-only";
export type NansenSimpleTemplateId =
  | "defi-positions"
  | "smart-money-holdings"
  | "token-top-holders"
  | "token-screener-discovery";
export type NansenComplexTemplateId =
  | "token-tracking-smart-money"
  | "hyperliquid-wallet-discovery"
  | "related-wallets-scale"
  | "top-wallet-copytrade-research"
  | "cex-health-monitor";

export type NansenEndpointDefinition = {
  id: string;
  path: string;
  label: string;
  category: "search" | "portfolio" | "profiler" | "token" | "smart-money" | "hyperliquid" | "agent";
  credits: number;
  redistribution: NansenRedistributionStatus;
  attributionRequired: boolean;
  note: string;
};

export const NANSEN_ENDPOINTS = {
  search: {
    id: "search",
    path: "/api/v1/search/general",
    label: "Search",
    category: "search",
    credits: 0,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Search tokens, entities, and addresses.",
  },
  portfolioDefiHoldings: {
    id: "portfolio-defi-holdings",
    path: "/api/v1/portfolio/defi-holdings",
    label: "DeFi holdings",
    category: "portfolio",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Wallet DeFi positions, rewards, and protocol summaries.",
  },
  addressCurrentBalance: {
    id: "address-current-balance",
    path: "/api/v1/profiler/address/current-balance",
    label: "Address current balance",
    category: "profiler",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Current wallet token balances.",
  },
  addressPnlSummary: {
    id: "address-pnl-summary",
    path: "/api/v1/profiler/address/pnl-summary",
    label: "Address PnL summary",
    category: "profiler",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Realized wallet trading summary and top trades.",
  },
  addressCounterparties: {
    id: "address-counterparties",
    path: "/api/v1/profiler/address/counterparties",
    label: "Address counterparties",
    category: "profiler",
    credits: 5,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Top counterparties for a wallet or entity.",
  },
  addressRelatedWallets: {
    id: "address-related-wallets",
    path: "/api/v1/profiler/address/related-wallets",
    label: "Related wallets",
    category: "profiler",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "First-degree related wallet relationships.",
  },
  addressTransactions: {
    id: "address-transactions",
    path: "/api/v1/profiler/address/transactions",
    label: "Address transactions",
    category: "profiler",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Recent address transaction activity.",
  },
  addressHistoricalBalances: {
    id: "address-historical-balances",
    path: "/api/v1/profiler/address/historical-balances",
    label: "Address historical balances",
    category: "profiler",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Historical address balance movements for clustering and flow validation.",
  },
  addressLabels: {
    id: "address-labels",
    path: "/api/v1/profiler/address/labels",
    label: "Address labels",
    category: "profiler",
    credits: 1,
    redistribution: "prohibited",
    attributionRequired: true,
    note: "Non-premium address labels; use only as transformed research, not raw label redistribution.",
  },
  addressPremiumLabels: {
    id: "address-premium-labels",
    path: "/api/v1/profiler/address/premium-labels",
    label: "Address premium labels",
    category: "profiler",
    credits: 1,
    redistribution: "prohibited",
    attributionRequired: true,
    note: "Address labels including premium categories; use only as transformed research, not raw label redistribution.",
  },
  smartMoneyNetflow: {
    id: "smart-money-netflow",
    path: "/api/v1/smart-money/netflow",
    label: "Smart Money netflow",
    category: "smart-money",
    credits: 5,
    redistribution: "restricted",
    attributionRequired: true,
    note: "Smart Money token netflow analysis for transformed internal research.",
  },
  smartMoneyDexTrades: {
    id: "smart-money-dex-trades",
    path: "/api/v1/smart-money/dex-trades",
    label: "Smart Money DEX trades",
    category: "smart-money",
    credits: 5,
    redistribution: "restricted",
    attributionRequired: true,
    note: "Recent Smart Money DEX trades; use only as transformed research, not raw feeds.",
  },
  smartMoneyHoldings: {
    id: "smart-money-holdings",
    path: "/api/v1/smart-money/holdings",
    label: "Smart Money holdings",
    category: "smart-money",
    credits: 5,
    redistribution: "restricted",
    attributionRequired: true,
    note: "Aggregated Smart Money token holdings; use only as transformed research, not raw feeds.",
  },
  tokenScreener: {
    id: "token-screener",
    path: "/api/v1/token-screener",
    label: "Token screener",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Multi-chain token screening and discovery.",
  },
  tokenInformation: {
    id: "token-information",
    path: "/api/v1/tgm/token-information",
    label: "Token information",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Token market cap, volume, holder, and trader stats.",
  },
  tokenIndicators: {
    id: "token-indicators",
    path: "/api/v1/tgm/indicators",
    label: "Token indicators",
    category: "token",
    credits: 5,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Risk and reward indicators for a token.",
  },
  tokenFlows: {
    id: "token-flows",
    path: "/api/v1/tgm/flows",
    label: "Token flows",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Token inflow and outflow aggregates.",
  },
  tokenFlowIntelligence: {
    id: "token-flow-intelligence",
    path: "/api/v1/tgm/flow-intelligence",
    label: "Flow intelligence",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Segmented token flow summary.",
  },
  tokenPnlLeaderboard: {
    id: "token-pnl-leaderboard",
    path: "/api/v1/tgm/pnl-leaderboard",
    label: "TGM PnL leaderboard",
    category: "token",
    credits: 5,
    redistribution: "prohibited",
    attributionRequired: true,
    note: "Internal-only token PnL leaderboard; never expose raw trader rankings.",
  },
  tokenHolders: {
    id: "token-holders",
    path: "/api/v1/tgm/holders",
    label: "TGM holders",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Token holder distribution and smart-money holder segments.",
  },
  tokenWhoBoughtSold: {
    id: "token-who-bought-sold",
    path: "/api/v1/tgm/who-bought-sold",
    label: "Who bought/sold",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Recent token buyer/seller aggregates.",
  },
  tokenDexTrades: {
    id: "token-dex-trades",
    path: "/api/v1/tgm/dex-trades",
    label: "Token DEX trades",
    category: "token",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "DEX trading activity for a token.",
  },
  tokenOhlcv: {
    id: "token-ohlcv",
    path: "/api/v1/tgm/token-ohlcv",
    label: "Token OHLCV",
    category: "token",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Unified OHLCV price data.",
  },
  perpScreener: {
    id: "perp-screener",
    path: "/api/v1/perp-screener",
    label: "Perp screener",
    category: "hyperliquid",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Hyperliquid perp market discovery.",
  },
  perpLeaderboard: {
    id: "perp-leaderboard",
    path: "/api/v1/perp-leaderboard",
    label: "Perp leaderboard",
    category: "hyperliquid",
    credits: 5,
    redistribution: "prohibited",
    attributionRequired: true,
    note: "Internal-only leaderboard; do not redistribute raw rankings.",
  },
  addressPerpPositions: {
    id: "address-perp-positions",
    path: "/api/v1/profiler/perp-positions",
    label: "Address perp positions",
    category: "hyperliquid",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Current Hyperliquid positions, PnL, and health for a wallet.",
  },
  addressPerpTrades: {
    id: "address-perp-trades",
    path: "/api/v1/profiler/perp-trades",
    label: "Address perp trades",
    category: "hyperliquid",
    credits: 1,
    redistribution: "allowed",
    attributionRequired: false,
    note: "Hyperliquid trade history for a wallet.",
  },
  tokenPerpPositions: {
    id: "token-perp-positions",
    path: "/api/v1/tgm/perp-positions",
    label: "Token perp positions",
    category: "hyperliquid",
    credits: 5,
    redistribution: "restricted",
    attributionRequired: true,
    note: "Perp token open-position lens; use only as transformed internal signal.",
  },
  tokenPerpTrades: {
    id: "token-perp-trades",
    path: "/api/v1/tgm/perp-trades",
    label: "Token perp trades",
    category: "hyperliquid",
    credits: 1,
    redistribution: "attribution-required",
    attributionRequired: true,
    note: "Trading history for a perp token.",
  },
  agentFast: {
    id: "agent-fast",
    path: "/api/v1/agent/fast",
    label: "Nansen Agent fast",
    category: "agent",
    credits: 200,
    redistribution: "internal-only",
    attributionRequired: true,
    note: "Low-latency streamed Nansen research agent.",
  },
  agentExpert: {
    id: "agent-expert",
    path: "/api/v1/agent/expert",
    label: "Nansen Agent expert",
    category: "agent",
    credits: 750,
    redistribution: "internal-only",
    attributionRequired: true,
    note: "Deep streamed Nansen research agent.",
  },
} as const satisfies Record<string, NansenEndpointDefinition>;

export type NansenEndpointKey = keyof typeof NANSEN_ENDPOINTS;

export type NansenManagedBillingContext = {
  creditSlug?: string;
  creditToken?: string;
  legacyAccountIds?: string[];
  idempotencyKey?: string;
};

export type NansenCallOptions = {
  timeoutMs?: number;
};

export type NansenUpstreamCall = {
  endpoint: NansenEndpointDefinition;
  mode: NansenTransport;
  status: number;
  ok: boolean;
  body: unknown;
};

type PlannedNansenCall = {
  key: NansenEndpointKey;
  body: Record<string, unknown>;
  options?: NansenCallOptions;
};

export type NansenBriefMetric = {
  label: string;
  value: string;
};

export type NansenBriefCard = {
  title: string;
  summary: string;
  metrics: NansenBriefMetric[];
  observations: string[];
  endpoint: string;
  redistribution: NansenRedistributionStatus;
};

export type NansenBriefSource = {
  label: string;
  endpoint: string;
  credits: number;
  mode?: NansenTransport;
  attributionRequired: boolean;
  redistribution: NansenRedistributionStatus;
  note: string;
};

export type NansenInsightBrief = {
  kind: NansenBriefKind;
  generatedAt: string;
  subject: string;
  status: "ok" | "partial" | "blocked";
  summary: string;
  cards: NansenBriefCard[];
  riskFlags: string[];
  nextQuestions: string[];
  sources: NansenBriefSource[];
  attribution: {
    required: boolean;
    text: string;
    reason: string;
  };
  compliance: string[];
  billing?: Record<string, unknown>;
};

export type NansenTokenBriefInput = {
  chain?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  date?: DateRangeInput;
  includeTrades?: boolean;
  includeIndicators?: boolean;
  billing?: NansenManagedBillingContext;
};

export type NansenWalletBriefInput = {
  address: string;
  chain?: string;
  date?: DateRangeInput;
  includeTransactions?: boolean;
  billing?: NansenManagedBillingContext;
};

export type NansenHyperliquidBriefInput = {
  address?: string;
  tokenSymbol?: string;
  date?: DateRangeInput;
  includeLeaderboard?: boolean;
  billing?: NansenManagedBillingContext;
};

export type NansenMarketScoutInput = {
  chains?: string[];
  date?: DateRangeInput;
  filters?: Record<string, unknown>;
  orderBy?: Array<{ field: string; direction: "ASC" | "DESC" }>;
  billing?: NansenManagedBillingContext;
};

export type NansenSimpleTemplateInput = {
  template: NansenSimpleTemplateId;
  chain?: string;
  chains?: string[];
  tokenAddress?: string;
  address?: string;
  date?: DateRangeInput;
  timeframe?: string;
  filters?: Record<string, unknown>;
  orderBy?: Array<{ field: string; direction: "ASC" | "DESC" }>;
  aggregateByEntity?: boolean;
  labelType?: string;
  premiumLabels?: boolean;
  billing?: NansenManagedBillingContext;
};

export type NansenComplexTemplateInput = {
  template: NansenComplexTemplateId;
  chain?: string;
  chains?: string[];
  tokenAddress?: string;
  tokenSymbol?: string;
  address?: string;
  entityName?: string;
  date?: DateRangeInput;
  timeframe?: string;
  filters?: Record<string, unknown>;
  includeLabels?: boolean;
  includeTransactions?: boolean;
  includeHistoricalBalances?: boolean;
  includePnlSummary?: boolean;
  billing?: NansenManagedBillingContext;
};

export type NansenAgentResearchInput = {
  text: string;
  mode?: "fast" | "expert";
  conversationId?: string;
  billing?: NansenManagedBillingContext;
};

export type NansenAgentResearchResult = {
  ok: boolean;
  mode: "fast" | "expert";
  text: string;
  conversationId?: string;
  toolCalls: string[];
  events: Array<Record<string, unknown>>;
  brief?: NansenInsightBrief;
  billing?: Record<string, unknown>;
};

type DateRangeInput = {
  from?: string;
  to?: string;
};

const NANSEN_ATTRIBUTION_TEXT = "Powered by Nansen API";
const DEFAULT_CHAINS = ["base", "ethereum", "solana"];

export async function nansenCredentialStatus(): Promise<{
  configured: boolean;
  credentials: HiveEnvPresence[];
  apiBaseUrl: string;
  mcpUrl: string;
  managedCloud: {
    supported: boolean;
    baseUrl: string;
    creditSlug: string;
    creditConfigured: boolean;
    note: string;
  };
  endpoints: NansenBriefSource[];
  compliance: string[];
}> {
  const credentials = await hiveEnvPresence([NANSEN_API_KEY_ENV]);
  const apiKeyConfigured = credentials.some((item) => item.present);
  const managedBaseUrl = managedNansenBaseUrl();
  const managedCreditToken = await resolvePooledHivemindosModelCreditToken(
    NANSEN_MANAGED_CREDIT_SLUG,
    [HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID],
  ).catch(() => "");
  return {
    configured: apiKeyConfigured || Boolean(managedCreditToken),
    credentials,
    apiBaseUrl: NANSEN_API_BASE_URL,
    mcpUrl: NANSEN_MCP_URL,
    managedCloud: {
      supported: Boolean(managedBaseUrl),
      baseUrl: managedBaseUrl,
      creditSlug: NANSEN_MANAGED_CREDIT_SLUG,
      creditConfigured: Boolean(managedCreditToken),
      note: "BYOK NANSEN_API_KEY takes precedence. Without BYOK, HivemindOS uses hosted credits against the HivemindOS-managed Nansen broker; direct Nansen x402 is not the cloud product path.",
    },
    endpoints: Object.values(NANSEN_ENDPOINTS).map((endpoint) => sourceForEndpoint(endpoint)),
    compliance: nansenComplianceNotes(),
  };
}

export async function buildNansenTokenBrief(input: NansenTokenBriefInput): Promise<NansenInsightBrief> {
  if (!(await nansenApiKey())) return callManagedNansenBrief("token-brief", input);

  const chain = cleanChain(input.chain);
  const tokenAddress = cleanText(input.tokenAddress);
  const tokenSymbol = cleanText(input.tokenSymbol);
  const subject = tokenAddress || tokenSymbol || "token discovery";
  const calls: Promise<NansenUpstreamCall>[] = [];

  if (tokenAddress) {
    calls.push(nansenPost("tokenInformation", tokenBody(chain, tokenAddress, input.date)));
    calls.push(nansenPost("tokenFlowIntelligence", tokenBody(chain, tokenAddress, input.date)));
    calls.push(nansenPost("tokenWhoBoughtSold", tokenBody(chain, tokenAddress, input.date)));
    calls.push(nansenPost("tokenOhlcv", tokenBody(chain, tokenAddress, input.date)));
    if (input.includeTrades) calls.push(nansenPost("tokenDexTrades", tokenBody(chain, tokenAddress, input.date)));
    if (input.includeIndicators) calls.push(nansenPost("tokenIndicators", tokenBody(chain, tokenAddress, input.date)));
  } else {
    if (tokenSymbol) calls.push(nansenPost("search", searchBody(tokenSymbol, chain)));
    calls.push(nansenPost("tokenScreener", tokenScreenerBody({
      chains: chain ? [chain] : DEFAULT_CHAINS,
      date: input.date,
    })));
  }

  const results = await settleNansenCalls(calls);
  return buildBrief({
    kind: "token",
    subject,
    results,
    emptySummary: tokenAddress
      ? "Nansen did not return token intelligence for this token."
      : "Nansen did not return token discovery results.",
    nextQuestions: [
      "Should the hive compare this with local wallet exposure before a trade?",
      "Should we ask for a Hyperliquid-specific read if this token has perp liquidity?",
      "Do you want a human-readable thesis that combines Nansen with news, price, and social context?",
    ],
  });
}

export async function buildNansenWalletBrief(input: NansenWalletBriefInput): Promise<NansenInsightBrief> {
  const address = cleanText(input.address);
  if (!address) throw new Error("address is required.");
  if (!(await nansenApiKey())) return callManagedNansenBrief("wallet-brief", input);

  const chain = cleanChain(input.chain);
  const body = {
    wallet_address: address,
    address,
    ...(chain ? { chain } : {}),
    ...(input.date ? { date: input.date } : {}),
    pagination: { page: 1, per_page: 25 },
  };
  const calls = [
    nansenPost("portfolioDefiHoldings", { wallet_address: address }),
    nansenPost("addressCurrentBalance", body),
    nansenPost("addressPnlSummary", body),
    nansenPost("addressCounterparties", body),
    nansenPost("addressRelatedWallets", body),
  ];
  if (input.includeTransactions) {
    calls.push(nansenPost("addressTransactions", body));
  }
  const results = await settleNansenCalls(calls);
  return buildBrief({
    kind: "wallet",
    subject: shortAddress(address),
    results,
    emptySummary: "Nansen did not return wallet portfolio or profiler data for this address.",
    nextQuestions: [
      "Should the hive compare this wallet with HivemindOS' local wallet ledger?",
      "Should this wallet be treated as a watch-only counterparty or as an acting wallet?",
      "Do you want a DeFi risk pass focused on borrow health, protocol concentration, and liquidation exposure?",
    ],
  });
}

export async function buildNansenHyperliquidBrief(input: NansenHyperliquidBriefInput): Promise<NansenInsightBrief> {
  if (!(await nansenApiKey())) return callManagedNansenBrief("hyperliquid-brief", input);

  const address = cleanText(input.address);
  const tokenSymbol = cleanText(input.tokenSymbol).toUpperCase();
  const calls: Promise<NansenUpstreamCall>[] = [];
  const date = input.date;

  if (address) {
    const body = { address, ...(date ? { date } : {}), pagination: { page: 1, per_page: 25 } };
    calls.push(nansenPost("addressPerpPositions", body));
    calls.push(nansenPost("addressPerpTrades", body));
  }
  if (tokenSymbol) {
    const body = { token_symbol: tokenSymbol, ...(date ? { date } : {}), pagination: { page: 1, per_page: 25 } };
    calls.push(nansenPost("tokenPerpTrades", body));
    calls.push(nansenPost("tokenPerpPositions", body));
  }
  if (!address && !tokenSymbol) {
    calls.push(nansenPost("perpScreener", {
      date,
      pagination: { page: 1, per_page: 25 },
      order_by: [{ field: "volume_usd", direction: "DESC" }],
    }));
  }
  if (input.includeLeaderboard) {
    calls.push(nansenPost("perpLeaderboard", {
      date,
      pagination: { page: 1, per_page: 10 },
      order_by: [{ field: "total_pnl", direction: "DESC" }],
    }, { timeoutMs: 45_000 }));
  }

  const results = await settleNansenCalls(calls);
  return buildBrief({
    kind: "hyperliquid",
    subject: address ? shortAddress(address) : tokenSymbol || "Hyperliquid market",
    results,
    emptySummary: "Nansen did not return Hyperliquid position or market data for this request.",
    nextQuestions: [
      "Should the hive compare this with the local Hyperliquid account before placing an order?",
      "Should leverage, liquidation distance, or concentration limits block this trade?",
      "Do you want a no-trade thesis, a hedge idea, or a watch-only alert?",
    ],
  });
}

export async function buildNansenMarketScout(input: NansenMarketScoutInput = {}): Promise<NansenInsightBrief> {
  if (!(await nansenApiKey())) return callManagedNansenBrief("market-scout", input);

  const chains = input.chains?.map(cleanChain).filter(Boolean) as string[] | undefined;
  const body = tokenScreenerBody({
    chains: chains?.length ? chains : DEFAULT_CHAINS,
    date: input.date,
    filters: input.filters,
    orderBy: input.orderBy,
  });
  const results = await settleNansenCalls([
    nansenPost("tokenScreener", body),
    nansenPost("perpScreener", {
      date: input.date,
      pagination: { page: 1, per_page: 20 },
      order_by: [{ field: "volume_usd", direction: "DESC" }],
    }),
  ]);

  return buildBrief({
    kind: "market-scout",
    subject: (chains?.length ? chains : DEFAULT_CHAINS).join(", "),
    results,
    emptySummary: "Nansen did not return market scout data for this request.",
    nextQuestions: [
      "Should the hive turn this into a daily scheduled scout brief?",
      "Should we cross-check candidates against the selected wallet's current exposure?",
      "Should we combine this with social/news/git/activity data before making a trade plan?",
    ],
  });
}

export async function buildNansenSimpleTemplateBrief(input: NansenSimpleTemplateInput): Promise<NansenInsightBrief> {
  if (!(await nansenApiKey())) return callManagedNansenBrief("simple-template", input);

  const plan = simpleTemplatePlan(input);
  if ("error" in plan) throw new Error(plan.error);
  const results = await settleNansenCalls(plan.calls.map((call) => nansenPost(call.key, call.body, call.options)));
  return buildBrief({
    kind: "simple-template",
    subject: plan.subject,
    results,
    emptySummary: plan.emptySummary,
    nextQuestions: plan.nextQuestions,
    compliance: plan.compliance,
  });
}

export async function buildNansenComplexTemplateBrief(input: NansenComplexTemplateInput): Promise<NansenInsightBrief> {
  if (!(await nansenApiKey())) return callManagedNansenBrief("complex-template", input);

  const plan = complexTemplatePlan(input);
  if ("error" in plan) throw new Error(plan.error);
  const results = await settleNansenCalls(plan.calls.map((call) => nansenPost(call.key, call.body, call.options)));
  return buildBrief({
    kind: "complex-template",
    subject: plan.subject,
    results,
    emptySummary: plan.emptySummary,
    nextQuestions: plan.nextQuestions,
    compliance: plan.compliance,
  });
}

export async function runNansenAgentResearch(input: NansenAgentResearchInput): Promise<NansenAgentResearchResult> {
  const text = cleanText(input.text);
  if (!text) throw new Error("text is required.");
  const mode = input.mode === "expert" ? "expert" : "fast";
  const apiKey = await nansenApiKey();
  if (!apiKey) {
    const brief = await callManagedNansenBrief("agent", input);
    return {
      ok: true,
      mode,
      text: brief.summary,
      conversationId: input.conversationId,
      toolCalls: brief.sources.map((source) => source.label),
      events: [],
      brief,
      billing: brief.billing,
    };
  }
  const endpoint = mode === "expert" ? NANSEN_ENDPOINTS.agentExpert : NANSEN_ENDPOINTS.agentFast;
  const response = await fetch(`${NANSEN_API_BASE_URL}${endpoint.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "text/event-stream, application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      text,
      ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    }),
    signal: AbortSignal.timeout(mode === "expert" ? 120_000 : 60_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Nansen Agent ${mode} failed with HTTP ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
  }
  const streamText = await response.text();
  return parseNansenAgentSse(streamText, mode);
}

export function parseNansenAgentSse(streamText: string, mode: "fast" | "expert" = "fast"): NansenAgentResearchResult {
  const events: Array<Record<string, unknown>> = [];
  const toolCalls = new Set<string>();
  const chunks: string[] = [];
  let conversationId = "";

  for (const rawLine of streamText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!isRecord(parsed)) continue;
      event = parsed;
    } catch {
      continue;
    }
    events.push(event);
    if (event.type === "delta" && typeof event.text === "string") chunks.push(event.text);
    if (event.type === "tool_call" && typeof event.name === "string") toolCalls.add(event.name);
    if (event.type === "finish") {
      if (typeof event.conversation_id === "string") conversationId = event.conversation_id;
      if (Array.isArray(event.tool_calls)) {
        for (const item of event.tool_calls) {
          if (typeof item === "string") toolCalls.add(item);
          else if (isRecord(item) && typeof item.name === "string") toolCalls.add(item.name);
        }
      }
    }
    if (event.type === "error") {
      const error = typeof event.error === "string" ? event.error : "Nansen Agent returned an error event.";
      throw new Error(error);
    }
  }

  return {
    ok: true,
    mode,
    text: chunks.join("").trim(),
    conversationId: conversationId || undefined,
    toolCalls: [...toolCalls],
    events,
  };
}

async function nansenPost(
  key: NansenEndpointKey,
  body: Record<string, unknown>,
  options: NansenCallOptions = {},
): Promise<NansenUpstreamCall> {
  const endpoint = NANSEN_ENDPOINTS[key];
  if (!endpoint) throw new Error(`Unknown Nansen endpoint: ${key}`);
  const apiKey = await nansenApiKey();
  if (apiKey) return callNansenWithApiKey(endpoint, body, apiKey, options.timeoutMs);
  throw new Error(`Set ${NANSEN_API_KEY_ENV} or add HivemindOS hosted credits to use managed Nansen cloud for ${endpoint.label}.`);
}

async function callNansenWithApiKey(
  endpoint: NansenEndpointDefinition,
  body: Record<string, unknown>,
  apiKey: string,
  timeoutMs = 45_000,
): Promise<NansenUpstreamCall> {
  const response = await fetch(`${NANSEN_API_BASE_URL}${endpoint.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = await parseResponseBody(response);
  return {
    endpoint,
    mode: "api-key",
    status: response.status,
    ok: response.ok,
    body: parsed,
  };
}

async function callManagedNansenBrief(
  action: "token-brief" | "wallet-brief" | "hyperliquid-brief" | "market-scout" | "agent" | "simple-template" | "complex-template",
  input: object & { billing?: NansenManagedBillingContext },
): Promise<NansenInsightBrief> {
  const baseUrl = managedNansenBaseUrl();
  if (!baseUrl) {
    throw new Error(`Set ${NANSEN_API_KEY_ENV} or configure the HivemindOS managed Nansen cloud endpoint.`);
  }
  const billing = input.billing;
  const creditSlug = managedCreditSlug(billing?.creditSlug);
  const creditToken = cleanText(billing?.creditToken)
    || await resolvePooledHivemindosModelCreditToken(creditSlug, billing?.legacyAccountIds ?? [HIVEMINDOS_SHARED_MODEL_CREDIT_ACCOUNT_ID]);
  if (!creditToken) {
    throw new Error(`Set ${NANSEN_API_KEY_ENV} or add HivemindOS hosted credits for managed Nansen cloud.`);
  }

  const body = { ...(input as Record<string, unknown>) };
  delete body.billing;
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-HivemindOS-Credit-Token": creditToken,
  });
  const idempotencyKey = cleanText(billing?.idempotencyKey);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

  const response = await fetch(`${baseUrl}/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(action === "agent" ? 130_000 : 90_000),
  });
  const payload = await parseResponseBody(response);
  const record = isRecord(payload) ? payload : {};
  if (!response.ok) {
    const error = typeof record.error === "string" ? record.error : `Managed Nansen cloud failed with HTTP ${response.status}.`;
    throw new Error(error);
  }
  if (!isRecord(record.brief)) {
    throw new Error("Managed Nansen cloud response did not include a brief.");
  }
  const billingRecord = isRecord(record.billing) ? record.billing : undefined;
  return {
    ...(record.brief as NansenInsightBrief),
    billing: billingRecord,
  };
}

async function nansenApiKey() {
  return hiveEnvValue(NANSEN_API_KEY_ENV).catch(() => "");
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 8000);
  }
}

function simpleTemplatePlan(input: NansenSimpleTemplateInput): {
  subject: string;
  calls: PlannedNansenCall[];
  emptySummary: string;
  nextQuestions: string[];
  compliance: string[];
} | { error: string } {
  const template = cleanText(input.template) as NansenSimpleTemplateId;
  if (!template) return { error: "template is required." };
  if (template === "defi-positions") return defiPositionsPlan(input);
  if (template === "smart-money-holdings") return smartMoneyHoldingsPlan(input);
  if (template === "token-top-holders") return tokenTopHoldersPlan(input);
  if (template === "token-screener-discovery") return tokenScreenerDiscoveryPlan(input);
  return { error: `Unknown Nansen simple template: ${template}` };
}

function defiPositionsPlan(input: NansenSimpleTemplateInput) {
  const address = cleanText(input.address);
  if (!address) return { error: "address is required for defi-positions." };
  const calls: PlannedNansenCall[] = [
    { key: "portfolioDefiHoldings", body: { wallet_address: address } },
  ];
  return {
    subject: `DeFi positions for ${shortAddress(address)}`,
    calls,
    emptySummary: "Nansen did not return DeFi position data for this wallet.",
    nextQuestions: [
      "Should the hive compare these DeFi positions with the selected wallet's local balance view?",
      "Should borrow, debt, reward, and protocol concentration risks be reviewed before action?",
      "Should this wallet become a watch-only portfolio monitor?",
    ],
    compliance: ["Template source: Nansen simple use case, viewing DeFi positions."],
  };
}

function smartMoneyHoldingsPlan(input: NansenSimpleTemplateInput) {
  const chain = cleanChain(input.chain);
  const chains = selectedChains(input.chains, chain);
  const calls: PlannedNansenCall[] = [
    {
      key: "smartMoneyHoldings",
      body: {
        chains,
        filters: {
          include_smart_money_labels: ["Fund", "Smart Trader", "30D Smart Trader"],
          include_stablecoins: false,
          ...(input.filters ?? {}),
        },
        pagination: { page: 1, per_page: 25 },
        order_by: input.orderBy?.length ? input.orderBy : [{ field: "value_usd", direction: "DESC" }],
      },
    },
  ];
  return {
    subject: `Smart Money holdings on ${chains.join(", ")}`,
    calls,
    emptySummary: "Nansen did not return Smart Money holdings for this request.",
    nextQuestions: [
      "Should the hive compare these holdings with Smart Money netflow before forming a thesis?",
      "Should stablecoins, majors, or a specific token segment be included or excluded?",
      "Should this become a scheduled watchlist for accumulation changes?",
    ],
    compliance: ["Template source: Nansen simple use case, viewing Smart Money holdings."],
  };
}

function tokenTopHoldersPlan(input: NansenSimpleTemplateInput) {
  const chain = cleanChain(input.chain) || "ethereum";
  const tokenAddress = cleanText(input.tokenAddress);
  if (!tokenAddress) return { error: "tokenAddress is required for token-top-holders." };
  const labelType = cleanText(input.labelType) || "all_holders";
  const calls: PlannedNansenCall[] = [
    {
      key: "tokenHolders",
      body: {
        chain,
        token_address: tokenAddress,
        aggregate_by_entity: input.aggregateByEntity === true,
        label_type: labelType,
        premium_labels: input.premiumLabels !== false,
        filters: input.filters ?? {},
        pagination: { page: 1, per_page: 25 },
        order_by: input.orderBy?.length ? input.orderBy : [{ field: "value_usd", direction: "DESC" }],
      },
    },
  ];
  return {
    subject: `top holders for ${tokenAddress} on ${chain}`,
    calls,
    emptySummary: "Nansen did not return token holder data for this request.",
    nextQuestions: [
      "Should top holders be compared with recent token flows before making a trade plan?",
      "Should labels be interpreted as probabilistic context rather than ownership proof?",
      "Should wallet exposure and concentration limits be checked before acting?",
    ],
    compliance: ["Template source: Nansen simple use case, finding top holders of a token."],
  };
}

function tokenScreenerDiscoveryPlan(input: NansenSimpleTemplateInput) {
  const chain = cleanChain(input.chain);
  const chains = selectedChains(input.chains, chain);
  const calls: PlannedNansenCall[] = [
    {
      key: "tokenScreener",
      body: tokenScreenerBody({
        chains,
        date: input.date,
        timeframe: cleanText(input.timeframe) || "24h",
        filters: input.filters ?? { token_age_days: { max: 7 } },
        orderBy: input.orderBy?.length ? input.orderBy : [{ field: "market_cap_usd", direction: "DESC" }],
      }),
    },
  ];
  return {
    subject: `token screener discovery on ${chains.join(", ")}`,
    calls,
    emptySummary: "Nansen did not return token screener candidates for this request.",
    nextQuestions: [
      "Should the hive filter the candidates by liquidity, age, holder count, or Smart Money activity?",
      "Should any candidate be expanded into a full token brief before a swap?",
      "Should this become a daily discovery brief?",
    ],
    compliance: ["Template source: Nansen simple use case, using Token Screener to find new tokens."],
  };
}

function complexTemplatePlan(input: NansenComplexTemplateInput): {
  subject: string;
  calls: PlannedNansenCall[];
  emptySummary: string;
  nextQuestions: string[];
  compliance: string[];
} | { error: string } {
  const template = cleanText(input.template) as NansenComplexTemplateId;
  if (!template) return { error: "template is required." };
  if (template === "token-tracking-smart-money") return tokenTrackingSmartMoneyPlan(input);
  if (template === "hyperliquid-wallet-discovery") return hyperliquidWalletDiscoveryPlan(input);
  if (template === "related-wallets-scale") return relatedWalletsScalePlan(input);
  if (template === "top-wallet-copytrade-research") return topWalletCopytradeResearchPlan(input);
  if (template === "cex-health-monitor") return cexHealthMonitorPlan(input);
  return { error: `Unknown Nansen complex template: ${template}` };
}

function tokenTrackingSmartMoneyPlan(input: NansenComplexTemplateInput) {
  const chain = cleanChain(input.chain);
  const chains = selectedChains(input.chains, chain);
  const tokenAddress = cleanText(input.tokenAddress);
  const tokenSymbol = cleanText(input.tokenSymbol);
  const calls: PlannedNansenCall[] = [
    { key: "tokenScreener", body: tokenScreenerBody({ chains, date: input.date, filters: input.filters }) },
    {
      key: "smartMoneyNetflow",
      body: {
        chains,
        filters: {
          include_smart_money_labels: ["Fund", "Smart Trader", "30D Smart Trader"],
          market_cap_usd: { min: 1_000_000 },
          trader_count: { min: 5 },
          ...(input.filters ?? {}),
        },
        pagination: { page: 1, per_page: 10 },
        order_by: [{ field: "net_flow_7d_usd", direction: "DESC" }],
      },
    },
  ];
  if (tokenSymbol) calls.unshift({ key: "search", body: searchBody(tokenSymbol, chain) });
  if (tokenAddress) {
    calls.push({
      key: "tokenPnlLeaderboard",
      body: tokenPnlLeaderboardBody(chain || chains[0], tokenAddress, input.date),
      options: { timeoutMs: 60_000 },
    });
  }
  return {
    subject: tokenAddress || tokenSymbol || `token tracking on ${chains.join(", ")}`,
    calls,
    emptySummary: "Nansen did not return token-tracking or Smart Money analysis for this template.",
    nextQuestions: [
      "Should the hive compare the candidates with local wallet exposure before any swap?",
      "Should we add price, liquidity, and news context before turning this into a trade thesis?",
      "Should this become a scheduled token discovery brief?",
    ],
    compliance: ["Template source: Nansen complex use case 1, automated token tracking and Smart Money analysis."],
  };
}

function hyperliquidWalletDiscoveryPlan(input: NansenComplexTemplateInput) {
  const address = cleanText(input.address);
  const date = input.date ?? defaultDateRangeDays(7);
  const tradeDate = input.date ?? defaultIsoRangeHours(24);
  const calls: PlannedNansenCall[] = [
    {
      key: "perpLeaderboard",
      body: {
        date,
        filters: input.filters ?? { total_pnl: { min: 0 } },
        pagination: { page: 1, per_page: 10 },
        order_by: [{ field: "total_pnl", direction: "DESC" }],
      },
      options: { timeoutMs: 60_000 },
    },
  ];
  if (address) {
    calls.push({ key: "addressPerpPositions", body: { address, order_by: [{ field: "position_value_usd", direction: "DESC" }] } });
    calls.push({
      key: "addressPerpTrades",
      body: {
        address,
        date: tradeDate,
        pagination: { page: 1, per_page: 10 },
        order_by: [{ field: "timestamp", direction: "DESC" }],
      },
    });
  }
  return {
    subject: address ? `Hyperliquid wallet discovery for ${shortAddress(address)}` : "Hyperliquid wallet discovery",
    calls,
    emptySummary: "Nansen did not return Hyperliquid leaderboard, position, or trade data for this template.",
    nextQuestions: [
      "Should the hive turn this into a watch-only alert list instead of a trade?",
      "Should local Hyperliquid account exposure, leverage, and liquidation distance be checked?",
      "Do you want a no-trade risk memo for the selected wallets?",
    ],
    compliance: [
      "Template source: Nansen complex use case 2, Hyperliquid wallet discovery.",
      "HivemindOS treats copytrade templates as read-only research and never auto-executes copied trades.",
    ],
  };
}

function relatedWalletsScalePlan(input: NansenComplexTemplateInput) {
  const address = cleanText(input.address);
  if (!address) return { error: "address is required for related-wallets-scale." };
  const chain = cleanChain(input.chain) || "ethereum";
  const date = input.date ?? defaultDateRangeDays(7);
  const base = { address, chain, date };
  const calls: PlannedNansenCall[] = [];
  if (input.includeLabels !== false) {
    calls.push({
      key: "addressPremiumLabels",
      body: { address, chain, pagination: { page: 1, per_page: 25 } },
    });
  }
  calls.push({ key: "addressRelatedWallets", body: { address, chain, pagination: { page: 1, per_page: 25 } } });
  calls.push({
    key: "addressCounterparties",
    body: {
      ...base,
      group_by: "wallet",
      source_input: "Combined",
      filters: input.filters ?? { total_volume_usd: { min: 10_000 } },
      order_by: [{ field: "total_volume_usd", direction: "DESC" }],
      pagination: { page: 1, per_page: 25 },
    },
  });
  if (input.includeHistoricalBalances !== false) {
    calls.push({
      key: "addressHistoricalBalances",
      body: { ...base, filters: input.filters ?? { value_usd: { min: 1_000 } }, pagination: { page: 1, per_page: 25 } },
    });
  }
  if (input.includeTransactions !== false) {
    calls.push({
      key: "addressTransactions",
      body: { ...base, filters: input.filters ?? { volume_usd: { min: 5_000 } }, pagination: { page: 1, per_page: 25 } },
    });
  }
  return {
    subject: `related-wallet clustering for ${shortAddress(address)} on ${chain}`,
    calls,
    emptySummary: "Nansen did not return related-wallet clustering data for this template.",
    nextQuestions: [
      "Should the hive build a watch-only relationship graph from these signals?",
      "Should CEX deposit overlap and timing similarities be reviewed manually?",
      "Should premium labels be cross-checked with counterparty and transaction patterns?",
    ],
    compliance: [
      "Template source: Nansen complex use case 3, identifying related wallets at scale.",
      "Wallet clustering is probabilistic context; do not assert ownership without independent evidence.",
    ],
  };
}

function topWalletCopytradeResearchPlan(input: NansenComplexTemplateInput) {
  const chain = cleanChain(input.chain) || "ethereum";
  const chains = selectedChains(input.chains, chain);
  const tokenAddress = cleanText(input.tokenAddress);
  if (!tokenAddress) return { error: "tokenAddress is required for top-wallet-copytrade-research." };
  const address = cleanText(input.address);
  const date = input.date ?? defaultDateRangeDays(90);
  const calls: PlannedNansenCall[] = [
    { key: "tokenFlowIntelligence", body: { chain, token_address: tokenAddress, timeframe: cleanText(input.timeframe) || "7d" } },
    { key: "tokenPnlLeaderboard", body: tokenPnlLeaderboardBody(chain, tokenAddress, date), options: { timeoutMs: 60_000 } },
    {
      key: "smartMoneyDexTrades",
      body: {
        chains,
        filters: {
          token_bought_address: tokenAddress,
          trade_value_usd: { min: 10_000 },
          include_smart_money_labels: ["Smart Trader", "Fund"],
          ...(input.filters ?? {}),
        },
        pagination: { page: 1, per_page: 25 },
      },
    },
    {
      key: "tokenHolders",
      body: {
        chain,
        token_address: tokenAddress,
        label_type: "smart_money",
        filters: {
          include_smart_money_labels: ["Smart Trader", "Fund", "30D Smart Trader"],
          ...(input.filters ?? {}),
        },
        pagination: { page: 1, per_page: 25 },
      },
    },
  ];
  if (address || input.includePnlSummary) {
    if (!address) return { error: "address is required when includePnlSummary is true." };
    calls.push({ key: "addressPnlSummary", body: { address, chain, date } });
  }
  return {
    subject: `top-wallet token research for ${tokenAddress} on ${chain}`,
    calls,
    emptySummary: "Nansen did not return top-wallet token research data for this template.",
    nextQuestions: [
      "Should the hive turn these signals into a manual review checklist?",
      "Should local wallet exposure and maximum position limits be checked before any action?",
      "Should the selected token be compared against alternatives in a market scout?",
    ],
    compliance: [
      "Template source: Nansen complex use case 4, top-performing wallet copytrade research.",
      "HivemindOS returns watch-only research, not raw copy-trading signals or automated copied trades.",
    ],
  };
}

function cexHealthMonitorPlan(input: NansenComplexTemplateInput) {
  const entityName = cleanText(input.entityName) || "Coinbase";
  const flowChain = cleanChain(input.chain) || "base";
  const date = input.date ?? defaultIsoRangeHours(24);
  const calls: PlannedNansenCall[] = [
    {
      key: "addressCurrentBalance",
      body: {
        entity_name: entityName,
        chain: "all",
        hide_spam_token: true,
        pagination: { page: 1, per_page: 25 },
      },
    },
    {
      key: "addressCounterparties",
      body: {
        entity_name: entityName,
        chain: flowChain,
        date,
        group_by: "entity",
        source_input: "Combined",
        pagination: { page: 1, per_page: 25 },
      },
    },
  ];
  return {
    subject: `${entityName} CEX health on ${flowChain}`,
    calls,
    emptySummary: "Nansen did not return CEX balance or counterparty flow data for this template.",
    nextQuestions: [
      "Should the hive compare this with prior daily snapshots?",
      "Should this become a scheduled CEX-health monitor?",
      "Should the result be narrowed to specific assets or chains?",
    ],
    compliance: ["Template source: Nansen complex use case 5, monitoring CEX health."],
  };
}

function tokenPnlLeaderboardBody(chain: string | undefined, tokenAddress: string, date?: DateRangeInput) {
  return {
    ...(chain ? { chain } : {}),
    token_address: tokenAddress,
    date: date ?? defaultDateRangeDays(90),
    pagination: { page: 1, per_page: 25 },
    filters: {
      holding_usd: { min: 1_000 },
      pnl_usd_realised: { min: 0 },
    },
    order_by: [{ field: "pnl_usd_realised", direction: "DESC" }],
  };
}

async function settleNansenCalls(calls: Promise<NansenUpstreamCall>[]) {
  const settled = await Promise.allSettled(calls);
  return settled.map((item) => item.status === "fulfilled"
    ? { ok: true as const, value: item.value }
    : { ok: false as const, error: item.reason instanceof Error ? item.reason.message : String(item.reason) });
}

function buildBrief(input: {
  kind: NansenBriefKind;
  subject: string;
  results: Array<{ ok: true; value: NansenUpstreamCall } | { ok: false; error: string }>;
  emptySummary: string;
  nextQuestions: string[];
  compliance?: string[];
}): NansenInsightBrief {
  const successful = input.results.filter((item): item is { ok: true; value: NansenUpstreamCall } => item.ok && item.value.ok);
  const failed = input.results.filter((item) => !item.ok || ("value" in item && !item.value.ok));
  const cards = successful.map(({ value }) => cardFromResult(value)).filter((card) => card.summary || card.metrics.length || card.observations.length);
  const sources = successful.map(({ value }) => sourceForEndpoint(value.endpoint, value.mode));
  const attributionRequired = sources.some((source) => source.attributionRequired);
  const status = successful.length && failed.length ? "partial" : successful.length ? "ok" : "blocked";
  const riskFlags = [
    ...riskFlagsFromCards(cards),
    ...failed.map((item) => !item.ok ? item.error : `${item.value.endpoint.label}: HTTP ${item.value.status}`),
  ].slice(0, 8);
  const summary = cards.length
    ? synthesizeBriefSummary(input.kind, input.subject, cards, failed.length)
    : input.emptySummary;
  return {
    kind: input.kind,
    generatedAt: new Date().toISOString(),
    subject: input.subject,
    status,
    summary,
    cards,
    riskFlags,
    nextQuestions: input.nextQuestions,
    sources,
    attribution: {
      required: attributionRequired,
      text: NANSEN_ATTRIBUTION_TEXT,
      reason: attributionRequired ? "At least one Nansen endpoint used here requires attribution when displayed outside personal/internal use." : "The selected endpoints do not require attribution for personal/internal use.",
    },
    compliance: [...nansenComplianceNotes(), ...(input.compliance ?? [])],
  };
}

function cardFromResult(result: NansenUpstreamCall): NansenBriefCard {
  const rows = extractRows(result.body);
  const metrics = metricRows(result.body).slice(0, 8);
  const observations = observationRows(result.body, rows).slice(0, 6);
  const summary = metrics.length
    ? `${result.endpoint.label}: ${metrics.slice(0, 3).map((item) => `${item.label} ${item.value}`).join("; ")}.`
    : observations[0] || `${result.endpoint.label} returned ${rows.length ? `${rows.length} rows` : "a response"}.`;
  return {
    title: result.endpoint.label,
    summary,
    metrics,
    observations,
    endpoint: result.endpoint.path,
    redistribution: result.endpoint.redistribution,
  };
}

function synthesizeBriefSummary(kind: NansenBriefKind, subject: string, cards: NansenBriefCard[], failedCount: number) {
  const labels = cards.map((card) => card.title).join(", ");
  const prefix = kind === "market-scout"
    ? `Nansen market scout for ${subject}`
    : kind === "simple-template"
      ? `Nansen simple-template workflow for ${subject}`
    : kind === "complex-template"
      ? `Nansen complex-template workflow for ${subject}`
    : `Nansen ${kind} brief for ${subject}`;
  return `${prefix} combined ${cards.length} source${cards.length === 1 ? "" : "s"} (${labels})${failedCount ? `; ${failedCount} source${failedCount === 1 ? "" : "s"} failed or were unavailable` : ""}.`;
}

function riskFlagsFromCards(cards: NansenBriefCard[]) {
  const joined = JSON.stringify(cards).toLowerCase();
  const flags: string[] = [];
  if (joined.includes("liquidation")) flags.push("Perp or lending data includes liquidation-sensitive fields; review liquidation distance before trading.");
  if (joined.includes("leverage")) flags.push("Leverage appears in the Nansen response; size limits and wallet policy should be checked before action.");
  if (joined.includes("borrow") || joined.includes("debt")) flags.push("DeFi debt or borrow exposure appears in the response; check health factors and collateral concentration.");
  if (joined.includes("counterpart")) flags.push("Counterparty data is contextual and should be interpreted with attribution and entity-label uncertainty.");
  if (cards.some((card) => card.redistribution === "restricted" || card.redistribution === "prohibited")) {
    flags.push("This brief used restricted/internal-only Nansen data as transformed context; do not expose raw tables, rankings, or wallet lists publicly.");
  }
  return flags;
}

function sourceForEndpoint(endpoint: NansenEndpointDefinition, mode?: NansenTransport): NansenBriefSource {
  return {
    label: endpoint.label,
    endpoint: endpoint.path,
    credits: endpoint.credits,
    mode,
    attributionRequired: endpoint.attributionRequired,
    redistribution: endpoint.redistribution,
    note: endpoint.note,
  };
}

function nansenComplianceNotes() {
  return [
    "Return derived HivemindOS analysis, not raw Smart Money tables, real-time feeds, public trader rankings, or copy-trading signals.",
    "Use Nansen as one input alongside wallet state, market data, news/social, and user policy before any trade recommendation.",
    "BYOK NANSEN_API_KEY calls go straight to Nansen; managed-cloud calls go through the HivemindOS paid-agent gateway and hosted credits.",
    "Show attribution near Nansen-derived displayed data when a source marks attribution required.",
    "Never store or print Nansen API keys; credential status is reported by key name only.",
  ];
}

function tokenBody(chain: string | undefined, tokenAddress: string, date?: DateRangeInput) {
  return {
    ...(chain ? { chain } : {}),
    token_address: tokenAddress,
    ...(date ? { date } : {}),
    pagination: { page: 1, per_page: 25 },
  };
}

function tokenScreenerBody(input: {
  chains?: string[];
  date?: DateRangeInput;
  timeframe?: string;
  filters?: Record<string, unknown>;
  orderBy?: Array<{ field: string; direction: "ASC" | "DESC" }>;
}) {
  return {
    chains: input.chains?.length ? input.chains : DEFAULT_CHAINS,
    ...(input.date ? { date: input.date } : { timeframe: cleanText(input.timeframe) || "24h" }),
    pagination: { page: 1, per_page: 25 },
    filters: input.filters ?? {},
    order_by: input.orderBy?.length ? input.orderBy : [{ field: "volume", direction: "DESC" }],
  };
}

function searchBody(searchQuery: string, chain?: string) {
  return {
    search_query: searchQuery,
    result_type: "token",
    ...(chain ? { chain } : {}),
    limit: 5,
  };
}

function metricRows(payload: unknown): NansenBriefMetric[] {
  const metrics: NansenBriefMetric[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || metrics.length >= 20) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 4)) visit(item, depth + 1);
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, item] of Object.entries(value)) {
      const label = humanLabel(key);
      if (isMetricKey(key) && (typeof item === "number" || typeof item === "string" || typeof item === "boolean")) {
        const display = formatMetricValue(key, item);
        const id = `${label}:${display}`;
        if (!seen.has(id)) {
          seen.add(id);
          metrics.push({ label, value: display });
        }
      } else if (isRecord(item) || Array.isArray(item)) {
        visit(item, depth + 1);
      }
    }
  };
  visit(payload);
  return metrics;
}

function observationRows(payload: unknown, rows = extractRows(payload)) {
  const observations: string[] = [];
  for (const row of rows.slice(0, 8)) {
    if (!isRecord(row)) continue;
    const symbol = firstString(row, ["symbol", "token_symbol", "ticker", "name", "token_name", "protocol_name", "entity_name"]);
    const chain = firstString(row, ["chain", "network"]);
    const value = firstNumber(row, ["value_usd", "usd_value", "total_value_usd", "volume_usd", "market_cap_usd", "position_value_usd", "total_pnl", "pnl_usd_realised"]);
    const direction = firstString(row, ["side", "direction", "action", "position_side"]);
    const parts = [
      symbol || "row",
      chain ? `on ${chain}` : "",
      direction ? `(${direction})` : "",
      Number.isFinite(value) ? formatUsd(value) : "",
    ].filter(Boolean);
    if (parts.length) observations.push(parts.join(" "));
  }
  if (!observations.length && rows.length) observations.push(`Returned ${rows.length} row${rows.length === 1 ? "" : "s"} for inspection.`);
  return observations;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ["data", "result", "results", "items", "rows", "tokens", "protocols", "transactions", "trades", "positions", "holdings"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = extractRows(value);
      if (nested.length) return nested;
    }
  }
  return [payload];
}

function isMetricKey(key: string) {
  return /(usd|price|market|volume|liquidity|holder|trader|pnl|roi|value|balance|debt|borrow|supply|count|health|leverage|liquidation|reward|protocol|token)/i.test(key);
}

function formatMetricValue(key: string, value: string | number | boolean) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    if (/(usd|price|market|volume|liquidity|pnl|value|debt|borrow|reward)/i.test(key)) return formatUsd(value);
    if (/(roi|percent|pct|ratio)/i.test(key)) return `${round(value)}%`;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
  }
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (/(usd|price|market|volume|liquidity|pnl|value|debt|borrow|reward)/i.test(key)) return formatUsd(numeric);
  }
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function firstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(numeric)) return numeric;
  }
  return NaN;
}

function humanLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\busd\b/i, "USD")
    .replace(/\bpnl\b/i, "PnL")
    .replace(/\broi\b/i, "ROI")
    .replace(/^\w/, (char) => char.toUpperCase());
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanChain(value: unknown) {
  const text = cleanText(value).toLowerCase();
  return text || undefined;
}

function selectedChains(chains: unknown, fallback?: string) {
  const cleaned = Array.isArray(chains)
    ? chains.map(cleanChain).filter((chain): chain is string => Boolean(chain))
    : [];
  if (cleaned.length) return cleaned;
  if (fallback) return [fallback];
  return DEFAULT_CHAINS;
}

function defaultDateRangeDays(days: number): DateRangeInput {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: dateOnly(from), to: dateOnly(to) };
}

function defaultIsoRangeHours(hours: number): DateRangeInput {
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shortAddress(address: string) {
  return address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function managedCreditSlug(value: unknown) {
  const normalized = cleanText(value).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || NANSEN_MANAGED_CREDIT_SLUG;
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 100 ? 0 : abs >= 1 ? 2 : 6;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value);
}

function round(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

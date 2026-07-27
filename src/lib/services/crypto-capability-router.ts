import "server-only";

import type { AgentPaymentProvider, AgentSpendCapAsset, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { AGENT_PAYMENT_PROVIDER_FEATURES, agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import { BANKR_ACTION_CONFIRMATION } from "@/lib/services/bankr-actions";
import { VEIL_CASH_NETWORK, VEIL_CASH_TRANSFER_CONFIRMATION_LABEL } from "@/lib/config/veil-cash";
import { anyHiveEnvPresent, hiveEnvPresence, type HiveEnvPresence } from "@/lib/services/shared-hive-env";
import { getWalletInfo } from "@/lib/services/wallet/local-wallet-vault";
import { resolveVeilCliPath, resolveVeilMcpPath } from "@/lib/services/wallet/veil-cli";
import { buildClearSigningReview, type ClearSigningReview } from "@/lib/services/crypto/clear-signing";
import { isCrosschainCryptoIntent, planCrosschainIntent, type CrosschainIntentPlan } from "@/lib/services/crypto/crosschain-intents";
import { quoteTradingPlatformFee, type PlatformFeeQuote } from "@/lib/services/wallet/platform-fees";
import {
  HYPERLIQUID_ORDER_CONFIRMATION,
  hyperliquidPolicyPresence,
  readHyperliquidBuilderConfig,
} from "@/lib/services/trading/hyperliquid";

export type CryptoCapabilityIntent =
  | "status"
  | "portfolio"
  | "receive"
  | "send"
  | "private-transfer"
  | "paid-api"
  | "private-paid-api"
  | "trade"
  | "crosschain-swap"
  | "bridge"
  | "crosschain-payment"
  | "token-launch"
  | "polymarket"
  | "hyperliquid"
  | "automation"
  | "nft"
  | "agent-job"
  | "claim-fees"
  | "card-payment"
  | "fund-llm-credits";

export type CryptoCapabilityProvider = Exclude<AgentPaymentProvider, "manual" | "clawcard"> | "hyperliquid";

export type CryptoRouteMode = "read" | "prepare" | "execute";

export type CryptoProviderCapability = {
  provider: CryptoCapabilityProvider;
  label: string;
  summary: string;
  intents: CryptoCapabilityIntent[];
  ready: boolean;
  configured: boolean;
  spendReady: boolean;
  requiresApproval: boolean;
  missing: string[];
  evidence: string[];
  credentials: HiveEnvPresence[];
  endpoints: Array<{
    intent: CryptoCapabilityIntent;
    method?: string;
    route?: string;
    skill?: string;
    note: string;
  }>;
};

export type CryptoCapabilityMap = {
  generatedAt: string;
  agentId?: string;
  intent?: CryptoCapabilityIntent;
  selected?: CryptoProviderCapability;
  providers: CryptoProviderCapability[];
  sideEffects: string[];
  gaps: string[];
};

export type CryptoPreparedAction = {
  intent: CryptoCapabilityIntent;
  provider: CryptoCapabilityProvider;
  ready: boolean;
  mode: CryptoRouteMode;
  endpoint?: {
    method?: string;
    route?: string;
    skill?: string;
  };
  requestBody: Record<string, unknown>;
  requiresApproval: boolean;
  confirmation?: string;
  missing: string[];
  guidance: string;
  review?: ClearSigningReview;
  crosschainPlan?: CrosschainIntentPlan;
  platformFee?: PlatformFeeQuote;
};

export type CryptoCapabilityRouterInput = {
  agentId?: string;
  wallet?: Partial<AgentWalletConfig>;
  intent?: CryptoCapabilityIntent;
  preferredProvider?: CryptoCapabilityProvider;
  amountUsd?: number;
  asset?: AgentSpendCapAsset;
  prompt?: string;
  live?: boolean;
};

/**
 * Single provider matrix for the crypto capability router. Each row declares
 * what a provider can do (`intents`), which shared-env keys configure it by
 * name (`envKeys`), and which intents are hard-gated behind the provider's
 * confirmation label. Provider intent lists, credential checks, confirmation
 * labels, and approval gating all derive from these rows; adding a provider
 * means adding one row plus its capability probe, not editing scattered maps.
 */
type CryptoProviderMatrixRow = {
  envKeys: readonly string[];
  intents: readonly CryptoCapabilityIntent[];
  confirmationLabel?: string;
  gatedIntents?: readonly CryptoCapabilityIntent[];
};

const BANKR_GATED_INTENTS = [
  "trade",
  "crosschain-swap",
  "bridge",
  "crosschain-payment",
  "token-launch",
  "polymarket",
  "hyperliquid",
  "automation",
  "nft",
  "agent-job",
  "claim-fees",
] as const satisfies readonly CryptoCapabilityIntent[];

const CRYPTO_PROVIDER_MATRIX: Record<CryptoCapabilityProvider, CryptoProviderMatrixRow> = {
  bankr: {
    envKeys: ["BANKR_API_KEY", "BANKR_LLM_KEY", "BANKR_MANAGEMENT_KEY"],
    intents: ["status", "portfolio", ...BANKR_GATED_INTENTS, "fund-llm-credits"],
    confirmationLabel: BANKR_ACTION_CONFIRMATION,
    gatedIntents: BANKR_GATED_INTENTS,
  },
  moneyclaw: {
    envKeys: ["MONEYCLAW_API_KEY"],
    intents: ["status", "portfolio", "receive", "send", "paid-api", "card-payment"],
  },
  x402: {
    envKeys: [],
    intents: ["status", "portfolio", "receive", "send", "paid-api"],
  },
  usepod: {
    envKeys: ["USEPOD_TOKEN"],
    intents: ["status", "receive", "paid-api"],
  },
  venice: {
    envKeys: ["VENICE_API_KEY"],
    intents: ["status", "paid-api"],
  },
  veil: {
    envKeys: ["VEIL_KEY"],
    intents: ["status", "receive", "send", "private-transfer", "paid-api", "private-paid-api"],
  },
  hyperliquid: {
    envKeys: [],
    intents: ["status", "hyperliquid"],
    confirmationLabel: HYPERLIQUID_ORDER_CONFIRMATION,
    gatedIntents: ["hyperliquid"],
  },
};

/**
 * Per-intent provider ORDER only — capability comes from the matrix above
 * (selection filters by declared intents before this order applies).
 */
const ROUTE_PRIORITY: Record<CryptoCapabilityIntent, CryptoCapabilityProvider[]> = {
  status: ["moneyclaw", "x402", "veil", "usepod", "venice", "hyperliquid", "bankr"],
  portfolio: ["bankr", "moneyclaw", "x402"],
  receive: ["moneyclaw", "x402", "usepod", "veil"],
  send: ["x402", "moneyclaw", "veil"],
  "private-transfer": ["veil"],
  "paid-api": ["veil", "x402", "usepod", "venice", "moneyclaw"],
  "private-paid-api": ["veil"],
  trade: ["bankr"],
  "crosschain-swap": ["bankr"],
  bridge: ["bankr"],
  "crosschain-payment": ["bankr"],
  "token-launch": ["bankr"],
  polymarket: ["bankr"],
  hyperliquid: ["hyperliquid", "bankr"],
  automation: ["bankr"],
  nft: ["bankr"],
  "agent-job": ["bankr"],
  "claim-fees": ["bankr"],
  "card-payment": ["moneyclaw"],
  "fund-llm-credits": ["bankr"],
};

// ROUTE_PRIORITY must only order providers that declare the intent in their
// matrix row — drift is dead config at best (selection filters by declared
// intents first) and a misleading capability map at worst. The previous
// hand-maintained pair had exactly this drift (usepod listed for portfolio).
for (const [intent, providersForIntent] of Object.entries(ROUTE_PRIORITY) as Array<[CryptoCapabilityIntent, CryptoCapabilityProvider[]]>) {
  for (const provider of providersForIntent) {
    if (!CRYPTO_PROVIDER_MATRIX[provider].intents.includes(intent)) {
      const message = `ROUTE_PRIORITY lists ${provider} for ${intent}, which its CRYPTO_PROVIDER_MATRIX row does not declare`;
      if (process.env.NODE_ENV !== "production") throw new Error(message);
      console.warn(message);
    }
  }
}

export function normalizeCryptoIntent(value: unknown): CryptoCapabilityIntent {
  if (typeof value !== "string") return "status";
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "private" || normalized === "private-send" || normalized === "private-payment") return "private-transfer";
  if (normalized === "x402" || normalized === "paid-api-call" || normalized === "paywall") return "paid-api";
  if (normalized === "private-x402" || normalized === "private-paid-api-call") return "private-paid-api";
  if (normalized === "bankr-llm" || normalized === "llm-credits") return "fund-llm-credits";
  if (isCrosschainCryptoIntent(normalized)) return normalized.includes("payment") ? "crosschain-payment" : normalized.includes("bridge") ? "bridge" : "crosschain-swap";
  if (normalized === "swap" || normalized === "swaps" || normalized === "trading") return "trade";
  if (normalized === "token" || normalized === "launch" || normalized === "deploy-token") return "token-launch";
  if (normalized === "poly" || normalized === "prediction-market" || normalized === "prediction-markets") return "polymarket";
  if (normalized === "hyper" || normalized === "perp" || normalized === "perps" || normalized === "leverage") return "hyperliquid";
  if (normalized === "automations" || normalized === "recurring" || normalized === "dca" || normalized === "twap") return "automation";
  if (normalized === "nfts") return "nft";
  if (normalized === "bankr-agent" || normalized === "agent-api" || normalized === "job") return "agent-job";
  if (normalized === "claim" || normalized === "claim-fee" || normalized === "fees" || normalized === "creator-fees" || normalized === "claim-creator-fees") return "claim-fees";
  if (isCryptoCapabilityIntent(normalized)) return normalized;
  return "status";
}

export function normalizeCryptoProvider(value: unknown): CryptoCapabilityProvider | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "money-claw") return "moneyclaw";
  if (normalized === "hl" || normalized === "hyper-liquid") return "hyperliquid";
  if (isCryptoCapabilityProvider(normalized)) return normalized;
  return undefined;
}

export async function getCryptoCapabilityMap(input: CryptoCapabilityRouterInput = {}): Promise<CryptoCapabilityMap> {
  const intent = input.intent ? normalizeCryptoIntent(input.intent) : undefined;
  const providers = await Promise.all([
    bankrCapability(),
    moneyClawCapability(input.wallet),
    x402Capability(input),
    podProviderCapability(input.wallet),
    veniceCapability(input.wallet),
    veilCapability(input),
    hyperliquidCapability(input),
  ]);
  const selected = selectCryptoProvider(providers, intent, input.preferredProvider);
  return {
    generatedAt: new Date().toISOString(),
    agentId: input.agentId,
    intent,
    selected,
    providers,
    sideEffects: [
      "Any send, trade, token launch, Polymarket bet, Hyperliquid position, NFT mutation, automation, paid API call, card payment, private transfer, or LLM credit funding is a spend or state-changing action.",
      "The router only selects and prepares; execution stays with the existing provider endpoint or skill approval gate.",
      "Private x402 requires explicit reviewed confirmation; Veil private transfers require reviewed confirmation unless that wallet's Veil auto-send policy is on and the prepared send stays under the wallet cap.",
      "Crosschain routes are modeled as intents first; Bankr is the active provider path while LI.FI and Open Intents stay explicit planned provider slots until adapters are configured.",
      "Prepared actions include a clear-signing review so agents can show amount, network, recipient, endpoint, risks, and confirmation text before execution.",
    ],
    gaps: providers.flatMap((provider) => provider.missing.map((missing) => `${provider.label}: ${missing}`)),
  };
}

export async function prepareCryptoAction(input: CryptoCapabilityRouterInput & {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  recipientAddress?: string;
  amount?: number | string;
  fromChain?: string;
  toChain?: string;
  fromAsset?: string;
  toAsset?: string;
}): Promise<CryptoPreparedAction> {
  const intent = normalizeCryptoIntent(input.intent);
  // Personal (`user:`) wallets never auto-spend. An explicit, per-action request
  // ("send X from my wallet") still works — it just always requires a fresh
  // human confirmation and never takes the no-human-in-the-loop auto path.
  const isPersonalWallet = String(input.agentId || "").startsWith("user:");
  const capabilityMap = await getCryptoCapabilityMap(input);
  const selected = capabilityMap.selected;
  if (!selected) {
    return {
      intent,
      provider: input.preferredProvider ?? "x402",
      ready: false,
      mode: "prepare",
      requestBody: {},
      requiresApproval: true,
      missing: [`No configured provider can satisfy ${intent}.`],
      guidance: "Check /api/crypto/capabilities for provider readiness, then configure one of the listed rails.",
    };
  }

  const endpoint = selected.endpoints.find((item) => item.intent === intent) ?? selected.endpoints[0];
  const requestBody = requestBodyForIntent(selected.provider, intent, input);
  // Personal wallets never take the auto-send/auto-pay bypass and always require
  // a fresh per-action confirmation (mode stays "prepare", never "execute").
  const autoSendPrivateTransfer = !isPersonalWallet && intent === "private-transfer" && canAutoSendVeilTransfer(input.wallet);
  const requiresApproval = isPersonalWallet || (selected.requiresApproval && !autoSendPrivateTransfer) || providerIntentRequiresApproval(intent, selected.provider);
  const confirmation = confirmationForIntent(intent, selected.provider, input.wallet);
  const crosschainPlan = isCrosschainPreparedIntent(intent)
    ? planCrosschainIntent({
      kind: intent,
      preferredProvider: selected.provider,
      fromChain: input.fromChain,
      toChain: input.toChain,
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      amount: input.amount,
      amountUsd: input.amountUsd,
      recipientAddress: input.recipientAddress,
      prompt: input.prompt,
    })
    : undefined;
  const review = buildPreparedActionReview({
    intent,
    provider: selected.provider,
    input,
    requestBody,
    confirmation,
  });
  // Non-breaking safety: flag a recipient that doesn't match the wallet network
  // on a direct send / private transfer (the execute path also rejects it) so a
  // wrong-network paste surfaces in the clear-signing review, not at confirm.
  if ((intent === "send" || intent === "private-transfer") && input.recipientAddress && review) {
    const mismatch = recipientNetworkMismatch(input.recipientAddress, input.wallet?.network);
    if (mismatch) review.risks = [...(review.risks ?? []), { level: "warning", code: "recipient-network-mismatch", message: mismatch }];
  }
  const platformFee = await preparedPlatformFee(intent, input);
  return {
    intent,
    provider: selected.provider,
    ready: selected.ready,
    mode: requiresApproval || !selected.spendReady ? "prepare" : "execute",
    endpoint: endpoint ? { method: endpoint.method, route: endpoint.route, skill: endpoint.skill } : undefined,
    requestBody,
    requiresApproval,
    confirmation,
    missing: selected.missing,
    guidance: guidanceForIntent(intent, selected),
    review,
    crosschainPlan,
    platformFee,
  };
}

function selectCryptoProvider(
  providers: CryptoProviderCapability[],
  intent: CryptoCapabilityIntent | undefined,
  preferredProvider: CryptoCapabilityProvider | undefined,
) {
  const candidates = intent
    ? providers.filter((provider) => provider.intents.includes(intent))
    : providers;
  if (preferredProvider) {
    const preferred = candidates.find((provider) => provider.provider === preferredProvider);
    if (preferred) return preferred;
  }
  const priority = intent ? ROUTE_PRIORITY[intent] : ROUTE_PRIORITY.status;
  return candidates
    .sort((left, right) => {
      if (left.ready !== right.ready) return left.ready ? -1 : 1;
      if (left.configured !== right.configured) return left.configured ? -1 : 1;
      return priority.indexOf(left.provider) - priority.indexOf(right.provider);
    })[0];
}

async function bankrCapability(): Promise<CryptoProviderCapability> {
  const envKeys = CRYPTO_PROVIDER_MATRIX.bankr.envKeys;
  const credentials = await hiveEnvPresence(envKeys);
  const configured = credentials.some((item) => item.present);
  return providerCapability({
    provider: "bankr",
    configured,
    spendReady: configured,
    credentials,
    missing: configured ? [] : [`Set one of ${envKeys.join(", ")}.`],
    evidence: configured ? ["Bankr credential is present by key name."] : [],
    endpoints: [
      { intent: "portfolio", method: "POST", route: "/api/bankr/actions", note: "Read Bankr wallet portfolio with PnL and NFT context." },
      { intent: "trade", method: "POST", route: "/api/bankr/actions", note: "Prepare or execute Bankr swaps/trades through the native approval gate." },
      { intent: "crosschain-swap", method: "POST", route: "/api/bankr/actions", note: "Prepare a crosschain swap intent through Bankr, with LI.FI/Open Intents kept as planned provider slots." },
      { intent: "bridge", method: "POST", route: "/api/bankr/actions", note: "Prepare a bridge/crosschain route draft through Bankr for explicit confirmation." },
      { intent: "crosschain-payment", method: "POST", route: "/api/bankr/actions", note: "Prepare a crosschain payment draft through Bankr for explicit confirmation." },
      { intent: "token-launch", method: "POST", route: "/api/bankr/actions", note: "Prepare a natural-language Bankr token launch for explicit user confirmation." },
      { intent: "polymarket", method: "POST", route: "/api/bankr/actions", note: "Search Polymarket read-only or prepare a Bankr prediction-market action for confirmation." },
      { intent: "hyperliquid", method: "POST", route: "/api/bankr/actions", note: "Read Hyperliquid state or prepare a leverage/spot action for confirmation." },
      { intent: "automation", method: "POST", route: "/api/bankr/actions", note: "Prepare recurring Bankr automations such as DCA, TWAP, limit, stop, or scheduled agent commands." },
      { intent: "nft", method: "POST", route: "/api/bankr/actions", note: "Read NFT data or prepare NFT buy/sell/mint/transfer actions through Bankr." },
      { intent: "agent-job", method: "POST", route: "/api/bankr/actions", note: "Run a Bankr Agent API prompt or inspect an existing Agent API job." },
      { intent: "claim-fees", method: "POST", route: "/api/bankr/actions", note: "Check or claim creator/LP trading fees for a Bankr-launched token; prepared for explicit user confirmation." },
      { intent: "fund-llm-credits", method: "POST", route: "/api/bankr/llm-credits", note: "Requires FUND_BANKR_LLM_CREDITS confirmation." },
    ],
  });
}

async function moneyClawCapability(wallet?: Partial<AgentWalletConfig>): Promise<CryptoProviderCapability> {
  const envName = cleanWalletEnvName(wallet?.moneyClawEnvName) || CRYPTO_PROVIDER_MATRIX.moneyclaw.envKeys[0];
  const credentials = await hiveEnvPresence([envName]);
  const configured = credentials.some((item) => item.present);
  return providerCapability({
    provider: "moneyclaw",
    configured,
    spendReady: configured && walletSpendEnabled(wallet),
    credentials,
    missing: [
      ...(configured ? [] : [`Set ${envName}.`]),
      ...(walletSpendEnabled(wallet) ? [] : ["Wallet Spend/auto-use policy was not supplied or is off."]),
    ],
    evidence: configured ? [`${envName} is present by key name.`] : [],
    endpoints: [
      { intent: "status", method: "GET", route: "/api/wallet/moneyclaw", note: "Read MoneyClaw account, balance, deposit address, and payment intents." },
      { intent: "card-payment", skill: "hivemindos-wallet-rails", note: "Prepare bounded payment tasks; execution remains MoneyClaw-specific." },
      { intent: "paid-api", method: "GET", route: "/api/wallet/moneyclaw", note: "Use when MoneyClaw exposes a matching payment task or intent." },
    ],
  });
}

async function x402Capability(input: CryptoCapabilityRouterInput): Promise<CryptoProviderCapability> {
  const walletInfo = input.agentId ? await getWalletInfo(input.agentId).catch(() => null) : null;
  const configured = Boolean(walletInfo || input.wallet?.vaultAddress || input.wallet?.walletAddress);
  const spendReady = configured && walletSpendEnabled(input.wallet);
  return providerCapability({
    provider: "x402",
    configured,
    spendReady,
    credentials: [],
    missing: [
      ...(configured ? [] : ["Create or import an encrypted local agent wallet."]),
      ...(walletSpendEnabled(input.wallet) ? [] : ["Wallet Spend/auto-use policy was not supplied or is off."]),
    ],
    evidence: [
      ...(walletInfo ? [`Encrypted local wallet exists for ${input.agentId}.`] : []),
      ...(input.wallet?.walletAddress || input.wallet?.vaultAddress ? ["Wallet policy/address supplied by caller."] : []),
    ],
    endpoints: [
      { intent: "paid-api", method: "POST", route: "/api/wallet/x402", note: "Public x402 paid fetch using the encrypted local wallet." },
      { intent: "send", method: "POST", route: "/api/wallet/send", note: "Stablecoin send (USDC, or USDG on Robinhood Chain) with SEND_USDC confirmation unless auto-use is enabled." },
      { intent: "portfolio", method: "POST", route: "/api/wallet/balance", note: "Read-only portfolio/balance check." },
    ],
  });
}

async function podProviderCapability(wallet?: Partial<AgentWalletConfig>): Promise<CryptoProviderCapability> {
  const tokenEnvName = cleanWalletEnvName(wallet?.provider === "usepod" ? undefined : undefined) || CRYPTO_PROVIDER_MATRIX.usepod.envKeys[0];
  const credentials = await hiveEnvPresence([tokenEnvName]);
  const configured = credentials.some((item) => item.present) || Boolean(wallet?.provider === "usepod" && wallet.walletAddress);
  return providerCapability({
    provider: "usepod",
    configured,
    spendReady: configured,
    credentials,
    missing: configured ? [] : [`Set ${tokenEnvName} or finish UsePod setup for the agent.`],
    evidence: [
      ...(credentials.some((item) => item.present) ? [`${tokenEnvName} is present by key name.`] : []),
      ...(wallet?.provider === "usepod" && wallet.walletAddress ? ["UsePod deposit receiver is present in supplied wallet policy."] : []),
    ],
    endpoints: [
      { intent: "status", method: "POST", route: "/api/usepod/status", note: "Read UsePod token status and model availability." },
      { intent: "paid-api", method: "POST", route: "/api/usepod/status", note: "UsePod handles provider-managed paid inference/paywalls from prepaid balance." },
      { intent: "receive", method: "POST", route: "/api/usepod/deposit-transaction", note: "Prepare UsePod deposit transaction." },
    ],
  });
}

async function veniceCapability(wallet?: Partial<AgentWalletConfig>): Promise<CryptoProviderCapability> {
  const veniceEnvKey = CRYPTO_PROVIDER_MATRIX.venice.envKeys[0];
  const credentials = await hiveEnvPresence([veniceEnvKey]);
  const walletConnected = Boolean(wallet?.provider === "venice" && wallet.walletAddress);
  const configured = credentials.some((item) => item.present) || walletConnected;
  return providerCapability({
    provider: "venice",
    configured,
    spendReady: configured,
    credentials,
    missing: configured ? [] : [`Set ${veniceEnvKey} or connect a wallet in Venice setup for the agent.`],
    evidence: [
      ...(credentials.some((item) => item.present) ? [`${veniceEnvKey} is present by key name.`] : []),
      ...(walletConnected ? ["Venice x402 wallet is present in supplied wallet policy."] : []),
    ],
    endpoints: [
      { intent: "status", method: "POST", route: "/api/venice/status", note: "Read Venice auth status, balance, and model availability." },
      { intent: "paid-api", method: "POST", route: "/api/venice/wallet", note: "Venice charges inference to the wallet's prepaid x402 balance; top-ups use Base USDC." },
    ],
  });
}

async function veilCapability(input: CryptoCapabilityRouterInput): Promise<CryptoProviderCapability> {
  const [credentials, cliPath, mcpPath, walletInfo] = await Promise.all([
    anyHiveEnvPresent(CRYPTO_PROVIDER_MATRIX.veil.envKeys),
    resolveVeilCliPath().catch(() => ""),
    resolveVeilMcpPath().catch(() => ""),
    input.agentId ? getWalletInfo(input.agentId).catch(() => null) : Promise.resolve(null),
  ]);
  const configured = credentials.present && Boolean(cliPath);
  const spendReady = configured && walletSpendEnabled(input.wallet) && (input.wallet?.provider === "veil" || input.intent === "private-paid-api" || input.intent === "private-transfer");
  return providerCapability({
    provider: "veil",
    configured,
    spendReady,
    credentials: credentials.keys,
    requiresApproval: true,
    missing: [
      ...(credentials.present ? [] : ["Set VEIL_KEY."]),
      ...(cliPath ? [] : ["Install the Veil CLI."]),
      ...(walletSpendEnabled(input.wallet) ? [] : ["Wallet Spend policy was not supplied or is off."]),
      ...(input.wallet?.provider === "veil" || !input.wallet ? [] : ["Agent wallet provider is not Veil Cash."]),
    ],
    evidence: [
      ...(credentials.present ? ["VEIL_KEY is present by key name."] : []),
      ...(cliPath ? ["Veil CLI is installed."] : []),
      ...(mcpPath ? ["Veil MCP CLI is installed."] : []),
      ...(walletInfo ? [`Encrypted local wallet exists for ${input.agentId}.`] : []),
      ...(input.wallet?.network === VEIL_CASH_NETWORK ? [`Wallet policy is on ${VEIL_CASH_NETWORK}.`] : []),
      ...(canAutoSendVeilTransfer(input.wallet) ? ["Veil auto-send private transfer policy is on for this wallet."] : []),
    ],
    endpoints: [
      { intent: "private-transfer", method: "POST", route: "/api/wallet/veil/transfer", note: canAutoSendVeilTransfer(input.wallet) ? "May execute without CONFIRM after reviewed draft when the wallet cap allows it." : `Requires ${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL} confirmation after user review.` },
      { intent: "private-paid-api", method: "POST", route: "/api/wallet/veil/x402", note: "Private x402 using Veil withdrawal into a fresh payer EOA." },
      { intent: "paid-api", method: "POST", route: "/api/wallet/veil/x402", note: "Selected when Auto Always Private or explicit private wording chooses Veil." },
      { intent: "status", method: "POST", route: "/api/wallet/veil/setup", note: "Setup/status surface for Veil CLI and keys." },
    ],
  });
}

async function hyperliquidCapability(input: CryptoCapabilityRouterInput): Promise<CryptoProviderCapability> {
  const [builderConfig, policy, walletInfo] = await Promise.all([
    readHyperliquidBuilderConfig(),
    hyperliquidPolicyPresence(),
    input.agentId ? getWalletInfo(input.agentId).catch(() => null) : Promise.resolve(null),
  ]);
  const walletAddress = walletInfo?.address || input.wallet?.vaultAddress || input.wallet?.walletAddress;
  const walletNetwork = walletInfo?.network || input.wallet?.network;
  const hasLocalWallet = Boolean(walletInfo);
  const evmWallet = typeof walletNetwork === "string" && walletNetwork.startsWith("eip155:");
  const tradeCapUsd = Number(input.wallet?.maxTradeUsd) > 0
    ? Number(input.wallet?.maxTradeUsd)
    : Number(input.wallet?.maxPaymentUsd) || 0;
  const configured = builderConfig.configured && Boolean(walletAddress) && evmWallet;
  const spendReady = configured && hasLocalWallet && input.wallet?.enabled === true && tradeCapUsd > 0;
  return providerCapability({
    provider: "hyperliquid",
    configured,
    spendReady,
    credentials: policy,
    requiresApproval: true,
    missing: [
      ...builderConfig.missing,
      ...(walletAddress ? [] : ["Create or import an encrypted local EVM wallet."]),
      ...(hasLocalWallet ? [] : ["Hyperliquid execution needs an encrypted local signing wallet, not a watch-only address."]),
      ...(evmWallet ? [] : ["Select an EVM wallet network for Hyperliquid."]),
      ...(input.wallet?.enabled === true ? [] : ["Wallet policy was not supplied or is disabled."]),
      ...(tradeCapUsd > 0 ? [] : ["Set maxTradeUsd or maxPaymentUsd before enabling Hyperliquid execution."]),
    ],
    evidence: [
      ...(builderConfig.configured ? [builderConfig.detail] : []),
      ...(hasLocalWallet ? [`Encrypted local EVM wallet exists for ${input.agentId}.`] : []),
      ...(evmWallet ? [`Wallet network is ${walletNetwork}.`] : []),
      ...(tradeCapUsd > 0 ? [`Wallet trade cap is $${tradeCapUsd.toFixed(2)}.`] : []),
    ],
    endpoints: [
      { intent: "status", method: "GET", route: "/api/trading/hyperliquid", note: "Read Hyperliquid account state, open orders, and builder approval status." },
      { intent: "hyperliquid", method: "POST", route: "/api/trading/hyperliquid", note: "Quote, approve builder fees, trade spot/perps, manage orders, adjust account settings, transfer funds, withdraw, or run TWAPs with action-specific confirmation." },
    ],
  });
}

function providerCapability(input: {
  provider: CryptoCapabilityProvider;
  configured: boolean;
  spendReady: boolean;
  credentials: HiveEnvPresence[];
  missing: string[];
  evidence: string[];
  endpoints: CryptoProviderCapability["endpoints"];
  requiresApproval?: boolean;
}): CryptoProviderCapability {
  const features = input.provider === "hyperliquid"
    ? {
      label: "Hyperliquid",
      summary: "Local Hyperliquid spot/perp trading, order management, transfers, and TWAPs with official builder-policy routing and wallet governance.",
    }
    : agentPaymentProviderFeatures(input.provider);
  return {
    provider: input.provider,
    label: features.label,
    summary: features.summary,
    intents: [...CRYPTO_PROVIDER_MATRIX[input.provider].intents],
    ready: input.configured && input.missing.length === 0,
    configured: input.configured,
    spendReady: input.spendReady,
    requiresApproval: input.requiresApproval ?? !input.spendReady,
    missing: input.missing,
    evidence: input.evidence,
    credentials: input.credentials,
    endpoints: input.endpoints,
  };
}

function requestBodyForIntent(
  provider: CryptoCapabilityProvider,
  intent: CryptoCapabilityIntent,
  input: CryptoCapabilityRouterInput & {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    recipientAddress?: string;
    amount?: number | string;
    fromChain?: string;
    toChain?: string;
    fromAsset?: string;
    toAsset?: string;
  },
) {
  if (intent === "paid-api" || intent === "private-paid-api") {
    return {
      agentId: input.agentId,
      url: input.url,
      method: input.method ?? "GET",
      headers: input.headers,
      body: input.body,
      policy: input.wallet,
      confirmation: confirmationForIntent(intent, provider, input.wallet),
    };
  }
  if (intent === "private-transfer") {
    return {
      agentId: input.agentId,
      enabled: input.wallet?.enabled,
      provider,
      network: input.wallet?.network ?? VEIL_CASH_NETWORK,
      asset: input.asset ?? "USDC",
      recipientAddress: input.recipientAddress,
      amount: input.amount ?? input.amountUsd,
      maxAssetAmount: input.asset ? input.wallet?.assetSpendCaps?.[input.asset] : input.wallet?.maxPaymentUsd,
      confirmation: confirmationForIntent(intent, provider, input.wallet),
      autoShield: true,
    };
  }
  if (intent === "send") {
    return {
      agentId: input.agentId,
      toAddress: input.recipientAddress,
      amountUsd: input.amountUsd,
      maxPaymentUsd: input.wallet?.maxPaymentUsd,
      autoPayEnabled: input.wallet?.autoPayEnabled,
      confirmation: confirmationForIntent(intent, provider, input.wallet),
    };
  }
  if (provider === "hyperliquid" && intent === "hyperliquid") {
    return {
      action: "quote",
      agentId: input.agentId,
      coin: input.prompt,
      notionalUsd: input.amountUsd,
      confirmation: confirmationForIntent(intent, provider, input.wallet),
    };
  }
  if (provider === "bankr" && intent !== "fund-llm-credits") {
    return {
      agentId: input.agentId,
      intent,
      prompt: input.prompt ?? promptForCrosschainIntent(intent, input),
      action: intent === "portfolio" ? "execute" : "prepare",
      confirmation: confirmationForIntent(intent, provider, input.wallet),
    };
  }
  return {
    agentId: input.agentId,
    policy: input.wallet,
  };
}

function guidanceForIntent(intent: CryptoCapabilityIntent, selected: CryptoProviderCapability) {
  if (!selected.ready) return `Configure ${selected.label}: ${selected.missing.join(" ")}`;
  if (intent === "private-transfer") return `Review recipient, asset, amount, and cap, then execute ${selected.endpoints.find((endpoint) => endpoint.intent === intent)?.route}.`;
  if (intent === "paid-api" || intent === "private-paid-api") return `Use ${selected.label} for this paid API call and keep the request under the supplied wallet policy cap.`;
  if (selected.provider === "hyperliquid" && intent === "hyperliquid") return "Use /api/trading/hyperliquid to quote/read first. Builder approval, orders, cancels, account changes, transfers, and TWAPs each require their matching Hyperliquid confirmation.";
  if (selected.provider === "bankr" && intent === "portfolio") return "Use /api/bankr/actions for a read-only Bankr wallet portfolio check.";
  if (selected.provider === "bankr" && providerIntentRequiresApproval(intent, "bankr")) return "Use /api/bankr/actions to prepare the Bankr action; execute only after the user confirms the reviewed draft.";
  return `Use ${selected.label} for ${intent}.`;
}

function confirmationForIntent(intent: CryptoCapabilityIntent, provider: CryptoCapabilityProvider, wallet?: Partial<AgentWalletConfig>) {
  // Intent-scoped labels first (they apply regardless of the routed provider),
  // then the provider matrix's gated-intent label.
  if (intent === "private-transfer") return canAutoSendVeilTransfer(wallet) ? undefined : VEIL_CASH_TRANSFER_CONFIRMATION_LABEL;
  if (intent === "private-paid-api" || (intent === "paid-api" && provider === "veil")) return "VEIL_X402";
  if (intent === "send") return "SEND_USDC";
  if (intent === "fund-llm-credits") return "FUND_BANKR_LLM_CREDITS";
  const row = CRYPTO_PROVIDER_MATRIX[provider];
  if (row.confirmationLabel && row.gatedIntents?.includes(intent)) return row.confirmationLabel;
  return undefined;
}

function canAutoSendVeilTransfer(wallet?: Partial<AgentWalletConfig>) {
  return Boolean(
    wallet?.veilAutoSendEnabled === true
    && wallet.enabled === true
    && wallet.provider === "veil"
    && wallet.network === VEIL_CASH_NETWORK
  );
}

function providerIntentRequiresApproval(intent: CryptoCapabilityIntent, provider: CryptoCapabilityProvider) {
  return Boolean(CRYPTO_PROVIDER_MATRIX[provider].gatedIntents?.includes(intent));
}

function isCrosschainPreparedIntent(intent: CryptoCapabilityIntent) {
  return intent === "crosschain-swap" || intent === "bridge" || intent === "crosschain-payment";
}

function promptForCrosschainIntent(
  intent: CryptoCapabilityIntent,
  input: CryptoCapabilityRouterInput & {
    recipientAddress?: string;
    amount?: number | string;
    fromChain?: string;
    toChain?: string;
    fromAsset?: string;
    toAsset?: string;
  },
) {
  if (!isCrosschainPreparedIntent(intent)) return input.prompt;
  return [
    intent.replace(/-/g, " "),
    input.amount ?? input.amountUsd,
    input.fromAsset,
    input.fromChain ? `from ${input.fromChain}` : undefined,
    input.toAsset,
    input.toChain ? `to ${input.toChain}` : undefined,
    input.recipientAddress ? `recipient ${input.recipientAddress}` : undefined,
  ].filter(Boolean).join(" ");
}

// "" when the recipient looks valid for the wallet network, else a warning. Name
// services (ENS/SNS/Basenames) are allowed through — they resolve server-side.
function recipientNetworkMismatch(addr: string, network?: string): string {
  const to = (addr || "").trim();
  if (!to || !network) return "";
  if (/\.(eth|sol|base|box|cb\.id)$/i.test(to)) return "";
  const isEvm = network.startsWith("eip155:");
  const isSol = network.includes("solana");
  const evmOk = /^0x[a-fA-F0-9]{40}$/.test(to);
  const solOk = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to);
  if (isEvm && !evmOk) return `Recipient ${to} is not a valid address for ${network} — confirm before signing.`;
  if (isSol && !solOk) return `Recipient ${to} is not a valid address for ${network} — confirm before signing.`;
  return "";
}

function buildPreparedActionReview(input: {
  intent: CryptoCapabilityIntent;
  provider: CryptoCapabilityProvider;
  input: CryptoCapabilityRouterInput & {
    url?: string;
    method?: string;
    recipientAddress?: string;
    amount?: number | string;
  };
  requestBody: Record<string, unknown>;
  confirmation?: string;
}) {
  return buildClearSigningReview({
    kind: reviewKindForIntent(input.intent, input.provider),
    intent: input.intent,
    provider: input.provider,
    agentId: input.input.agentId,
    network: input.input.wallet?.network,
    asset: input.input.asset,
    amount: input.input.amount,
    amountUsd: input.input.amountUsd,
    recipientAddress: input.input.recipientAddress,
    url: input.input.url,
    method: input.input.method,
    prompt: input.input.prompt,
    policy: input.input.wallet,
    confirmation: input.confirmation,
    metadata: { requestBody: input.requestBody },
  });
}

async function preparedPlatformFee(inputIntent: CryptoCapabilityIntent, input: CryptoCapabilityRouterInput): Promise<PlatformFeeQuote | undefined> {
  if (inputIntent !== "send") return undefined;
  const network = input.wallet?.network;
  const amountUsd = Number(input.amountUsd);
  if (!network || !Number.isFinite(amountUsd) || amountUsd <= 0) return undefined;
  return quoteTradingPlatformFee({ source: "wallet-send", network, amountUsd });
}

function reviewKindForIntent(intent: CryptoCapabilityIntent, provider?: CryptoCapabilityProvider) {
  if (intent === "paid-api" || intent === "private-paid-api") return "x402";
  if (intent === "private-transfer") return "private-transfer";
  if (intent === "send") return "send";
  if (isCrosschainPreparedIntent(intent)) return "crosschain-intent";
  if (intent === "hyperliquid" && provider === "hyperliquid") return "raw-transaction";
  if (["trade", "token-launch", "polymarket", "hyperliquid", "automation", "nft", "agent-job", "claim-fees", "fund-llm-credits"].includes(intent)) return "bankr-action";
  return "raw-transaction";
}

function walletSpendEnabled(wallet?: Partial<AgentWalletConfig>) {
  return wallet?.enabled === true && wallet.autoPayEnabled === true;
}

function cleanWalletEnvName(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^[A-Z0-9_]+$/.test(trimmed) ? trimmed : "";
}

function isCryptoCapabilityIntent(value: string): value is CryptoCapabilityIntent {
  return [
    "status",
    "portfolio",
    "receive",
    "send",
    "private-transfer",
    "paid-api",
    "private-paid-api",
    "trade",
    "crosschain-swap",
    "bridge",
    "crosschain-payment",
    "token-launch",
    "polymarket",
    "hyperliquid",
    "automation",
    "nft",
    "agent-job",
    "claim-fees",
    "card-payment",
    "fund-llm-credits",
  ].includes(value);
}

function isCryptoCapabilityProvider(value: string): value is CryptoCapabilityProvider {
  if (value === "hyperliquid") return true;
  return Object.keys(AGENT_PAYMENT_PROVIDER_FEATURES)
    .filter((provider) => provider !== "manual" && provider !== "clawcard")
    .includes(value);
}

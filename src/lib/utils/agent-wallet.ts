import type {
  HoneyAgentReward,
  HoneyTreasuryConfig,
  AgentSpendCapAsset,
  AgentSurvivalSnapshot,
  AgentSurvivalTier,
  AgentWalletConfig,
  X402PaymentRequirement,
} from "@/lib/types/agent-wallet";
import type { AgentProfile, UsePodAgentConfig } from "@/lib/types/agent-runtime";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import {
  VEIL_CASH_TRANSFER_CONFIRMATION_LABEL,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
} from "@/lib/config/veil-cash";

export const DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS = 15 * 60;

export const DEFAULT_AGENT_WALLET: Omit<AgentWalletConfig, "agentId"> = {
  enabled: false,
  provider: "moneyclaw",
  walletAddress: "",
  network: "eip155:8453",
  tokenSymbol: "USDC",
  seedBalanceUsd: 0,
  currentBalanceUsd: 0,
  dailyComputeBurnUsd: 0,
  maxPaymentUsd: 0.5,
  assetSpendCaps: {
    ETH: 0.01,
  },
  approvalRequiredOverUsd: 2,
  autoPayEnabled: false,
  duplicatePaymentGuardEnabled: true,
  duplicatePaymentGuardSeconds: DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS,
  clawCardEnvName: "CLAWCARD_API_KEY",
  moneyClawEnvName: "MONEYCLAW_API_KEY",
  x402BaseUrl: "",
  veilAutoPrivateX402: true,
  survivalStartedAt: 0,
  updatedAt: 0,
  notes: "",
  custodyMode: "watch",
  vaultAddress: "",
  onchainBalanceUsd: 0,
  nativeBalance: 0,
  lastOnchainSyncAt: 0,
};

export function assetSpendCapFor(config: Pick<AgentWalletConfig, "assetSpendCaps" | "maxPaymentUsd">, asset: AgentSpendCapAsset): number {
  if (asset === "USDC") return normalizeMoney(config.assetSpendCaps?.USDC, config.maxPaymentUsd);
  const cap = Number(config.assetSpendCaps?.[asset]);
  if (!Number.isFinite(cap)) return asset === "ETH" ? 0.01 : 0;
  return Math.max(0, cap);
}

export const DEFAULT_HONEY_TREASURY_CONFIG: HoneyTreasuryConfig = {
  honeyPerThousandTokens: 0.001,
  tokenPerHoney: 1,
  agentTokenUsage: {},
  agentHoneyExchanged: {},
  agentHiveBalances: {},
  rewardPoolHive: 0,
  rewardPoolRemainingHive: 0,
  rewardPoolEmittedHive: 0,
  rewardPoolExchangedHive: 0,
  rewardPoolUsd: 0,
  rewardPoolVolumeUsd: 0,
  rewardPoolShareOfVolume: 0.000684,
  hivePerMillionTokens: 1,
  hiveTokenAddress: "",
};

// Adapted from Conway-Research/automaton: src/types.ts and src/conway/credits.ts.
// Their runtime thresholds are credit-cents based; this app uses dollars for the local setup ledger.
export const SURVIVAL_THRESHOLDS_USD = {
  high: 5,
  normal: 0.5,
  low_compute: 0.1,
  critical: 0,
  dead: -0.01,
} as const;

export function createDefaultAgentWallet(agentId: string): AgentWalletConfig {
  const now = Date.now();
  return {
    ...DEFAULT_AGENT_WALLET,
    assetSpendCaps: { ...DEFAULT_AGENT_WALLET.assetSpendCaps },
    agentId,
    survivalStartedAt: now,
    updatedAt: now,
  };
}

export function hasWalletBalanceEvidence(config: AgentWalletConfig): boolean {
  return Boolean(
    config.walletAddress.trim()
    || config.vaultAddress?.trim()
    || (config.lastOnchainSyncAt && config.lastOnchainSyncAt > 0)
    || (config.onchainBalanceUsd && config.onchainBalanceUsd > 0)
  );
}

export function stripUnfundedWalletBalance(config: AgentWalletConfig): AgentWalletConfig {
  if (config.enabled || hasWalletBalanceEvidence(config)) return config;
  if (config.currentBalanceUsd <= 0 && config.seedBalanceUsd <= 0) return config;
  return {
    ...config,
    seedBalanceUsd: 0,
    currentBalanceUsd: 0,
    onchainBalanceUsd: 0,
  };
}

export function parseWalletBalanceUsd(value?: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : null;
  const text = value?.trim();
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

export function getUsePodBalanceUsd(config?: UsePodAgentConfig): number | null {
  return parseWalletBalanceUsd(config?.lastBalanceRemaining);
}

function hasUsePodWalletEvidence(config?: UsePodAgentConfig, balance = getUsePodBalanceUsd(config)) {
  return Boolean(
    config?.tokenEnvName
      || config?.depositAddress
      || config?.depositCode
      || config?.dashboardUrl
      || config?.lastTestStatus
      || config?.lastStatusMessage
      || typeof config?.lastModelCount === "number"
      || balance !== null
  );
}

function hasExplicitWalletProvider(wallet?: AgentWalletConfig) {
  if (!wallet) return false;
  if (wallet.providerSelectedAt) return true;
  if (wallet.provider !== DEFAULT_AGENT_WALLET.provider) return true;
  return Boolean(
    wallet.walletAddress.trim()
      || wallet.vaultAddress?.trim()
      || wallet.notes.trim()
      || wallet.x402BaseUrl.trim()
      || wallet.currentBalanceUsd > 0
      || wallet.seedBalanceUsd > 0
      || (wallet.onchainBalanceUsd ?? 0) > 0
      || (wallet.lastOnchainSyncAt ?? 0) > 0
  );
}

export function resolveAgentWallet(agent: Pick<AgentProfile, "id" | "provider" | "usePod">, wallet?: AgentWalletConfig): AgentWalletConfig {
  const base = wallet ?? createDefaultAgentWallet(agent.id);
  const usePodBalance = getUsePodBalanceUsd(agent.usePod);
  const provider = hasExplicitWalletProvider(wallet)
    ? base.provider
    : agent.provider === "usepod" || hasUsePodWalletEvidence(agent.usePod, usePodBalance)
      ? "usepod"
      : base.provider;
  const providerFeatures = agentPaymentProviderFeatures(provider);
  if (providerFeatures.balanceSource !== "usepod-runtime") {
    return base.provider === provider ? base : { ...base, provider };
  }

  const usePod = agent.usePod ?? {};
  const checkedAtMs = Date.parse(usePod.lastCheckedAt ?? "");
  const hasCheckedAt = Number.isFinite(checkedAtMs);
  const setupVisible = hasUsePodWalletEvidence(usePod, usePodBalance);
  return {
    ...base,
    provider: "usepod",
    enabled: base.enabled || setupVisible || (usePodBalance !== null && usePodBalance > 0),
    walletAddress: usePod.depositAddress || base.walletAddress,
    network: "solana:mainnet",
    tokenSymbol: "USDC",
    currentBalanceUsd: usePodBalance ?? base.currentBalanceUsd,
    onchainBalanceUsd: usePodBalance ?? base.onchainBalanceUsd,
    lastOnchainSyncAt: hasCheckedAt ? checkedAtMs : base.lastOnchainSyncAt,
    custodyMode: "watch",
    x402BaseUrl: base.x402BaseUrl || "https://api.usepod.ai",
  };
}

export function getDisplayWalletBalanceUsd(config: AgentWalletConfig, now = Date.now()): number {
  const providerFeatures = agentPaymentProviderFeatures(config.provider);
  if (providerFeatures.balanceSource === "usepod-runtime") {
    return normalizeMoney(config.currentBalanceUsd);
  }
  return hasWalletBalanceEvidence(config) ? getEffectiveBalanceUsd(config, now) : 0;
}

export function normalizeMoney(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.round(numeric * 100) / 100);
}

export function getEffectiveBalanceUsd(config: AgentWalletConfig, now = Date.now()): number {
  if (!config.enabled || config.dailyComputeBurnUsd <= 0 || !config.survivalStartedAt) {
    return normalizeMoney(config.currentBalanceUsd);
  }
  const elapsedDays = Math.max(0, now - config.survivalStartedAt) / 86_400_000;
  return Math.round((config.currentBalanceUsd - elapsedDays * config.dailyComputeBurnUsd) * 100) / 100;
}

export function getSurvivalTierFromUsd(balanceUsd: number): AgentSurvivalTier {
  if (balanceUsd > SURVIVAL_THRESHOLDS_USD.high) return "high";
  if (balanceUsd > SURVIVAL_THRESHOLDS_USD.normal) return "normal";
  if (balanceUsd > SURVIVAL_THRESHOLDS_USD.low_compute) return "low_compute";
  if (balanceUsd >= SURVIVAL_THRESHOLDS_USD.critical) return "critical";
  return "dead";
}

export function getSurvivalSnapshot(config: AgentWalletConfig, now = Date.now()): AgentSurvivalSnapshot {
  const effectiveBalanceUsd = getEffectiveBalanceUsd(config, now);
  const tier = getSurvivalTierFromUsd(effectiveBalanceUsd);
  const daysRemaining = config.dailyComputeBurnUsd > 0
    ? Math.max(0, effectiveBalanceUsd / config.dailyComputeBurnUsd)
    : null;
  const hoursRemaining = daysRemaining == null ? null : daysRemaining * 24;

  const tierHints: Record<AgentSurvivalTier, Pick<AgentSurvivalSnapshot, "canRunInference" | "modelHint" | "heartbeatHint" | "statusCopy">> = {
    high: {
      canRunInference: true,
      modelHint: "frontier",
      heartbeatHint: "fast",
      statusCopy: "Funded and clear for normal paid work.",
    },
    normal: {
      canRunInference: true,
      modelHint: "frontier",
      heartbeatHint: "normal",
      statusCopy: "Alive, but should seek revenue before spending freely.",
    },
    low_compute: {
      canRunInference: true,
      modelHint: "cheap",
      heartbeatHint: "slow",
      statusCopy: "Low compute mode: cheap model, fewer paid calls.",
    },
    critical: {
      canRunInference: true,
      modelHint: "minimal",
      heartbeatHint: "emergency",
      statusCopy: "Critical: only survival, earning, and funding tasks should run.",
    },
    dead: {
      canRunInference: false,
      modelHint: "stopped",
      heartbeatHint: "stopped",
      statusCopy: "Stopped locally until the wallet is funded again.",
    },
  };

  return {
    tier,
    effectiveBalanceUsd,
    daysRemaining,
    hoursRemaining,
    ...tierHints[tier],
  };
}

export function createDefaultHoneyTreasuryConfig(): HoneyTreasuryConfig {
  return {
    ...DEFAULT_HONEY_TREASURY_CONFIG,
    agentTokenUsage: {},
    agentHoneyExchanged: {},
    agentHiveBalances: {},
  };
}

// Adapted from TarunGoyalDev/rewards-calculation-dashboard reward helpers.
// The original maps purchase amounts to points; this maps agent token usage to Honey.
export function calculateHoneyForTokens(tokensUsed: number, honeyPerThousandTokens: number): number {
  if (!Number.isFinite(tokensUsed) || tokensUsed <= 0) return 0;
  if (!Number.isFinite(honeyPerThousandTokens) || honeyPerThousandTokens <= 0) return 0;
  return Math.round((tokensUsed / 1_000) * honeyPerThousandTokens * 1_000_000) / 1_000_000;
}

export function getHoneyAgentRewards(agentIds: string[], config: HoneyTreasuryConfig): HoneyAgentReward[] {
  const balancesByAgent = new Map((config.balances ?? []).map((balance) => [balance.agentId, balance]));
  return agentIds.map((agentId) => {
    const balance = balancesByAgent.get(agentId);
    if (balance) {
      const honeyAvailable = Math.max(0, Math.round(Number(balance.availableHoney || 0) * 1_000_000) / 1_000_000);
      const honeyEarned = Math.max(0, Math.round(Number(balance.lifetimeHoney || 0) * 1_000_000) / 1_000_000);
      const hiveBalance = Math.max(0, Math.round(Number(balance.hiveBalance || 0) * 1_000_000) / 1_000_000);
      return {
        agentId,
        tokensUsed: Math.max(0, Math.round(Number(balance.tokensUsed || 0))),
        honeyEarned,
        honeyAvailable,
        honeyExchanged: Math.max(0, Math.round((honeyEarned - honeyAvailable) * 1_000_000) / 1_000_000),
        tokenReward: Math.round(honeyAvailable * config.tokenPerHoney * 1_000_000) / 1_000_000,
        hiveBalance,
      };
    }
    const tokensUsed = Math.max(0, Math.round(Number(config.agentTokenUsage[agentId] ?? 0)));
    const honeyEarned = calculateHoneyForTokens(tokensUsed, config.honeyPerThousandTokens);
    const honeyExchanged = Math.min(honeyEarned, Math.max(0, Number(config.agentHoneyExchanged[agentId] ?? 0)));
    const honeyAvailable = Math.max(0, Math.round((honeyEarned - honeyExchanged) * 1_000_000) / 1_000_000);
    return {
      agentId,
      tokensUsed,
      honeyEarned,
      honeyAvailable,
      honeyExchanged,
      tokenReward: Math.round(honeyAvailable * config.tokenPerHoney * 1_000_000) / 1_000_000,
      hiveBalance: Math.round(Number(config.agentHiveBalances[agentId] ?? 0) * 1_000_000) / 1_000_000,
    };
  });
}

// Adapted from qntx/x402-openai-typescript: src/policies.ts.
// The original policies operate on @x402/fetch PaymentRequirements; these local versions keep
// the same filter semantics without importing wallet/payment packages into the dashboard.
export type X402Policy = (requirements: X402PaymentRequirement[]) => X402PaymentRequirement[];

export function preferNetwork(network: string): X402Policy {
  const isWildcard = network.endsWith(":*");
  const prefix = isWildcard ? network.slice(0, -1) : null;
  return (requirements) => {
    const matched = requirements.filter((requirement) => (
      prefix ? requirement.network.startsWith(prefix) : requirement.network === network
    ));
    return matched.length > 0 ? matched : requirements;
  };
}

export function preferScheme(scheme: string): X402Policy {
  return (requirements) => {
    const matched = requirements.filter((requirement) => requirement.scheme === scheme);
    return matched.length > 0 ? matched : requirements;
  };
}

export function maxAmount(maxBaseUnits: bigint | number): X402Policy {
  const limit = BigInt(maxBaseUnits);
  return (requirements) => {
    const matched = requirements.filter((requirement) => {
      const raw = requirement.amount ?? requirement.maxAmountRequired ?? 0;
      return BigInt(raw) <= limit;
    });
    return matched.length > 0 ? matched : requirements;
  };
}

export function buildAgentPaymentPrompt(config: AgentWalletConfig, snapshot = getSurvivalSnapshot(config)): string {
  const veilAutoPrivateX402 = config.veilAutoPrivateX402 !== false;
  const duplicateGuardSeconds = Number.isFinite(Number(config.duplicatePaymentGuardSeconds))
    ? Math.max(0, Number(config.duplicatePaymentGuardSeconds))
    : DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS;
  const provider = config.provider === "bankr"
    ? "Bankr LLM Gateway with dashboard spending caps"
    : config.provider === "clawcard"
    ? `ClawCard via ${config.clawCardEnvName}`
    : config.provider === "moneyclaw"
      ? `MoneyClaw via ${config.moneyClawEnvName}`
      : config.provider === "x402"
        ? "x402 wallet payments"
        : config.provider === "usepod"
          ? "UsePod prepaid inference wallet with provider-managed x402 payments"
          : config.provider === "veil"
            ? "private Base privacy-pool payments via the active privacy rail"
          : "manual wallet accounting";
  return [
    `Payment mode: ${provider}.`,
    `Network: ${config.network}; token: ${config.tokenSymbol}; wallet: ${config.walletAddress || "not yet connected"}.`,
    `Spend cap: $${config.maxPaymentUsd.toFixed(2)} per payment; require approval over $${config.approvalRequiredOverUsd.toFixed(2)}.`,
    config.provider === "veil" ? `ETH transfer cap: ${assetSpendCapFor(config, "ETH").toFixed(6)} ETH.` : "",
    config.enabled ? "Wallet spending is on." : "Wallet spending is off; prepare drafts only and do not execute wallet tools.",
    `Allow auto-use is ${config.autoPayEnabled ? "on within the hard spend cap" : "off; ask before spending"}.`,
    `Duplicate payment guard is ${config.duplicatePaymentGuardEnabled !== false ? `on for ${Math.max(1, Math.round(duplicateGuardSeconds / 60))} minutes` : "off; intentional repeat payments may submit back to back after the previous transfer finishes"}.`,
    `Survival tier: ${snapshot.tier}; effective balance $${snapshot.effectiveBalanceUsd.toFixed(2)}; compute burn $${config.dailyComputeBurnUsd.toFixed(2)}/day.`,
    `Use ${snapshot.modelHint} model behavior and ${snapshot.heartbeatHint} heartbeat behavior.`,
    config.provider === "veil"
      ? `Capability: private sends are available for USDC and ETH on Base. If the user asks to send privately, make a private payment, or privately pay an x402 endpoint, infer this active private rail automatically; do not require the user to name Veil Cash. ${veilAutoPrivateX402 ? "Auto Always Private is on: ordinary x402/pay-this endpoint requests should use Veil private x402 by default." : "Auto Always Private is off: ordinary x402/pay-this endpoint requests use the basic public x402 route, and only explicit private language such as privately, in private, private, or Veil should use Veil private x402."} Present one agent spend balance; public, queued, and ready private Veil balances are internal rail state. Dashboard execution uses POST /api/wallet/veil/transfer after the user confirms a reviewed transfer draft; use ${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL} as the internal route confirmation and autoShield for USDC sends. Private x402 drafts and confirmations are handled directly by the chat wallet capability; ask the user for plain confirmation such as "confirm" and map provider-specific confirmation tokens internally. By default private sends go to any public Ethereum address; current public-recipient USDC withdrawals require at least ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC. If ready private USDC is short, HivemindOS can shield from the agent's encrypted local Base wallet first and finish after Veil accepts the deposit. Only use registered-recipient mode for an explicit in-pool shielded transfer to a registered Veil recipient. VEIL_KEY and the Veil CLI must be configured on the server. Do not execute private actions without explicit setup and approval.`
      : "",
    "Never expose private keys, card PAN/CVV, or billing identity in chat or durable shared notes.",
  ].filter(Boolean).join("\n");
}

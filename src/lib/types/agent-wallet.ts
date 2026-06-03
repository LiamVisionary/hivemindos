export type AgentPaymentProvider = "manual" | "bankr" | "clawcard" | "moneyclaw" | "x402" | "usepod" | "veil";

export type AgentSurvivalTier = "dead" | "critical" | "low_compute" | "normal" | "high";
export type AgentSpendCapAsset = "USDC" | "ETH";
export type AgentAssetSpendCaps = Partial<Record<AgentSpendCapAsset, number>>;

export interface AgentWalletConfig {
  agentId: string;
  enabled: boolean;
  provider: AgentPaymentProvider;
  walletAddress: string;
  network: string;
  tokenSymbol: string;
  seedBalanceUsd: number;
  currentBalanceUsd: number;
  dailyComputeBurnUsd: number;
  maxPaymentUsd: number;
  assetSpendCaps?: AgentAssetSpendCaps;
  approvalRequiredOverUsd: number;
  autoPayEnabled: boolean;
  duplicatePaymentGuardEnabled?: boolean;
  duplicatePaymentGuardSeconds?: number;
  clawCardEnvName: string;
  moneyClawEnvName: string;
  x402BaseUrl: string;
  survivalStartedAt: number;
  updatedAt: number;
  notes: string;
  custodyMode?: "watch" | "local";
  vaultAddress?: string;
  onchainBalanceUsd?: number;
  nativeBalance?: number;
  lastOnchainSyncAt?: number;
}

export interface AgentSurvivalSnapshot {
  tier: AgentSurvivalTier;
  effectiveBalanceUsd: number;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  canRunInference: boolean;
  modelHint: "frontier" | "cheap" | "minimal" | "stopped";
  heartbeatHint: "fast" | "normal" | "slow" | "emergency" | "stopped";
  statusCopy: string;
}

export interface X402PaymentRequirement {
  network: string;
  scheme: string;
  amount?: string | number | bigint;
  maxAmountRequired?: string | number | bigint;
  asset?: string;
  description?: string;
}

export interface AgentWalletBalance {
  address: string;
  network: string;
  tokenSymbol: string;
  tokenBalance: number;
  nativeBalance: number;
  fetchedAt: number;
}

export interface AgentWalletVaultInfo {
  agentId: string;
  address: string;
  network: string;
  custodyMode: "local";
  createdAt: string;
}

export interface HoneyTreasuryConfig {
  honeyPerThousandTokens: number;
  tokenPerHoney: number;
  agentTokenUsage: Record<string, number>;
  agentHoneyExchanged: Record<string, number>;
  agentHiveBalances: Record<string, number>;
  balances?: HoneyLedgerBalance[];
  rewardPoolHive: number;
  rewardPoolRemainingHive: number;
  rewardPoolEmittedHive: number;
  rewardPoolExchangedHive: number;
  rewardPoolUsd: number;
  rewardPoolVolumeUsd: number;
  rewardPoolShareOfVolume: number;
  hivePerMillionTokens: number;
  hiveTokenAddress: string;
}

export interface HoneyLedgerBalance {
  workspaceId: string;
  agentId: string;
  tokensUsed: number;
  lifetimeHoney: number;
  availableHoney: number;
  hiveBalance: number;
  updatedAt: string;
}

export interface HoneyAgentReward {
  agentId: string;
  tokensUsed: number;
  honeyEarned: number;
  honeyAvailable: number;
  honeyExchanged: number;
  tokenReward: number;
  hiveBalance: number;
}

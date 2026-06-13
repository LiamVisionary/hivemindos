export type AgentPaymentProvider = "manual" | "bankr" | "clawcard" | "moneyclaw" | "x402" | "usepod" | "venice" | "veil";

export type AgentSurvivalTier = "dead" | "critical" | "low_compute" | "normal" | "high";
export type AgentSpendCapAsset = "USDC" | "ETH";
export type AgentAssetSpendCaps = Partial<Record<AgentSpendCapAsset, number>>;

/** Stock-buying rail: real brokerage (Alpaca) or on-chain tokenized equities (xStocks via Jupiter swap). */
export type AgentTradingVenue = "alpaca" | "xstocks";

export interface AgentWalletConfig {
  agentId: string;
  enabled: boolean;
  provider: AgentPaymentProvider;
  providerSelectedAt?: number;
  walletAddress: string;
  network: string;
  tokenSymbol: string;
  seedBalanceUsd: number;
  currentBalanceUsd: number;
  dailyComputeBurnUsd: number;
  maxPaymentUsd: number;
  assetSpendCaps?: AgentAssetSpendCaps;
  approvalRequiredOverUsd: number;
  /** Rolling 24h cumulative USD spend cap across all rails. 0/undefined = unlimited. */
  dailyBudgetUsd?: number;
  /** Rolling 30d cumulative USD spend cap across all rails. 0/undefined = unlimited. */
  monthlyBudgetUsd?: number;
  autoPayEnabled: boolean;
  duplicatePaymentGuardEnabled?: boolean;
  duplicatePaymentGuardSeconds?: number;
  clawCardEnvName: string;
  moneyClawEnvName: string;
  x402BaseUrl: string;
  veilAutoPrivateX402?: boolean;
  /** Stock-buying rail selection. Absent = buy-stock disabled for this agent. */
  tradingVenue?: AgentTradingVenue;
  /** Shared-hive env var NAME holding the Alpaca API key id (value never stored in project files). */
  alpacaKeyEnvName?: string;
  /** Shared-hive env var NAME holding the Alpaca API secret. */
  alpacaSecretEnvName?: string;
  /** When false, Alpaca trades route to the live brokerage; defaults to paper (true). */
  alpacaPaper?: boolean;
  /** Hard per-trade USD ceiling for the buy-stock rail. 0/undefined falls back to maxPaymentUsd. */
  maxTradeUsd?: number;
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
  totalValueUsd?: number | null;
  tokens?: AgentWalletTokenBalance[];
  fetchedAt: number;
}

export interface AgentWalletTokenBalance {
  symbol: string;
  name: string;
  balance: number;
  network: string;
  priceUsd?: number | null;
  valueUsd?: number | null;
  priceChange24hPct?: number | null;
  isNative?: boolean;
  tokenAddress?: string;
  iconUrl?: string | null;
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
  managedHoneyBalance?: number;
  managedHoneyLifetimeCredits?: number;
  managedHoneySpent?: number;
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

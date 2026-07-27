export const OFFICIAL_BANKR_COPY_TRADING_BASE_URL = "https://hivemindos-copy-trading-gateway.hivemindos.workers.dev";
export const BANKR_COPY_TRADING_PAYMENT_NETWORK = "eip155:8453";
export const BANKR_COPY_TRADING_FUND_CONFIRMATION = "FUND_BANKR_COPY_WALLET";
export const BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT = "I understand copy trading can lose money";
export const BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT =
  "I authorize HivemindOS to charge the published $1 usage minimum and uncapped 0.5% fee on each verified live copied trade";
export const BANKR_COPY_TRADING_LEGACY_FEE_ACKNOWLEDGEMENT =
  "I authorize HivemindOS to charge the published fee after each verified live copied trade";
export const BANKR_COPY_TRADING_API_KEY_ENV_NAMES = [
  "BANKR_API_KEY",
  "BANKR_LLM_KEY",
  "BANKR_MANAGEMENT_KEY",
] as const;

export type BankrCopyConnectionKind = "existing" | "provisioned";

export type BankrCopyFundingWallet = {
  id: string;
  name: string;
  address: string;
  balanceUsd: number;
  maxPaymentUsd: number;
};

export type BankrCopyEvent = {
  id: string;
  sourceTransactionHash: string;
  mode: "paper" | "live";
  maxTradeUsd: number;
  status: string;
  receiptStatus: string | null;
  executionTransactionHash: string | null;
  executedNotionalUsd: number | null;
  receiptError: string | null;
  fee: {
    policyVersion: string | null;
    feeBps: number | null;
    amountUsd: number;
    grossAmountUsd?: number;
    usageCreditAppliedUsd?: number;
    usagePeriodId?: string | null;
    status: string | null;
    transactionHash: string | null;
    error: string | null;
    collectedAt: string | null;
  } | null;
  createdAt: string;
};

export type BankrCopySubscription = {
  id: string;
  targetWallet: string;
  bankrWallet: string;
  bankrConnectionKind: "existing" | "provisioned" | "webhook";
  executionProvider: "bankr-managed" | "bankr-webhook";
  status: "active" | "paused" | "canceled" | "expired";
  mode: "paper" | "live";
  billingModel: "bankr-usage-minimum" | "bankr-per-trade" | "prepaid-period";
  billing: {
    feePolicyVersion?: string | null;
    feeBps?: number;
    feePercent?: number;
    minimumFeeUsd?: number;
    maximumFeeUsd?: number;
    feeCapUsd?: number | null;
    uncapped?: boolean;
    usageMinimumUsd?: number;
    usagePeriodDays?: number;
    usageMinimumCreditedTowardFees?: boolean;
    minimumCopyTradeUsd?: number;
    usagePeriod?: BankrCopyUsagePeriod | null;
    feeAcknowledgedAt?: string | null;
    chargedFrom?: string;
    chargedAfter?: string;
    billingMode?: string;
    additionalPerTradeFeeUsd?: number;
  };
  maxTradeUsd: number;
  maxDailyUsd: number;
  scalePercent: number;
  maxSlippageBps: number;
  paperTrialEndsAt: string | null;
  expiresAt: string | null;
  renews: boolean;
};

export type BankrCopyUsagePeriod = {
  id: string;
  status: "pending" | "charging" | "verifying" | "collected" | "uncertain" | "verification_failed";
  minimumUsd: number;
  creditRemainingUsd: number;
  startsAt: string;
  endsAt: string;
  transactionHash: string | null;
  error: string | null;
  collectedAt: string | null;
};

export type BankrCopyPerformanceShare = {
  enabled: boolean;
  createdAt: string | null;
  revokedAt: string | null;
};

export type BankrCopyPerformancePublication = {
  schemaVersion: "2026-07-17";
  publicUrl: string;
  createdAt: string;
  rotated: boolean;
};

export type BankrCopyDashboard = {
  available: boolean;
  managedExecutionAvailable: boolean;
  liveEnabled: boolean;
  partnerProvisioningConfigured: boolean;
  billingMode: "rolling-usage-minimum";
  feePolicyVersion: string;
  feePercent: number;
  feeCapUsd: number | null;
  usageMinimumUsd: number;
  usagePeriodDays: number;
  usageMinimumCreditedTowardFees: boolean;
  minimumCopyTradeUsd: number;
  feeRecipient: string;
  pendingRecoveryCount: number;
  fundingWallets: BankrCopyFundingWallet[];
  subscriptions: Array<{
    subscription: BankrCopySubscription;
    performanceShare?: BankrCopyPerformanceShare;
    events: BankrCopyEvent[];
    usageToday?: { signalCount: number; reservedUsd: number; maxDailyUsd: number };
    statusError?: string;
  }>;
};

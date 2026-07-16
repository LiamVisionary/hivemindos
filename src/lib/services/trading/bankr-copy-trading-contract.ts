export const OFFICIAL_BANKR_COPY_TRADING_BASE_URL = "https://hivemindos-copy-trading-gateway.hivemindos.workers.dev";
export const BANKR_COPY_TRADING_PAYMENT_NETWORK = "eip155:8453";
export const BANKR_COPY_TRADING_FUND_CONFIRMATION = "FUND_BANKR_COPY_WALLET";
export const BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT = "I understand copy trading can lose money";
export const BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT =
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
  billingModel: "bankr-per-trade" | "prepaid-period";
  billing: {
    feePolicyVersion?: string | null;
    feeBps?: number;
    feePercent?: number;
    minimumFeeUsd?: number;
    maximumFeeUsd?: number;
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

export type BankrCopyDashboard = {
  available: boolean;
  managedExecutionAvailable: boolean;
  liveEnabled: boolean;
  partnerProvisioningConfigured: boolean;
  billingMode: "per-successful-live-trade";
  feePolicyVersion: string;
  feePercent: number;
  minimumFeeUsd: number;
  maximumFeeUsd: number;
  feeRecipient: string;
  paperTrialDays: number;
  pendingRecoveryCount: number;
  fundingWallets: BankrCopyFundingWallet[];
  subscriptions: Array<{
    subscription: BankrCopySubscription;
    events: BankrCopyEvent[];
    usageToday?: { signalCount: number; reservedUsd: number; maxDailyUsd: number };
    statusError?: string;
  }>;
};

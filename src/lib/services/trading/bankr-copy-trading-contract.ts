export const OFFICIAL_BANKR_COPY_TRADING_BASE_URL = "https://hivemindos-copy-trading-gateway.hivemindos.workers.dev";
export const BANKR_COPY_TRADING_PAYMENT_NETWORK = "eip155:8453";
export const BANKR_COPY_TRADING_PAYMENT_CONFIRMATION = "PAY_X402";
export const BANKR_COPY_TRADING_FUND_CONFIRMATION = "FUND_BANKR_COPY_WALLET";
export const BANKR_COPY_TRADING_MAX_PLAN_PRICE_USD = 5;
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
  receiptError: string | null;
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
  maxTradeUsd: number;
  maxDailyUsd: number;
  scalePercent: number;
  maxSlippageBps: number;
  expiresAt: string;
};

export type BankrCopyDashboard = {
  available: boolean;
  managedExecutionAvailable: boolean;
  liveEnabled: boolean;
  partnerProvisioningConfigured: boolean;
  priceUsd: number;
  periodDays: number;
  pendingRecoveryCount: number;
  fundingWallets: BankrCopyFundingWallet[];
  subscriptions: Array<{
    subscription: BankrCopySubscription;
    events: BankrCopyEvent[];
    usageToday?: { signalCount: number; reservedUsd: number; maxDailyUsd: number };
    statusError?: string;
  }>;
};

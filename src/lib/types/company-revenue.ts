export type CompanyRevenueEventSource = "manual" | "stripe" | "invoice" | "x402" | "marketplace" | "other";
export type CompanyRevenueFeeStatus = "quoted" | "collected" | "unavailable" | "failed";
export type CompanyRevenueEventStatus = "recorded" | "fee-pending" | "fee-collected" | "fee-unavailable" | "fee-failed";

export type CompanyRevenueFeeSnapshot = {
  status: CompanyRevenueFeeStatus;
  enabled: boolean;
  configured: boolean;
  network: string;
  amountUsd: number;
  basisPoints: number;
  minFeeUsd: number;
  maxFeeUsd?: number;
  assetSymbol: "USDC" | "USDG";
  recipient?: string;
  recipientKey?: string;
  signature?: string;
  reason?: string;
  collectedAt?: string;
};

export type CompanyRevenueRecord = {
  id: string;
  companyId: string;
  amountUsd: number;
  source: CompanyRevenueEventSource;
  externalId?: string;
  customerLabel?: string;
  description?: string;
  receivedAt: string;
  recordedAt: string;
  recordedAtMs: number;
  status: CompanyRevenueEventStatus;
  fee: CompanyRevenueFeeSnapshot;
  collectingAgentId?: string;
};

export type CompanyRevenueRollup = {
  companyId: string;
  eventCount: number;
  totalRevenueUsd: number;
  shareQuotedUsd: number;
  shareCollectedUsd: number;
  sharePendingUsd: number;
  shareFailedUsd: number;
  shareUnavailableUsd: number;
  lastRevenueAt?: string;
};

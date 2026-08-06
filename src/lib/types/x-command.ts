export type XCommandIntent = "general" | "post-analysis" | "token-analysis" | "trade-execute";

export type XCommandTradeRequest = {
  side: "buy" | "sell" | "swap";
  assetClass?: "stock" | "token";
  amountUsd?: number;
  quantity?: number;
  asset?: string;
  sourcePostId?: string;
  sourcePostUrl?: string;
  requiresLocalAuthorization: true;
  executionStatus: "queued-local";
};

/** Legacy read-only job shape kept so existing pre-authorization receipts can still open in Trade. */
export type XCommandTradeDraft = {
  requestId?: string;
  side: "buy" | "sell" | "swap";
  assetClass?: "stock" | "token";
  amountUsd?: number;
  quantity?: number;
  asset?: string;
  sourcePostId?: string;
  sourcePostUrl?: string;
  requiresReview: true;
  requiresConfirmation: true;
  executionStatus: "not-executed";
};

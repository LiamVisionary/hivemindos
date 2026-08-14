export type WalletSendUsdcRequest = {
  agentId: string;
  actingAgentId?: string;
  toAddress: string;
  amountUsd: number;
  maxPaymentUsd?: number;
  autoPayEnabled?: boolean;
  confirmation?: string;
  gasSponsorAgentId?: string;
};

export type WalletSendUsdcResponse = {
  ok?: boolean;
  signature?: string;
  network?: string;
  assetSymbol?: "USDC" | "USDG";
  platformFee?: unknown;
  gasAssist?: { signature: string; amountEth: number; sponsorAgentId: string };
  error?: string;
};

export type PersonalWalletAssetSendRequest = {
  agentId: string;
  toAddress: string;
  asset: string;
  assetAmount: string;
  tokenAddress?: string;
  confirmation: "SEND_TOKEN";
};

export type PersonalWalletAssetSendResponse = Omit<WalletSendUsdcResponse, "assetSymbol"> & {
  assetSymbol?: string;
  assetAmount?: number;
};

type WalletSendApprovalResponse = {
  ok?: boolean;
  approvalToken?: string;
  error?: string;
};

export async function sendApprovedWalletUsdc(input: WalletSendUsdcRequest): Promise<WalletSendUsdcResponse> {
  const approval = await postWalletSend<WalletSendApprovalResponse>({
    ...input,
    action: "approve",
  }, "Could not approve this stablecoin send.");
  if (!approval.ok || !approval.approvalToken) {
    return { ok: false, error: approval.error ?? "Could not approve this stablecoin send." };
  }
  return postWalletSend<WalletSendUsdcResponse>({
    ...input,
    action: "send",
    approvalToken: approval.approvalToken,
  }, "Could not send stablecoin.");
}

export async function sendApprovedPersonalWalletAsset(input: PersonalWalletAssetSendRequest): Promise<PersonalWalletAssetSendResponse> {
  const approval = await postWalletSend<WalletSendApprovalResponse>({ ...input, action: "approve" }, "Could not approve this token send.");
  if (!approval.ok || !approval.approvalToken) {
    return { ok: false, error: approval.error ?? "Could not approve this token send." };
  }
  return postWalletSend<PersonalWalletAssetSendResponse>({
    ...input,
    action: "send",
    approvalToken: approval.approvalToken,
  }, `Could not send ${input.asset}.`);
}

async function postWalletSend<T extends { ok?: boolean; error?: string }>(body: Record<string, unknown>, fallbackError: string): Promise<T> {
  const response = await fetch("/api/wallet/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = await response?.json().catch(() => null) as T | null;
  if (!response?.ok || !data?.ok) {
    return {
      ...(data ?? {}),
      ok: false,
      error: data?.error ?? fallbackError,
    } as T;
  }
  return data;
}

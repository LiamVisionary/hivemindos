export type WalletSendUsdcRequest = {
  agentId: string;
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

type WalletSendApprovalResponse = {
  ok?: boolean;
  approvalToken?: string;
  error?: string;
};

export async function sendApprovedWalletUsdc(input: WalletSendUsdcRequest): Promise<WalletSendUsdcResponse> {
  const approval = await postWalletSend<WalletSendApprovalResponse>({
    ...input,
    action: "approve",
  });
  if (!approval.ok || !approval.approvalToken) {
    return { ok: false, error: approval.error ?? "Could not approve this stablecoin send." };
  }
  return postWalletSend<WalletSendUsdcResponse>({
    ...input,
    action: "send",
    approvalToken: approval.approvalToken,
  });
}

async function postWalletSend<T extends { ok?: boolean; error?: string }>(body: Record<string, unknown>): Promise<T> {
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
      error: data?.error ?? "Could not send stablecoin.",
    } as T;
  }
  return data;
}

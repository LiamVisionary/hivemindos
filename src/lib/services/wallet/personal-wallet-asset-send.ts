import "server-only";

import { getWalletBalance, resolveWalletTransferAsset, sendWalletAsset } from "@/lib/services/wallet/chain-wallet";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export type PersonalWalletAssetSendResult =
  | { ok: true; signature: string; network: string; assetSymbol: string; assetAmount: number }
  | { ok: false; status: "not_found" | "blocked" | "error"; error: string };

export async function executePersonalWalletAssetSend(input: {
  agentId: string;
  toAddress: string;
  asset: string;
  assetAmount: string | number;
  tokenAddress?: string;
}): Promise<PersonalWalletAssetSendResult> {
  const agentId = input.agentId.trim();
  if (!agentId.startsWith("user:")) {
    return { ok: false, status: "blocked", error: "Arbitrary-token sends are available only from explicitly selected personal wallets." };
  }
  const stored = await getWalletSecret(agentId);
  if (!stored) return { ok: false, status: "not_found", error: "No local personal wallet exists for this account." };
  try {
    const balance = await getWalletBalance(stored.info.address, stored.info.network);
    const asset = resolveWalletTransferAsset(balance, input.asset, input.tokenAddress);
    const result = await sendWalletAsset({
      network: stored.info.network,
      secret: stored.secret,
      fromAddress: stored.info.address,
      toAddress: input.toAddress.trim(),
      asset,
      amount: input.assetAmount,
    });
    const priceUsd = Number(asset.priceUsd);
    const amountUsd = Number.isFinite(priceUsd) && priceUsd >= 0 ? result.assetAmount * priceUsd : 0;
    await appendSpend({
      agentId,
      kind: "send",
      asset: result.assetSymbol,
      amountUsd,
      assetAmount: result.assetAmount,
      target: shortTarget(input.toAddress),
      status: "executed",
      transactionHash: result.signature,
    }).catch(() => {});
    return { ok: true, signature: result.signature, network: stored.info.network, assetSymbol: result.assetSymbol, assetAmount: result.assetAmount };
  } catch (error) {
    return { ok: false, status: "error", error: error instanceof Error ? error.message : `Could not send ${input.asset}.` };
  }
}

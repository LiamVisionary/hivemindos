import "server-only";

import { formatEther } from "viem";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { readEvmNativeBalanceWei, sendEvmNative } from "@/lib/services/wallet/chain-wallet";
import { loadGovernanceWallet } from "@/lib/services/wallet/spend-governance";
import { appendSpend, shortTarget } from "@/lib/services/wallet/spend-ledger";

export const AGENT_FUNDING_GAS_RESERVE_WEI = 10_000_000_000_000n; // 0.00001 ETH
const GAS_SPONSOR_MINIMUM_REMAINDER_WEI = 50_000_000_000_000n; // 0.00005 ETH

export type AgentFundingGasAssist = {
  signature: string;
  amountEth: number;
  sponsorAgentId: string;
};

export function requiredAgentFundingGasTopUpWei(nativeBalanceWei: bigint): bigint {
  return nativeBalanceWei >= AGENT_FUNDING_GAS_RESERVE_WEI
    ? 0n
    : AGENT_FUNDING_GAS_RESERVE_WEI - nativeBalanceWei;
}

/**
 * A Fund Agent action can use the receiving agent's Base wallet to supply a
 * tightly capped gas reserve to the personal source wallet. The sponsor must
 * be the exact transfer recipient; callers cannot redirect agent ETH elsewhere.
 */
export async function ensureAgentFundingGas(input: {
  sourceAgentId: string;
  sourceNetwork: string;
  sourceAddress: string;
  recipientAddress: string;
  sponsorAgentId?: string;
}): Promise<AgentFundingGasAssist | undefined> {
  if (!input.sponsorAgentId || !input.sourceAgentId.startsWith("user:")) return undefined;
  if (input.sourceNetwork !== "eip155:8453") return undefined;

  const sourceBalanceWei = await readEvmNativeBalanceWei(input.sourceNetwork, input.sourceAddress);
  const amountWei = requiredAgentFundingGasTopUpWei(sourceBalanceWei);
  if (amountWei === 0n) return undefined;

  const sponsor = await getWalletSecret(input.sponsorAgentId);
  if (!sponsor) throw new Error("The selected agent has no local wallet available to cover Base gas.");
  const sponsorPolicy = await loadGovernanceWallet(input.sponsorAgentId);
  if (sponsorPolicy && !sponsorPolicy.wallet.enabled) {
    throw new Error("Spending is off for the selected agent, so it cannot cover Base gas.");
  }
  if (sponsor.info.network !== input.sourceNetwork) {
    throw new Error("The selected agent wallet is not on the same Base network as the personal wallet.");
  }
  if (sponsor.info.address.toLowerCase() !== input.recipientAddress.trim().toLowerCase()) {
    throw new Error("The gas sponsor must be the same agent receiving this funding transfer.");
  }

  const sponsorBalanceWei = await readEvmNativeBalanceWei(sponsor.info.network, sponsor.info.address);
  if (sponsorBalanceWei < amountWei + GAS_SPONSOR_MINIMUM_REMAINDER_WEI) {
    throw new Error("The selected agent does not have enough Base ETH to cover this wallet's gas.");
  }
  const amountEth = Number(formatEther(amountWei));
  const sponsorEthCap = Number(sponsorPolicy?.wallet.assetSpendCaps?.ETH ?? 0);
  if (sponsorEthCap > 0 && amountEth > sponsorEthCap) {
    throw new Error(`The required Base gas exceeds this agent's ${sponsorEthCap} ETH spend cap.`);
  }

  const transfer = await sendEvmNative({
    network: sponsor.info.network,
    secret: sponsor.secret,
    fromAddress: sponsor.info.address,
    toAddress: input.sourceAddress,
    amountWei,
  });
  await appendSpend({
    agentId: input.sponsorAgentId,
    kind: "send",
    asset: "ETH",
    amountUsd: 0,
    assetAmount: amountEth,
    target: shortTarget(input.sourceAddress),
    status: "executed",
    transactionHash: transfer.signature,
  }).catch(() => {});
  return {
    signature: transfer.signature,
    amountEth,
    sponsorAgentId: input.sponsorAgentId,
  };
}

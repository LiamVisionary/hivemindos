import "server-only";

import { encodeFunctionData } from "viem";
import { isEvmAddress } from "@/lib/services/hive-staking-client";
import { createHiveStakingPublicClient, HIVE_ERC20_ABI, HIVE_STAKE_VAULT_ABI } from "@/lib/services/hive-staking";
import {
  hiveBaseRpcUrl,
  hiveStakingWriteContractAddress,
  hiveWriteTokenAddress,
  parseHiveStakeAmount,
  waitForHiveAllowance,
} from "@/lib/services/hive-staking-local";
import { readBankrWalletAddress, submitBankrTransaction } from "@/lib/services/bankr-actions";

const BASE_CHAIN_ID = 8453;

/**
 * Stake HIVE from the Bankr-provisioned wallet.
 *
 * Bankr signs and broadcasts from its own managed wallet, so the HIVE must live
 * in that wallet — and the on-chain stake is attributed to the Bankr address,
 * not the user's connected wallet. We build the `approve` + `stake` calldata
 * ourselves (Bankr's agent doesn't know this custom vault) and push both through
 * Bankr's /wallet/submit endpoint, waiting for each to confirm.
 */
export async function stakeHiveFromBankrWallet(input: {
  amountHive: string;
  tokenAddress?: string;
  stakingAddress?: string;
}) {
  const signer = await readBankrWalletAddress();
  if (!isEvmAddress(signer)) {
    throw new Error("Could not read the Bankr wallet address. Make sure a Bankr API key is configured.");
  }

  const tokenAddress = await resolveAddress(input.tokenAddress, hiveWriteTokenAddress);
  const stakingAddress = await resolveAddress(input.stakingAddress, hiveStakingWriteContractAddress);

  const rpcUrl = await hiveBaseRpcUrl();
  const publicClient = createHiveStakingPublicClient(rpcUrl);
  const tokenDecimals = Number(await publicClient.readContract({
    address: tokenAddress,
    abi: HIVE_ERC20_ABI,
    functionName: "decimals",
  }).catch(() => 18));
  const amountRaw = parseHiveStakeAmount(input.amountHive, tokenDecimals);

  // Bankr signs from its own wallet, so guard against staking more HIVE than it
  // actually holds (a clean error beats a reverted on-chain transaction).
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: HIVE_ERC20_ABI,
    functionName: "balanceOf",
    args: [signer],
  }).catch(() => null);
  if (balance != null && balance < amountRaw) {
    throw new Error("The Bankr wallet does not hold enough HIVE to stake that amount.");
  }

  const approve = await submitBankrTransaction({
    to: tokenAddress,
    value: "0",
    data: encodeFunctionData({
      abi: HIVE_ERC20_ABI,
      functionName: "approve",
      args: [stakingAddress, amountRaw],
    }),
    chainId: BASE_CHAIN_ID,
  }, { description: "Approve HIVE for staking", waitForConfirmation: true });

  await waitForHiveAllowance({ publicClient, owner: signer, tokenAddress, spender: stakingAddress, amountRaw });

  const stake = await submitBankrTransaction({
    to: stakingAddress,
    value: "0",
    data: encodeFunctionData({
      abi: HIVE_STAKE_VAULT_ABI,
      functionName: "stake",
      args: [amountRaw],
    }),
    chainId: BASE_CHAIN_ID,
  }, { description: "Stake HIVE", waitForConfirmation: true });

  return { signer, approveHash: approve.transactionHash, stakeHash: stake.transactionHash };
}

async function resolveAddress(
  provided: string | undefined,
  fallback: () => Promise<`0x${string}`>,
): Promise<`0x${string}`> {
  if (provided && isEvmAddress(provided)) return provided;
  return fallback();
}

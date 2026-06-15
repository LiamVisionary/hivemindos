import "server-only";

import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS, DEFAULT_BASE_HIVE_TOKEN_ADDRESS } from "@/lib/services/hive-staking";
import { isEvmAddress } from "@/lib/services/hive-staking-client";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";

const HIVE_ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "spender", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}] as const;

const HIVE_STAKE_ABI = [{
  type: "function",
  name: "stake",
  stateMutability: "nonpayable",
  inputs: [{ name: "amount", type: "uint256" }],
  outputs: [],
}] as const;

export async function hiveStakingWriteContractAddress(): Promise<`0x${string}`> {
  const candidate = await hiveEnvValue("HIVE_STAKING_CONTRACT_ADDRESS")
    || await hiveEnvValue("NEXT_PUBLIC_HIVE_STAKING_CONTRACT_ADDRESS")
    || DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS;
  if (!isEvmAddress(candidate)) throw new Error("HIVE staking contract address is not configured.");
  return candidate;
}

export async function hiveWriteTokenAddress(): Promise<`0x${string}`> {
  const candidate = await hiveEnvValue("HIVE_TOKEN_ADDRESS")
    || await hiveEnvValue("NEXT_PUBLIC_HIVE_TOKEN_ADDRESS")
    || DEFAULT_BASE_HIVE_TOKEN_ADDRESS;
  if (!isEvmAddress(candidate)) throw new Error("HIVE token address is not configured.");
  return candidate;
}

async function hiveBaseRpcUrl() {
  return await hiveEnvValue("BASE_RPC_URL") || "https://mainnet.base.org";
}

export async function stakeHiveFromLocalWallet(input: {
  secret: string;
  fromAddress: string;
  amountHive: string;
  tokenAddress?: string;
  stakingAddress?: string;
}) {
  if (!isEvmAddress(input.fromAddress)) throw new Error("Wallet address is not a valid Base address.");
  const amount = Number(input.amountHive);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Stake amount must be greater than zero.");

  const privateKey = normalizeEvmPrivateKey(input.secret);
  const account = privateKeyToAccount(privateKey);
  if (account.address.toLowerCase() !== input.fromAddress.toLowerCase()) {
    throw new Error("Stored wallet key does not match the selected staking wallet.");
  }

  const tokenAddress = input.tokenAddress ? validateAddress(input.tokenAddress, "HIVE token") : await hiveWriteTokenAddress();
  const stakingAddress = input.stakingAddress ? validateAddress(input.stakingAddress, "HIVE staking contract") : await hiveStakingWriteContractAddress();
  const amountRaw = parseUnits(input.amountHive, 18);
  const wallet = createWalletClient({
    account,
    chain: base,
    transport: http(await hiveBaseRpcUrl()),
  });

  const approveHash = await wallet.writeContract({
    address: tokenAddress,
    abi: HIVE_ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [stakingAddress, amountRaw],
  });
  const stakeHash = await wallet.writeContract({
    address: stakingAddress,
    abi: HIVE_STAKE_ABI,
    functionName: "stake",
    args: [amountRaw],
  });

  return { approveHash, stakeHash };
}

function normalizeEvmPrivateKey(secret: string): `0x${string}` {
  const compact = secret.trim();
  const prefixed = compact.startsWith("0x") ? compact : `0x${compact}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(prefixed)) throw new Error("EVM private keys must be 32-byte hex.");
  return prefixed as `0x${string}`;
}

function validateAddress(value: string, label: string): `0x${string}` {
  if (!isEvmAddress(value)) throw new Error(`${label} address is invalid.`);
  return value;
}

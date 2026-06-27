import { createPublicClient, fallback, http, webSocket } from "viem";
import type { Address } from "viem";
import {
  BASE_HIVE_READ_RPC_URLS,
  DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS,
  DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
  HIVE_STAKING_TIERS,
  isHiveEvmAddress,
  type HiveStakingTier,
} from "@/lib/config/hive-staking";
import { base } from "@/lib/services/wallet/base-chain";

export {
  DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS,
  DEFAULT_BASE_HIVE_TOKEN_ADDRESS,
  HIVE_STAKING_TIERS,
  isHiveEvmAddress,
  type HiveStakingTier,
  type HiveStakingTierId,
} from "@/lib/config/hive-staking";

export const HIVE_STAKE_VAULT_ABI = [
  {
    type: "function",
    name: "stakedBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalStaked",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingUnstakeOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "unstakeAvailableAt",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "timestamp", type: "uint256" }],
  },
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "seconds", type: "uint256" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "paused", type: "bool" }],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

export const HIVE_ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type HiveStakeStatus = {
  account: Address;
  contractAddress: Address;
  activeStakedRaw: bigint;
  pendingUnstakeRaw: bigint;
  unstakeAvailableAt: bigint;
  cooldown: bigint;
  paused: boolean;
  tier: HiveStakingTier | null;
};

export type HiveStakeAccountStatus = Omit<HiveStakeStatus, "cooldown" | "paused">;

export type HiveStakingContractStatus = {
  contractAddress: Address;
  tokenAddress: Address;
  tokenDecimals: number;
  totalStakedRaw: bigint;
  cooldown: bigint;
  paused: boolean;
};

export type HiveStakingReadClient = {
  readContract: ReturnType<typeof createPublicClient>["readContract"];
};

const DEFAULT_HIVE_DECIMALS = 18;

export function hiveStakingContractAddress(): Address | null {
  const candidate = process.env.HIVE_STAKING_CONTRACT_ADDRESS?.trim()
    || process.env.NEXT_PUBLIC_HIVE_STAKING_CONTRACT_ADDRESS?.trim()
    || DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS;
  if (!candidate) return null;
  if (!isHiveEvmAddress(candidate)) throw new Error(`HIVE_STAKING_CONTRACT_ADDRESS is not a valid address: ${candidate}`);
  return candidate;
}

export function hiveTokenAddress(): Address {
  const candidate = process.env.HIVE_TOKEN_ADDRESS?.trim()
    || process.env.NEXT_PUBLIC_HIVE_TOKEN_ADDRESS?.trim()
    || DEFAULT_BASE_HIVE_TOKEN_ADDRESS;
  if (!isHiveEvmAddress(candidate)) throw new Error(`HIVE_TOKEN_ADDRESS is not a valid address: ${candidate}`);
  return candidate;
}

export function scaleHiveAmount(amountHive: bigint, decimals = DEFAULT_HIVE_DECIMALS) {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`Invalid token decimals: ${decimals}`);
  return amountHive * 10n ** BigInt(decimals);
}

export function hiveTierForStakedHive(stakedHive: bigint): HiveStakingTier | null {
  let match: HiveStakingTier | null = null;
  for (const tier of HIVE_STAKING_TIERS) {
    if (stakedHive >= tier.thresholdHive) match = tier;
  }
  return match;
}

export function hiveTierForStakedRaw(stakedRaw: bigint, decimals = DEFAULT_HIVE_DECIMALS): HiveStakingTier | null {
  let match: HiveStakingTier | null = null;
  for (const tier of HIVE_STAKING_TIERS) {
    if (stakedRaw >= scaleHiveAmount(tier.thresholdHive, decimals)) match = tier;
  }
  return match;
}

export function createHiveStakingPublicClient(rpcUrl?: string) {
  const readTransports = uniqueBaseRpcUrls(rpcUrl || process.env.BASE_RPC_URL).map((url) => {
    const options = { retryCount: 1, timeout: 10_000 };
    return url.startsWith("wss://") ? webSocket(url, options) : http(url, options);
  });
  return createPublicClient({
    chain: base,
    transport: fallback(readTransports, {
      rank: false,
      retryCount: 1,
    }),
  });
}

export async function getHiveStakeStatus(params: {
  account: string;
  contractAddress?: string | null;
  client?: HiveStakingReadClient;
  decimals?: number;
}): Promise<HiveStakeStatus> {
  if (!isHiveEvmAddress(params.account)) throw new Error(`Invalid staking account address: ${params.account}`);

  const contractAddress = params.contractAddress ? normalizeHiveAddress(params.contractAddress, "HIVE staking contract") : hiveStakingContractAddress();
  if (!contractAddress) throw new Error("HIVE staking contract address is not configured.");

  const client = params.client || createHiveStakingPublicClient();
  const [activeStakedRaw, pendingUnstakeRaw, unstakeAvailableAt, cooldown, paused] = await Promise.all([
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "stakedBalanceOf", args: [params.account] }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "pendingUnstakeOf", args: [params.account] }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "unstakeAvailableAt", args: [params.account] }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "cooldown" }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "paused" }),
  ]);

  return {
    account: params.account,
    contractAddress,
    activeStakedRaw,
    pendingUnstakeRaw,
    unstakeAvailableAt,
    cooldown,
    paused,
    tier: hiveTierForStakedRaw(activeStakedRaw, params.decimals),
  };
}

export async function getHiveStakeAccountStatus(params: {
  account: string;
  contractAddress?: string | null;
  client?: HiveStakingReadClient;
  decimals?: number;
}): Promise<HiveStakeAccountStatus> {
  if (!isHiveEvmAddress(params.account)) throw new Error(`Invalid staking account address: ${params.account}`);

  const contractAddress = params.contractAddress ? normalizeHiveAddress(params.contractAddress, "HIVE staking contract") : hiveStakingContractAddress();
  if (!contractAddress) throw new Error("HIVE staking contract address is not configured.");

  const client = params.client || createHiveStakingPublicClient();
  const [activeStakedRaw, pendingUnstakeRaw, unstakeAvailableAt] = await Promise.all([
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "stakedBalanceOf", args: [params.account] }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "pendingUnstakeOf", args: [params.account] }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "unstakeAvailableAt", args: [params.account] }),
  ]);

  return {
    account: params.account,
    contractAddress,
    activeStakedRaw,
    pendingUnstakeRaw,
    unstakeAvailableAt,
    tier: hiveTierForStakedRaw(activeStakedRaw, params.decimals),
  };
}

export async function getHiveStakingContractStatus(params: {
  contractAddress?: string | null;
  tokenAddress?: string | null;
  client?: HiveStakingReadClient;
} = {}): Promise<HiveStakingContractStatus> {
  const contractAddress = params.contractAddress ? normalizeHiveAddress(params.contractAddress, "HIVE staking contract") : hiveStakingContractAddress();
  if (!contractAddress) throw new Error("HIVE staking contract address is not configured.");
  const tokenAddress = params.tokenAddress ? normalizeHiveAddress(params.tokenAddress, "HIVE token") : hiveTokenAddress();

  const client = params.client || createHiveStakingPublicClient();
  const [tokenDecimals, totalStakedRaw, cooldown, paused] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: HIVE_ERC20_ABI, functionName: "decimals" }).catch(() => DEFAULT_HIVE_DECIMALS),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "totalStaked" }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "cooldown" }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "paused" }),
  ]);

  return {
    contractAddress,
    tokenAddress,
    tokenDecimals: Number(tokenDecimals),
    totalStakedRaw,
    cooldown,
    paused,
  };
}

function normalizeHiveAddress(value: string, label: string): Address {
  if (!isHiveEvmAddress(value)) throw new Error(`Invalid ${label} address: ${value}`);
  return value;
}

function uniqueBaseRpcUrls(primaryUrl?: string) {
  const urls = [...parseRpcUrls(primaryUrl), ...BASE_HIVE_READ_RPC_URLS];
  return Array.from(new Set(urls));
}

function parseRpcUrls(value?: string) {
  return (value || "")
    .split(/[,\s]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

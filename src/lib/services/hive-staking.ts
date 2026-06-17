import { createPublicClient, http } from "viem";
import type { Address } from "viem";
import { base } from "viem/chains";
import {
  DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS,
  HIVE_STAKING_TIERS,
  isHiveEvmAddress,
  type HiveStakingTier,
} from "@/lib/config/hive-staking";

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

export function createHiveStakingPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
  });
}

export async function getHiveStakeStatus(params: {
  account: string;
  contractAddress?: string | null;
  client?: HiveStakingReadClient;
  decimals?: number;
}): Promise<HiveStakeStatus> {
  if (!isHiveEvmAddress(params.account)) throw new Error(`Invalid staking account address: ${params.account}`);

  const contractAddress = params.contractAddress ? normalizeContractAddress(params.contractAddress) : hiveStakingContractAddress();
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

  const contractAddress = params.contractAddress ? normalizeContractAddress(params.contractAddress) : hiveStakingContractAddress();
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
  client?: HiveStakingReadClient;
} = {}): Promise<HiveStakingContractStatus> {
  const contractAddress = params.contractAddress ? normalizeContractAddress(params.contractAddress) : hiveStakingContractAddress();
  if (!contractAddress) throw new Error("HIVE staking contract address is not configured.");

  const client = params.client || createHiveStakingPublicClient();
  const [cooldown, paused] = await Promise.all([
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "cooldown" }),
    client.readContract({ address: contractAddress, abi: HIVE_STAKE_VAULT_ABI, functionName: "paused" }),
  ]);

  return {
    contractAddress,
    cooldown,
    paused,
  };
}

function normalizeContractAddress(value: string): Address {
  if (!isHiveEvmAddress(value)) throw new Error(`Invalid HIVE staking contract address: ${value}`);
  return value;
}

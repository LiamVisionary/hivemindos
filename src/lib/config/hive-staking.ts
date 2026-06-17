import type { Address } from "viem";

export const DEFAULT_BASE_HIVE_TOKEN_ADDRESS = "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3" as const;
export const DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS = "0x26c7121e41e779327adbd5682646dc5deb764539" as const;

export type HiveStakingTierId = "holder" | "supporter" | "builder" | "curator" | "operator" | "visionary";

export type HiveStakingTier = {
  id: HiveStakingTierId;
  label: string;
  thresholdHive: bigint;
  role: string;
};

export const HIVE_STAKING_TIERS = [
  {
    id: "holder",
    label: "Holder",
    thresholdHive: 1_000_000n,
    role: "Wallet-linked identity and basic status",
  },
  {
    id: "supporter",
    label: "Supporter",
    thresholdHive: 10_000_000n,
    role: "Community access and stronger signal",
  },
  {
    id: "builder",
    label: "Builder",
    thresholdHive: 50_000_000n,
    role: "Early workflows and contributor status",
  },
  {
    id: "curator",
    label: "Curator",
    thresholdHive: 100_000_000n,
    role: "Bounty and marketplace curation eligibility",
  },
  {
    id: "operator",
    label: "Operator",
    thresholdHive: 250_000_000n,
    role: "Ecosystem operations and higher influence",
  },
  {
    id: "visionary",
    label: "Visionary",
    thresholdHive: 1_000_000_000n,
    role: "Highest alignment, access, and status",
  },
] as const satisfies readonly HiveStakingTier[];

export function isHiveEvmAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

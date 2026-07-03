import type { Address } from "viem";

export const DEFAULT_BASE_HIVE_TOKEN_ADDRESS = "0xA382c83e2a3B79368f372c2EB9b6925ffAf45bA3" as const;
export const DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS = "0x26c7121e41e779327adbd5682646dc5deb764539" as const;
export const BASE_CHAIN_ID_HEX = "0x2105";
export const BASE_HIVE_READ_RPC_URLS = [
  "https://mainnet.base.org",
  "https://base.api.pocket.network",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://1rpc.io/base",
  "wss://base-rpc.publicnode.com",
] as const;

export type HiveStakingTierId = "holder" | "supporter" | "builder" | "curator" | "operator" | "visionary";

export type HiveStakingTier = {
  id: HiveStakingTierId;
  label: string;
  thresholdHive: bigint;
  rewardWeight: number;
  rewardWeightLabel: string;
  rewardBoostLabel: string;
  role: string;
};

export const HIVE_STAKING_TIERS = [
  {
    id: "holder",
    label: "Holder",
    thresholdHive: 1_000_000n,
    rewardWeight: 1,
    rewardWeightLabel: "1.00x",
    rewardBoostLabel: "Base",
    role: "Wallet-linked identity, basic status, base reward weight, and a visible place in the hive.",
  },
  {
    id: "supporter",
    label: "Supporter",
    thresholdHive: 10_000_000n,
    rewardWeight: 1.1,
    rewardWeightLabel: "1.10x",
    rewardBoostLabel: "+10%",
    role: "1.10x reward weight. Community access, stronger signal, better reward exposure, and eligible managed-service discounts.",
  },
  {
    id: "builder",
    label: "Builder",
    thresholdHive: 50_000_000n,
    rewardWeight: 1.25,
    rewardWeightLabel: "1.25x",
    rewardBoostLabel: "+25%",
    role: "1.25x reward weight. Alpha workflow access, higher Honey multipliers, contributor status, and stronger seasonal rewards.",
  },
  {
    id: "curator",
    label: "Curator",
    thresholdHive: 100_000_000n,
    rewardWeight: 1.45,
    rewardWeightLabel: "1.45x",
    rewardBoostLabel: "+45%",
    role: "1.45x reward weight. Marketplace curation, bounty visibility, trust signals, better distribution surfaces, and stronger reward exposure.",
  },
  {
    id: "operator",
    label: "Operator",
    thresholdHive: 250_000_000n,
    rewardWeight: 1.7,
    rewardWeightLabel: "1.70x",
    rewardBoostLabel: "+70%",
    role: "1.70x reward weight. Operator rooms, higher ecosystem influence, lower marketplace fees, stronger governance signal, and major reward exposure.",
  },
  {
    id: "visionary",
    label: "Visionary",
    thresholdHive: 1_000_000_000n,
    rewardWeight: 2,
    rewardWeightLabel: "2.00x",
    rewardBoostLabel: "+100%",
    role: "2.00x reward weight. Highest caps, earliest access to premium reward seasons, Visionary council eligibility, strongest status, and the clearest upside exposure.",
  },
] as const satisfies readonly HiveStakingTier[];

export function isHiveEvmAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

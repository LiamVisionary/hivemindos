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
  rewardBucketUsdPerMillion: number;
  bucketRateLabel: string;
  holderMultiple: string;
  role: string;
};

export const HIVE_STAKING_TIERS = [
  {
    id: "holder",
    label: "Holder",
    thresholdHive: 1_000_000n,
    rewardBucketUsdPerMillion: 625,
    bucketRateLabel: "0.0625%",
    holderMultiple: "1x",
    role: "Wallet-linked identity, basic status, base rewards, and a visible place in the hive.",
  },
  {
    id: "supporter",
    label: "Supporter",
    thresholdHive: 10_000_000n,
    rewardBucketUsdPerMillion: 1_250,
    bucketRateLabel: "0.125%",
    holderMultiple: "2x",
    role: "2x the Holder bucket. Community access, stronger signal, better reward exposure, and eligible managed-service discounts.",
  },
  {
    id: "builder",
    label: "Builder",
    thresholdHive: 50_000_000n,
    rewardBucketUsdPerMillion: 2_500,
    bucketRateLabel: "0.25%",
    holderMultiple: "4x",
    role: "4x the Holder bucket. Alpha workflow access, higher Honey multipliers, contributor status, and stronger seasonal rewards.",
  },
  {
    id: "curator",
    label: "Curator",
    thresholdHive: 100_000_000n,
    rewardBucketUsdPerMillion: 5_000,
    bucketRateLabel: "0.5%",
    holderMultiple: "8x",
    role: "8x the Holder bucket. Marketplace curation, bounty visibility, trust signals, better distribution surfaces, and a larger reward bucket.",
  },
  {
    id: "operator",
    label: "Operator",
    thresholdHive: 250_000_000n,
    rewardBucketUsdPerMillion: 10_000,
    bucketRateLabel: "1%",
    holderMultiple: "16x",
    role: "16x the Holder bucket. Operator rooms, higher ecosystem influence, lower marketplace fees, stronger governance signal, and a major reward bucket.",
  },
  {
    id: "visionary",
    label: "Visionary",
    thresholdHive: 1_000_000_000n,
    rewardBucketUsdPerMillion: 20_000,
    bucketRateLabel: "2%",
    holderMultiple: "32x",
    role: "32x the Holder bucket. Highest reward bucket, highest caps, earliest access to premium reward seasons, Visionary council eligibility, strongest status, and the clearest upside exposure.",
  },
] as const satisfies readonly HiveStakingTier[];

export function isHiveEvmAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

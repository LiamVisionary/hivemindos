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
  // Honey multiplier in basis points (10000 = 1.00x). Honey is a
  // non-transferable contribution record, so this is a status mechanic, not a
  // financial promise. MUST stay numerically identical to the published /stake
  // page ladder (hivemindos-website src/lib/hive-staking.ts, 1.00x..2.00x) and
  // the compute gateway (hivemind-cloud-services
  // workers/compute-gateway/src/honey-staking.ts), or Honey awards would
  // disagree with the published page.
  rewardMultiplierBps: number;
  role: string;
};

export const HIVE_STAKING_TIERS = [
  {
    id: "holder",
    label: "Holder",
    thresholdHive: 1_000_000n,
    rewardMultiplierBps: 10_000,
    role: "Wallet-linked identity, basic status, and a visible place in the community.",
  },
  {
    id: "supporter",
    label: "Supporter",
    thresholdHive: 10_000_000n,
    rewardMultiplierBps: 11_000,
    role: "Community access eligibility and a stronger ecosystem-alignment signal.",
  },
  {
    id: "builder",
    label: "Builder",
    thresholdHive: 50_000_000n,
    rewardMultiplierBps: 12_500,
    role: "Contributor status and eligibility for explicitly experimental ecosystem access.",
  },
  {
    id: "curator",
    label: "Curator",
    thresholdHive: 100_000_000n,
    rewardMultiplierBps: 14_500,
    role: "Curation eligibility and marketplace reputation context, subject to verified work.",
  },
  {
    id: "operator",
    label: "Operator",
    thresholdHive: 250_000_000n,
    rewardMultiplierBps: 17_000,
    role: "Ecosystem-operations signaling and eligibility for operator community spaces.",
  },
  {
    id: "visionary",
    label: "Visionary",
    thresholdHive: 1_000_000_000n,
    rewardMultiplierBps: 20_000,
    role: "Highest community status and eligibility for non-binding council participation.",
  },
] as const satisfies readonly HiveStakingTier[];

export const HONEY_MULTIPLIER_BASE_BPS = 10_000;
export const FOUNDING_BEE_BONUS_BPS = 5_000;
export const HONEY_MULTIPLIER_MAX_BPS = 25_000;

// Published Founding Bee snapshot (hivemindos-website public/founding-bees.json):
// every wallet with active stake > 0 in the HIVE staking vault at block 48540680.
// The bonus is a flat +0.5x stacked on the wallet's CURRENT tier and persists
// through unstakes by design. This bundled copy of the public list serves the
// LOCAL (kill-switch-off) ledger only; the official hosted award path enforces
// its own copy server-side (compute-gateway HONEY_FOUNDING_BEE_ADDRESSES) per
// the commercial trust boundary.
export const FOUNDING_BEE_SNAPSHOT_BLOCK = 48_540_680;
export const FOUNDING_BEE_ADDRESSES = [
  "0xea53f22b387bc3ebabc8a22e6be807e22a817f02",
  "0x18388030512c997a1f5dba692dd682297c387c19",
  "0x9b38261ee45f98f7c7a73b72a275db5fe0eba965",
  "0xc42e0144fbfe7e16f240ff8a74d04a125d147be9",
  "0x4f89c07321ae91cc98aae986317e927875898bc9",
] as const;

export function isFoundingBeeAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase();
  return FOUNDING_BEE_ADDRESSES.some((founding) => founding === normalized);
}

// The founding +0.5x stacks on the current tier (base 1.00x when no active
// stake); the sum is capped at 2.50x (Founding Queen Bee).
export function combinedHoneyMultiplierBps(tierMultiplierBps: number | null | undefined, foundingBee: boolean): number {
  const tierBps = Number.isInteger(tierMultiplierBps) && (tierMultiplierBps as number) >= HONEY_MULTIPLIER_BASE_BPS
    ? (tierMultiplierBps as number)
    : HONEY_MULTIPLIER_BASE_BPS;
  return Math.min(tierBps + (foundingBee ? FOUNDING_BEE_BONUS_BPS : 0), HONEY_MULTIPLIER_MAX_BPS);
}

// Scales a Honey amount by a multiplier, rounded to micro-Honey precision.
export function applyHoneyMultiplier(honeyAmount: number, multiplierBps: number): number {
  const bps = Number.isInteger(multiplierBps)
    && multiplierBps >= HONEY_MULTIPLIER_BASE_BPS
    && multiplierBps <= HONEY_MULTIPLIER_MAX_BPS
    ? multiplierBps
    : HONEY_MULTIPLIER_BASE_BPS;
  const base = Math.max(0, Number(honeyAmount) || 0);
  return Math.round(((base * bps) / HONEY_MULTIPLIER_BASE_BPS) * 1_000_000) / 1_000_000;
}

export function isHiveEvmAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

// Local Honey stake-tier multiplier resolution.
//
// The OFFICIAL multiplier is enforced server-side by the compute gateway
// (signature-verified wallet link, per-epoch stake reads, hosted founding
// list) per the commercial trust boundary. This local resolver mirrors the
// same semantics for the local (economy kill-switch off) ledger so the
// dashboard's Honey matches the published /stake page ladder. Local Honey has
// no official value and cannot convert (conversion is hosted and dark), so a
// locally-misconfigured multiplier cannot mint official value.
//
// Semantics (identical to the gateway):
//   - tier from HiveStakeVault stakedBalanceOf(address), re-read once per
//     UTC-day epoch; unstaking drops the tier at the next re-read;
//   - Founding Bee +0.5x from the published snapshot list, persists forever;
//   - daily caps stay absolute in tokens; the multiplier scales Honey per token.
//
// The chat path reads the multiplier through the non-blocking cached accessor
// (honey-economy-config.ts pattern): the cached value (default 1.00x) returns
// instantly and the on-chain refresh runs in the background, so an RPC outage
// adds zero latency and fails closed to the last-known tier.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { homedir } from "@/lib/home-dir";
import {
  HONEY_MULTIPLIER_BASE_BPS,
  combinedHoneyMultiplierBps,
  isFoundingBeeAddress,
  isHiveEvmAddress,
} from "@/lib/config/hive-staking";
import {
  HIVE_STAKE_VAULT_ABI,
  createHiveStakingPublicClient,
  hiveStakingContractAddress,
  hiveTierForStakedRaw,
} from "@/lib/services/hive-staking";

const LINK_PATH = join(homedir(), ".hivemindos", "honey-wallet-link.json");
const STAKE_READ_TIMEOUT_MS = 10_000;

export type HoneyWalletLinkCache = {
  multiplierBps: number;
  tierId: string | null;
  foundingBee: boolean;
  stakedHive: string | null;
  checkedAt: string;
};

export type HoneyWalletLink = {
  address: string;
  linkedAt: string;
  // Whether the official compute gateway accepted the signature-verified link.
  gatewayLinked: boolean;
  cache?: HoneyWalletLinkCache;
};

let memoryLink: HoneyWalletLink | null | undefined;
let refreshing = false;

export async function readHoneyWalletLink(): Promise<HoneyWalletLink | null> {
  try {
    const parsed = JSON.parse(await readFile(LINK_PATH, "utf8")) as Partial<HoneyWalletLink>;
    if (typeof parsed.address !== "string" || !isHiveEvmAddress(parsed.address)) return null;
    return {
      address: parsed.address.toLowerCase(),
      linkedAt: typeof parsed.linkedAt === "string" ? parsed.linkedAt : new Date(0).toISOString(),
      gatewayLinked: parsed.gatewayLinked === true,
      cache: normalizeCache(parsed.cache),
    };
  } catch {
    return null;
  }
}

export async function writeHoneyWalletLink(link: HoneyWalletLink): Promise<void> {
  await mkdir(dirname(LINK_PATH), { recursive: true });
  await writeFile(LINK_PATH, `${JSON.stringify(link, null, 2)}\n`, "utf8");
  memoryLink = link;
}

// Non-blocking accessor for the mint paths: returns the cached multiplier
// immediately (base 1.00x until a link exists and a stake read has landed) and
// refreshes in the background once per UTC-day epoch.
export function getLocalHoneyMultiplierBpsCached(): number {
  refreshInBackground();
  const cache = memoryLink?.cache;
  return cache && Number.isInteger(cache.multiplierBps) ? cache.multiplierBps : HONEY_MULTIPLIER_BASE_BPS;
}

// Blocking resolver used by the link/status API actions.
export async function resolveLocalHoneyMultiplier(): Promise<HoneyWalletLinkCache & { address: string | null }> {
  const link = memoryLink === undefined ? await readHoneyWalletLink() : memoryLink;
  memoryLink = link;
  if (!link) {
    return { multiplierBps: HONEY_MULTIPLIER_BASE_BPS, tierId: null, foundingBee: false, stakedHive: null, checkedAt: new Date(0).toISOString(), address: null };
  }
  if (!isCacheFresh(link.cache)) {
    const refreshed = await refreshLinkCache(link);
    return { ...(refreshed.cache ?? fallbackCache(link)), address: refreshed.address };
  }
  return { ...(link.cache ?? fallbackCache(link)), address: link.address };
}

// Epoch = UTC day: matches the gateway and the daily reward-token caps.
function isCacheFresh(cache: HoneyWalletLinkCache | undefined): boolean {
  return Boolean(cache && cache.checkedAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
}

function refreshInBackground(): void {
  if (refreshing) return;
  if (memoryLink !== undefined && (!memoryLink || isCacheFresh(memoryLink.cache))) return;
  refreshing = true;
  void (async () => {
    const link = memoryLink === undefined ? await readHoneyWalletLink() : memoryLink;
    memoryLink = link;
    if (link && !isCacheFresh(link.cache)) await refreshLinkCache(link);
  })().catch(() => undefined).finally(() => {
    refreshing = false;
  });
}

// Reads the current stake and rewrites the cached multiplier. A failed RPC read
// keeps the previous cache (fail closed to last-known) and retries on the next
// refresh instead of guessing a tier.
async function refreshLinkCache(link: HoneyWalletLink): Promise<HoneyWalletLink> {
  const stakedRaw = await readStakedRaw(link.address);
  if (stakedRaw === null) return link;
  const tier = hiveTierForStakedRaw(stakedRaw);
  const foundingBee = isFoundingBeeAddress(link.address);
  const next: HoneyWalletLink = {
    ...link,
    cache: {
      multiplierBps: combinedHoneyMultiplierBps(tier?.rewardMultiplierBps, foundingBee),
      tierId: tier?.id ?? null,
      foundingBee,
      stakedHive: String(stakedRaw / 10n ** 18n),
      checkedAt: new Date().toISOString(),
    },
  };
  await writeHoneyWalletLink(next).catch(() => undefined);
  memoryLink = next;
  return next;
}

async function readStakedRaw(address: string): Promise<bigint | null> {
  try {
    const contractAddress = hiveStakingContractAddress();
    if (!contractAddress || !isHiveEvmAddress(address)) return null;
    const client = createHiveStakingPublicClient();
    return await Promise.race([
      client.readContract({
        address: contractAddress,
        abi: HIVE_STAKE_VAULT_ABI,
        functionName: "stakedBalanceOf",
        args: [address],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stake read timeout")), STAKE_READ_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

function fallbackCache(link: HoneyWalletLink): HoneyWalletLinkCache {
  return link.cache ?? {
    multiplierBps: combinedHoneyMultiplierBps(HONEY_MULTIPLIER_BASE_BPS, isFoundingBeeAddress(link.address)),
    tierId: null,
    foundingBee: isFoundingBeeAddress(link.address),
    stakedHive: null,
    checkedAt: new Date(0).toISOString(),
  };
}

function normalizeCache(value: unknown): HoneyWalletLinkCache | undefined {
  if (!value || typeof value !== "object") return undefined;
  const cache = value as Partial<HoneyWalletLinkCache>;
  if (!Number.isInteger(cache.multiplierBps) || typeof cache.checkedAt !== "string") return undefined;
  return {
    multiplierBps: cache.multiplierBps as number,
    tierId: typeof cache.tierId === "string" ? cache.tierId : null,
    foundingBee: cache.foundingBee === true,
    stakedHive: typeof cache.stakedHive === "string" ? cache.stakedHive : null,
    checkedAt: cache.checkedAt,
  };
}

// Test-only: reset the module cache so hermetic tests can swap HOME dirs.
export function resetHoneyWalletLinkCacheForTests(): void {
  memoryLink = undefined;
  refreshing = false;
}

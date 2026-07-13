import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";

/**
 * Last-seen free-tier allowance for HivemindOS Models. The hosted gateway is
 * the sole authority on the daily allowance but only reports it via
 * `X-HivemindOS-Free-Remaining-*` response headers on completions — there is
 * no query endpoint, and probing would spend allowance. So the local gateway
 * proxy records the headers from every real free call here, and the UI meter
 * reads this snapshot ("as of last use").
 */
export type FreeModelAllowanceSnapshot = {
  remainingRequests: number | null;
  remainingTokens: number | null;
  /** When the hosted gateway says the allowance resets (its header value). */
  resetAt: string | null;
  /** When this machine last observed these numbers (ISO). */
  observedAt: string;
  /** Highest remaining values seen in the current reset window — the meter
   *  denominator, since the gateway never reports the maximum directly. */
  highWaterRequests: number | null;
  highWaterTokens: number | null;
  /** Verified hosted entitlement observed on the same completion. */
  stakeTierId: string | null;
  stakeTierLabel: string | null;
  quotaMultiplierBps: number | null;
};

const ALLOWANCE_PATH = join(
  homedir(),
  ".hivemindos",
  "cache",
  "hivemindos-free-allowance.json",
);

function asCount(value: string | null | undefined): number | null {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

export async function readFreeModelAllowance(): Promise<FreeModelAllowanceSnapshot | null> {
  try {
    const raw = await readFile(ALLOWANCE_PATH, "utf8");
    const data = JSON.parse(raw) as FreeModelAllowanceSnapshot;
    if (!data || typeof data !== "object" || typeof data.observedAt !== "string") return null;
    return {
      ...data,
      stakeTierId: typeof data.stakeTierId === "string" ? data.stakeTierId : null,
      stakeTierLabel: typeof data.stakeTierLabel === "string" ? data.stakeTierLabel : null,
      quotaMultiplierBps: asQuotaMultiplierBps(data.quotaMultiplierBps),
    };
  } catch {
    return null;
  }
}

/** Record the allowance headers from one real free-model response. Best-effort:
 *  a write failure must never fail the chat call that carried the headers. */
export async function recordFreeModelAllowance(headers: {
  remainingRequests?: string | null;
  remainingTokens?: string | null;
  resetAt?: string | null;
  stakeTierId?: string | null;
  stakeTierLabel?: string | null;
  quotaMultiplierBps?: string | null;
}): Promise<void> {
  const remainingRequests = asCount(headers.remainingRequests);
  const remainingTokens = asCount(headers.remainingTokens);
  const resetAt = headers.resetAt?.trim() || null;
  const hasRemainingCount = remainingRequests !== null || remainingTokens !== null;
  const stakeTierId = cleanStakeTier(headers.stakeTierId);
  const stakeTierLabel = stakeTierId ? cleanTierLabel(headers.stakeTierLabel) : null;
  const quotaMultiplierBps = asQuotaMultiplierBps(headers.quotaMultiplierBps);
  if (!hasRemainingCount || !resetAt || !Number.isFinite(Date.parse(resetAt))) return;
  try {
    const prior = await readFreeModelAllowance();
    // A changed reset marker means a new daily window: high-water restarts at
    // the fresh remaining values instead of carrying yesterday's ceiling.
    const sameWindow = Boolean(prior && (prior.resetAt ?? null) === resetAt);
    const highWater = (current: number | null, previous: number | null) => {
      if (current === null) return sameWindow ? previous : null;
      if (!sameWindow || previous === null) return current;
      return Math.max(previous, current);
    };
    const snapshot: FreeModelAllowanceSnapshot = {
      remainingRequests,
      remainingTokens,
      resetAt,
      observedAt: new Date().toISOString(),
      highWaterRequests: highWater(remainingRequests, prior?.highWaterRequests ?? null),
      highWaterTokens: highWater(remainingTokens, prior?.highWaterTokens ?? null),
      stakeTierId,
      stakeTierLabel,
      quotaMultiplierBps,
    };
    await mkdir(dirname(ALLOWANCE_PATH), { recursive: true, mode: 0o700 });
    const temporaryPath = `${ALLOWANCE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporaryPath, ALLOWANCE_PATH);
  } catch {
    // best-effort only
  }
}

function cleanStakeTier(value: unknown): string | null {
  const tier = String(value ?? "").trim().toLowerCase();
  return ["holder", "supporter", "builder", "curator", "operator", "visionary"].includes(tier)
    ? tier
    : null;
}

function cleanTierLabel(value: unknown): string | null {
  const label = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
  return label || null;
}

function asQuotaMultiplierBps(value: unknown): number | null {
  const parsed = Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed >= 10_000 && parsed <= 20_000 ? parsed : null;
}

import "server-only";

import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { homedir } from "@/lib/home-dir";

/**
 * Machine-wide lease for the marketplace monitor driver — the company-driver
 * lease shape (wx-create + pid-liveness + stale takeover), marketplace-scoped:
 * every Next server process runs the loop, exactly one per machine actively
 * ticks, and standbys take over when the holder dies. Critically important
 * here because ticks can open a real browser profile — two holders would race
 * the profile lock and double-poll Facebook.
 *
 * Disable with HIVEMINDOS_MARKETPLACE_DRIVER_LEASE=0 (every instance ticks).
 */

export type MarketplaceDriverLeaseHolder = {
  pid: number;
  port: string;
  startedAt: number;
  renewedAt: number;
};

export type MarketplaceDriverLeaseState = {
  held: boolean;
  holder?: MarketplaceDriverLeaseHolder;
};

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Holders renew on every loop wake (seconds-scale); minutes of silence means wedged.
const leaseStaleMs = () => envNum("HIVEMINDOS_MARKETPLACE_DRIVER_LEASE_STALE_MS", 5 * 60_000);

function leasePath(): string {
  const override = process.env.HIVEMINDOS_MARKETPLACE_DRIVER_LEASE_FILE?.trim();
  if (override) return override;
  return join(homedir(), ".hivemindos", "marketplace-monitor-driver.lease.json");
}

export function marketplaceDriverLeaseDisabled(): boolean {
  return (process.env.HIVEMINDOS_MARKETPLACE_DRIVER_LEASE || "").trim() === "0";
}

function parseHolder(raw: string): MarketplaceDriverLeaseHolder | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MarketplaceDriverLeaseHolder>;
    if (typeof parsed?.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return {
      pid: parsed.pid,
      port: typeof parsed.port === "string" ? parsed.port : "",
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      renewedAt: typeof parsed.renewedAt === "number" ? parsed.renewedAt : 0,
    };
  } catch {
    return null;
  }
}

function holderProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function holderExpired(holder: MarketplaceDriverLeaseHolder, now: number): boolean {
  if (now - holder.renewedAt > leaseStaleMs()) return true;
  if (holder.pid === process.pid) return false;
  return !holderProcessAlive(holder.pid);
}

function ownHolder(now: number, startedAt?: number): MarketplaceDriverLeaseHolder {
  return {
    pid: process.pid,
    port: process.env.PORT?.trim() ?? "",
    startedAt: startedAt ?? now,
    renewedAt: now,
  };
}

/** Acquire if free/stale/dead, renew if held by us, else report the live holder. Never throws. */
export async function acquireOrRenewMarketplaceDriverLease(): Promise<MarketplaceDriverLeaseState> {
  const path = leasePath();
  const now = Date.now();
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const raw = await readFile(path, "utf8").catch(() => "");
    const holder = raw ? parseHolder(raw) : null;
    if (holder && holder.pid === process.pid) {
      const renewed = ownHolder(now, holder.startedAt);
      await writeFile(path, JSON.stringify(renewed) + "\n", { mode: 0o600 });
      return { held: true, holder: renewed };
    }
    if (holder && !holderExpired(holder, now)) {
      return { held: false, holder };
    }
    if (raw) await rm(path, { force: true }).catch(() => undefined);
    const claim = ownHolder(now);
    try {
      await writeFile(path, JSON.stringify(claim) + "\n", { flag: "wx", mode: 0o600 });
      return { held: true, holder: claim };
    } catch {
      const winnerRaw = await readFile(path, "utf8").catch(() => "");
      const winner = winnerRaw ? parseHolder(winnerRaw) : null;
      return winner && winner.pid === process.pid ? { held: true, holder: winner } : { held: false, holder: winner ?? undefined };
    }
  } catch {
    // Filesystem trouble degrades to "nobody ticks", never "everybody ticks".
    return { held: false };
  }
}

/** Release iff this process holds it. */
export async function releaseMarketplaceDriverLease(): Promise<void> {
  const path = leasePath();
  try {
    const raw = await readFile(path, "utf8");
    const holder = parseHolder(raw);
    if (holder?.pid === process.pid) await rm(path, { force: true });
  } catch {
    // nothing to release
  }
}

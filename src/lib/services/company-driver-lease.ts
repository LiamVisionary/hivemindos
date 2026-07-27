import "server-only";

import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join } from "path";

/**
 * Machine-wide lease for the company-autonomy driver.
 *
 * The driver auto-starts in EVERY Next server process (instrumentation.ts), and
 * a dev box routinely runs several at once (pnpm dev, tauri dev, verify
 * servers). Without coordination each instance independently ticks the SAME
 * shared Work Board every 5 minutes — duplicate fleet scans, duplicate
 * reclaim/redispatch passes, and potentially duplicate real agent dispatches
 * (observed: an agent-runtime call fired on dev-server boot because a second
 * driver picked up a stranded task).
 *
 * This lease elects exactly one ACTIVE driver per machine. Every server still
 * runs its driver loop, but standby instances only poll the lease (a tiny file
 * read) and take over when the holder goes away:
 *   - graceful stop releases the lease;
 *   - a killed process is detected by pid-liveness (ESRCH) on the next poll;
 *   - a wedged-but-alive holder ages out via the renewal timestamp.
 * The packaged desktop app runs one embedded server, so behavior there is
 * unchanged. Same wx-create + stale-takeover shape as the veil transfer lock.
 *
 * Disable with HIVEMINDOS_COMPANY_DRIVER_LEASE=0 (every instance ticks, the
 * pre-lease behavior).
 */

export type CompanyDriverLeaseHolder = {
  pid: number;
  port: string;
  startedAt: number;
  renewedAt: number;
};

export type CompanyDriverLeaseState = {
  held: boolean;
  holder?: CompanyDriverLeaseHolder;
};

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// A holder renews once per driver tick (default 5 min); three missed renewals
// means it is wedged or gone even if its pid is still alive.
const leaseStaleMs = () => envNum("HIVEMINDOS_COMPANY_DRIVER_LEASE_STALE_MS", 15 * 60_000);

function leasePath(): string {
  const override = process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE_FILE?.trim();
  if (override) return override;
  return join(homedir(), ".hivemindos", "company-autonomy-driver.lease.json");
}

export function companyDriverLeaseDisabled(): boolean {
  return (process.env.HIVEMINDOS_COMPANY_DRIVER_LEASE || "").trim() === "0";
}

function parseHolder(raw: string): CompanyDriverLeaseHolder | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CompanyDriverLeaseHolder>;
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
    // EPERM = exists but owned by another user → alive. ESRCH (and anything
    // else) → treat as gone; the staleness window still backstops pid reuse.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function holderExpired(holder: CompanyDriverLeaseHolder, now: number): boolean {
  if (now - holder.renewedAt > leaseStaleMs()) return true;
  if (holder.pid === process.pid) return false;
  return !holderProcessAlive(holder.pid);
}

function ownHolder(now: number, startedAt?: number): CompanyDriverLeaseHolder {
  return {
    pid: process.pid,
    port: process.env.PORT?.trim() ?? "",
    startedAt: startedAt ?? now,
    renewedAt: now,
  };
}

async function tryCreateLease(path: string, holder: CompanyDriverLeaseHolder): Promise<boolean> {
  try {
    await writeFile(path, JSON.stringify(holder) + "\n", { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire the lease if it's free/stale/dead, renew it if we already hold it,
 * or report the live holder. Never throws; on filesystem trouble it reports
 * not-held so a broken disk degrades to "nobody ticks" rather than "everybody
 * ticks".
 */
export async function acquireOrRenewCompanyDriverLease(): Promise<CompanyDriverLeaseState> {
  const path = leasePath();
  const now = Date.now();
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const raw = await readFile(path, "utf8").catch(() => "");
    const holder = raw ? parseHolder(raw) : null;

    if (holder && holder.pid === process.pid) {
      // Renewal: we own the file, a plain overwrite is safe.
      const renewed = ownHolder(now, holder.startedAt);
      await writeFile(path, JSON.stringify(renewed) + "\n", { mode: 0o600 });
      return { held: true, holder: renewed };
    }

    if (holder && !holderExpired(holder, now)) {
      return { held: false, holder };
    }

    // Free, corrupt, stale, or dead-pid lease: contend for it. rm+wx keeps the
    // race window tiny; the loser reads back whoever won.
    if (raw) await rm(path, { force: true }).catch(() => undefined);
    const claim = ownHolder(now);
    if (await tryCreateLease(path, claim)) {
      return { held: true, holder: claim };
    }
    const winnerRaw = await readFile(path, "utf8").catch(() => "");
    const winner = winnerRaw ? parseHolder(winnerRaw) : null;
    return winner && winner.pid === process.pid
      ? { held: true, holder: winner }
      : { held: false, holder: winner ?? undefined };
  } catch {
    return { held: false };
  }
}

/** Release the lease iff this process holds it (never someone else's). */
export async function releaseCompanyDriverLease(): Promise<void> {
  const path = leasePath();
  try {
    const raw = await readFile(path, "utf8");
    const holder = parseHolder(raw);
    if (holder?.pid === process.pid) await rm(path, { force: true });
  } catch {
    // No lease file (or unreadable) — nothing to release.
  }
}

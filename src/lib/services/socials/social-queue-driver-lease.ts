import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { homedir } from "@/lib/home-dir";

export type SocialQueueDriverLeaseHolder = { pid: number; port: string; startedAt: number; renewedAt: number };
export type SocialQueueDriverLeaseState = { held: boolean; holder?: SocialQueueDriverLeaseHolder };

function leasePath(): string {
  return process.env.HIVEMINDOS_SOCIAL_QUEUE_DRIVER_LEASE_FILE?.trim()
    || join(homedir(), ".hivemindos", "social-queue-driver.lease.json");
}

function staleMs(): number {
  const parsed = Number(process.env.HIVEMINDOS_SOCIAL_QUEUE_DRIVER_LEASE_STALE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 60_000;
}

export function socialQueueDriverLeaseDisabled(): boolean {
  return (process.env.HIVEMINDOS_SOCIAL_QUEUE_DRIVER_LEASE || "").trim() === "0";
}

function parseHolder(raw: string): SocialQueueDriverLeaseHolder | null {
  try {
    const value = JSON.parse(raw) as Partial<SocialQueueDriverLeaseHolder>;
    if (!Number.isInteger(value.pid) || (value.pid ?? 0) <= 0) return null;
    return {
      pid: value.pid!,
      port: typeof value.port === "string" ? value.port : "",
      startedAt: typeof value.startedAt === "number" ? value.startedAt : 0,
      renewedAt: typeof value.renewedAt === "number" ? value.renewedAt : 0,
    };
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ownHolder(now: number, startedAt = now): SocialQueueDriverLeaseHolder {
  return { pid: process.pid, port: process.env.PORT?.trim() ?? "", startedAt, renewedAt: now };
}

export async function acquireOrRenewSocialQueueDriverLease(): Promise<SocialQueueDriverLeaseState> {
  const file = leasePath();
  const now = Date.now();
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const raw = await readFile(file, "utf8").catch(() => "");
    const holder = raw ? parseHolder(raw) : null;
    if (holder?.pid === process.pid) {
      const renewed = ownHolder(now, holder.startedAt);
      await writeFile(file, `${JSON.stringify(renewed)}\n`, { mode: 0o600 });
      return { held: true, holder: renewed };
    }
    const expired = holder && (now - holder.renewedAt > staleMs() || !processAlive(holder.pid));
    if (holder && !expired) return { held: false, holder };
    if (raw) await rm(file, { force: true }).catch(() => undefined);
    const claim = ownHolder(now);
    try {
      await writeFile(file, `${JSON.stringify(claim)}\n`, { flag: "wx", mode: 0o600 });
      return { held: true, holder: claim };
    } catch {
      const winner = parseHolder(await readFile(file, "utf8").catch(() => ""));
      return winner?.pid === process.pid ? { held: true, holder: winner } : { held: false, ...(winner ? { holder: winner } : {}) };
    }
  } catch {
    return { held: false };
  }
}

export async function releaseSocialQueueDriverLease(): Promise<void> {
  const file = leasePath();
  try {
    const holder = parseHolder(await readFile(file, "utf8"));
    if (holder?.pid === process.pid) await rm(file, { force: true });
  } catch {
    // Nothing to release.
  }
}

import { mkdir, open, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";

/**
 * Mutual exclusion for a managed marketplace browser profile: one persistent
 * profile supports exactly one live browser at a time, so scripted probes must
 * never race an in-flight agent session (and vice versa). BOTH sides hold it:
 * probes acquire around their scripted reads, and the dispatch rail holds it
 * (with mtime renewal) for the whole minutes-long agent session — before that
 * renewal existed, only probes locked and the monitor happily probed mid-
 * session. Mirrors the beeline browser lock in browser-use-runner.ts:
 * wx-create + pid stamp + stale takeover, keyed by profile name under the
 * marketplace lock directory.
 */

const LOCK_STALE_MS = 10 * 60_000; // contender-side takeover; live holders renew mtime well inside this
const LOCK_POLL_MS = 250;
/** Renewal cadence for long-held session locks — keeps mtime far fresher than the stale window. */
export const MARKETPLACE_SESSION_LOCK_RENEW_MS = 60_000;

function lockDirectory(): string {
  return join(homedir(), ".hivemindos", "marketplace", "browser-locks");
}

export class MarketplaceProfileBusyError extends Error {
  constructor(profileName: string) {
    super(`The browser profile "${profileName}" is busy with another marketplace session. Try again in a moment.`);
    this.name = "MarketplaceProfileBusyError";
  }
}

/**
 * Acquire the profile lock, waiting up to `waitMs`. Returns a release
 * function. Throws MarketplaceProfileBusyError when the wait budget runs out.
 * `renewEveryMs` keeps the lock's mtime fresh for holds longer than the stale
 * window (agent sessions run up to an hour; without renewal a contender would
 * steal the lock mid-session at the 10-minute mark). The renewal timer is
 * unref'd and cleared on release; a crashed holder stops renewing, so the
 * stale takeover still recovers the lock.
 */
export async function acquireMarketplaceProfileLock(
  profileName: string,
  waitMs = 5_000,
  options?: { renewEveryMs?: number },
): Promise<() => Promise<void>> {
  const safe = profileName.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(safe)) throw new Error(`Invalid marketplace profile name: ${profileName}`);
  const directory = lockDirectory();
  const lockPath = join(directory, `${safe}.lock`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`);
      let renewTimer: NodeJS.Timeout | undefined;
      if (options?.renewEveryMs && options.renewEveryMs > 0) {
        renewTimer = setInterval(() => {
          const now = new Date();
          void utimes(lockPath, now, now).catch(() => undefined);
        }, options.renewEveryMs);
        renewTimer.unref?.();
      }
      return async () => {
        if (renewTimer) clearInterval(renewTimer);
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const modified = await stat(lockPath).then((value) => value.mtimeMs).catch(() => 0);
      if (modified && Date.now() - modified > LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      if (Date.now() >= deadline) throw new MarketplaceProfileBusyError(safe);
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

/**
 * Hold the profile lock (with renewal) for the duration of `run` — the rail
 * dispatched agent sessions use so probes and sessions are truly mutually
 * exclusive. The generous default wait lets a session queue briefly behind a
 * seconds-long scripted probe instead of failing.
 */
export async function withMarketplaceSessionLock<T>(
  profileName: string,
  run: () => Promise<T>,
  options?: { waitMs?: number; renewEveryMs?: number },
): Promise<T> {
  const release = await acquireMarketplaceProfileLock(profileName, options?.waitMs ?? 30_000, {
    renewEveryMs: options?.renewEveryMs ?? MARKETPLACE_SESSION_LOCK_RENEW_MS,
  });
  try {
    return await run();
  } finally {
    await release();
  }
}

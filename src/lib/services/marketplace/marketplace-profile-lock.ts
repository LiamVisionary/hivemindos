import { mkdir, open, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "@/lib/home-dir";

/**
 * Mutual exclusion for a managed marketplace browser profile: one persistent
 * profile supports exactly one live browser at a time, so scripted probes must
 * never race an in-flight agent session (and vice versa). Mirrors the beeline
 * browser lock in browser-use-runner.ts: wx-create + pid stamp + stale
 * takeover, but keyed by profile name under the marketplace lock directory.
 */

const LOCK_STALE_MS = 10 * 60_000; // agent listing sessions can legitimately run for minutes
const LOCK_POLL_MS = 250;

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
 */
export async function acquireMarketplaceProfileLock(profileName: string, waitMs = 5_000): Promise<() => Promise<void>> {
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
      return async () => {
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

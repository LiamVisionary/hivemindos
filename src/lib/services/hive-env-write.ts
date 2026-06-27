import "server-only";

import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Server-side writer for shared hive env credentials.
 *
 * Mirrors the spawn pattern in src/app/api/env/route.ts (updateHiveEnvSource):
 * pipes the secret to `scripts/hive-env-add` over stdin (never as an argv, so it
 * can't leak via the process list) and never logs the value. Extracted here so
 * flows that mint a credential server-side (e.g. ClawBank onboarding) can persist
 * it without round-tripping the secret to the browser.
 */

const SHARED_SOURCE = { scope: "agent", runtime: "generic" } as const;
const RUNTIME_MIRRORS = [
  { scope: "agent", runtime: "openclaw" },
  { scope: "agent", runtime: "hermes" },
  { scope: "agent", runtime: "aeon" },
] as const;

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type EnvScope = { scope: string; runtime: string };

function spawnHiveEnvAdd(scope: EnvScope, key: string, value: string, options: { backup?: boolean; sync?: boolean } = {}) {
  const args = ["--stdin", "--scope", scope.scope, "--runtime", scope.runtime, key];
  if (options.backup === false) args.splice(1, 0, "--no-backup");
  if (options.sync === false) args.splice(1, 0, "--no-tailnet-sync");
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while saving the credential."));
    }, 30_000);
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || "hive-env-add could not save the credential."));
    });
    child.stdin.end(value);
  });
}

/**
 * Write a credential to the shared hive env (~/.hivemindos/.env) and mirror it
 * into the per-runtime envs, exactly like a shared-key save through /api/env.
 * The shared write carries the GPG backup + Tailnet sync; runtime mirrors skip
 * both (best-effort, never fatal). Throws on the shared write failing.
 */
export async function writeSharedHiveEnvValue(key: string, value: string): Promise<void> {
  const safeKey = key.trim();
  if (!ENV_KEY_RE.test(safeKey)) throw new Error(`Invalid env variable name: ${key}`);
  if (!value) throw new Error("Refusing to write an empty credential value.");
  await spawnHiveEnvAdd(SHARED_SOURCE, safeKey, value);
  await Promise.all(
    RUNTIME_MIRRORS.map((target) => spawnHiveEnvAdd(target, safeKey, value, { backup: false, sync: false }).catch(() => undefined)),
  );
}

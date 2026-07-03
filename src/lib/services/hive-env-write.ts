import "server-only";

import { spawn } from "node:child_process";
import { join } from "node:path";

/**
 * Server-side writer for shared hive env credentials.
 *
 * Every write routes through `scripts/hive-env-add` (the spawn pattern of
 * src/app/api/env/route.ts updateHiveEnvSource) instead of touching the env
 * files directly: hive-env-add serializes writers through the sidecar lock,
 * writes atomically, stamps per-key updatedAt meta so env-sync reconcile
 * treats the write as current, refreshes the encrypted backup, and pushes to
 * Tailnet peers. Values travel over stdin (never argv, so they can't leak via
 * the process list) and are never logged.
 */

const SHARED_SOURCE = { scope: "agent", runtime: "generic" } as const;
const RUNTIME_MIRRORS = [
  { scope: "agent", runtime: "openclaw" },
  { scope: "agent", runtime: "hermes" },
  { scope: "agent", runtime: "aeon" },
] as const;

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type EnvScope = { scope: string; runtime: string };

function runHiveEnvAdd(args: string[], stdinText: string) {
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
    child.stdin.end(stdinText);
  });
}

function importStdinArgs(scope: EnvScope, options: { backup?: boolean; sync?: boolean } = {}) {
  const args = ["--import-stdin", "--scope", scope.scope, "--runtime", scope.runtime];
  if (options.backup === false) args.push("--no-backup");
  if (options.sync === false) args.push("--no-tailnet-sync");
  return args;
}

/**
 * Encode values as one .env assignment per line for --import-stdin. Values
 * without single quotes stay single-quoted (hive-env-add's parser strips one
 * outer quote pair and leaves the interior untouched). Values containing a
 * single quote use double quotes with backslash escapes, which the parser
 * decodes — the same format the collector's peer-push payloads already use.
 */
function encodeEnvValue(value: string) {
  if (value.includes("'")) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `'${value}'`;
}

function encodeEnvAssignments(values: Record<string, string>) {
  const entries = Object.entries(values);
  if (entries.length === 0) throw new Error("No env values to write.");
  const lines = entries.map(([rawKey, value]) => {
    const key = rawKey.trim();
    if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid env variable name: ${rawKey}`);
    if (!value) throw new Error(`Refusing to write an empty value for ${key} (hive-env-add deletes the key on empty).`);
    if ([...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) {
      throw new Error(`Refusing to write control characters in the value of ${key}.`);
    }
    return `${key}=${encodeEnvValue(value)}`;
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Write credentials to the shared hive env (~/.hivemindos/.env) and mirror
 * them into the per-runtime envs, exactly like a shared-key save through
 * /api/env — one hive-env-add invocation per store. The shared write carries
 * the GPG backup + Tailnet sync; runtime mirrors skip both (best-effort,
 * never fatal). Throws on the shared write failing.
 */
export async function writeSharedHiveEnvValues(values: Record<string, string>): Promise<void> {
  const payload = encodeEnvAssignments(values);
  await runHiveEnvAdd(importStdinArgs(SHARED_SOURCE), payload);
  await Promise.all(
    RUNTIME_MIRRORS.map((target) =>
      runHiveEnvAdd(importStdinArgs(target, { backup: false, sync: false }), payload).catch(() => undefined),
    ),
  );
}

export async function writeSharedHiveEnvValue(key: string, value: string): Promise<void> {
  await writeSharedHiveEnvValues({ [key]: value });
}

/**
 * Ensure a bare `KEY=` line exists in the shared hive env for flows that open
 * the file for manual editing. Runs under hive-env-add's store lock, so the
 * append can never drop a concurrent writer's key; the placeholder carries no
 * updatedAt meta and never syncs, so it cannot overwrite a peer's real value.
 */
export async function ensureSharedHiveEnvPlaceholder(key: string): Promise<void> {
  const safeKey = key.trim();
  if (!ENV_KEY_RE.test(safeKey)) throw new Error(`Invalid env variable name: ${key}`);
  await runHiveEnvAdd(
    ["--ensure-placeholder", "--scope", SHARED_SOURCE.scope, "--runtime", SHARED_SOURCE.runtime, safeKey],
    "",
  );
}

import { execFile, spawn } from "child_process";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const SHARED_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function serializeSharedAgentEnvValues(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => {
      if (!SHARED_ENV_KEY_RE.test(key)) throw new Error(`Invalid shared env key: ${key}`);
      return `${key}=${JSON.stringify(value)}`;
    })
    .join("\n") + "\n";
}

/**
 * Canonical read/write access to the shared hive env (`hive-env-add`) for
 * integration credentials. Values written here replicate to every machine in
 * the fleet automatically, so app connections never need a "host machine".
 */
export async function readSharedAgentEnv(): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync(join(process.cwd(), "scripts", "hive-env-add"), [
      "--export-json",
      "--scope",
      "agent",
      "--runtime",
      "generic",
    ], {
      timeout: 12_000,
      maxBuffer: 1_000_000,
    });
    const payload = JSON.parse(stdout) as { values?: Record<string, string> };
    return payload.values && typeof payload.values === "object" ? payload.values : {};
  } catch {
    return {};
  }
}

/** Save a shared env key. An empty value removes the key. */
function runSharedEnvWriter(args: string[], input: string, description: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out while saving ${description}.`));
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
      reject(new Error(errorText.trim() || `hive-env-add could not save ${description}.`));
    });
    child.stdin.end(input);
  });
}

/** Save a shared env key. An empty value removes the key. */
export function saveSharedAgentEnv(key: string, value: string) {
  return runSharedEnvWriter([
    "--stdin",
    "--scope",
    "agent",
    "--runtime",
    "generic",
    key,
  ], value, key);
}

/** Save several shared env keys through one backup and fleet replication cycle. */
export function saveSharedAgentEnvValues(values: Record<string, string>) {
  const count = Object.keys(values).length;
  if (!count) return Promise.resolve();
  return runSharedEnvWriter([
    "--import-stdin",
    "--scope",
    "agent",
    "--runtime",
    "generic",
  ], serializeSharedAgentEnvValues(values), `${count} shared env values`);
}

export function removeSharedAgentEnv(key: string) {
  return saveSharedAgentEnv(key, "");
}

export function sharedEnvValue(key: string, sharedEnv: Record<string, string>) {
  return process.env[key]?.trim() || sharedEnv[key]?.trim() || "";
}

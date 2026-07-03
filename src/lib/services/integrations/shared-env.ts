import { execFile, spawn } from "child_process";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

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
export function saveSharedAgentEnv(key: string, value: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.cwd(), "scripts", "hive-env-add"), [
      "--stdin",
      "--scope",
      "agent",
      "--runtime",
      "generic",
      key,
    ], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out while saving ${key}.`));
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
      reject(new Error(errorText.trim() || `hive-env-add could not save ${key}.`));
    });
    child.stdin.end(value);
  });
}

export function removeSharedAgentEnv(key: string) {
  return saveSharedAgentEnv(key, "");
}

export function sharedEnvValue(key: string, sharedEnv: Record<string, string>) {
  return process.env[key]?.trim() || sharedEnv[key]?.trim() || "";
}

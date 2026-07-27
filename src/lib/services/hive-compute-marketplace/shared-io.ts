import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { homedir } from "@/lib/home-dir";
import type { HiveComputeEnvPresence } from "@/lib/types/hive-compute-marketplace";

/** Small IO helpers shared by the Hive Compute marketplace service and its
 * backend-discovery module (single source; do not re-inline in either). */

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");

export type EnvRead = HiveComputeEnvPresence & { value: string };

let hiveEnvCache: Promise<string> | null = null;

export function parseEnvFileValue(raw: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m"));
  if (!match) return "";
  const value = match[1].trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export async function readEnv(key: string): Promise<EnvRead> {
  const processValue = process.env[key]?.trim();
  if (processValue) return { name: key, value: processValue, present: true, source: "process" };
  if (!hiveEnvCache) hiveEnvCache = readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  const value = parseEnvFileValue(await hiveEnvCache, key);
  return value
    ? { name: key, value, present: true, source: "shared-hive-env" }
    : { name: key, value: "", present: false };
}

export async function readSavedEnvValue(key: string) {
  return (await readEnv(key)).value;
}

export function envPresence(read: EnvRead): HiveComputeEnvPresence {
  return {
    name: read.name,
    present: read.present,
    ...(read.source ? { source: read.source } : {}),
  };
}

export async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function joinUrl(base: string, suffix: string) {
  return `${base.trim().replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export function booleanSetting(value: string) {
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

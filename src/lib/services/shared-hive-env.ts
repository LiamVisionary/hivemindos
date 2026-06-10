import "server-only";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const HIVE_ENV_FILE = join(homedir(), ".hivemindos", ".env");

export type HiveEnvPresence = {
  key: string;
  present: boolean;
  source: "process" | "shared-hive-env" | "missing";
};

export async function hiveEnvValue(key: string): Promise<string> {
  const safeKey = cleanEnvKey(key);
  const processValue = process.env[safeKey]?.trim();
  if (processValue) return processValue;
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  return parseEnvFileValue(raw, safeKey);
}

export async function hiveEnvPresence(keys: readonly string[]): Promise<HiveEnvPresence[]> {
  const raw = await readFile(HIVE_ENV_FILE, "utf8").catch(() => "");
  return keys.map((key) => {
    const safeKey = cleanEnvKey(key);
    if (process.env[safeKey]?.trim()) return { key: safeKey, present: true, source: "process" };
    if (parseEnvFileValue(raw, safeKey)) return { key: safeKey, present: true, source: "shared-hive-env" };
    return { key: safeKey, present: false, source: "missing" };
  });
}

export async function anyHiveEnvPresent(keys: readonly string[]) {
  const presence = await hiveEnvPresence(keys);
  return {
    present: presence.some((item) => item.present),
    keys: presence,
  };
}

function cleanEnvKey(key: string) {
  const trimmed = key.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) throw new Error(`Invalid env key: ${key}`);
  return trimmed;
}

function parseEnvFileValue(raw: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.*)\\s*$`, "m");
  const match = raw.match(pattern);
  if (!match) return "";
  const value = match[1].trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replaceAll("\0", "").trim();
  }
  return value.replace(/\s+#.*$/, "").replaceAll("\0", "").trim();
}

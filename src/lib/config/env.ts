/**
 * Typed process.env access for app flags and settings, so required-ness and
 * parsing live in one place instead of scattered raw reads (209 distinct keys
 * were read ad hoc across src/). Credentials still belong to the shared hive
 * env service (src/lib/services/shared-hive-env.ts) — this module is for
 * plain configuration and feature flags.
 */
export function optionalEnv(key: string): string {
  return process.env[key]?.trim() ?? "";
}

export function requiredEnv(key: string): string {
  const value = optionalEnv(key);
  if (!value) throw new Error(`Missing required environment variable ${key}`);
  return value;
}

export function booleanEnv(key: string, defaultValue = false): boolean {
  const value = optionalEnv(key).toLowerCase();
  if (!value) return defaultValue;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function numberEnv(key: string, defaultValue: number): number {
  const value = Number(optionalEnv(key));
  return Number.isFinite(value) && optionalEnv(key) !== "" ? value : defaultValue;
}

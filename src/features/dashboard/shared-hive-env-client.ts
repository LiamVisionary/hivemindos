export type HiveEnvKeyResult = {
  keys: string[];
  error?: string;
};

export function isValidHiveEnvKey(key: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

export async function loadSharedHiveEnvKeys(): Promise<HiveEnvKeyResult> {
  const response = await fetch("/api/env?keysOnly=1").catch(() => null);
  const data = await response?.json().catch(() => null);
  if (!response?.ok || data?.ok === false) {
    return { keys: [], error: data?.error ?? "Could not read shared hive env names." };
  }
  const keys: string[] = Array.isArray(data?.sharedSource?.keys)
    ? data.sharedSource.keys.map(String)
    : Object.keys(data?.sharedSource?.values ?? {});
  return {
    keys: [...new Set(keys.filter(isValidHiveEnvKey))].sort((left, right) => left.localeCompare(right)),
  };
}

export async function saveSharedHiveEnvValue(envKey: string, value: string): Promise<string> {
  const key = String(envKey ?? "").trim();
  if (!isValidHiveEnvKey(key)) return "Use a valid env name like OPENAI_API_KEY.";
  if (!String(value ?? "").trim()) return "Paste the key value first.";
  const response = await fetch("/api/env", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId: "shared", key, value }),
  }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (!response?.ok || data?.ok === false) {
    return data?.error ?? "Could not save the key to the shared hive env.";
  }
  return "";
}

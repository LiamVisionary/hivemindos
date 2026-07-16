import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dashboardTokenKey = "HIVEMINDOS_DASHBOARD_DEVICE_TOKEN";

function envFileValue(path, key) {
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return "";
  }
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`^\\s*(?:export\\s+)?${escapedKey}\\s*=\\s*(.+)\\s*$`, "m"));
  let value = match?.[1]?.trim() ?? "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

export function resolveTauriDevEnvironment({
  baseEnvironment = process.env,
  homeDir = homedir(),
  projectRoot,
}) {
  const dashboardToken = (
    baseEnvironment[dashboardTokenKey]
    || envFileValue(join(projectRoot, ".env.local"), dashboardTokenKey)
    || envFileValue(join(homeDir, ".hivemindos", ".env"), dashboardTokenKey)
  ).trim();

  return {
    ...baseEnvironment,
    HIVE_ENV_PROJECT_ROOT: projectRoot,
    ...(dashboardToken ? { [dashboardTokenKey]: dashboardToken } : {}),
  };
}

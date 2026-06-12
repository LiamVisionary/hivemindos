import { readFileSync } from "fs";
import { homedir } from "@/lib/home-dir";
import { join } from "path";

function unquoteShellValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\\(.)/g, "$1");
}

function collectorEnvValue(key: string) {
  try {
    const body = readFileSync(join(homedir(), ".hivemindos", "collector.env"), "utf8");
    for (const line of body.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || match[1] !== key) continue;
      return unquoteShellValue(match[2] ?? "");
    }
  } catch {
    return "";
  }
  return "";
}

export function hivemindLinkControlUrl() {
  return (
    process.env.HIVE_LINK_CONTROL_URL
    || collectorEnvValue("HIVE_LINK_CONTROL_URL")
    || "http://127.0.0.1:8788"
  ).replace(/\/+$/, "");
}

export function localTelemetryCollectorUrl() {
  const port = collectorEnvValue("AGENT_TELEMETRY_PORT") || process.env.AGENT_TELEMETRY_PORT || "8787";
  return `http://127.0.0.1:${port}`;
}

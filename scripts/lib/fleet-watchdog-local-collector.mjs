import { resolve } from "node:path";

function validPort(value) {
  const port = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function launchAgentCollectorPort(text) {
  const match = String(text ?? "").match(
    /<key>\s*AGENT_TELEMETRY_PORT\s*<\/key>\s*<string>\s*(\d+)\s*<\/string>/i,
  );
  return validPort(match?.[1]);
}

function systemdCollectorPort(text) {
  const match = String(text ?? "").match(
    /^\s*Environment\s*=\s*["']?AGENT_TELEMETRY_PORT=(\d+)["']?\s*$/im,
  );
  return validPort(match?.[1]);
}

export function localCollectorPortCandidates({
  configuredPort,
  launchAgentText,
  systemdUnitText,
  scanPorts = [],
} = {}) {
  const candidates = [];
  const seen = new Set();
  const add = (value, source, authoritative) => {
    const port = validPort(value);
    if (port === null || seen.has(port)) return;
    seen.add(port);
    candidates.push({ port, source, authoritative });
  };

  add(launchAgentCollectorPort(launchAgentText), "launchd", true);
  add(systemdCollectorPort(systemdUnitText), "systemd", true);
  add(configuredPort, "collector.env", false);
  for (const port of scanPorts) add(port, "scan", false);
  return candidates;
}

export function collectorHealthBelongsToApp(health, expectedAppDir, allowUnattributed = false) {
  if (health?.ok !== true) return false;
  const reportedAppDir = String(health?.version?.appDir ?? health?.appDir ?? "").trim();
  if (!reportedAppDir) return allowUnattributed;
  if (!expectedAppDir) return false;
  return resolve(reportedAppDir) === resolve(expectedAppDir);
}

export function selectHealthyLocalCollector(checks, expectedAppDir) {
  for (const check of checks ?? []) {
    const candidate = check?.candidate;
    if (!candidate) continue;
    if (collectorHealthBelongsToApp(check.health, expectedAppDir, candidate.authoritative)) {
      return check;
    }
  }
  return null;
}

import { homedir, platform } from "node:os";
import { join, resolve, sep } from "node:path";

export function appDataReadsAllowed(env = process.env) {
  return env.AGENT_TELEMETRY_ALLOW_APP_DATA_READS === "1";
}

export function isPathInside(candidate, root) {
  const resolvedCandidate = resolve(String(candidate || ""));
  const resolvedRoot = resolve(String(root || ""));
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  );
}

export function macosProtectedAppDataRoots(home = homedir()) {
  return [
    join(home, "Library", "Application Support"),
    join(home, "Library", "Containers"),
    join(home, "Library", "Group Containers"),
    join(home, "Library", "Mail"),
    join(home, "Library", "Messages"),
    join(home, "Library", "Safari"),
    join(home, "Library", "Calendars"),
    join(home, "Library", "Reminders"),
  ];
}

export function isMacosProtectedAppDataPath(filePath, options = {}) {
  const env = options.env || process.env;
  const platformName = options.platformName ?? platform();
  if (platformName !== "darwin") return false;
  if (options.allow ?? appDataReadsAllowed(env)) return false;
  const value = String(filePath || "").trim();
  if (!value) return false;
  const home = options.home || homedir();
  return macosProtectedAppDataRoots(home).some((root) =>
    isPathInside(value, root),
  );
}

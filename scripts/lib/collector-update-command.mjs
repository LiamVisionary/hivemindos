import { dirname, win32 } from "node:path";

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

// PowerShell single-quoted literals escape embedded quotes by doubling them.
function powershellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsUpdateScriptPath(appDir) {
  return win32.join(appDir, "scripts", "update-hivemindos.ps1");
}

// The command the collector's POST /update launches in the background. Unix
// machines run the bash updater through `sh`; Windows machines run the
// PowerShell updater (there is no sh, and Task Scheduler owns the service).
export function collectorUpdateCommand({
  appDir,
  collectorOnly,
  logPath,
  platform = process.platform,
}) {
  if (platform === "win32") {
    const modeArgument = collectorOnly ? " -CollectorOnly" : "";
    return [
      "$ErrorActionPreference='Stop'",
      `New-Item -ItemType Directory -Force -Path ${powershellSingleQuote(win32.dirname(logPath))} | Out-Null`,
      `& ${powershellSingleQuote(windowsUpdateScriptPath(appDir))}${modeArgument} *>> ${powershellSingleQuote(logPath)}`,
    ].join("; ");
  }
  const modeArgument = collectorOnly ? " --collector-only" : "";
  return [
    `mkdir -p ${shellSingleQuote(dirname(logPath))}`,
    `cd ${shellSingleQuote(appDir)}`,
    `./scripts/update-hivemindos.sh${modeArgument} >> ${shellSingleQuote(logPath)} 2>&1`,
  ].join(" && ");
}

// The human-facing update command surfaced in /health version info (and shown
// by the dashboard as the manual fallback). Same per-platform split, no log
// redirection.
export function collectorManualUpdateCommand({
  appDir,
  collectorOnly,
  platform = process.platform,
}) {
  if (platform === "win32") {
    const modeArgument = collectorOnly ? " -CollectorOnly" : "";
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${windowsUpdateScriptPath(appDir)}"${modeArgument}`;
  }
  return collectorOnly
    ? `cd ${JSON.stringify(appDir)} && ./scripts/update-hivemindos.sh --collector-only`
    : `cd ${JSON.stringify(appDir)} && git pull --ff-only && pnpm install --frozen-lockfile && ./scripts/install-telemetry-collector.sh`;
}

import { readFileSync } from "node:fs";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const setup = readFileSync("src-tauri/src/setup.rs", "utf8");
const setupSh = readFileSync("setup.sh", "utf8");
const setupPs = readFileSync("setup.ps1", "utf8");
const uninstallPs = readFileSync("uninstall.ps1", "utf8");
const collectorPs = readFileSync("scripts/install-telemetry-collector.ps1", "utf8");
const collectorSh = readFileSync("scripts/install-telemetry-collector.sh", "utf8");
const fleetMachinePermissionsDocs = readFileSync("docs/for-users/features/fleet-machine-permissions.md", "utf8");
const env = readFileSync("src-tauri/src/env.rs", "utf8");
const nativeBootstrap = readFileSync("src-tauri/src/lib.rs", "utf8");
const bootstrapClient = readFileSync("src/lib/native/dashboard-bootstrap.ts", "utf8");
const onboarding = readFileSync("src/features/native/NativeFirstRunOnboarding.tsx", "utf8");
const hiveEnv = readFileSync("src/lib/native/hive-env.ts", "utf8");
const phone = readFileSync("src/lib/native/phone.ts", "utf8");
const scheduler = readFileSync("src/lib/native/scheduler.ts", "utf8");

if (/join\("Documents\/Obsidian\/hivemindos-vault"\)/.test(setup)) {
  fail("native_setup_status must not probe ~/Documents before user consent.");
}

if (!env.includes("fn backup_dir(allow_private_filesystem: bool)") || !env.includes("if !allow_private_filesystem")) {
  fail("native hive env backup checks must be gated behind private filesystem consent.");
}

if (!nativeBootstrap.includes("allow_private_filesystem") || !nativeBootstrap.includes("if !allow_private_filesystem")) {
  fail("dashboard_bootstrap must gate private filesystem reads behind allow_private_filesystem.");
}

if (!bootstrapClient.includes("DEFAULT_BOOTSTRAP_TIMEOUT_MS") || !bootstrapClient.includes("Promise.race")) {
  fail("readNativeDashboardBootstrap must time out stuck native bootstrap calls.");
}

if (!bootstrapClient.includes("nativePrivateFilesystemAccessGranted")) {
  fail("native dashboard bootstrap must check stored private filesystem consent.");
}

if (!onboarding.includes("hivemindos.nativeFirstRun.dismissed.v3")) {
  fail("native first-run dismissal key must invalidate pre-consent v2 dismissals.");
}

if (!onboarding.includes("grantNativePrivateFilesystemAccess")) {
  fail("native first-run setup must grant private filesystem access only after user-approved setup starts.");
}

if (!onboarding.includes("installDeps: false") || !onboarding.includes("--skip-deps")) {
  fail("native first-run setup must skip the source workspace dependency install for packaged-app users.");
}

if (!setup.includes("--skip-deps --skip-build --skip-dashboard")) {
  fail("native setup repair commands must skip source dependency/build/dev-server work by default.");
}

if (!setup.includes("HIVE_SETUP_EXIT=%ERRORLEVEL%") || !setup.includes("exit /b %HIVE_SETUP_EXIT%")) {
  fail("Windows native setup launcher must preserve the setup.ps1 exit code after printing the finished marker.");
}

if (!setupSh.includes("needs_pnpm=\"false\"") || !setupSh.includes("CLI_SKIP_DEPS") || !setupSh.includes("CLI_SKIP_DASHBOARD")) {
  fail("setup.sh must not install or enable pnpm when no workspace install/build/dev dashboard is requested.");
}

if (!setupPs.includes("$needsPnpm = (-not $SkipDeps) -or (-not $SkipBuild) -or (-not $SkipDashboard)")) {
  fail("setup.ps1 must not install or enable pnpm when no workspace install/build/dev dashboard is requested.");
}

if (
  !setupPs.includes("[switch]$CollectorOnly")
  || !setupPs.includes("$SkipDeps = $true")
  || !setupPs.includes("$SkipBuild = $true")
  || !setupPs.includes("$SkipDashboard = $true")
  || !setupPs.includes("$collectorArgs.CollectorOnly = $true")
) {
  fail("setup.ps1 -CollectorOnly must skip dashboard work and persist the collector-only mode through the Windows collector installer.");
}

if (
  !collectorPs.includes('"HIVE_COLLECTOR_ONLY=$collectorOnlyValue"')
  || !collectorPs.includes('"set HIVE_COLLECTOR_ONLY=$collectorOnlyValue"')
) {
  fail("Windows collector-only mode must be written to collector.env and injected into the scheduled collector process.");
}

if (
  !setupPs.includes('[ValidateSet("link", "system-tailscale", "local")]')
  || !setupPs.includes('elseif ($collectorOnlyMode) { "link" }')
  || !setupPs.includes('if ($resolvedNetworkMode -eq "link")')
  || !setupPs.includes("'^HIVE_LINK_CONTROL='")
  || !collectorPs.includes('} elseif ($collectorOnlyMode) {\n  $linkRequested = $true')
) {
  fail("Windows collector-only setup and its direct installer must choose Hivemind Link by default while preserving explicit, sticky, system-Tailscale, and local modes.");
}

if (
  !collectorPs.includes("Installing Go for Hivemind Link")
  || !collectorPs.includes('winget install --id GoLang.Go --exact')
  || !collectorPs.includes("Hivemind Link requires Go")
  || !uninstallPs.includes('Uninstall Go itself from this machine?')
) {
  fail("Windows Hivemind Link setup must install its Go prerequisite when possible, fail clearly otherwise, and retain the matching uninstall prompt.");
}

if (
  !collectorSh.includes("The collector was not exposed on a less-protected fallback network.")
  || collectorSh.includes("falling back to the normal collector network mode")
) {
  fail("macOS/Linux Hivemind Link setup must fail closed instead of exposing the collector when Link cannot build.");
}

for (const copy of [
  "main HivemindOS hub",
  "same Tailscale account",
  "Return to the Hive Fleet",
  "Set-Clipboard -Value $authUrl",
]) {
  if (!collectorPs.includes(copy)) {
    fail(`Windows Hivemind Link authorization must include explicit hub onboarding copy: ${copy}`);
  }
}

for (const [name, source] of [
  ["setup.sh", setupSh],
  ["scripts/install-telemetry-collector.sh", collectorSh],
]) {
  if (!source.includes("copy_hivemind_auth_url_to_clipboard")) {
    fail(`${name} must copy the authorization URL locally when a supported clipboard command exists.`);
  }
  for (const copy of ["main HivemindOS hub", "same Tailscale account", "Return to the Hive Fleet"]) {
    if (!source.includes(copy)) {
      fail(`${name} must explain cross-platform Fleet authorization explicitly: ${copy}`);
    }
  }
}

if (
  !fleetMachinePermissionsDocs.includes("automatically enables Hivemind Link")
  || !fleetMachinePermissionsDocs.includes("same Tailscale account as the main hub")
) {
  fail("Fleet machine-permissions docs must explain automatic Link setup and where to authorize the collector.");
}

if (!setupPs.includes("$collectorInstallFailed = $false") || !setupPs.includes("if ($collectorInstallFailed)") || !setupPs.includes("exit 1")) {
  fail("setup.ps1 must report collector install failure to app-driven first-run callers.");
}

if (!collectorPs.includes("-LogonType Interactive") || !collectorPs.includes("-LogonType S4U") || !collectorPs.includes("Register-HivemindScheduledTask")) {
  fail("Windows collector scheduled tasks must support both durable S4U start-now registration and desktop-user Interactive fallback.");
}

if (!collectorPs.includes("Start-HivemindHiddenLauncher") || !collectorPs.includes('Start-Process -FilePath "powershell.exe"') || !collectorPs.includes("Start-HivemindScheduledTaskNow") || !collectorPs.includes("Register-HivemindStartupLauncher")) {
  fail("Windows collector setup must start the hidden PowerShell supervisor immediately and keep bounded scheduled-task plus Startup-folder fallbacks.");
}

if (collectorPs.includes(', 0, True)') || collectorPs.includes("bWaitOnReturn=True")) {
  fail("Windows long-running launchers must not synchronously wait through WScript.Shell.Run, which can raise 80020009 on desktop Windows.");
}

if (!collectorPs.includes("System.Diagnostics.ProcessStartInfo") || !collectorPs.includes("CreateNoWindow = `$true") || !collectorPs.includes("WaitForExit()") || !collectorPs.includes("exit `$process.ExitCode")) {
  fail("Windows collector and Link launchers must use a hidden .NET process supervisor that preserves the child exit code.");
}

if (!collectorPs.includes("Remove-HivemindStartupLauncher -Name $Name")) {
  fail("Successful Windows Scheduled Task registration must remove any stale Startup-folder fallback launcher.");
}

if (!uninstallPs.includes("Remove-HivemindStartupLauncher") || !uninstallPs.includes("HivemindOS Telemetry Collector") || !uninstallPs.includes("HivemindOS Link")) {
  fail("Windows uninstall must remove collector/link Startup-folder launchers as well as scheduled tasks.");
}

if (!onboarding.includes("setupProcessDone") || !onboarding.includes("Setup finished, but the local agent bridge did not come online.") || !onboarding.includes("Retry setup")) {
  fail("native first-run must turn a finished-but-offline collector run into a retryable setup error.");
}

if (!hiveEnv.includes("nativePrivateFilesystemAccessGranted()") || !hiveEnv.includes("allowPrivateFilesystem")) {
  fail("native hive env fallback must pass private filesystem consent to Tauri.");
}

if (!phone.includes("nativePrivateFilesystemAccessGranted()") || !scheduler.includes("nativePrivateFilesystemAccessGranted()")) {
  fail("vault-backed native helper fallbacks must not bypass private filesystem consent.");
}

if (!process.exitCode) {
  console.log("Native first launch stays consent-first and bounded.");
}

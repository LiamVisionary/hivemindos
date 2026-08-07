import { existsSync, readFileSync } from "node:fs";

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
const onboardingStyles = readFileSync("src/features/native/NativeFirstRunOnboarding.module.css", "utf8");
const setupClient = readFileSync("src/lib/native/setup.ts", "utf8");
const dashboard = readFileSync("src/features/dashboard/DashboardApp.tsx", "utf8");
const guidedTour = readFileSync("src/features/dashboard/GuidedDashboardTour.tsx", "utf8");
const chatExchange = readFileSync("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", "utf8");
const firstTask = readFileSync("src/lib/native/first-task.ts", "utf8");
const focusTrap = readFileSync("src/lib/ui/use-modal-focus-trap.ts", "utf8");
const hiveEnv = readFileSync("src/lib/native/hive-env.ts", "utf8");
const phone = readFileSync("src/lib/native/phone.ts", "utf8");
const scheduler = readFileSync("src/lib/native/scheduler.ts", "utf8");
const readme = readFileSync("README.md", "utf8");
const designSystem = readFileSync("src/app/design-system/page.tsx", "utf8");
const appNavShelf = readFileSync("src/components/fleet-hive/AppNavShelf.tsx", "utf8");

if (
  existsSync("public/hivemindos-logo.png")
  || existsSync("public/design-system/assets/logo/hivemindos-logo.png")
  || onboarding.includes("/hivemindos-logo.png")
  || readme.includes("public/hivemindos-logo.png")
  || designSystem.includes("/design-system/assets/logo/hivemindos-logo.png")
) {
  fail("The retired HivemindOS logo must not exist or remain referenced.");
}

const navBrandPath = appNavShelf.match(/brandSrc\s*=\s*"([^"]+)"/)?.[1];
const onboardingBrandPath = onboarding.match(/const APP_LOGO_PATH = "([^"]+)"/)?.[1];
if (
  navBrandPath !== "/icon-512.png"
  || onboardingBrandPath !== navBrandPath
  || !existsSync(`public${navBrandPath}`)
  || !readme.includes(`src="public${navBrandPath}"`)
  || !designSystem.includes(`{ src: "${navBrandPath}"`)
) {
  fail("Native onboarding must use the same canonical app icon as the left navigation rail.");
}

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

if (!collectorPs.includes("System.Diagnostics.ProcessStartInfo") || !collectorPs.includes("CreateNoWindow = `$true") || !collectorPs.includes("WaitForExit()") || !collectorPs.includes("`$exitCode = `$process.ExitCode")) {
  fail("Windows collector and Link launchers must use a hidden .NET process supervisor that preserves the child exit code.");
}

// Task Scheduler's restart-on-failure never relaunches a task whose process ran
// and then exited (validated on a real Windows Server box), so the supervisor
// itself must relaunch: immediately on the collector's self-reload exit code
// (75), delayed on crashes, bounded against hot loops, ending clean on exit 0.
if (!collectorPs.includes("-eq 75") || !collectorPs.includes("consecutiveFastExits") || !collectorPs.includes("if (`$exitCode -eq 0) { exit 0 }")) {
  fail("The Windows supervisor must relaunch the collector on self-reload (exit 75) with bounded crash restarts, since Task Scheduler never restarts a ran-then-exited task.");
}

// Re-registering the task with -Force does not touch a running instance and
// starting a running task is a no-op, so without an explicit stop, setup
// re-runs verified "health" against the STALE collector and never applied
// updates (confirmed live on a Windows PC). The stop must come BEFORE the port
// scan or a listening stale collector drifts the recorded port.
{
  const stopIndex = collectorPs.indexOf("stop any previously-running collector BEFORE the port scan");
  const scanIndex = collectorPs.indexOf("$chosenPort = 0");
  if (
    stopIndex < 0
    || scanIndex < 0
    || stopIndex > scanIndex
    || !collectorPs.includes("agent-telemetry-collector\\.mjs")
  ) {
    fail("install-telemetry-collector.ps1 must stop the previously-running collector (own process only, command-line matched) before the port scan, so setup re-runs actually apply updates on a stable port.");
  }
}

// A stale collector answering on 8787 must not satisfy the first-run wizard's
// done-gate: "done" requires the hidden setup process to have actually exited
// cleanly, not just any collector responding (a re-run previously jumped
// straight to the completed screen while setup was still mid-download).
if (
  !/setupSettled\s*=\s*setupProcessDone\s*&&\s*!setupExitError\s*&&\s*\(demoMode\s*\|\|\s*collectorReady\)/.test(onboarding)
  || !onboarding.includes("payload.runId !== activeRunIdRef.current")
) {
  fail("The first-run wizard must gate 'done' on the setup process finishing AND collector health, so a stale collector cannot fake instant completion.");
}

if (
  !setup.includes('"runId": run_id')
  || !setup.includes("spawn_hidden_setup(app, &command_path, platform, &run_id)")
  || !onboarding.includes("result.runId === runId")
) {
  fail("native first-run setup must correlate start, progress, completion, and result to the exact initiating run.");
}

if (
  !onboarding.includes("setInstallWebResearch] = useState(false)")
  || !onboarding.includes("setEnableCodeProof] = useState(false)")
  || !setupSh.includes("HIVE_INSTALL_WEB_RESEARCH:-")
  || !setupPs.includes("[switch]$InstallWebResearch")
  || !setupPs.includes("[switch]$EnableCodeProof")
) {
  fail("first-run optional web research and Code Proof downloads must default off and be honored by both setup scripts.");
}

if (onboarding.includes("setupEventlessFallback")) {
  fail("The first-run wizard must never turn an old collector or silent event bridge into a successful current setup run.");
}

if (!onboarding.includes('const [mode, setMode] = useState<InstallMode>("local")')) {
  fail("First-run networking must default to this computer only.");
}

if (!onboarding.includes('const WIZARD_STEPS = ["welcome", "setup", "running", "done"]') || /isWindows\s*\?\s*\["welcome"/.test(onboarding)) {
  fail("macOS, Windows, and Linux must use the same four understandable onboarding steps.");
}

for (const explicitChoice of ["installWebResearch: boolean", "enableCodeProof: boolean"]) {
  if (!setupClient.includes(explicitChoice)) fail(`Native setup must carry the explicit optional choice: ${explicitChoice}`);
}

if (!setupSh.includes('install_web_research="false"') || !setupSh.includes('enable_code_proof="false"')) {
  fail("Non-interactive setup.sh must keep web research and public Code Proof off without explicit consent.");
}

if (!setupPs.includes("$installWebResearchRequested") || !setupPs.includes("$enableCodeProofRequested") || setupPs.includes("$installWebResearch = $NonInteractive")) {
  fail("Non-interactive setup.ps1 must keep optional network/download features off without explicit consent.");
}

for (const windowsParity of ["-NetworkMode", "-RuntimeTargets", "-NonInteractive", "-InstallWebResearch", "-EnableCodeProof"]) {
  if (!setup.includes(windowsParity)) fail(`Windows native setup must receive the same approved setup contract: ${windowsParity}`);
}

const setupRuntime = setup.slice(0, setup.indexOf("#[cfg(test)]"));
if (setupRuntime.includes("archive/refs/heads/main") || setupRuntime.includes("commits/main") || !setupRuntime.includes('env!("HIVEMINDOS_GIT_COMMIT")')) {
  fail("Native first-run must download the immutable source embedded in the signed app build, never a moving main branch.");
}

for (const accessibleContract of [
  'role="radiogroup"',
  'role="radio"',
  'role="switch"',
  'role="progressbar"',
  'role="log"',
  'aria-live="polite"',
]) {
  if (!onboarding.includes(accessibleContract)) fail(`Onboarding must expose accessible semantics: ${accessibleContract}`);
}

if (!focusTrap.includes("child.inert = true") || !focusTrap.includes('event.key !== "Tab"') || !focusTrap.includes("previousFocus?.focus()")) {
  fail("Portal modals must make the background inert, trap keyboard focus, and restore focus on close.");
}

if (!/\.close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/.test(onboardingStyles)) {
  fail("The onboarding close target must meet the 44px touch-target minimum.");
}

if (/\.logLine\s*\{[^}]*text-overflow:\s*ellipsis/.test(onboardingStyles) || !/\.logLine\s*\{[^}]*overflow-wrap:\s*anywhere/.test(onboardingStyles)) {
  fail("Setup errors and activity must wrap instead of being silently truncated.");
}

if (!onboarding.includes("Try a first task") || !onboarding.includes("Show me around") || onboarding.includes("CLAWBANK_OPEN_EVENT")) {
  fail("Successful setup must lead to a useful first task or tour, not a financial integration.");
}

if (
  !firstTask.includes("What can you help me accomplish today?")
  || !guidedTour.includes("FIRST_TASK_EVENT")
  || !dashboard.includes("setText(prompt)")
  || !dashboard.includes("startAgentChat(target.id, { fresh: true })")
) {
  fail("The first-task action must open a fresh chat and provide a lay-user prompt without auto-sending it.");
}

if (
  !onboarding.includes("Add your first agent")
  || !guidedTour.includes("if (!opened) openFirstAgentSetup()")
  || !dashboard.includes("openFirstAgentSetup={() =>")
  || !dashboard.includes("addAgentToMachine(targetMachine)")
  || !chatExchange.includes("Boolean(selectedAgent &&")
) {
  fail("The first-task action must open agent setup when no chat-capable agent exists, and agentless chat drafts must stay unsendable.");
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

if (
  !setupSh.includes("HIVEMINDOS_SETUP_WARNING:")
  || !setup.includes("Memory import could not finish. Core setup is ready")
  || !onboarding.includes("setupWarningMessages")
  || !onboarding.includes("One optional step is paused")
) {
  fail("native first-run must keep optional protected-folder failures nonfatal and show lay-user recovery guidance on completion.");
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

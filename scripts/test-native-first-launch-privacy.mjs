import { readFileSync } from "node:fs";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const setup = readFileSync("src-tauri/src/setup.rs", "utf8");
const setupSh = readFileSync("setup.sh", "utf8");
const setupPs = readFileSync("setup.ps1", "utf8");
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

if (!setupSh.includes("needs_pnpm=\"false\"") || !setupSh.includes("CLI_SKIP_DEPS") || !setupSh.includes("CLI_SKIP_DASHBOARD")) {
  fail("setup.sh must not install or enable pnpm when no workspace install/build/dev dashboard is requested.");
}

if (!setupPs.includes("$needsPnpm = (-not $SkipDeps) -or (-not $SkipBuild) -or (-not $SkipDashboard)")) {
  fail("setup.ps1 must not install or enable pnpm when no workspace install/build/dev dashboard is requested.");
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

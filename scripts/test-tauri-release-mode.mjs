import { existsSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { join } from "node:path";

const workflowPath = ".github/workflows/tauri-cross-platform-release.yml";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const nativeDocsPath = "docs/for-users/native-app.md";
const packagePath = "package.json";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function sourceFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const workflow = readFileSync(workflowPath, "utf8");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const nativeDocs = readFileSync(nativeDocsPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const tauriBuild = readFileSync("scripts/tauri-build.mjs", "utf8");
const tauriReleaseBuild = readFileSync("scripts/run-tauri-release-build.mjs", "utf8");

const staticallyTraceableServerHomedirLoads = sourceFiles("src").filter((path) => {
  if (path === join("src", "lib", "home-dir.ts")) return false;
  const source = readFileSync(path, "utf8");
  return /import\s*\{[^}]*\bhomedir\b[^}]*\}\s*from\s*["'](?:node:)?os["']/.test(source)
    || /require\s*<[^>]*\bhomedir\b[^>]*>\s*\(\s*["'](?:node:)?os["']\s*\)/s.test(source)
    || /require\s*\(\s*["'](?:node:)?os["']\s*\)\.homedir/s.test(source);
});

if (staticallyTraceableServerHomedirLoads.length > 0) {
  fail(
    `Next server modules must use @/lib/home-dir, or a runtime-only process.getBuiltinModule lookup when instrumentation bundling requires it, so file tracing cannot scan the user profile:\n${staticallyTraceableServerHomedirLoads.join("\n")}`,
  );
}

function findInstalledPackageDir(packageName) {
  const segments = packageName.split("/");
  const candidates = [
    join(process.cwd(), "node_modules", ...segments),
    join(process.cwd(), "node_modules", ".pnpm", "node_modules", ...segments),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function collectPackageDependencyClosure(packageNames, seen = new Set()) {
  for (const packageName of packageNames) {
    if (seen.has(packageName)) {
      continue;
    }

    seen.add(packageName);
    const packageDir = findInstalledPackageDir(packageName);
    if (!packageDir) {
      fail(`Unable to resolve installed package ${packageName} while checking Tauri runtime dependency staging.`);
      continue;
    }

    const packageJsonPath = join(realpathSync(packageDir), "package.json");
    const installedPackageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    collectPackageDependencyClosure(Object.keys(installedPackageJson.dependencies ?? {}), seen);
  }

  return seen;
}

if (!/^\s*HIVEMINDOS_TAURI_EMBEDDED_NEXT\s*:\s*"1"/m.test(workflow)) {
  fail(`${workflowPath} must enable the embedded Next server for release builds.`);
}

if (!workflow.includes("Embedded mode (serve /api/* at runtime, no endpoint gaps)")) {
  fail(`${workflowPath} should document the embedded release backend mode near the build matrix.`);
}

if (!workflow.includes("uses: Swatinem/rust-cache@v2") && !workflow.includes("~/.cargo/registry")) {
  fail(`${workflowPath} must cache Cargo dependencies for release builds.`);
}

if (!workflow.includes("Fetch Rust dependencies") || !workflow.includes("cargo fetch --locked")) {
  fail(`${workflowPath} must fetch locked Rust dependencies before Tauri packaging.`);
}

if (!workflow.includes("HivemindOS-macos-apple-silicon.dmg")) {
  fail(`${workflowPath} must use a human-readable Apple Silicon macOS asset name.`);
}

if (!workflow.includes('TAURI_NEXT_BUILD_HEAP_MB: "12288"')) {
  fail(`${workflowPath} must give embedded Next builds the validated 12 GB heap.`);
}

if (!workflow.includes('TAURI_NEXT_BUILD_MEMORY_MB: "14000"')) {
  fail(`${workflowPath} must keep enough RSS headroom for the embedded Next heap.`);
}

if (/HivemindOS-macos-aarch64|HivemindOS-macos-arm64\.app\.zip|HivemindOS-macos-x64\.app\.zip/.test(workflow)) {
  fail(`${workflowPath} must not publish duplicate or jargon-heavy macOS release assets.`);
}

if (tauriConfig.build?.frontendDist !== "static") {
  fail(`${tauriConfigPath} must keep the static loading shell as frontendDist while embedded Next boots.`);
}

if (tauriConfig.build?.beforeBuildCommand !== "pnpm tauri:prepare") {
  fail(`${tauriConfigPath} must run pnpm tauri:prepare before packaging.`);
}

if (!packageJson.scripts?.["tauri:build"]?.includes("HIVEMINDOS_TAURI_EMBEDDED_NEXT=1")) {
  fail(`${packagePath} tauri:build must build the embedded production app.`);
}

if (!packageJson.scripts?.["tauri:build"]?.includes("HIVEMINDOS_TAURI_SOURCE_BUILD=1")) {
  fail(`${packagePath} tauri:build must mark local bundles as source builds so they do not follow the release updater channel.`);
}

if (!packageJson.scripts?.["tauri:build"]?.includes("--bundles app")) {
  fail(`${packagePath} tauri:build must produce the local embedded app bundle without requiring DMG creation.`);
}

if (!packageJson.scripts?.["tauri:build"]?.includes('"createUpdaterArtifacts":false')) {
  fail(`${packagePath} tauri:build must not require updater signing secrets for local production builds.`);
}

if (packageJson.scripts?.["tauri:build:release"] !== "tauri build") {
  fail(`${packagePath} tauri:build:release must delegate release-mode environment to the GitHub release workflow.`);
}

if (packageJson.scripts?.["tauri:build:release"]?.includes("HIVEMINDOS_TAURI_SOURCE_BUILD=1")) {
  fail(`${packagePath} tauri:build:release must remain on the signed release updater channel.`);
}

if (packageJson.scripts?.["test:tauri-runtime-bundle"] !== "node scripts/test-tauri-runtime-bundle.mjs") {
  fail(`${packagePath} must expose test:tauri-runtime-bundle for post-staging embedded runtime dependency checks.`);
}

if (!workflow.includes("run: node scripts/run-tauri-release-build.mjs")) {
  fail(`${workflowPath} must use the guarded full release bundle script.`);
}

if ((workflow.match(/node scripts\/run-tauri-release-build\.mjs/g) ?? []).length < 2) {
  fail(`${workflowPath} must retry transient macOS DMG packaging failures on the warm build cache.`);
}

if (!tauriReleaseBuild.includes("const maxAttempts = process.platform === \"darwin\" ? 3 : 1;")) {
  fail("scripts/run-tauri-release-build.mjs must retry only macOS release bundles.");
}

if (!nativeDocs.includes("Release builds enable `HIVEMINDOS_TAURI_EMBEDDED_NEXT`")) {
  fail(`${nativeDocsPath} must explain that release builds use the embedded Next server.`);
}

if (!nativeDocs.includes("static fallback still needs native bridge coverage")) {
  fail(`${nativeDocsPath} must describe the native bridge coverage requirement for the static fallback.`);
}

if (!nativeDocs.includes("downloaded-app users do not get the full source workspace `pnpm install`")) {
  fail(`${nativeDocsPath} must document that packaged setup skips the source dependency install.`);
}

for (const packageName of [
  "@solana/kit",
  "@solana/spl-token",
  "@solana/web3.js",
  "viem",
  "@noble/curves",
  "@noble/hashes",
  "@scure/base",
  "@scure/bip32",
  "@scure/bip39",
]) {
  if (!tauriBuild.includes(`"${packageName}"`)) {
    fail(`scripts/tauri-build.mjs must stage ${packageName} for wallet-backed API routes in the embedded Next runtime.`);
  }
}

if (!tauriBuild.includes("readRuntimePackageDependencies") || !tauriBuild.includes("copyRuntimePackageIntoNodeModules(dependencyName, targetNodeModulesDir")) {
  fail("scripts/tauri-build.mjs must recursively stage package.json dependencies for embedded Next runtime packages.");
}

for (const expectedSnippet of ["packageNodeModulesDirForSource", "copyPackageLocalRuntimeDependencyIsland", "sourceNodeModulesDirs"]) {
  if (!tauriBuild.includes(expectedSnippet)) {
    fail("scripts/tauri-build.mjs must preserve package-local dependency resolution for pnpm-staged runtime packages.");
  }
}

const walletRuntimeDependencyClosure = collectPackageDependencyClosure(["@solana/spl-token", "@solana/web3.js", "viem"]);
for (const packageName of ["@solana/spl-token-metadata", "bn.js", "abitype"]) {
  if (!walletRuntimeDependencyClosure.has(packageName)) {
    fail(`${packageName} must stay covered by the embedded wallet runtime dependency closure.`);
  }
}

if (!process.exitCode) {
  console.log("Tauri release mode uses embedded Next with a static loading shell.");
}

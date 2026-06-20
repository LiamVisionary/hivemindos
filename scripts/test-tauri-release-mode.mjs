import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/tauri-cross-platform-release.yml";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const nativeDocsPath = "docs/native-app.md";
const packagePath = "package.json";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const workflow = readFileSync(workflowPath, "utf8");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const nativeDocs = readFileSync(nativeDocsPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const tauriBuild = readFileSync("scripts/tauri-build.mjs", "utf8");

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

if (!packageJson.scripts?.["tauri:build:release"]?.includes("HIVEMINDOS_TAURI_EMBEDDED_NEXT=1")) {
  fail(`${packagePath} tauri:build:release must build the embedded release bundle set.`);
}

if (packageJson.scripts?.["tauri:build:release"]?.includes("HIVEMINDOS_TAURI_SOURCE_BUILD=1")) {
  fail(`${packagePath} tauri:build:release must remain on the signed release updater channel.`);
}

if (!workflow.includes("run: pnpm tauri:build:release")) {
  fail(`${workflowPath} must use the explicit full release bundle script.`);
}

if (!nativeDocs.includes("Release builds enable `HIVEMINDOS_TAURI_EMBEDDED_NEXT`")) {
  fail(`${nativeDocsPath} must explain that release builds use the embedded Next server.`);
}

if (!nativeDocs.includes("static fallback still needs native bridge coverage")) {
  fail(`${nativeDocsPath} must describe the native bridge coverage requirement for the static fallback.`);
}

for (const packageName of ["@noble/curves", "@noble/hashes", "@scure/base", "@scure/bip32", "@scure/bip39"]) {
  if (!tauriBuild.includes(`"${packageName}"`)) {
    fail(`scripts/tauri-build.mjs must stage ${packageName} for Solana-backed API routes in the embedded Next runtime.`);
  }
}

if (!process.exitCode) {
  console.log("Tauri release mode uses embedded Next with a static loading shell.");
}

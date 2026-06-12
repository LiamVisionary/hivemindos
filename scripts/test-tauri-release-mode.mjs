import { readFileSync } from "node:fs";

const workflowPath = ".github/workflows/tauri-cross-platform-release.yml";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const nativeDocsPath = "docs/native-app.md";

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

const workflow = readFileSync(workflowPath, "utf8");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
const nativeDocs = readFileSync(nativeDocsPath, "utf8");

if (/^\s*HIVEMINDOS_TAURI_EMBEDDED_NEXT\s*:/m.test(workflow)) {
  fail(`${workflowPath} must not enable the embedded Next fallback for release builds.`);
}

if (!workflow.includes("static Tauri UI plus native/sidecar backend")) {
  fail(`${workflowPath} should document the release backend mode near the build matrix.`);
}

if (!workflow.includes("uses: actions/cache@v4") || !workflow.includes("~/.cargo/registry")) {
  fail(`${workflowPath} must cache Cargo registry dependencies for release builds.`);
}

if (!workflow.includes("Fetch Rust dependencies") || !workflow.includes("cargo fetch --locked")) {
  fail(`${workflowPath} must fetch locked Rust dependencies before Tauri packaging.`);
}

if (tauriConfig.build?.frontendDist !== "static") {
  fail(`${tauriConfigPath} must keep packaged releases on the static frontendDist.`);
}

if (tauriConfig.build?.beforeBuildCommand !== "pnpm tauri:prepare") {
  fail(`${tauriConfigPath} must run pnpm tauri:prepare before packaging.`);
}

if (!nativeDocs.includes("Release builds must not enable `HIVEMINDOS_TAURI_EMBEDDED_NEXT`")) {
  fail(`${nativeDocsPath} must explain why release builds avoid the embedded Next fallback.`);
}

if (!nativeDocs.includes("native bridge coverage gate")) {
  fail(`${nativeDocsPath} must describe the native bridge coverage gate for desktop features.`);
}

if (!process.exitCode) {
  console.log("Tauri release mode stays on static UI plus native/sidecar backend bridges.");
}

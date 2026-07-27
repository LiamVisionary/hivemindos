#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { arch, platform } from "node:process";

const read = (file) => readFileSync(file, "utf8");
const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const tauriGitignore = read("src-tauri/.gitignore");
const rust = read("src-tauri/src/lib.rs");
const stage = read("scripts/stage-markitdown-sidecar.mjs");
const nativeManifestPath = "native/document-reader/Cargo.toml";
assert.ok(existsSync(nativeManifestPath), "the bundled converter must be a native Rust project");
const nativeManifest = read(nativeManifestPath);
const nativeSource = read("native/document-reader/src/main.rs");
const notice = read("src-tauri/resources/third-party/document-reader-NOTICE.txt");
const releaseWorkflow = read(".github/workflows/tauri-cross-platform-release.yml");

assert.match(packageJson.scripts["tauri:prepare"], /stage-markitdown-sidecar\.mjs/);
assert.match(packageJson.scripts["tauri:prepare:server"], /stage-markitdown-sidecar\.mjs/);
assert.ok(tauriConfig.bundle.externalBin.includes("binaries/hivemind-markitdown"));
assert.equal(tauriConfig.bundle.resources["resources/"], "resources/", "the packaged app retains the third-party notice");
assert.match(tauriGitignore, /!\/resources\/third-party\//, "Git must expose the notice directory");
assert.match(
  tauriGitignore,
  /!\/resources\/third-party\/document-reader-NOTICE\.txt/,
  "Git must expose the bundled notice",
);
assert.match(rust, /HIVEMINDOS_MARKITDOWN_BIN/);
assert.match(stage, /native["'],\s*["']document-reader/);
assert.match(stage, /cargo/);
assert.match(stage, /"build",\s*"--release",\s*"--locked"/);
assert.match(stage, /MAX_SIDECAR_BYTES\s*=\s*12 \* 1024 \* 1024/);
assert.doesNotMatch(stage, /\b(?:python(?:3)?|pip(?:3)?|pyinstaller)\b|requirements/i);
assert.match(stage, /stageScriptSha256/, "packaging changes invalidate a staged binary");
assert.match(nativeManifest, /calamine\s*=\s*\{\s*version\s*=\s*"=0\.36\.0"/);
assert.match(nativeManifest, /msg_parser\s*=\s*"=0\.3\.6"/);
assert.match(nativeManifest, /html-to-markdown-rs\s*=\s*\{\s*version\s*=\s*"=3\.8\.3"/);
assert.match(nativeManifest, /lopdf\s*=\s*\{\s*version\s*=\s*"=0\.44\.0"/);
assert.match(nativeManifest, /quick-xml\s*=\s*"=0\.41\.0"/);
assert.match(nativeManifest, /csv\s*=\s*"=1\.4\.0"/);
assert.doesNotMatch(nativeManifest, /officemd/, "the reader must not retain vulnerable OfficeMD parser dependencies");
assert.match(nativeManifest, /unsafe_code\s*=\s*"forbid"/);
assert.match(nativeSource, /--stdio/);
assert.match(nativeSource, /MAX_ZIP_EXPANDED_BYTES/);
assert.match(nativeSource, /hivemind-docs-1/);
assert.ok(!existsSync("scripts/markitdown-sidecar.py"), "the bundle must not retain its Python wrapper");
assert.ok(!existsSync("scripts/markitdown-sidecar-requirements.txt"), "the bundle must not retain Python dependencies");
assert.match(notice, /Calamine 0\.36\.0/);
assert.match(notice, /msg_parser 0\.3\.6/);
assert.match(notice, /html-to-markdown-rs 3\.8\.3/);
assert.match(notice, /lopdf 0\.44\.0/);
assert.match(notice, /quick-xml 0\.41\.0/);
assert.match(releaseWorkflow, /Exercise bundled document converter/);

const stagedBinary = stagedBinaryPath();
if (existsSync(stagedBinary)) {
  assert.ok(
    statSync(stagedBinary).size <= 12 * 1024 * 1024,
    `${stagedBinary} must stay at or below the 12 MiB release budget`,
  );
}

console.log("MarkItDown bundle contract test passed");

function stagedBinaryPath() {
  if (platform === "darwin" && arch === "arm64") return "src-tauri/binaries/hivemind-markitdown-aarch64-apple-darwin";
  if (platform === "darwin" && arch === "x64") return "src-tauri/binaries/hivemind-markitdown-x86_64-apple-darwin";
  if (platform === "linux" && arch === "x64") return "src-tauri/binaries/hivemind-markitdown-x86_64-unknown-linux-gnu";
  if (platform === "win32" && arch === "x64") return "src-tauri/binaries/hivemind-markitdown-x86_64-pc-windows-msvc.exe";
  return "";
}

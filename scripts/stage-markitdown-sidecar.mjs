#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const stageScriptPath = fileURLToPath(import.meta.url);
const sourceRoot = join(projectRoot, "native", "document-reader");
const manifest = join(sourceRoot, "Cargo.toml");
const lockfile = join(sourceRoot, "Cargo.lock");
const mainSource = join(sourceRoot, "src", "main.rs");
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const target = sidecarTarget();
const binaryName = `hivemind-markitdown${target.exe}`;
const builtBinary = join(sourceRoot, "target", "release", binaryName);
const targetPath = join(binariesDir, `hivemind-markitdown-${target.triple}${target.exe}`);
const stampPath = `${targetPath}.build.json`;
const prebuiltPath = process.env.HIVEMINDOS_MARKITDOWN_PREBUILT?.trim();
const MAX_SIDECAR_BYTES = 12 * 1024 * 1024;

for (const source of [manifest, lockfile, mainSource]) {
  if (!existsSync(source)) {
    throw new Error(`Native document-reader source is missing: ${source}`);
  }
}

mkdirSync(binariesDir, { recursive: true });
const fingerprint = buildFingerprint();
if (reusableSidecar(fingerprint)) {
  console.log(`[document-reader] reusing ${basename(targetPath)} (${fingerprint.hash.slice(0, 12)})`);
  process.exit(0);
}

if (prebuiltPath) {
  copyPrebuilt(prebuiltPath, targetPath);
  verifySidecar(targetPath);
  writeStamp(fingerprint, "prebuilt");
  console.log(`[document-reader] staged verified prebuilt ${basename(targetPath)}`);
  process.exit(0);
}

buildSidecar(targetPath);
verifySidecar(targetPath);
writeStamp(fingerprint, "cargo");
console.log(`[document-reader] built ${basename(targetPath)} (${formatMiB(statSync(targetPath).size)} MiB)`);

function sidecarTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { triple: "aarch64-apple-darwin", exe: "" };
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return { triple: "x86_64-apple-darwin", exe: "" };
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return { triple: "x86_64-unknown-linux-gnu", exe: "" };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return { triple: "x86_64-pc-windows-msvc", exe: ".exe" };
  }
  throw new Error(`Unsupported document-reader platform: ${process.platform}/${process.arch}`);
}

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function buildFingerprint() {
  const stageScriptSha256 = sha256File(stageScriptPath);
  const manifestSha256 = sha256File(manifest);
  const lockfileSha256 = sha256File(lockfile);
  const mainSourceSha256 = sha256File(mainSource);
  const hash = createHash("sha256")
    .update(
      `v4\0${target.triple}\0${stageScriptSha256}\0${manifestSha256}\0${lockfileSha256}\0${mainSourceSha256}`,
    )
    .digest("hex");
  return {
    version: 4,
    hash,
    target: target.triple,
    stageScriptSha256,
    manifestSha256,
    lockfileSha256,
    mainSourceSha256,
  };
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function reusableSidecar(fingerprint) {
  const stamp = readStamp();
  if (!stamp || stamp.hash !== fingerprint.hash || !existsSync(targetPath)) return false;
  try {
    verifySidecar(targetPath);
    return true;
  } catch {
    return false;
  }
}

function writeStamp(fingerprint, source) {
  writeFileSync(
    stampPath,
    `${JSON.stringify({ ...fingerprint, source, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function copyPrebuilt(source, destination) {
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`HIVEMINDOS_MARKITDOWN_PREBUILT is not a file: ${source}`);
  }
  rmSync(destination, { force: true });
  copyFileSync(source, destination);
  if (process.platform !== "win32") chmodSync(destination, 0o755);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: options.stdio ?? "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? "unknown"}): ${detail}`);
  }
  return result;
}

function buildSidecar(destination) {
  run("cargo", ["build", "--release", "--locked", "--manifest-path", manifest], { stdio: "inherit" });
  if (!existsSync(builtBinary)) {
    throw new Error(`Cargo did not produce ${builtBinary}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { force: true });
  copyFileSync(builtBinary, destination);
  if (process.platform !== "win32") chmodSync(destination, 0o755);
}

function verifySidecar(binary) {
  const size = statSync(binary).size;
  if (size > MAX_SIDECAR_BYTES) {
    throw new Error(
      `Bundled document reader is ${formatMiB(size)} MiB; maximum is ${formatMiB(MAX_SIDECAR_BYTES)} MiB.`,
    );
  }
  const result = run(binary, ["--version"]);
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw new Error("Bundled document reader returned invalid version JSON.");
  }
  if (response.ok !== true || response.converterVersion !== "hivemind-docs-1") {
    throw new Error(`Bundled document reader has unexpected version ${response.converterVersion ?? "unknown"}.`);
  }
}

function formatMiB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

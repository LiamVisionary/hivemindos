#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const runner = readFileSync("src/lib/services/quant-research/runner.ts", "utf8");
const tauriLib = readFileSync("src-tauri/src/lib.rs", "utf8");

assert.ok(existsSync("scripts/stage-quant-research-engine.mjs"));
assert.ok(tauriConfig.bundle.externalBin.includes("binaries/hivemind-quant-research-engine"));
for (const scriptName of ["tauri:prepare", "tauri:prepare:server", "tauri:prepare:server:fresh"]) {
  assert.match(packageJson.scripts[scriptName], /stage-quant-research-engine\.mjs/);
}
assert.match(runner, /hivemind-quant-research-engine/);
assert.match(runner, /MacOS/);
assert.match(runner, /HIVEMINDOS_QUANT_VALIDATOR_PATH/);
assert.match(tauriLib, /HIVEMINDOS_QUANT_ENGINE_PATH/);
assert.match(tauriLib, /HIVEMINDOS_QUANT_VALIDATOR_PATH/);

const staged = spawnSync("node", ["scripts/stage-quant-research-engine.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 180_000,
});
assert.equal(staged.status, 0, staged.stderr || staged.stdout);
const target = process.platform === "darwin"
  ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
  : process.platform === "win32"
    ? "x86_64-pc-windows-msvc"
    : "x86_64-unknown-linux-gnu";
const extension = process.platform === "win32" ? ".exe" : "";
const binary = `src-tauri/binaries/hivemind-quant-research-engine-${target}${extension}`;
assert.ok(existsSync(binary), `missing staged engine ${binary}`);
const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
assert.equal(version.status, 0, version.stderr);
const versionBody = JSON.parse(version.stdout);
assert.equal(versionBody.engine, "hivemindos-rust-quant-engine");
assert.equal(versionBody.researchOnly, true);
assert.equal(versionBody.liveTradingEnabled, false);
const validatorResource = "src-tauri/resources/quant-research/quant-research-validator.py";
assert.ok(existsSync(validatorResource), "missing packaged Python validator source");
const compiled = spawnSync("python3", ["-m", "py_compile", validatorResource], { encoding: "utf8" });
assert.equal(compiled.status, 0, compiled.stderr);

console.log("Quant research Tauri sidecar bundle contract passed.");

#!/usr/bin/env node
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const target = hostTarget();
const manifest = join(
  projectRoot,
  "native",
  "quant-research-engine",
  "Cargo.toml",
);
const binaryName = `hivemind-quant-research-engine${target.exe}`;
const builtBinary = join(
  projectRoot,
  "native",
  "quant-research-engine",
  "target",
  "release",
  binaryName,
);
const destination = join(
  projectRoot,
  "src-tauri",
  "binaries",
  `hivemind-quant-research-engine-${target.triple}${target.exe}`,
);
const validatorSource = join(projectRoot, "scripts", "quant-research-validator.py");
const validatorDestination = join(
  projectRoot,
  "src-tauri",
  "resources",
  "quant-research",
  "quant-research-validator.py",
);

const built = spawnSync(
  "cargo",
  ["build", "--release", "--locked", "--manifest-path", manifest],
  { cwd: projectRoot, stdio: "inherit", windowsHide: true },
);
if (built.error) throw built.error;
if (built.status !== 0) {
  throw new Error(`Quant research engine build failed with exit ${built.status ?? "unknown"}.`);
}
if (!existsSync(builtBinary)) {
  throw new Error(`Quant research engine build did not produce ${builtBinary}.`);
}

mkdirSync(dirname(destination), { recursive: true });
rmSync(destination, { force: true });
copyFileSync(builtBinary, destination);
if (process.platform !== "win32") chmodSync(destination, 0o755);
mkdirSync(dirname(validatorDestination), { recursive: true });
copyFileSync(validatorSource, validatorDestination);
if (process.platform !== "win32") chmodSync(validatorDestination, 0o755);

const verified = spawnSync(destination, ["--version"], {
  encoding: "utf8",
  windowsHide: true,
});
if (verified.status !== 0) {
  throw new Error(`Staged quant research engine failed verification: ${verified.stderr?.trim()}`);
}
const version = JSON.parse(verified.stdout);
if (
  version.engine !== "hivemindos-rust-quant-engine"
  || version.researchOnly !== true
  || version.liveTradingEnabled !== false
) {
  throw new Error("Staged quant research engine returned an unsafe version contract.");
}
console.log(`[quant-research-sidecar] staged ${target.triple} engine ${version.version} and Python validator`);

function hostTarget() {
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
  throw new Error(`Unsupported quant research sidecar platform: ${process.platform}/${process.arch}`);
}

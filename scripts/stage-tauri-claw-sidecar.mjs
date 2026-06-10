import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const clawBackendVersion = process.env.CLAW_BACKEND_VERSION || "v0.3.0";
const clawBackendBase =
  process.env.CLAW_BACKEND_BASE_URL ||
  `${process.env.CLAW_BACKEND_PUBLIC_BASE || "https://claw-dl.hivemindos.workers.dev"}/claw-backend/${clawBackendVersion}`;

const target = sidecarTarget();
const targetPath = join(binariesDir, `claw-${target.triple}${target.exe}`);

mkdirSync(binariesDir, { recursive: true });
rmSync(targetPath, { force: true });

const localSource = findLocalClawBinary(target);
if (localSource) {
  copyExecutable(localSource, targetPath);
  console.log(`[tauri-sidecar] staged ${target.triple} from ${localSource}`);
  process.exit(0);
}

if (target.clawArchive) {
  const downloaded = downloadClawArchive(target);
  if (downloaded) {
    copyExecutable(downloaded, targetPath);
    console.log(
      `[tauri-sidecar] staged ${target.triple} from ${target.clawArchive}`,
    );
    process.exit(0);
  }
}

stageFallbackLauncher(target, targetPath);
console.log(`[tauri-sidecar] staged fallback launcher for ${target.triple}`);

function sidecarTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      triple: "aarch64-apple-darwin",
      exe: "",
      clawArchive: "claw-backend-darwin-arm64.tar.gz",
    };
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return {
      triple: "x86_64-apple-darwin",
      exe: "",
    };
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return {
      triple: "x86_64-unknown-linux-gnu",
      exe: "",
    };
  }

  if (process.platform === "win32" && process.arch === "x64") {
    return {
      triple: "x86_64-pc-windows-msvc",
      exe: ".exe",
    };
  }

  throw new Error(
    `Unsupported Tauri Claw sidecar platform: ${process.platform}/${process.arch}`,
  );
}

function findLocalClawBinary(target) {
  const fileName = `claw${target.exe}`;
  const candidates = [
    join(projectRoot, "src-tauri", "target", "release", fileName),
    join(projectRoot, "src-tauri", "target", "debug", fileName),
    join(homedir(), ".hivemindos", "claw", "bin", fileName),
  ];

  return candidates.find((path) => executableFileExists(path));
}

function executableFileExists(path) {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function copyExecutable(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
}

function downloadClawArchive(target) {
  const tempRoot = mkdtempSync(join(tmpdir(), "hivemindos-claw-sidecar-"));
  const archivePath = join(tempRoot, target.clawArchive);
  const url = `${clawBackendBase}/${target.clawArchive}`;

  try {
    run("curl", ["-fsSL", url, "-o", archivePath]);
    run("tar", ["-xzf", archivePath, "-C", tempRoot]);
    const binaryPath = findExtractedClaw(tempRoot, target.exe);
    if (!binaryPath) {
      throw new Error(
        `Downloaded ${basename(archivePath)} did not contain bin/claw${target.exe}`,
      );
    }
    return binaryPath;
  } catch (error) {
    console.warn(`[tauri-sidecar] ${error.message}`);
    return null;
  }
}

function findExtractedClaw(root, exe) {
  const findResult = spawnSync(
    "find",
    [root, "-path", `*/bin/claw${exe}`, "-type", "f", "-print", "-quit"],
    {
      encoding: "utf8",
    },
  );
  const found = findResult.stdout.trim();
  return found && executableFileExists(found) ? found : null;
}

function stageFallbackLauncher(target, destination) {
  if (process.platform === "win32") {
    stageWindowsFallbackLauncher(destination);
    return;
  }

  writeFileSync(
    destination,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'fallback="${CLAW_EXTERNAL_BINARY:-$HOME/.hivemindos/claw/bin/claw}"',
      'if [ ! -x "$fallback" ]; then',
      `  echo "[hivemindos] Claw sidecar for ${target.triple} is a fallback launcher, but $fallback is missing." >&2`,
      "  exit 127",
      "fi",
      'exec "$fallback" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(destination, 0o755);
}

function stageWindowsFallbackLauncher(destination) {
  const tempRoot = mkdtempSync(
    join(tmpdir(), "hivemindos-claw-windows-sidecar-"),
  );
  const sourcePath = join(tempRoot, "claw-sidecar-fallback.rs");
  writeFileSync(
    sourcePath,
    String.raw`use std::{env, path::PathBuf, process::{Command, exit}};

fn main() {
    let home = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME"));
    let Some(home) = home else {
        eprintln!("[hivemindos] USERPROFILE is not set; cannot locate Claw fallback binary.");
        exit(127);
    };

    let fallback = PathBuf::from(home).join(".hivemindos").join("claw").join("bin").join("claw.exe");
    if !fallback.is_file() {
        eprintln!("[hivemindos] Claw sidecar is a fallback launcher, but {} is missing.", fallback.display());
        exit(127);
    }

    match Command::new(fallback).args(env::args_os().skip(1)).status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("[hivemindos] failed to launch Claw fallback binary: {error}");
            exit(127);
        }
    }
}
`,
  );
  run("rustc", ["--edition=2021", sourcePath, "-o", destination]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(
      `${command} ${args.join(" ")} failed to start: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`,
    );
  }
}

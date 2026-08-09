#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const maxAttempts = process.platform === "darwin" ? 3 : 1;
let lastExitCode = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  lastExitCode = await runBuild();
  if (lastExitCode === 0) process.exit(0);
  if (attempt === maxAttempts) break;

  const delayMs = attempt * 15_000;
  console.warn(
    `Tauri release bundle attempt ${attempt}/${maxAttempts} failed; retrying on the warm build cache in ${delayMs / 1_000}s.`,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

process.exit(lastExitCode);

function runBuild() {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["tauri:build:release"], {
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Tauri release build terminated by ${signal}.`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

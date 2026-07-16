#!/usr/bin/env node

// Runs the upstream browser login outside the dashboard request lifecycle.
// The upstream CLI detects successful Google authentication and writes its
// private browser state under ~/.notebooklm; no credentials enter this process.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INTEGRATIONS_DIR = path.join(os.homedir(), ".hivemindos", "integrations");
const INSTALL_ROOT = path.join(INTEGRATIONS_DIR, "notebooklm");
const STATE_FILE = path.join(INTEGRATIONS_DIR, "notebooklm-state.json");
const BINARY_DIR = path.join(INSTALL_ROOT, "venv", process.platform === "win32" ? "Scripts" : "bin");
const CLI = path.join(BINARY_DIR, process.platform === "win32" ? "notebooklm.exe" : "notebooklm");
const BROWSER_PATH = path.join(INSTALL_ROOT, "playwright");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(INTEGRATIONS_DIR, { recursive: true });
  const next = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(next, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(next, STATE_FILE);
}

try {
  writeState({ ...readState(), authStatus: "signing-in", authPid: process.pid, authError: undefined });
  await execFileAsync(CLI, ["login"], {
    timeout: 15 * 60_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSER_PATH },
  });
  await execFileAsync(CLI, ["auth", "check", "--test", "--json"], {
    timeout: 60_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSER_PATH },
  });
  writeState({ ...readState(), authStatus: "authenticated", authPid: undefined, authError: undefined });
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  writeState({
    ...readState(),
    authStatus: "error",
    authPid: undefined,
    authError: `NotebookLM browser sign-in did not complete (exit ${code}). Retry from Integrations.`,
  });
  process.exitCode = 1;
}

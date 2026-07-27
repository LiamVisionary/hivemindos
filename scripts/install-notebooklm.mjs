#!/usr/bin/env node

// Installs the pinned NotebookLM Python client and native MCP preview into a
// dedicated user-owned virtual environment. Authentication remains in the
// upstream machine-local profile store and is never copied into HivemindOS.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, "..");
const INTEGRATIONS_DIR = path.join(os.homedir(), ".hivemindos", "integrations");
const INSTALL_ROOT = path.join(INTEGRATIONS_DIR, "notebooklm");
const STATE_FILE = path.join(INTEGRATIONS_DIR, "notebooklm-state.json");
const REGISTER_SCRIPT = path.join(ROOT, "scripts", "register-mcp-clients.mjs");
const PACKAGE_VERSION = "0.8.0b1";
const PACKAGE_SPEC = `notebooklm-py[browser,mcp]==${PACKAGE_VERSION}`;
const WHEEL_URL = "https://files.pythonhosted.org/packages/64/21/ff0a8ee135af3f51b1a2b1eeb5ddee0e4a3a216b2ef471ca4fc1abf7e360/notebooklm_py-0.8.0b1-py3-none-any.whl";
const EXPECTED_SHA256 = "752ceb76dac486d09a517ed97a651117d43fe113cb1e648952bc16be1dc16703";
const TARGETS = flagValue("--targets") || "all";

function flagValue(name) {
  const argv = process.argv.slice(2);
  const index = argv.findIndex((value) => value === name || value.startsWith(`${name}=`));
  if (index < 0) return "";
  return argv[index].includes("=") ? argv[index].split("=").slice(1).join("=") : (argv[index + 1] || "");
}

function writeState(state) {
  fs.mkdirSync(INTEGRATIONS_DIR, { recursive: true });
  const next = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(next, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(next, STATE_FILE);
}

function pythonCandidates() {
  if (process.platform === "win32") {
    return ["3.14", "3.13", "3.12", "3.11", "3.10"].map((version) => ({ command: "py", prefix: [`-${version}`] }));
  }
  return ["python3.14", "python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"]
    .map((command) => ({ command, prefix: [] }));
}

async function findPython() {
  for (const candidate of pythonCandidates()) {
    try {
      const result = await execFileAsync(candidate.command, [...candidate.prefix, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"], {
        timeout: 10_000,
        maxBuffer: 100_000,
      });
      const version = result.stdout.trim().split(".").map(Number);
      if (version[0] === 3 && version[1] >= 10) return { ...candidate, version: result.stdout.trim() };
    } catch {
      // Try the next portable Python candidate.
    }
  }
  throw new Error("NotebookLM requires Python 3.10 or newer. Install Python, then retry from Integrations.");
}

function venvBinary(name) {
  return path.join(INSTALL_ROOT, "venv", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? `${name}.exe` : name);
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: ROOT,
    timeout: options.timeout || 10 * 60_000,
    maxBuffer: 4_000_000,
    env: options.env || process.env,
  });
}

async function main() {
  fs.mkdirSync(INTEGRATIONS_DIR, { recursive: true });
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-notebooklm-"));
  const backupRoot = `${INSTALL_ROOT}.backup-${process.pid}`;
  let previousInstallMoved = false;

  writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "python" });
  try {
    const python = await findPython();
    const wheelPath = path.join(downloadDir, path.basename(new URL(WHEEL_URL).pathname));

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "download", pythonVersion: python.version });
    const response = await fetch(WHEEL_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`NotebookLM wheel download failed with HTTP ${response.status}.`);
    const wheel = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(wheel).digest("hex");
    if (digest !== EXPECTED_SHA256) throw new Error("The downloaded NotebookLM wheel did not match the pinned SHA-256 digest.");
    fs.writeFileSync(wheelPath, wheel, { mode: 0o600 });

    if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
    if (fs.existsSync(INSTALL_ROOT)) {
      fs.renameSync(INSTALL_ROOT, backupRoot);
      previousInstallMoved = true;
    }
    fs.mkdirSync(INSTALL_ROOT, { recursive: true });

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "environment", pythonVersion: python.version });
    await run(python.command, [...python.prefix, "-m", "venv", path.join(INSTALL_ROOT, "venv")]);
    const venvPython = venvBinary("python");
    await run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", `${wheelPath}[browser,mcp]`]);

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "browser", pythonVersion: python.version });
    const browserPath = path.join(INSTALL_ROOT, "playwright");
    await run(venvPython, ["-m", "playwright", "install", "chromium"], {
      timeout: 15 * 60_000,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
    });

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "verify", pythonVersion: python.version });
    const cli = venvBinary("notebooklm");
    const mcp = venvBinary("notebooklm-mcp");
    if (!fs.existsSync(cli) || !fs.existsSync(mcp)) throw new Error("NotebookLM installed without its required CLI or MCP executable.");
    const versionResult = await run(cli, ["--version"], { timeout: 30_000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath } });
    if (!versionResult.stdout.includes(PACKAGE_VERSION)) {
      throw new Error(`Installed NotebookLM version did not match ${PACKAGE_VERSION}.`);
    }
    await run(mcp, ["--help"], { timeout: 30_000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath } });

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "register", pythonVersion: python.version });
    const registration = await run(process.execPath, [REGISTER_SCRIPT, "--server", "notebooklm", "--targets", TARGETS], { timeout: 60_000 });

    if (previousInstallMoved) fs.rmSync(backupRoot, { recursive: true, force: true });
    writeState({
      status: "installed",
      package: PACKAGE_SPEC,
      version: PACKAGE_VERSION,
      sha256: EXPECTED_SHA256,
      pythonVersion: python.version,
      authStatus: "signed-out",
      registration: registration.stdout.trim().slice(-4000),
    });
  } catch (error) {
    fs.rmSync(INSTALL_ROOT, { recursive: true, force: true });
    if (previousInstallMoved && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, INSTALL_ROOT);
    writeState({
      status: "error",
      package: PACKAGE_SPEC,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

await main();

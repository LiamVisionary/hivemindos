#!/usr/bin/env node

// Install the pinned Hound engine into an isolated HivemindOS-owned virtual
// environment. The app launches it through scripts/web-research/hound_server.py,
// never through Hound's self-updating CLI entry point.

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
const INSTALL_ROOT = path.join(INTEGRATIONS_DIR, "web-research");
const STATE_FILE = path.join(INTEGRATIONS_DIR, "web-research-state.json");
const PACKAGE_VERSION = "11.1.6";
const PACKAGE_SPEC = `hound-mcp[all]==${PACKAGE_VERSION}`;
const WHEEL_URL = "https://files.pythonhosted.org/packages/07/a8/efa7a33135f4051e3c9bbc7daaccaa81e3a9321ebb701c410714a94885b4/hound_mcp-11.1.6-py3-none-any.whl";
const EXPECTED_SHA256 = "7deb3ac10b8cd48aeff093bb41beb94b16e173b2a12a97678345820b12b7f4fa";

function writeState(state) {
  fs.mkdirSync(INTEGRATIONS_DIR, { recursive: true });
  const next = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(next, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(next, STATE_FILE);
}

function pythonCandidates() {
  if (process.platform === "win32") {
    return ["3.14", "3.13", "3.12", "3.11"].map((version) => ({ command: "py", prefix: [`-${version}`] }));
  }
  return ["python3.14", "python3.13", "python3.12", "python3.11", "python3"]
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
      if (version[0] === 3 && version[1] >= 11) return { ...candidate, version: result.stdout.trim() };
    } catch {
      // Try the next portable Python candidate.
    }
  }
  throw new Error("Web research requires Python 3.11 or newer.");
}

function venvBinary(name) {
  return path.join(
    INSTALL_ROOT,
    "venv",
    process.platform === "win32" ? "Scripts" : "bin",
    process.platform === "win32" ? `${name}.exe` : name,
  );
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: ROOT,
    timeout: options.timeout || 15 * 60_000,
    maxBuffer: 4_000_000,
    env: options.env || process.env,
  });
}

async function installedVersion() {
  const python = venvBinary("python");
  if (!fs.existsSync(python)) return "";
  try {
    const result = await run(python, ["-c", "from importlib.metadata import version; print(version('hound-mcp'))"], { timeout: 30_000 });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

function browserInstalled() {
  const browserRoot = path.join(INSTALL_ROOT, "playwright");
  try {
    return fs.readdirSync(browserRoot).some((entry) => /chromium/i.test(entry));
  } catch {
    return false;
  }
}

async function main() {
  if (await installedVersion() === PACKAGE_VERSION && browserInstalled()) {
    writeState({ status: "installed", package: PACKAGE_SPEC, version: PACKAGE_VERSION, sha256: EXPECTED_SHA256 });
    console.log(`HivemindOS web research ${PACKAGE_VERSION} is already installed.`);
    return;
  }

  fs.mkdirSync(INTEGRATIONS_DIR, { recursive: true });
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-web-research-"));
  const backupRoot = `${INSTALL_ROOT}.backup-${process.pid}`;
  let previousInstallMoved = false;

  writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "python" });
  try {
    const python = await findPython();
    const wheelPath = path.join(downloadDir, path.basename(new URL(WHEEL_URL).pathname));

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "download", pythonVersion: python.version });
    const response = await fetch(WHEEL_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`Web research wheel download failed with HTTP ${response.status}.`);
    const wheel = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(wheel).digest("hex");
    if (digest !== EXPECTED_SHA256) throw new Error("The downloaded web research wheel did not match its pinned SHA-256 digest.");
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
    await run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", `${wheelPath}[all]`]);

    const browserPath = path.join(INSTALL_ROOT, "playwright");
    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "browser", pythonVersion: python.version });
    await run(venvPython, ["-m", "playwright", "install", "chromium"], {
      timeout: 20 * 60_000,
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
    });

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "verify", pythonVersion: python.version });
    const version = await installedVersion();
    if (version !== PACKAGE_VERSION) throw new Error(`Installed web research version ${version || "unknown"} did not match ${PACKAGE_VERSION}.`);
    if (!browserInstalled()) throw new Error("The web research browser engine was not installed.");
    await run(venvPython, [path.join(ROOT, "scripts", "web-research", "hound_server.py"), "--help"], {
      timeout: 60_000,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: browserPath,
        HIVEMINDOS_WEB_RESEARCH_DATA_DIR: path.join(INSTALL_ROOT, "data"),
        PYTHONDONTWRITEBYTECODE: "1",
      },
    });

    if (previousInstallMoved) fs.rmSync(backupRoot, { recursive: true, force: true });
    writeState({
      status: "installed",
      package: PACKAGE_SPEC,
      version: PACKAGE_VERSION,
      sha256: EXPECTED_SHA256,
      pythonVersion: python.version,
      browser: "chromium",
    });
    console.log(`Installed HivemindOS web research ${PACKAGE_VERSION}.`);
  } catch (error) {
    fs.rmSync(INSTALL_ROOT, { recursive: true, force: true });
    if (previousInstallMoved && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, INSTALL_ROOT);
    writeState({
      status: "error",
      package: PACKAGE_SPEC,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

await main();

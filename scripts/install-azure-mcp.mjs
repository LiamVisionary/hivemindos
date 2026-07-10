#!/usr/bin/env node

// Installs Microsoft's official Azure MCP into a dedicated user-owned prefix.
// This script is spawned by the local dashboard so the HTTP request can return
// immediately while npm downloads the ~114 MB platform package.

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, "..");
const HOME = os.homedir();
const INTEGRATIONS_DIR = path.join(HOME, ".hivemindos", "integrations");
const INSTALL_ROOT = path.join(INTEGRATIONS_DIR, "azure-mcp");
const STATE_FILE = path.join(INTEGRATIONS_DIR, "azure-mcp-state.json");
const REGISTER_SCRIPT = path.join(ROOT, "scripts", "register-mcp-clients.mjs");
const PACKAGE_NAME = "@azure/mcp";
const PACKAGE_VERSION = "2.0.4";
const PACKAGE_SPEC = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;
const EXPECTED_INTEGRITY = "sha512-W93sHb0uh4WxgL5VOQlFKLu+Xyex9npVKvVFQPCQPuRZMRjIRVF4CpVhtI3i593foSDxD8BsFvGrnifOxI51Fw==";
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

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function main() {
  writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "download" });
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "hivemind-azure-mcp-"));
  try {
    const packed = await execFileAsync(npmCommand(), ["pack", PACKAGE_SPEC, "--json", "--pack-destination", staging], {
      cwd: staging,
      timeout: 120_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, AZURE_MCP_COLLECT_TELEMETRY: "false" },
    });
    const metadata = JSON.parse(packed.stdout);
    const artifact = Array.isArray(metadata) ? metadata[0] : null;
    if (!artifact?.filename || artifact.integrity !== EXPECTED_INTEGRITY) {
      throw new Error("The downloaded @azure/mcp package did not match the pinned npm integrity.");
    }

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "install" });
    const tarball = path.join(staging, artifact.filename);
    await execFileAsync(npmCommand(), [
      "install",
      "--prefix",
      INSTALL_ROOT,
      "--no-save",
      "--package-lock=false",
      "--omit=dev",
      "--audit=false",
      "--fund=false",
      tarball,
    ], {
      cwd: staging,
      timeout: 10 * 60_000,
      maxBuffer: 4_000_000,
      env: { ...process.env, AZURE_MCP_COLLECT_TELEMETRY: "false" },
    });

    const installedPackage = JSON.parse(fs.readFileSync(path.join(INSTALL_ROOT, "node_modules", "@azure", "mcp", "package.json"), "utf8"));
    if (installedPackage.version !== PACKAGE_VERSION) {
      throw new Error(`Installed Azure MCP version ${String(installedPackage.version)} did not match ${PACKAGE_VERSION}.`);
    }
    const binary = path.join(INSTALL_ROOT, "node_modules", ".bin", process.platform === "win32" ? "azmcp.cmd" : "azmcp");
    if (!fs.existsSync(binary)) throw new Error("The Azure MCP executable was not installed.");

    writeState({ status: "installing", pid: process.pid, package: PACKAGE_SPEC, phase: "register" });
    const registration = await execFileAsync(process.execPath, [
      REGISTER_SCRIPT,
      "--server",
      "azure",
      "--azure-access",
      "read",
      "--targets",
      TARGETS,
    ], { cwd: ROOT, timeout: 60_000, maxBuffer: 2_000_000 });

    writeState({
      status: "installed",
      package: PACKAGE_SPEC,
      version: PACKAGE_VERSION,
      integrity: EXPECTED_INTEGRITY,
      access: "read",
      registration: registration.stdout.trim().slice(-4000),
    });
  } catch (error) {
    writeState({
      status: "error",
      package: PACKAGE_SPEC,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

await main();


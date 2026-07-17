#!/usr/bin/env node
// Guards the cross-platform hive-env-add spawn resolution
// (scripts/lib/hive-env-add-command.mjs). On Windows the collector used to
// resolve the setup.ps1-installed hive-env-add.cmd shim but only ONE of its
// four spawn sites passed `shell: true`, so Node >= 20.12.2 (CVE-2024-27980)
// killed the env-sync export, maintenance, and E2E endpoints with
// "spawn EINVAL" (2026-07-17: a fresh Windows fleet PC looked healthy locally
// while every peer reported it env-sync-unreachable). The resolver must prefer
// a Python launcher + real argv on Windows — the .cmd shim via the shell is a
// last resort only. Hermetic: all platform/fs/launcher probes are injected.

import assert from "node:assert/strict";
import { join } from "node:path";

import { resolveHiveEnvAddCommand } from "./lib/hive-env-add-command.mjs";

const APP_DIR = join("/opt", "hivemindos");
const HOME = join("/home", "bee");
const WIN_APP_DIR = "C:\\Users\\bee\\.hivemindos\\app-source";
const WIN_HOME = "C:\\Users\\bee";

function deps({ platform, executables = [], launcher = null, env = {} }) {
  const allowed = new Set(executables);
  return {
    platform,
    env,
    home: platform === "win32" ? WIN_HOME : HOME,
    canExecute: async (path) => allowed.has(path),
    findWindowsPythonLauncher: () => launcher,
  };
}

// macOS/Linux: spawn the extensionless script directly, ~/.local/bin first.
{
  const localBin = join(HOME, ".local", "bin", "hive-env-add");
  const appScript = join(APP_DIR, "scripts", "hive-env-add");
  const both = await resolveHiveEnvAddCommand(
    { appDir: APP_DIR },
    deps({ platform: "darwin", executables: [localBin, appScript] }),
  );
  assert.deepEqual(
    { command: both.command, args: both.args, shell: both.shell },
    { command: localBin, args: [], shell: false },
    "darwin must prefer ~/.local/bin and spawn directly",
  );
  const appOnly = await resolveHiveEnvAddCommand(
    { appDir: APP_DIR },
    deps({ platform: "linux", executables: [appScript] }),
  );
  assert.equal(appOnly.command, appScript, "linux must fall back to appDir/scripts");
  assert.equal(appOnly.shell, false);
}

// Windows: Python launcher + real argv beats the .cmd shim (no shell, so
// caller-supplied values stay properly quoted argv entries).
{
  const appScript = join(WIN_APP_DIR, "scripts", "hive-env-add");
  const shim = join(WIN_HOME, ".local", "bin", "hive-env-add.cmd");
  const resolved = await resolveHiveEnvAddCommand(
    { appDir: WIN_APP_DIR },
    deps({
      platform: "win32",
      executables: [appScript, shim],
      launcher: { command: "py", baseArgs: ["-3"] },
    }),
  );
  assert.deepEqual(
    { command: resolved.command, args: resolved.args, shell: resolved.shell },
    { command: "py", args: ["-3", appScript], shell: false },
    "win32 with a Python launcher must run the script via launcher argv, not the .cmd shim",
  );
}

// Windows without a resolvable Python launcher: the .cmd shim is still usable,
// but ONLY with shell: true — that flag reaching the spawn sites is the whole
// EINVAL fix.
{
  const shim = join(WIN_HOME, ".local", "bin", "hive-env-add.cmd");
  const resolved = await resolveHiveEnvAddCommand(
    { appDir: WIN_APP_DIR },
    deps({ platform: "win32", executables: [shim], launcher: null }),
  );
  assert.deepEqual(
    { command: resolved.command, args: resolved.args, shell: resolved.shell },
    { command: shim, args: [], shell: true },
    "win32 .cmd shim fallback must demand the shell",
  );
}

// HIVE_ENV_ADD_BIN override keeps its historical semantics: spawned as-is,
// shell only when it points at a .cmd on Windows.
{
  const override = "C:\\tools\\hive-env-add.CMD";
  const resolved = await resolveHiveEnvAddCommand(
    { appDir: WIN_APP_DIR },
    deps({
      platform: "win32",
      executables: [override],
      launcher: { command: "py", baseArgs: ["-3"] },
      env: { HIVE_ENV_ADD_BIN: override },
    }),
  );
  assert.deepEqual(
    { command: resolved.command, args: resolved.args, shell: resolved.shell },
    { command: override, args: [], shell: true },
    "HIVE_ENV_ADD_BIN override must win and keep .cmd shell semantics",
  );
  const unixOverride = join("/usr", "local", "bin", "hive-env-add");
  const unixResolved = await resolveHiveEnvAddCommand(
    { appDir: APP_DIR },
    deps({
      platform: "darwin",
      executables: [unixOverride],
      env: { HIVE_ENV_ADD_BIN: unixOverride },
    }),
  );
  assert.equal(unixResolved.command, unixOverride);
  assert.equal(unixResolved.shell, false);
}

// Nothing installed: not ready, with the setup hint and a spreadable args
// array (call sites do `[...envSync.args, ...flags]` unconditionally).
{
  const resolved = await resolveHiveEnvAddCommand(
    { appDir: WIN_APP_DIR },
    deps({ platform: "win32", executables: [], launcher: null }),
  );
  assert.equal(resolved.ready, false);
  assert.match(resolved.error, /Run setup on this machine/);
  assert.deepEqual(resolved.args, []);
  assert.equal(resolved.shell, false);
}

// Every collector spawn site must spread the resolver argv and pass the shell
// flag — a new call site that forgets either resurrects the Windows EINVAL.
{
  const { readFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const collector = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "agent-telemetry-collector.mjs"),
    "utf8",
  );
  // Lookbehind excludes the /health display string `[envSync.command, ...]`;
  // the trailing comma excludes the doc comment near resolveHiveEnvAdd.
  const executions = (collector.match(/(?<!\[)envSync\.command,/g) ?? []).length;
  const displaySpreads = (collector.match(/\[envSync\.command, \.\.\.envSync\.args\]/g) ?? []).length;
  const spreads = (collector.match(/\.\.\.envSync\.args/g) ?? []).length - displaySpreads;
  const shellFlags = (collector.match(/shell: Boolean\(envSync\.shell\),/g) ?? []).length;
  assert.ok(executions >= 4, `expected at least 4 collector spawn sites, saw ${executions}`);
  assert.equal(
    spreads,
    executions,
    "every collector hive-env-add spawn must spread ...envSync.args",
  );
  assert.equal(
    shellFlags,
    executions,
    "every collector hive-env-add spawn must pass shell: Boolean(envSync.shell)",
  );
}

console.log("hive-env-add command resolution: all assertions passed");

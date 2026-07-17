import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Cross-platform resolution of how to spawn `scripts/hive-env-add` (an
// extensionless `#!/usr/bin/env python3` script).
//
// macOS/Linux spawn the script directly via its shebang. Windows cannot spawn
// an extensionless Python file, and Node >= 20.12.2 refuses to spawn the
// setup.ps1-installed `hive-env-add.cmd` shim without `shell: true`
// (CVE-2024-27980 hardening) — the "spawn EINVAL" that broke every collector
// env-sync endpoint on Windows. `shell: true` in turn joins argv into one
// unescaped cmd.exe line, which breaks paths with spaces and lets
// caller-supplied values inject into the shell. So on Windows we prefer
// invoking the script through a Python launcher with a real argv (`py -3` →
// `python` → `python3`, matching setup.ps1's own resolution order and
// src/lib/services/hive-env-command.ts), and keep the .cmd shim only as a
// shell-mode fallback for installs without a resolvable Python launcher.

const WINDOWS_PYTHON_LAUNCHERS = [
  { command: "py", baseArgs: ["-3"] },
  { command: "python", baseArgs: [] },
  { command: "python3", baseArgs: [] },
];

let cachedWindowsLauncher; // undefined = not probed yet; null = none available

function defaultFindWindowsPythonLauncher() {
  if (cachedWindowsLauncher !== undefined) return cachedWindowsLauncher;
  for (const candidate of WINDOWS_PYTHON_LAUNCHERS) {
    try {
      const probe = spawnSync(
        candidate.command,
        [...candidate.baseArgs, "--version"],
        { stdio: "ignore", windowsHide: true },
      );
      if (!probe.error && probe.status === 0) {
        cachedWindowsLauncher = candidate;
        return candidate;
      }
    } catch {
      // try the next launcher
    }
  }
  cachedWindowsLauncher = null;
  return null;
}

async function defaultCanExecute(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function ready(command, args, shell) {
  return { ready: true, command, args, shell: Boolean(shell) };
}

function notReady() {
  return {
    ready: false,
    command: "hive-env-add",
    args: [],
    shell: false,
    error:
      "hive-env-add is not installed or executable. Run setup on this machine.",
  };
}

/**
 * Resolve the command + base argv to run hive-env-add on this platform.
 * Callers append their own flags after `args` and must pass
 * `shell: Boolean(result.shell)` (plus `windowsHide: true`) to spawn/execFile.
 */
export async function resolveHiveEnvAddCommand({ appDir }, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const home = dependencies.home ?? homedir();
  const canExecute = dependencies.canExecute ?? defaultCanExecute;
  const findWindowsPythonLauncher =
    dependencies.findWindowsPythonLauncher ?? defaultFindWindowsPythonLauncher;
  const isWin = platform === "win32";

  // An explicit override is spawned as-is (a .cmd override still needs the shell).
  const override = env.HIVE_ENV_ADD_BIN;
  if (override && (await canExecute(override))) {
    return ready(override, [], isWin && override.toLowerCase().endsWith(".cmd"));
  }

  const scriptCandidates = [
    join(home, ".local", "bin", "hive-env-add"),
    join(appDir, "scripts", "hive-env-add"),
  ];
  if (!isWin) {
    for (const path of scriptCandidates) {
      if (await canExecute(path)) return ready(path, [], false);
    }
    return notReady();
  }

  const launcher = findWindowsPythonLauncher();
  if (launcher) {
    for (const path of scriptCandidates) {
      if (await canExecute(path)) {
        return ready(launcher.command, [...launcher.baseArgs, path], false);
      }
    }
  }
  const shimCandidates = [
    join(home, ".local", "bin", "hive-env-add.cmd"),
    join(appDir, "scripts", "hive-env-add.cmd"),
  ];
  for (const path of shimCandidates) {
    if (await canExecute(path)) return ready(path, [], true);
  }
  return notReady();
}

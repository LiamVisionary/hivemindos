import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams, type ExecFileOptions, type SpawnOptions } from "child_process";
import { promisify } from "util";
import { join } from "path";

const execFileAsync = promisify(execFile);

// `scripts/hive-env-add` is a `#!/usr/bin/env python3` script. On macOS/Linux the
// shebang makes it directly spawnable, but Windows cannot spawn an extensionless
// Python file (child_process fails with ENOENT — the "spawn ...\scripts\hive-env-add
// ENOENT" users hit when saving an API key). On Windows we invoke it through a Python
// launcher, preferring `py -3` (the launcher lives at C:\Windows\py.exe, always on
// PATH even if the app's PATH predates a setup-time Python install), then `python` /
// `python3` — matching setup.ps1's own resolution order.
let cachedWindowsPython: { exe: string; base: string[] } | null | undefined;

function resolveWindowsPython(): { exe: string; base: string[] } {
  if (cachedWindowsPython !== undefined) {
    return cachedWindowsPython ?? { exe: "python", base: [] };
  }
  const candidates: Array<{ exe: string; base: string[] }> = [
    { exe: "py", base: ["-3"] },
    { exe: "python", base: [] },
    { exe: "python3", base: [] },
  ];
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate.exe, [...candidate.base, "--version"], {
        stdio: "ignore",
        windowsHide: true,
      });
      if (!probe.error && probe.status === 0) {
        cachedWindowsPython = candidate;
        return candidate;
      }
    } catch {
      // try the next candidate
    }
  }
  cachedWindowsPython = null;
  return { exe: "python", base: [] };
}

/** The command + full argv to run a Python script on this platform. */
export function pythonScriptCommand(scriptPath: string, args: string[] = []): { command: string; argv: string[] } {
  if (process.platform !== "win32") {
    return { command: scriptPath, argv: args };
  }
  const { exe, base } = resolveWindowsPython();
  return { command: exe, argv: [...base, scriptPath, ...args] };
}

/** The command + full argv to run `scripts/hive-env-add` with `args` on this platform. */
export function hiveEnvAddCommand(args: string[] = []): { command: string; argv: string[] } {
  return pythonScriptCommand(join(process.cwd(), "scripts", "hive-env-add"), args);
}

/**
 * Drop-in for `spawn(<hive-env-add path>, args, options)`, cross-platform. Always
 * pipes stdio (every caller does + needs the non-null stdin/stderr streams), so the
 * return is `ChildProcessWithoutNullStreams`.
 */
export function spawnHiveEnvAdd(args: string[], options: SpawnOptions = {}): ChildProcessWithoutNullStreams {
  const { command, argv } = hiveEnvAddCommand(args);
  return spawn(command, argv, { windowsHide: true, ...options, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
}

/** Drop-in for `execFileAsync(<hive-env-add path>, args, options)`, cross-platform. */
export function execFileHiveEnvAdd(args: string[], options: ExecFileOptions = {}) {
  const { command, argv } = hiveEnvAddCommand(args);
  return execFileAsync(command, argv, { windowsHide: true, ...options });
}

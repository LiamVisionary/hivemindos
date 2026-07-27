import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

const SYSTEMD_RUN_CANDIDATES = ["/usr/bin/systemd-run", "/bin/systemd-run"];

export function collectorUpdateLaunchSpec(command, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const pathExists = dependencies.pathExists ?? existsSync;
  const now = dependencies.now ?? Date.now;
  if (platform === "win32") {
    // Two Windows realities (validated on a real Server 2022 box) shape this:
    // Windows PowerShell's console host exits immediately without executing
    // when spawned DETACHED, and a non-detached child sits in the collector
    // task's Job object — where the update would kill itself the moment it
    // restarts the collector's task. So a short-lived, NON-detached bootstrap
    // hands the real update to its own one-shot Scheduled Task; the command
    // rides as -EncodedCommand base64 so no quoting is re-parsed en route.
    return {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        win32.join(dependencies.appDir ?? "", "scripts", "start-hivemindos-update-task.ps1"),
        "-EncodedTaskCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      launcher: "windows-update-task",
      detached: false,
    };
  }
  const systemdRun = platform === "linux"
    ? SYSTEMD_RUN_CANDIDATES.find((candidate) => pathExists(candidate))
    : undefined;
  if (systemdRun) {
    return {
      executable: systemdRun,
      args: [
        "--user",
        "--no-block",
        "--collect",
        `--unit=hivemindos-update-${now()}`,
        "sh",
        "-lc",
        command,
      ],
      launcher: "systemd-user-unit",
    };
  }
  return { executable: "sh", args: ["-lc", command], launcher: "detached-process" };
}

export function launchCollectorUpdate(options) {
  const spec = collectorUpdateLaunchSpec(options.command, {
    appDir: options.appDir,
  });
  const detached = spec.detached !== false;
  const child = spawn(spec.executable, spec.args, {
    detached,
    stdio: "ignore",
    windowsHide: true,
  });

  child.once("error", () => options.releaseReservation(options.reservationToken));
  child.once("exit", (code) => {
    // systemd-run and the Windows update-task bootstrap exit after handing the
    // independent unit/task off; their successful exit does not mean the update
    // itself has finished (the restarted collector clears the reservation).
    const handsOff =
      spec.launcher === "systemd-user-unit" ||
      spec.launcher === "windows-update-task";
    if (!handsOff || code !== 0) {
      options.releaseReservation(options.reservationToken);
    }
  });
  if (detached) child.unref();
  return { command: options.command, launcher: spec.launcher };
}

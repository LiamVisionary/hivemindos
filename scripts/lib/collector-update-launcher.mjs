import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const SYSTEMD_RUN_CANDIDATES = ["/usr/bin/systemd-run", "/bin/systemd-run"];

export function collectorUpdateLaunchSpec(command, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  const pathExists = dependencies.pathExists ?? existsSync;
  const now = dependencies.now ?? Date.now;
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
  const spec = collectorUpdateLaunchSpec(options.command);
  const child = spawn(spec.executable, spec.args, {
    detached: true,
    stdio: "ignore",
  });

  child.once("error", () => options.releaseReservation(options.reservationToken));
  child.once("exit", (code) => {
    // systemd-run exits after handing the independent unit to the user manager;
    // its successful exit does not mean the update itself has finished.
    if (spec.launcher !== "systemd-user-unit" || code !== 0) {
      options.releaseReservation(options.reservationToken);
    }
  });
  child.unref();
  return { command: options.command, launcher: spec.launcher };
}

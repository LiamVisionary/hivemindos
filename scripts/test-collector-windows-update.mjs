import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  collectorManualUpdateCommand,
  collectorUpdateCommand,
} = await import("./lib/collector-update-command.mjs");
const { collectorUpdateLaunchSpec } = await import(
  "./lib/collector-update-launcher.mjs"
);
const {
  fetchLatestMainCommit,
  readCollectorAppVersion,
  readSourceCommitMarker,
  resetLatestMainCommitCacheForTests,
} = await import("./lib/collector-source-version.mjs");

// --- collectorUpdateCommand: win32 runs the PowerShell updater --------------
{
  const command = collectorUpdateCommand({
    appDir: "C:\\Users\\liam o'brien\\.hivemindos\\app-source",
    collectorOnly: true,
    logPath: "C:\\Users\\liam o'brien\\.hivemindos\\logs\\agent-update.log",
    platform: "win32",
  });
  assert.match(command, /update-hivemindos\.ps1/);
  assert.match(command, / -CollectorOnly /);
  assert.match(command, /\*>>/, "all output streams should append to the log");
  assert.match(
    command,
    /liam o''brien/,
    "embedded single quotes must be doubled for PowerShell literals",
  );
  assert.doesNotMatch(command, /update-hivemindos\.sh/);
  assert.doesNotMatch(command, /mkdir -p/, "no sh syntax on Windows");

  const full = collectorUpdateCommand({
    appDir: "C:\\hm",
    collectorOnly: false,
    logPath: "C:\\hm\\logs\\agent-update.log",
    platform: "win32",
  });
  assert.doesNotMatch(full, /-CollectorOnly/);
}

// --- collectorUpdateCommand: unix strings stay byte-identical ---------------
{
  for (const platform of ["darwin", "linux"]) {
    const command = collectorUpdateCommand({
      appDir: "/tmp/hivemind os",
      collectorOnly: true,
      logPath: "/tmp/agent update.log",
      platform,
    });
    assert.equal(
      command,
      "mkdir -p '/tmp' && cd '/tmp/hivemind os' && ./scripts/update-hivemindos.sh --collector-only >> '/tmp/agent update.log' 2>&1",
    );
  }
  const full = collectorUpdateCommand({
    appDir: "/tmp/hivemind os",
    collectorOnly: false,
    logPath: "/tmp/agent update.log",
    platform: "linux",
  });
  assert.doesNotMatch(full, /--collector-only/);
}

// --- collectorManualUpdateCommand (the /health updateCommand) ---------------
{
  assert.equal(
    collectorManualUpdateCommand({
      appDir: "/Users/x/hivemindos",
      collectorOnly: true,
      platform: "darwin",
    }),
    'cd "/Users/x/hivemindos" && ./scripts/update-hivemindos.sh --collector-only',
  );
  assert.equal(
    collectorManualUpdateCommand({
      appDir: "/Users/x/hivemindos",
      collectorOnly: false,
      platform: "darwin",
    }),
    'cd "/Users/x/hivemindos" && git pull --ff-only && pnpm install --frozen-lockfile && ./scripts/install-telemetry-collector.sh',
  );
  const windows = collectorManualUpdateCommand({
    appDir: "C:\\Users\\x\\.hivemindos\\app-source",
    collectorOnly: true,
    platform: "win32",
  });
  assert.equal(
    windows,
    'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\x\\.hivemindos\\app-source\\scripts\\update-hivemindos.ps1" -CollectorOnly',
  );
}

// --- collectorUpdateLaunchSpec: win32 hands off to a Scheduled Task ---------
// A detached powershell.exe never executes (Windows PowerShell's console host
// exits under DETACHED_PROCESS), and a non-detached child would die inside the
// collector task's Job when the update restarts that task — so win32 launches
// a short-lived NON-detached bootstrap that registers/starts "HivemindOS
// Update" with the real command as -EncodedCommand base64.
{
  const spec = collectorUpdateLaunchSpec("Write-Host update", {
    platform: "win32",
    appDir: "C:\\Users\\x\\.hivemindos\\app-source",
    pathExists: () => {
      throw new Error("win32 must not probe for systemd-run");
    },
  });
  assert.equal(spec.executable, "powershell.exe");
  assert.equal(spec.launcher, "windows-update-task");
  assert.equal(spec.detached, false, "detached powershell silently no-ops on Windows");
  assert.ok(spec.args.includes("-NonInteractive"));
  const fileIndex = spec.args.indexOf("-File");
  assert.equal(
    spec.args[fileIndex + 1],
    "C:\\Users\\x\\.hivemindos\\app-source\\scripts\\start-hivemindos-update-task.ps1",
  );
  const encodedIndex = spec.args.indexOf("-EncodedTaskCommand");
  assert.ok(encodedIndex > 0);
  assert.equal(
    Buffer.from(spec.args[encodedIndex + 1], "base64").toString("utf16le"),
    "Write-Host update",
    "the task command must round-trip through -EncodedCommand base64 (UTF-16LE)",
  );

  const darwin = collectorUpdateLaunchSpec("echo hi", { platform: "darwin" });
  assert.deepEqual(
    { executable: darwin.executable, args: darwin.args },
    { executable: "sh", args: ["-lc", "echo hi"] },
  );
  assert.notEqual(darwin.detached, false);
  const linux = collectorUpdateLaunchSpec("echo hi", {
    platform: "linux",
    pathExists: (candidate) => candidate === "/usr/bin/systemd-run",
    now: () => 7,
  });
  assert.equal(linux.launcher, "systemd-user-unit");
  assert.equal(linux.executable, "/usr/bin/systemd-run");
}

// --- readSourceCommitMarker: archive checkouts report a validated commit ----
{
  const sha = "abcdef0123456789abcdef0123456789abcdef01";
  assert.equal(
    await readSourceCommitMarker("/app", {
      readFileImpl: async () => `  ${sha.toUpperCase()}\r\n`,
    }),
    sha,
  );
  assert.equal(
    await readSourceCommitMarker("/app", {
      readFileImpl: async () => "<html>rate limited</html>",
    }),
    "",
    "junk marker content must read as no version, not a fake commit",
  );
  assert.equal(
    await readSourceCommitMarker("/app", {
      readFileImpl: async () => {
        throw new Error("ENOENT");
      },
    }),
    "",
  );
}

// --- fetchLatestMainCommit: validated, cached (including failures) ----------
{
  const sha = "1234567890abcdef1234567890abcdef12345678";
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls += 1;
    assert.match(String(url), /api\.github\.com/);
    assert.equal(init.headers.accept, "application/vnd.github.sha");
    return { ok: true, text: async () => `${sha.toUpperCase()}\n` };
  };
  resetLatestMainCommitCacheForTests();
  let clock = 0;
  const now = () => clock;
  assert.equal(await fetchLatestMainCommit({ fetchImpl, now }), sha);
  assert.equal(await fetchLatestMainCommit({ fetchImpl, now }), sha);
  assert.equal(calls, 1, "a second probe inside the cache window must not refetch");
  clock = 11 * 60_000;
  assert.equal(await fetchLatestMainCommit({ fetchImpl, now }), sha);
  assert.equal(calls, 2, "an expired cache refetches");

  resetLatestMainCommitCacheForTests();
  let failures = 0;
  const failingFetch = async () => {
    failures += 1;
    throw new Error("offline");
  };
  clock = 0;
  assert.equal(await fetchLatestMainCommit({ fetchImpl: failingFetch, now }), "");
  assert.equal(await fetchLatestMainCommit({ fetchImpl: failingFetch, now }), "");
  assert.equal(failures, 1, "failures are cached so offline boxes do not hammer the API");

  resetLatestMainCommitCacheForTests();
  assert.equal(
    await fetchLatestMainCommit({
      fetchImpl: async () => ({ ok: true, text: async () => "not a sha" }),
      now,
    }),
    "",
  );
  resetLatestMainCommitCacheForTests();
}

// --- readCollectorAppVersion: git-free checkouts still report identity ------
{
  const sha = "abcdef0123456789abcdef0123456789abcdef01";
  const latest = "1234567890abcdef1234567890abcdef12345678";
  const gitless = async () => "";
  const version = await readCollectorAppVersion(
    {
      appDir: "C:\\Users\\x\\.hivemindos\\app-source",
      collectorOnly: true,
      execText: gitless,
      readProjectCheckouts: async () => [],
    },
    {
      readMarker: async () => sha,
      fetchLatest: async () => latest,
      platform: "win32",
    },
  );
  assert.equal(version.commit, sha);
  assert.equal(version.branch, "main");
  assert.equal(version.latestCommit, latest);
  assert.equal(version.dirty, false);
  assert.match(version.updateCommand, /update-hivemindos\.ps1/);

  // A real git checkout keeps its exact git identity and never probes.
  const gitVersion = await readCollectorAppVersion(
    {
      appDir: "/Users/x/hivemindos",
      collectorOnly: false,
      execText: async (cmd, args) => {
        if (args[0] === "rev-parse" && args[1] === "HEAD") return sha;
        if (args[0] === "rev-parse") return "main";
        if (args[0] === "status") return " M file";
        if (args[0] === "ls-remote") return `${latest}\trefs/heads/main`;
        return "";
      },
      readProjectCheckouts: async () => [],
    },
    {
      readMarker: async () => {
        throw new Error("git checkouts must not read the marker");
      },
      fetchLatest: async () => {
        throw new Error("git checkouts must not probe the GitHub API");
      },
      platform: "darwin",
    },
  );
  assert.equal(gitVersion.commit, sha);
  assert.equal(gitVersion.latestCommit, latest);
  assert.equal(gitVersion.dirty, true);
  assert.match(gitVersion.updateCommand, /install-telemetry-collector\.sh/);

  // No git and no marker: version is honestly unknown, nothing is probed.
  const unknown = await readCollectorAppVersion(
    {
      appDir: "C:\\hm",
      collectorOnly: true,
      execText: gitless,
      readProjectCheckouts: async () => [],
    },
    {
      readMarker: async () => "",
      fetchLatest: async () => {
        throw new Error("markerless checkouts must not probe the GitHub API");
      },
      platform: "win32",
    },
  );
  assert.equal(unknown.commit, "");
  assert.equal(unknown.latestCommit, "");
}

// --- source contracts: the wiring that makes the Windows path real ----------
{
  const collectorSource = readFileSync(
    "scripts/agent-telemetry-collector.mjs",
    "utf8",
  );
  assert.match(
    collectorSource,
    /const reloadExitCode = process\.platform === "win32" \? 75 : 0;[\s\S]*?process\.exit\(reloadExitCode\)/,
    "the self-reload watcher must exit 75 on Windows — the supervisor restarts that code immediately; a clean exit ends the service and Task Scheduler never relaunches a ran-then-exited task at all (validated on a real box)",
  );

  const installerSource = readFileSync(
    "scripts/install-telemetry-collector.ps1",
    "utf8",
  );
  assert.match(
    installerSource,
    /if \(`\$exitCode -eq 75\) \{[\s\S]*?continue/,
    "the generated supervisor must restart the collector immediately on the reload exit code",
  );
  assert.match(
    installerSource,
    /consecutiveFastExits/,
    "the supervisor's crash restarts must be bounded so a port-conflict zombie cannot hot-loop forever",
  );
  assert.match(
    collectorSource,
    /readCollectorAppVersion\(\{/,
    "the /health version payload must use the git-free-aware reader",
  );

  const launcherSource = readFileSync(
    "scripts/lib/collector-update-launcher.mjs",
    "utf8",
  );
  assert.match(launcherSource, /windowsHide: true/);
  assert.match(
    launcherSource,
    /spec\.launcher === "systemd-user-unit" \|\|\s*spec\.launcher === "windows-update-task"/,
    "the bootstrap's clean exit hands off — it must keep the maintenance reservation (the restarted collector clears it)",
  );

  const bootstrap = readFileSync("scripts/start-hivemindos-update-task.ps1", "utf8");
  assert.match(bootstrap, /Register-ScheduledTask/);
  assert.match(bootstrap, /-EncodedCommand \$EncodedTaskCommand/);
  assert.match(bootstrap, /S4U/);
  assert.match(bootstrap, /Start-ScheduledTask/);

  const uninstall = readFileSync("uninstall.ps1", "utf8");
  assert.match(
    uninstall,
    /Unregister-ScheduledTask -TaskName "HivemindOS Update"/,
    "the update task registered at update time must be removed by uninstall",
  );

  const updateScript = readFileSync("scripts/update-hivemindos.ps1", "utf8");
  assert.match(updateScript, /install-telemetry-collector\.ps1/);
  assert.match(updateScript, /\.hivemindos-source-commit/);
  assert.match(updateScript, /archive\/refs\/heads\/main\.zip/);
  assert.match(updateScript, /pull-with-changelog-preserve\.mjs/);
  assert.match(
    updateScript,
    /Win32_Process[\s\S]*?CommandLine[\s\S]*?-match \$escapedScript/,
    "the restart step must stop only this checkout's own collector process, matched by command line — never a port owner",
  );
  assert.doesNotMatch(
    updateScript,
    /Remove-Item -Recurse -Force \$Root/i,
    "the archive path must overlay in place, never delete the checkout wholesale",
  );
  assert.match(
    updateScript,
    /trap \{[\s\S]*?\[update\] FAILED/,
    "unhandled failures bypass the launcher's *>> redirection — the trap must land them in the log",
  );
  assert.match(
    updateScript,
    /HIVE_LINK_CONTROL=/,
    "the update must pin the machine's existing Link state — the installer's collector-only default would otherwise demand Go on Link-less boxes",
  );
  assert.match(
    updateScript,
    /Write-Warning "Collector reinstall failed[\s\S]*?Start-ScheduledTask -TaskName "HivemindOS Telemetry Collector"/,
    "a failed reinstall must restart the stopped collector task instead of stranding the machine",
  );

  const setupRs = readFileSync("src-tauri/src/setup.rs", "utf8");
  assert.match(setupRs, /\.hivemindos-source-commit/);
  assert.match(setupRs, /vnd\.github\.sha/);
}

console.log("collector windows update checks passed");

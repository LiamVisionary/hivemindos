import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  HivemindLinkUpdateError,
  runHivemindLinkUpdateScript,
} = await import("../src/lib/services/fleet/hivemind-link-update.ts");
const {
  collectorUpdateCommand,
} = await import("./lib/collector-update-command.mjs");

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status });
}

{
  const requests = [];
  let historyReads = 0;
  let remoteLines = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") {
      const command = JSON.parse(String(init.body ?? "{}")).command ?? "";
      // /bin/sh (not zsh): the wrapper must be POSIX-portable, and CI's
      // ubuntu-latest has no zsh on the launchd-like PATH this simulates.
      remoteLines = execFileSync("/bin/sh", ["-c", command], {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", TMPDIR: "/tmp" },
      })
        .split(/\r?\n/)
        .filter(Boolean);
      return jsonResponse({ ok: true });
    }
    historyReads += 1;
    return jsonResponse({
      ok: true,
      busy: historyReads === 1,
      lines:
        historyReads === 1
          ? ["update started"]
          : ["update started", ...remoteLines],
    });
  };

  const result = await runHivemindLinkUpdateScript(
    {
      collectorUrl: "http://update-success.test-tailnet.ts.net:8787",
      script: "printf 'updated\\n'",
      timeoutMs: 1_000,
    },
    {
      fetchImpl,
      now: (() => {
        let value = 0;
        return () => value++;
      })(),
      sessionId: () => "test_session",
      sleep: async () => undefined,
    },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /updated/);
  assert.equal(requests[0]?.init.method, "POST");
  assert.match(requests[0]?.url ?? "", /\/_hivemind\/shell\/sessions\/test_session\/command$/);
  const postedCommand = JSON.parse(String(requests[0]?.init.body ?? "{}")).command ?? "";
  assert.doesNotMatch(
    postedCommand,
    /\bnode\b/,
    "the Hivemind Link shell runs with a launchd PATH that does not include Node",
  );
  assert.match(postedCommand, /base64/, "the remote wrapper should use the system base64 tool");
  assert.ok(historyReads >= 2, "the update runner should wait for the remote completion marker");
}

{
  const fetchImpl = async (_url, init = {}) =>
    init.method === "POST"
      ? jsonResponse({ ok: true })
      : jsonResponse({
          ok: true,
          busy: false,
          lines: ["git pull failed", "__HIVE_UPDATE_DONE_failed_session__:17"],
        });

  await assert.rejects(
    () =>
      runHivemindLinkUpdateScript(
        {
          collectorUrl: "http://update-failure.test-tailnet.ts.net:8787",
          script: "exit 17",
          timeoutMs: 1_000,
        },
        {
          fetchImpl,
          now: (() => {
            let value = 0;
            return () => value++;
          })(),
          sessionId: () => "failed_session",
          sleep: async () => undefined,
        },
      ),
    /Hivemind Link update exited with code 17[\s\S]*git pull failed/,
  );
}

{
  let historyReads = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === "POST") return jsonResponse({ ok: true });
    historyReads += 1;
    return historyReads === 1
      ? jsonResponse({
          ok: true,
          busy: true,
          shellActive: true,
          lines: ["collector install started"],
        })
      : jsonResponse({
          ok: true,
          busy: false,
          shellActive: false,
          lines: null,
        });
  };

  const result = await runHivemindLinkUpdateScript(
    {
      collectorUrl: "http://update-restart.test-tailnet.ts.net:8787",
      script: "./scripts/install-telemetry-collector.sh",
      timeoutMs: 1_000,
    },
    {
      fetchImpl,
      now: (() => {
        let value = 0;
        return () => (value += 100);
      })(),
      sessionId: () => "restarting_session",
      sleep: async () => undefined,
    },
  );

  assert.equal(result.disconnected, true);
  assert.equal(result.exitCode, null);
  assert.match(result.stdout, /collector install started/);
}

{
  let commandPosts = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === "POST") {
      commandPosts += 1;
      return jsonResponse({ ok: true });
    }
    throw new Error("link restarted before history could be read");
  };

  await assert.rejects(
    () =>
      runHivemindLinkUpdateScript(
        {
          collectorUrl: "http://update-disconnect.test-tailnet.ts.net:8787",
          script: "./scripts/install-telemetry-collector.sh",
          timeoutMs: 1_000,
        },
        { fetchImpl, sessionId: () => "accepted_then_lost" },
      ),
    (error) => {
      assert.ok(error instanceof HivemindLinkUpdateError);
      assert.equal(error.commandAccepted, true);
      assert.equal(error.completionUnknown, true);
      return true;
    },
  );
  assert.equal(commandPosts, 1);
}

{
  const collectorOnly = collectorUpdateCommand({
    appDir: "/tmp/hivemind os",
    collectorOnly: true,
    logPath: "/tmp/agent update.log",
  });
  assert.match(collectorOnly, /update-hivemindos\.sh --collector-only/);
  assert.doesNotMatch(collectorOnly, /pnpm (install|build)/);

  const full = collectorUpdateCommand({
    appDir: "/tmp/hivemind os",
    collectorOnly: false,
    logPath: "/tmp/agent update.log",
  });
  assert.match(full, /update-hivemindos\.sh/);
  assert.doesNotMatch(full, /--collector-only/);
}

{
  const controllerSource = readFileSync(
    "src/features/dashboard/hooks/use-fleet-notifications-controller.tsx",
    "utf8",
  );
  const updateRouteSource = readFileSync("src/app/api/fleet/update/route.ts", "utf8");
  const collectorSource = readFileSync("scripts/agent-telemetry-collector.mjs", "utf8");

  assert.match(
    controllerSource,
    /signal:\s*AbortSignal\.timeout\(updateRequestTimeoutMs\)/,
    "the browser update request needs its own hard deadline",
  );
  assert.match(
    controllerSource,
    /data\?\.queued === true[\s\S]*?response\?\.status === 409[\s\S]*?active chat run[\s\S]*?Waiting for agent work[\s\S]*?await new Promise/,
    "a manual update blocked by active agent work should stay visible and retry automatically",
  );
  assert.match(
    controllerSource,
    /maintenanceRequestId[\s\S]*?crypto\.randomUUID\(\)[\s\S]*?JSON\.stringify\(\{[\s\S]*?maintenanceRequestId/,
    "retries should reuse one opaque maintenance request id",
  );
  assert.match(
    updateRouteSource,
    /COLLECTOR_VERIFICATION_TIMEOUT_MS\s*=\s*90_000/,
    "collector verification should stop with actionable feedback instead of polling for six minutes",
  );
  assert.match(
    updateRouteSource,
    /runHivemindLinkUpdateScript/,
    "remote updates should use the existing Hivemind Link shell before unavailable SSH",
  );
  assert.match(
    updateRouteSource,
    /x-hivemind-maintenance-request-id[\s\S]*?reservation\.queued[\s\S]*?status:\s*202/,
    "the dashboard route should preserve a queued collector reservation instead of racing new chat work",
  );
  assert.match(
    updateRouteSource,
    /error instanceof HivemindLinkUpdateError\s*&&\s*error\.commandAccepted[\s\S]*?error\.completionUnknown[\s\S]*?hivemind-link-shell-disconnected/,
    "an accepted Link command lost during restart should be verified instead of duplicated or reported failed",
  );
  assert.match(
    updateRouteSource,
    /branch" = "HEAD"[\s\S]*?refs\/remotes\/origin\/HEAD[\s\S]*?git merge --ff-only "origin\/\$branch"/,
    "collector-only checkouts on a detached HEAD should fast-forward from origin's default branch",
  );
  assert.match(
    collectorSource,
    /collectorUpdateCommand\(\{[\s\S]*?collectorOnly/,
    "the collector update endpoint should use the mode-aware fail-fast update command",
  );
  assert.match(
    collectorSource,
    /installedRuntimes\(\{\s*waitForRefresh:\s*false\s*\}\)/,
    "collector health must not wait for cold runtime CLI probes after a restart",
  );
  assert.match(
    collectorSource,
    /if \(options\.waitForRefresh === false\)[\s\S]*?installedRuntimesCache\s*\?[\s\S]*?: \[\]/,
    "cold runtime probes should refresh in the background while health uses an empty fallback",
  );
}

console.log("fleet update reliability checks passed");

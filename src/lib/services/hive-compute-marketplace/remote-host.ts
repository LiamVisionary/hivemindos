import { shellBaseFromCollectorUrl, shellSessionUrl } from "@/app/api/fleet/shell/shell-target";
import {
  HIVE_COMPUTE_WORKER_SOURCE,
  hiveComputeWorkerNotice,
  hiveComputeWorkerPackageJson,
  hiveComputeWorkerReadme,
} from "@/lib/services/hive-compute-marketplace/worker-module";
import type { HiveComputeHostModel, HiveComputeHostTarget } from "@/lib/types/hive-compute-marketplace";

/**
 * Remote quick-host: set up and run the Hive Compute worker on another fleet
 * machine over the established hive-native rails — linkd `/_hivemind/file` for
 * the worker module files and the linkd shell session API for commands (the
 * same rails the fleet Send-file button and /api/fleet/shell use). POSIX
 * targets only in v1; gateway URL and worker token come from the REMOTE
 * machine's shared hive env via `hive-env-run`, so no credentials ever leave
 * the dashboard machine.
 *
 * Remote quick-host advertises the discovered models WITHOUT exact per-token
 * asks (no local benchmark ran on that machine); the gateway's centralized
 * pricing governs until hosting is set up on the machine itself.
 */

const REMOTE_MODULE_DIR = "~/.hivemindos/modules/hive-compute-worker";
const SHELL_SESSION = "hive-compute-remote-host";
const COMMAND_TIMEOUT_MS = 10_000;
const SENTINEL_POLL_MS = 500;

export type RemoteHostCommandResult = {
  ok: boolean;
  sentinel: string;
  lines: string[];
};

export type RemoteHostRunStatus = {
  running: boolean;
  logTail: string;
};

export class HiveComputeRemoteHostError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "HiveComputeRemoteHostError";
    this.status = status;
  }
}

function requireShellBase(target: Pick<HiveComputeHostTarget, "collectorUrl" | "machineName">) {
  const base = shellBaseFromCollectorUrl(target.collectorUrl);
  if (!base) {
    throw new HiveComputeRemoteHostError(
      `Can't reach ${target.machineName || "that machine"}'s Hivemind Link shell from its collector URL.`,
      424,
    );
  }
  return base;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function shellJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  if (!response.ok) throw new HiveComputeRemoteHostError(`Hivemind Link shell returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null);
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

function shellOutputLines(payload: Record<string, unknown>) {
  const lines = payload.lines;
  if (!Array.isArray(lines)) return [];
  return lines.filter((line): line is string => typeof line === "string" && !line.startsWith("$ "));
}

/** Run one command in the dedicated remote-host shell session and wait for one
 * of the sentinel markers to appear in its output. */
async function runSentinelCommand(
  base: string,
  command: string,
  sentinels: { ok: string; fail: string },
  timeoutMs = 90_000,
): Promise<RemoteHostCommandResult> {
  await shellJson(shellSessionUrl(base, SHELL_SESSION, "command"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command }),
  });
  const deadline = Date.now() + timeoutMs;
  let lines: string[] = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SENTINEL_POLL_MS));
    const payload = await shellJson(shellSessionUrl(base, SHELL_SESSION)).catch(() => ({}));
    lines = shellOutputLines(payload);
    if (lines.some((line) => line.trim() === sentinels.ok)) return { ok: true, sentinel: sentinels.ok, lines };
    if (lines.some((line) => line.trim() === sentinels.fail)) return { ok: false, sentinel: sentinels.fail, lines };
  }
  throw new HiveComputeRemoteHostError("Timed out waiting for the remote shell to finish.", 504);
}

async function pushRemoteFile(base: string, fileName: string, content: string) {
  const url = `${base}/_hivemind/file?dir=${encodeURIComponent(REMOTE_MODULE_DIR)}&name=${encodeURIComponent(fileName)}`;
  const body = new TextEncoder().encode(content);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "content-length": String(body.byteLength) },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new HiveComputeRemoteHostError(`Could not push ${fileName} to the remote machine (HTTP ${response.status}).`, 502);
  }
}

/** Install the worker module files and dependencies on the remote machine. */
export async function setupRemoteHiveComputeHosting(
  target: Pick<HiveComputeHostTarget, "collectorUrl" | "machineName">,
): Promise<RemoteHostCommandResult> {
  const base = requireShellBase(target);
  await pushRemoteFile(base, "worker.mjs", HIVE_COMPUTE_WORKER_SOURCE);
  await pushRemoteFile(base, "package.json", hiveComputeWorkerPackageJson());
  await pushRemoteFile(base, "README.md", hiveComputeWorkerReadme());
  await pushRemoteFile(base, "NOTICE.md", hiveComputeWorkerNotice());
  return runSentinelCommand(
    base,
    `cd ${REMOTE_MODULE_DIR} && [ -s worker.mjs ] && [ -s package.json ] && npm install --omit=dev >install.log 2>&1 && echo HMOS_HC_SETUP_OK || echo HMOS_HC_SETUP_FAIL`,
    { ok: "HMOS_HC_SETUP_OK", fail: "HMOS_HC_SETUP_FAIL" },
    180_000,
  );
}

/** Start the worker on the remote machine with the models this dashboard
 * discovered over the collector. Conservative guardrails are pinned inline;
 * gateway URL and token resolve from the remote machine's own hive env. */
export async function startRemoteHiveComputeWorker(
  target: Pick<HiveComputeHostTarget, "collectorUrl" | "machineName">,
  models: HiveComputeHostModel[],
): Promise<RemoteHostCommandResult> {
  const base = requireShellBase(target);
  if (!models.length) {
    throw new HiveComputeRemoteHostError("No models were discovered on that machine to advertise.", 424);
  }
  const modelIds = models.map((model) => model.providerModelId);
  const modelMap: Record<string, string> = { "*": modelIds[0] };
  const engines: Record<string, string> = {};
  for (const model of models) {
    modelMap[model.providerModelId] = model.providerModelId;
    engines[model.providerModelId] = model.backendKind === "ollama" ? "ollama" : "openai";
  }
  const env = [
    `HIVE_COMPUTE_MODELS=${shellQuote(modelIds.join(","))}`,
    `HIVE_COMPUTE_MODEL_MAP_JSON=${shellQuote(JSON.stringify(modelMap))}`,
    `HIVE_COMPUTE_MODEL_ENGINES_JSON=${shellQuote(JSON.stringify(engines))}`,
    "HIVE_COMPUTE_WORKER_HOST_WHEN=idle",
    "HIVE_COMPUTE_WORKER_PAUSE_ON_BATTERY=1",
    "HIVE_COMPUTE_WORKER_YIELD_TO_USER=1",
  ].join(" ");
  return runSentinelCommand(
    base,
    `cd ${REMOTE_MODULE_DIR} && command -v hive-env-run >/dev/null 2>&1 && ` +
    `(${env} nohup hive-env-run -- npm start >worker.log 2>&1 & echo $! > worker.pid) && sleep 2 && ` +
    `kill -0 $(cat worker.pid) 2>/dev/null && echo HMOS_HC_LIVE_OK || echo HMOS_HC_LIVE_FAIL`,
    { ok: "HMOS_HC_LIVE_OK", fail: "HMOS_HC_LIVE_FAIL" },
  );
}

/** Stop a remotely started worker by its own pid file — never by port. */
export async function stopRemoteHiveComputeWorker(
  target: Pick<HiveComputeHostTarget, "collectorUrl" | "machineName">,
): Promise<RemoteHostCommandResult> {
  const base = requireShellBase(target);
  return runSentinelCommand(
    base,
    `cd ${REMOTE_MODULE_DIR} 2>/dev/null && { [ -f worker.pid ] && kill $(cat worker.pid) 2>/dev/null; rm -f worker.pid; echo HMOS_HC_STOPPED; } || echo HMOS_HC_STOP_FAIL`,
    { ok: "HMOS_HC_STOPPED", fail: "HMOS_HC_STOP_FAIL" },
  );
}

/** Probe whether a remotely started worker is still running, with a log tail. */
export async function readRemoteHiveComputeHostRun(
  target: Pick<HiveComputeHostTarget, "collectorUrl" | "machineName">,
): Promise<RemoteHostRunStatus> {
  const base = requireShellBase(target);
  const result = await runSentinelCommand(
    base,
    `cd ${REMOTE_MODULE_DIR} 2>/dev/null && { [ -f worker.pid ] && kill -0 $(cat worker.pid) 2>/dev/null && echo HMOS_HC_RUNNING || echo HMOS_HC_NOT_RUNNING; tail -n 6 worker.log 2>/dev/null | sed 's/^/HMOS_HC_LOG:/'; } || echo HMOS_HC_NOT_RUNNING`,
    { ok: "HMOS_HC_RUNNING", fail: "HMOS_HC_NOT_RUNNING" },
    15_000,
  );
  const logTail = result.lines
    .flatMap((line) => (line.startsWith("HMOS_HC_LOG:") ? [line.slice("HMOS_HC_LOG:".length)] : []))
    .join("\n");
  return { running: result.ok, logTail };
}

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentRuntime } from "@/lib/types/agent-runtime";
import { localCollectorPort, normalizeCollectorUrl } from "@/lib/services/local-collector-url";
import type { MachineInitResult } from "./hetzner-control-room";

// One-click Hetzner provisioning + runtime seeding (Mechanism A).
//
// The "New Hetzner agent box" modal used to only scaffold scripts and hand the
// user copyable commands. This runner EXECUTES those scaffolded scripts and then
// seeds the new box with the chosen runtimes + their portable state, streaming
// progress into an in-memory job the modal polls (no SSE — the codebase pattern
// is status-object polling, e.g. BridgeRepairStatus in fleet/discover).
//
// Seeding is driven over SSH against the box's loopback collector (127.0.0.1:8787,
// which requireLinkOwner allows as a local caller), so it needs no tailnet-collector
// reachability and works before the box is fully discovered. The job is detached
// (survives the triggering request) but in-memory (dies with the Next server) —
// the same limitation as the existing BridgeRepairStatus jobs.

export type ProvisionPhase =
  | "queued"
  | "provision"
  | "bootstrap"
  | "wait-collector"
  | "seed-runtimes"
  | "seed-env"
  | "seed-state"
  | "done"
  | "failed";

export type ProvisionJob = {
  id: string;
  projectName: string;
  serverName: string;
  sshAlias: string;
  projectDir: string;
  seedRuntimes: AgentRuntime[];
  seedFromMachineId: string;
  status: "running" | "succeeded" | "failed";
  phase: ProvisionPhase;
  log: string[];
  error: string | null;
  startedAt: number;
  updatedAt: number;
  // True once the box exists + bootstrapped, even if a later seed step failed —
  // a provisioned box with a partial seed is still a usable machine.
  provisioned: boolean;
};

const jobs = new Map<string, ProvisionJob>();
const MAX_LOG = 4000;
const COLLECTOR_WAIT_MS = 10 * 60_000;
const SSH_OPTS = ["-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15"];

function augmentedPath(): string {
  const home = process.env.HOME || "";
  return [
    home ? join(home, ".local", "bin") : "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH || "",
  ]
    .filter(Boolean)
    .join(":");
}

function pushLog(job: ProvisionJob, line: string) {
  for (const part of line.split("\n")) {
    const trimmed = part.replace(/\s+$/, "");
    if (trimmed) job.log.push(trimmed);
  }
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
  job.updatedAt = Date.now();
}

function setPhase(job: ProvisionJob, phase: ProvisionPhase) {
  job.phase = phase;
  job.updatedAt = Date.now();
  pushLog(job, `==> ${phase}`);
}

function runCommand(
  job: ProvisionJob,
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; capture?: boolean } = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: augmentedPath() },
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          pushLog(job, `(timeout after ${Math.round((opts.timeoutMs || 0) / 1000)}s, killing ${command})`);
          child.kill("SIGTERM");
        }, opts.timeoutMs)
      : null;
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (opts.capture) out += text;
      pushLog(job, text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      pushLog(job, `error: ${err.message}`);
      resolve({ code: 1, out });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
}

// Run a curl against the box's loopback collector over SSH, capturing stdout.
function sshCurl(job: ProvisionJob, curlArgs: string, timeoutMs = 960_000) {
  return runCommand(job, "ssh", [...SSH_OPTS, job.sshAlias, curlArgs], {
    timeoutMs,
    capture: true,
  });
}

async function waitForBoxCollector(job: ProvisionJob): Promise<boolean> {
  const deadline = Date.now() + COLLECTOR_WAIT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const { code, out } = await sshCurl(
      job,
      "curl -sf --max-time 5 http://127.0.0.1:8787/health || true",
      30_000,
    );
    if (code === 0 && /"ok"\s*:\s*true/.test(out)) {
      pushLog(job, "collector is up on the new box.");
      return true;
    }
    if (attempt % 4 === 0) pushLog(job, "waiting for the box collector to come up…");
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function fetchSourceExport(collectorUrl: string, runtime: AgentRuntime): Promise<Buffer> {
  const base = normalizeCollectorUrl(collectorUrl);
  const res = await fetch(`${base}/runtimes/${runtime}/export-runtime-state`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`source export for ${runtime} returned HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function runJob(job: ProvisionJob, sourceCollectorUrl: string) {
  try {
    // 1. Provision the Hetzner server (creates the box, writes SERVER_HOST + SSH alias).
    setPhase(job, "provision");
    const provision = await runCommand(job, "bash", [join(job.projectDir, "scripts", "provision.sh")], {
      cwd: job.projectDir,
      timeoutMs: 8 * 60_000,
    });
    if (provision.code !== 0) throw new Error("provision.sh failed (see log).");

    // 2. Bootstrap HivemindOS + the primary runtime + the fleet collector.
    setPhase(job, "bootstrap");
    const bootstrap = await runCommand(job, "bash", [join(job.projectDir, "scripts", "bootstrap-hivemindos.sh")], {
      cwd: job.projectDir,
      timeoutMs: 20 * 60_000,
    });
    if (bootstrap.code !== 0) throw new Error("bootstrap-hivemindos.sh failed (see log).");
    job.provisioned = true;

    // 3. Wait for the box's collector to be reachable on its loopback.
    setPhase(job, "wait-collector");
    if (!(await waitForBoxCollector(job))) {
      throw new Error("the box collector did not come up within the timeout.");
    }

    // 4. Install each requested runtime on the box (loopback collector).
    setPhase(job, "seed-runtimes");
    for (const rt of job.seedRuntimes) {
      const body = `{"action":"install-runtime"}`;
      const { code, out } = await sshCurl(
        job,
        `curl -sf -X POST http://127.0.0.1:8787/runtimes/${rt}/integrations -H 'content-type: application/json' -d '${body}' || true`,
      );
      if (code === 0 && /"ok"\s*:\s*true/.test(out)) pushLog(job, `installed ${rt}.`);
      else pushLog(job, `${rt}: install was skipped or needs manual setup (continuing).`);
    }

    // 5. Pull shared-env keys onto the box so provider keys land before state import.
    setPhase(job, "seed-env");
    await sshCurl(job, "curl -sf -X POST http://127.0.0.1:8787/env/sync-maintenance || true", 120_000);

    // 6. Seed each runtime's portable state from the source machine.
    setPhase(job, "seed-state");
    for (const rt of job.seedRuntimes) {
      let tar: Buffer;
      try {
        tar = await fetchSourceExport(sourceCollectorUrl, rt);
      } catch (error) {
        pushLog(job, `${rt}: skipped state seed (${error instanceof Error ? error.message : "export failed"}).`);
        continue;
      }
      const localTar = join(tmpdir(), `hive-seed-${job.id}-${rt}.tar.gz`);
      const remoteTar = `/tmp/hive-seed-${rt}.tar.gz`;
      await writeFile(localTar, tar as unknown as Uint8Array);
      try {
        const scp = await runCommand(job, "scp", [...SSH_OPTS, localTar, `${job.sshAlias}:${remoteTar}`], {
          timeoutMs: 120_000,
        });
        if (scp.code !== 0) {
          pushLog(job, `${rt}: scp of state failed (continuing).`);
          continue;
        }
        const { code, out } = await sshCurl(
          job,
          `curl -sf -X POST http://127.0.0.1:8787/runtimes/${rt}/import-runtime-state -H 'content-type: application/gzip' --data-binary @${remoteTar}; rm -f ${remoteTar}`,
        );
        if (code === 0 && /"ok"\s*:\s*true/.test(out)) pushLog(job, `seeded ${rt} state onto the box.`);
        else pushLog(job, `${rt}: state import did not confirm (continuing).`);
      } finally {
        await rm(localTar, { force: true }).catch(() => {});
      }
    }

    setPhase(job, "done");
    job.status = "succeeded";
  } catch (error) {
    job.error = error instanceof Error ? error.message : String(error);
    job.status = "failed";
    setPhase(job, "failed");
    pushLog(job, `FAILED: ${job.error}`);
  }
}

export type StartProvisionInput = {
  machine: MachineInitResult;
  seedRuntimes: AgentRuntime[];
  seedFromMachineId?: string;
  seedFromCollectorUrl?: string;
};

export async function startProvisionJob(input: StartProvisionInput): Promise<ProvisionJob> {
  const now = Date.now();
  const job: ProvisionJob = {
    id: randomUUID(),
    projectName: input.machine.projectName,
    serverName: input.machine.serverName,
    sshAlias: input.machine.sshAlias,
    projectDir: input.machine.projectDir,
    seedRuntimes: input.seedRuntimes,
    seedFromMachineId: input.seedFromMachineId || "",
    status: "running",
    phase: "queued",
    log: [],
    error: null,
    startedAt: now,
    updatedAt: now,
    provisioned: false,
  };
  jobs.set(job.id, job);

  // Resolve the source collector: a passed URL (remote machine) or the local
  // collector (cloning from this machine).
  let sourceCollectorUrl = input.seedFromCollectorUrl?.trim() || "";
  if (!sourceCollectorUrl) {
    sourceCollectorUrl = `http://127.0.0.1:${await localCollectorPort()}`;
  }

  // Detached: run without awaiting so the POST returns immediately.
  void runJob(job, sourceCollectorUrl);
  return job;
}

export function getProvisionJob(id: string): ProvisionJob | null {
  return jobs.get(id) ?? null;
}

// Trim a job to a poll-friendly view (tail of the log + a cursor for incremental
// polling).
export function provisionJobView(job: ProvisionJob, sinceCursor = 0) {
  const cursor = job.log.length;
  const start = Math.max(0, sinceCursor);
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    provisioned: job.provisioned,
    serverName: job.serverName,
    sshAlias: job.sshAlias,
    seedRuntimes: job.seedRuntimes,
    error: job.error,
    logTail: job.log.slice(start),
    cursor,
    updatedAt: job.updatedAt,
  };
}

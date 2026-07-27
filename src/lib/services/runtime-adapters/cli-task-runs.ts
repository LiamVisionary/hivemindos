import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "@/lib/home-dir";
import { runtimeCommandEnv, runtimeCommandPaths } from "@/lib/services/runtime-command-env";
import { readSharedHiveEnvValues } from "@/lib/services/shared-hive-env";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { RuntimeRun, RuntimeRunLog } from "./types";
import { evaluateCompletionEvent } from "@/lib/services/evaluation/control-plane";

const RUN_ROOT = join(homedir(), ".hivemindos", "runtime-runs");

type CliTaskConfig = {
  runtime: AgentRuntime;
  label: string;
  command: string;
  buildArgs: (task: string, input: Record<string, unknown>, profile?: AgentProfile) => string[];
};

type StoredCliRun = RuntimeRun & {
  pid?: number;
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  exitCode?: number | null;
  evaluation?: RuntimeRun["evaluation"];
};

function runDir(runtime: AgentRuntime) {
  return join(RUN_ROOT, String(runtime));
}

function metaPath(runtime: AgentRuntime, id: string) {
  return join(runDir(runtime), `${id}.json`);
}

function logPath(runtime: AgentRuntime, id: string) {
  return join(runDir(runtime), `${id}.log`);
}

async function executableExists(command: string) {
  if (command.includes("/")) return existsSync(command);
  return runtimeCommandPaths().some((part) => existsSync(join(part, command)));
}

async function cliRuntimeEnv(runtime: AgentRuntime, profile?: AgentProfile) {
  const sharedEnv = await readSharedHiveEnvValues().catch(() => ({}));
  const env: NodeJS.ProcessEnv = runtimeCommandEnv({ ...sharedEnv, ...process.env });
  if (runtime === "openhands") {
    env.OPENHANDS_SUPPRESS_BANNER = env.OPENHANDS_SUPPRESS_BANNER || "1";
    env.LLM_API_KEY = env.LLM_API_KEY || env.OPENAI_API_KEY || "";
    env.LLM_MODEL = env.LLM_MODEL || profile?.model || "";
  }
  return env;
}

async function writeRun(run: StoredCliRun) {
  await mkdir(dirname(metaPath(run.runtime, run.id)), { recursive: true });
  await writeFile(metaPath(run.runtime, run.id), `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 });
}

async function appendLog(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, { flag: "a", mode: 0o600 });
}

async function readStoredRun(runtime: AgentRuntime, id: string): Promise<StoredCliRun | null> {
  const raw = await readFile(metaPath(runtime, id), "utf8").catch(() => "");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredCliRun;
  } catch {
    return null;
  }
}

function processIsRunning(pid?: number) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function normalizeCwd(input: Record<string, unknown>) {
  const cwd = String(input.cwd ?? process.cwd()).trim() || process.cwd();
  const resolved = resolve(cwd.replace(/^~(?=$|\/)/, homedir()));
  const entry = await stat(resolved).catch(() => null);
  if (!entry?.isDirectory()) throw new Error(`Working directory does not exist: ${resolved}`);
  return resolved;
}

function refreshedRun(run: StoredCliRun): StoredCliRun {
  if (run.status !== "active") return run;
  if (processIsRunning(run.pid)) return run;
  // Derive the demotion at read time only. The child's close handler attaches the
  // evaluation and final status asynchronously after exit; persisting this stale
  // read-modify-write here can land after that write and permanently clobber it.
  return {
    ...run,
    status: "unknown",
    conclusion: run.conclusion ?? "Process is no longer running; final exit was not captured.",
  };
}

export async function startCliTaskRun(config: CliTaskConfig, input: Record<string, unknown>, profile?: AgentProfile) {
  const task = String(input.task ?? input.prompt ?? "").trim();
  if (!task) return { ok: false, error: "Task prompt is required." };
  if (!(await executableExists(config.command))) {
    return { ok: false, error: `${config.label} CLI was not found. Install it first, then retry the task.` };
  }

  const cwd = await normalizeCwd(input);
  const id = `${String(config.runtime)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const args = config.buildArgs(task, input, profile);
  const runLogPath = logPath(config.runtime, id);
  const now = new Date().toISOString();
  const run: StoredCliRun = {
    id,
    runtime: config.runtime,
    name: task.length > 90 ? `${task.slice(0, 87)}...` : task,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    conclusion: null,
    command: config.command,
    args,
    cwd,
    logPath: runLogPath,
  };
  await writeRun(run);
  await appendLog(runLogPath, `$ ${config.command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}\n`);

  const child = spawn(config.command, args, {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: await cliRuntimeEnv(config.runtime, profile),
  });

  const active: StoredCliRun = {
    ...run,
    status: "active",
    pid: child.pid,
    updatedAt: new Date().toISOString(),
  };
  await writeRun(active);

  let pendingLogWrite = Promise.resolve();
  const queueLog = (value: string) => {
    pendingLogWrite = pendingLogWrite.then(() => appendLog(runLogPath, value));
    return pendingLogWrite;
  };
  child.stdout.on("data", (chunk: Buffer) => void queueLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => void queueLog(chunk.toString()));
  child.on("error", (error) => {
    void queueLog(`\n${error.message}\n`);
    void writeRun({
      ...active,
      status: "failed",
      updatedAt: new Date().toISOString(),
      conclusion: error.message,
    });
  });
  child.on("close", (code) => {
    void (async () => {
      await pendingLogWrite.catch(() => undefined);
      const rawLog = await readFile(runLogPath, "utf8").catch(() => "");
      // The first line is HivemindOS's command echo and contains the task prompt.
      // Exclude it so an exit-0 process with no agent response cannot pass by
      // "evaluating" its own input as substantive output.
      const output = rawLog.split(/\r?\n/).slice(1).join("\n");
      const completedAt = Date.now();
      const evaluation = await evaluateCompletionEvent({
        id,
        surface: "runtime-cli",
        status: code === 0 ? "completed" : "failed",
        observed: true,
        output,
        startedAt: Date.parse(run.createdAt || "") || undefined,
        completedAt,
        metadata: { runtime: config.runtime, cwd },
      });
      await writeRun({
        ...active,
        status: code === 0 ? "completed" : "failed",
        updatedAt: new Date(completedAt).toISOString(),
        exitCode: code,
        conclusion: code === 0 ? "completed" : `exited with code ${code}`,
        evaluation,
      });
    })();
  });
  child.unref();

  return { ok: true, id, logPath: runLogPath, message: `Started ${config.label} task.`, result: active };
}

export async function listCliTaskRuns(runtime: AgentRuntime): Promise<RuntimeRun[]> {
  const dir = runDir(runtime);
  const files = await readdir(dir).catch(() => []);
  const runs = await Promise.all(files.filter((file) => file.endsWith(".json")).map(async (file) => {
    const run = await readStoredRun(runtime, file.replace(/\.json$/, ""));
    return run ? refreshedRun(run) : null;
  }));
  return runs
    .filter((run): run is StoredCliRun => Boolean(run))
    .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""))
    .map(({ id, name, status, createdAt, updatedAt, conclusion, evaluation }) => ({
      id,
      runtime,
      name,
      status,
      createdAt,
      updatedAt,
      conclusion,
      evaluation,
    }));
}

export async function readCliTaskRunLog(runtime: AgentRuntime, runId: string): Promise<RuntimeRunLog> {
  const run = await readStoredRun(runtime, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const logs = await readFile(run.logPath, "utf8").catch(() => "");
  return {
    id: run.id,
    summary: run.conclusion || run.name,
    logs,
    evaluation: run.evaluation,
  };
}

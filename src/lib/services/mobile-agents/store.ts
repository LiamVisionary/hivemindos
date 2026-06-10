import "server-only";

import { randomBytes } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
import { finishRuntimeChatSession } from "@/lib/services/chat/runtime-session-store";
import {
  mobileAgentMachineKey,
  type MobileAgentHostModel,
  type MobileAgentHostRecord,
  type MobileAgentJob,
  type MobileAgentJobMessage,
  type MobileAgentRecord,
} from "@/lib/types/mobile-agents";

// Phones have no collector, so the hub itself stores phone-hosted agents and
// queues chat turns as jobs in ~/.hivemindos; the HivemindOS Mobile app polls
// /api/phone (action "agent-host-poll") to claim and run them on-device.
const AGENTS_FILE = join(homedir(), ".hivemindos", "mobile-agents.json");
const JOBS_FILE = join(homedir(), ".hivemindos", "mobile-agent-jobs.json");
const FINISHED_JOB_RETENTION_MS = 60 * 60 * 1000;
const QUEUED_JOB_EXPIRY_MS = 10 * 60 * 1000;

type MobileAgentsFile = {
  agents: MobileAgentRecord[];
  hosts: Record<string, MobileAgentHostRecord>;
};

type MobileAgentJobsFile = { jobs: MobileAgentJob[] };

// In-process promise mutex: every read-modify-write runs sequentially so two
// concurrent route handlers cannot clobber each other's file writes.
let storeQueue: Promise<unknown> = Promise.resolve();

function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = storeQueue.catch(() => undefined).then(operation);
  storeQueue = run.catch(() => undefined);
  return run;
}

function emptyAgentsFile(): MobileAgentsFile {
  return { agents: [], hosts: {} };
}

function normalizeHostModels(value: unknown): MobileAgentHostModel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): MobileAgentHostModel | null => {
      const record = entry as { id?: unknown; sizeBytes?: unknown };
      const id = typeof record?.id === "string" ? record.id.trim() : "";
      const sizeBytes = Number(record?.sizeBytes);
      if (!id) return null;
      return {
        id,
        sizeBytes:
          Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : undefined,
      };
    })
    .filter((model): model is MobileAgentHostModel => Boolean(model));
}

function normalizeAgentsFile(value: unknown): MobileAgentsFile {
  if (!value || typeof value !== "object") return emptyAgentsFile();
  const record = value as Partial<MobileAgentsFile>;
  const agents = (Array.isArray(record.agents) ? record.agents : []).filter(
    (agent): agent is MobileAgentRecord =>
      Boolean(agent) &&
      typeof agent === "object" &&
      typeof agent.id === "string" &&
      typeof agent.machineKey === "string" &&
      typeof agent.name === "string" &&
      typeof agent.model === "string",
  );
  const hosts: Record<string, MobileAgentHostRecord> = {};
  for (const [key, host] of Object.entries(record.hosts ?? {})) {
    if (!key || !host || typeof host !== "object") continue;
    hosts[key] = {
      machineName:
        typeof host.machineName === "string" ? host.machineName : key,
      models: normalizeHostModels(host.models),
      lastPollAt: Number(host.lastPollAt) || 0,
    };
  }
  return { agents, hosts };
}

function normalizeJobsFile(value: unknown): MobileAgentJobsFile {
  if (!value || typeof value !== "object") return { jobs: [] };
  const record = value as Partial<MobileAgentJobsFile>;
  const jobs = (Array.isArray(record.jobs) ? record.jobs : []).filter(
    (job): job is MobileAgentJob =>
      Boolean(job) &&
      typeof job === "object" &&
      typeof job.id === "string" &&
      typeof job.agentId === "string" &&
      typeof job.machineKey === "string" &&
      typeof job.sessionId === "string",
  );
  return { jobs };
}

async function readJsonFile<T>(
  path: string,
  normalize: (value: unknown) => T,
  fallback: T,
): Promise<T> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return fallback;
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function readAgentsFile() {
  return readJsonFile(AGENTS_FILE, normalizeAgentsFile, emptyAgentsFile());
}

function readJobsFile() {
  return readJsonFile(JOBS_FILE, normalizeJobsFile, { jobs: [] });
}

function isFinishedJob(job: MobileAgentJob) {
  return job.status === "done" || job.status === "error";
}

/**
 * Drop finished jobs older than an hour and expire queued jobs no phone
 * claimed within ten minutes (finishing their chat sessions so the dashboard
 * stream and history both see the failure).
 */
async function pruneJobs(jobs: MobileAgentJob[], now: number) {
  const kept: MobileAgentJob[] = [];
  for (const job of jobs) {
    if (
      isFinishedJob(job) &&
      now - (job.finishedAt ?? job.updatedAt) > FINISHED_JOB_RETENTION_MS
    ) {
      continue;
    }
    if (job.status === "queued" && now - job.createdAt > QUEUED_JOB_EXPIRY_MS) {
      kept.push({
        ...job,
        status: "error",
        errorReason: "expired-unclaimed",
        updatedAt: now,
        finishedAt: now,
      });
      await finishRuntimeChatSession(job.sessionId, "error").catch(
        () => undefined,
      );
      continue;
    }
    kept.push(job);
  }
  return kept;
}

async function modifyJobs<T>(
  mutate: (
    jobs: MobileAgentJob[],
    now: number,
  ) => { jobs: MobileAgentJob[]; result: T },
): Promise<T> {
  return withStoreLock(async () => {
    const now = Date.now();
    const file = await readJobsFile();
    const { jobs, result } = mutate(file.jobs, now);
    await writeJsonAtomic(JOBS_FILE, { jobs: await pruneJobs(jobs, now) });
    return result;
  });
}

export async function listMobileAgents(): Promise<MobileAgentRecord[]> {
  return (await readAgentsFile()).agents;
}

export async function listMobileAgentHosts(): Promise<
  Record<string, MobileAgentHostRecord>
> {
  return (await readAgentsFile()).hosts;
}

export async function getMobileAgent(
  id: string,
): Promise<MobileAgentRecord | null> {
  const { agents } = await readAgentsFile();
  return agents.find((agent) => agent.id === id) ?? null;
}

export async function mobileAgentHostLastPollAt(machineKey: string) {
  const { hosts } = await readAgentsFile();
  return hosts[machineKey]?.lastPollAt ?? 0;
}

export async function createMobileAgent(input: {
  machineName: string;
  name: string;
  model: string;
  systemPrompt?: string;
}): Promise<MobileAgentRecord> {
  const machineName = input.machineName.trim();
  const machineKey = mobileAgentMachineKey(machineName);
  const name = input.name.trim();
  const model = input.model.trim();
  if (!machineKey) throw new Error("A valid phone machine name is required.");
  if (!name) throw new Error("An agent name is required.");
  if (!model) throw new Error("An on-device model id is required.");
  const systemPrompt = input.systemPrompt?.trim() || undefined;
  return withStoreLock(async () => {
    const file = await readAgentsFile();
    const now = Date.now();
    const record: MobileAgentRecord = {
      id: `mobile-agent-${randomBytes(6).toString("hex")}`,
      machineKey,
      machineName,
      name,
      model,
      provider: "on-device",
      systemPrompt,
      createdAt: now,
      updatedAt: now,
    };
    await writeJsonAtomic(AGENTS_FILE, {
      ...file,
      agents: [...file.agents, record],
    });
    return record;
  });
}

/** Removes the agent and any of its still-queued jobs. */
export async function deleteMobileAgent(id: string): Promise<boolean> {
  return withStoreLock(async () => {
    const file = await readAgentsFile();
    const remaining = file.agents.filter((agent) => agent.id !== id);
    const deleted = remaining.length !== file.agents.length;
    if (deleted) {
      await writeJsonAtomic(AGENTS_FILE, { ...file, agents: remaining });
    }
    const jobsFile = await readJobsFile();
    const now = Date.now();
    const jobs = jobsFile.jobs.filter(
      (job) => !(job.agentId === id && job.status === "queued"),
    );
    await writeJsonAtomic(JOBS_FILE, { jobs: await pruneJobs(jobs, now) });
    return deleted;
  });
}

export async function enqueueMobileAgentJob(input: {
  agentId: string;
  machineKey: string;
  sessionId: string;
  prompt: string;
  messages: MobileAgentJobMessage[];
}): Promise<MobileAgentJob> {
  return modifyJobs((jobs, now) => {
    const job: MobileAgentJob = {
      id: `maj-${randomBytes(6).toString("hex")}`,
      agentId: input.agentId,
      machineKey: input.machineKey,
      sessionId: input.sessionId,
      prompt: input.prompt,
      messages: input.messages,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    return { jobs: [...jobs, job], result: job };
  });
}

export async function getMobileAgentJob(
  jobId: string,
): Promise<MobileAgentJob | null> {
  const { jobs } = await readJobsFile();
  return jobs.find((job) => job.id === jobId) ?? null;
}

/** Bump updatedAt after the phone streamed events for the job. */
export async function touchMobileAgentJob(jobId: string) {
  return modifyJobs((jobs, now) => ({
    jobs: jobs.map((job) =>
      job.id === jobId ? { ...job, updatedAt: now } : job,
    ),
    result: undefined,
  }));
}

export async function completeMobileAgentJob(
  jobId: string,
  input: { ok: boolean; resultText?: string; errorReason?: string },
): Promise<MobileAgentJob | null> {
  return modifyJobs((jobs, now) => {
    let updated: MobileAgentJob | null = null;
    const next = jobs.map((job) => {
      if (job.id !== jobId || isFinishedJob(job)) return job;
      updated = {
        ...job,
        status: input.ok ? ("done" as const) : ("error" as const),
        updatedAt: now,
        finishedAt: now,
        resultText: input.resultText?.trim() || job.resultText,
        errorReason: input.ok
          ? undefined
          : input.errorReason?.trim() || "phone-run-failed",
      };
      return updated;
    });
    return { jobs: next, result: updated };
  });
}

/**
 * Heartbeat + work pickup for a phone host. Resolves the machine key from the
 * reported names (falling back to the store's single machine key for
 * single-phone fleets where the iOS device name differs from the tailnet
 * hostname), refreshes the host heartbeat, and returns the agents plus the
 * currently claimed jobs — atomically claiming up to one queued job when
 * `claim` is enabled. Returning already-claimed jobs lets a restarted phone
 * resume; the phone dedupes by job id.
 */
export async function pollMobileAgentHost(input: {
  machineName: string;
  names?: string[];
  models?: MobileAgentHostModel[];
  claim?: boolean;
}): Promise<{
  machineKey: string;
  agents: MobileAgentRecord[];
  jobs: MobileAgentJob[];
}> {
  return withStoreLock(async () => {
    const now = Date.now();
    const agentsFile = await readAgentsFile();
    const candidateKeys = [input.machineName, ...(input.names ?? [])]
      .map(mobileAgentMachineKey)
      .filter(Boolean)
      .filter((key, index, all) => all.indexOf(key) === index);
    const storedKeys = [
      ...new Set(agentsFile.agents.map((agent) => agent.machineKey)),
    ];
    const machineKey =
      candidateKeys.find((key) => storedKeys.includes(key)) ??
      (storedKeys.length === 1 ? storedKeys[0] : (candidateKeys[0] ?? ""));
    if (!machineKey) throw new Error("A phone machine name is required.");

    const hosts = { ...agentsFile.hosts };
    const heartbeat = (key: string) => {
      hosts[key] = {
        machineName: input.machineName.trim() || key,
        models: input.models?.length
          ? input.models
          : (hosts[key]?.models ?? []),
        lastPollAt: now,
      };
    };
    heartbeat(machineKey);
    // Also heartbeat under the literal device-name key when it differs, so the
    // fleet machine row (keyed by the tailnet name) can show host-online.
    const nameKey = mobileAgentMachineKey(input.machineName);
    if (nameKey && nameKey !== machineKey) heartbeat(nameKey);
    await writeJsonAtomic(AGENTS_FILE, { ...agentsFile, hosts });

    const jobsFile = await readJobsFile();
    const prunedJobs = await pruneJobs(jobsFile.jobs, now);
    const running = prunedJobs.filter(
      (job) => job.machineKey === machineKey && job.status === "claimed",
    );
    let claimed: MobileAgentJob | null = null;
    const nextJobs = prunedJobs.map((job) => {
      if (
        claimed ||
        input.claim === false ||
        job.machineKey !== machineKey ||
        job.status !== "queued"
      ) {
        return job;
      }
      claimed = { ...job, status: "claimed", claimedAt: now, updatedAt: now };
      return claimed;
    });
    await writeJsonAtomic(JOBS_FILE, { jobs: nextJobs });

    return {
      machineKey,
      agents: agentsFile.agents.filter(
        (agent) => agent.machineKey === machineKey,
      ),
      jobs: [...running, ...(claimed ? [claimed] : [])].sort(
        (left, right) => left.createdAt - right.createdAt,
      ),
    };
  });
}

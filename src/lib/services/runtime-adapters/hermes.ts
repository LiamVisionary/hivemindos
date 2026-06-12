import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { dirname, join, resolve } from "node:path";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { RuntimeAdapter, RuntimeSchedule, RuntimeScheduleAction } from "./types";

type ParsedSchedule = {
  id?: string;
  name: string;
  every: string;
  nextRunMs?: number;
  message: string;
  enabled: boolean;
};

function expandHome(path: string) {
  return path.replace(/^~(?=$|\/)/, homedir());
}

async function listHermesSchedules(profile: AgentProfile): Promise<RuntimeSchedule[]> {
  const home = resolve(expandHome(profile.localDataDir?.trim() || "~/.hermes"));
  const cronDir = join(home, "cron");
  const entries = await readdir(cronDir, { withFileTypes: true }).catch(() => []);
  const schedules: RuntimeSchedule[] = [];
  for (const entry of entries.filter((item) => item.isFile()).slice(0, 60)) {
    if (!/\.(md|txt|json|jsonl|yaml|yml)$/i.test(entry.name)) continue;
    const path = join(cronDir, entry.name);
    const raw = await readFile(path, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    const fileStat = await stat(path).catch(() => null);
    const parsedSchedules = parseScheduleContent(raw, entry.name);
    parsedSchedules.forEach((parsed, index) => schedules.push({
      id: parsedSchedules.length === 1
        ? `hermes:${profile.id}:${entry.name}`
        : `hermes:${profile.id}:${entry.name}:${parsed.id ?? index}`,
      runtime: "hermes",
      agentId: profile.id,
      name: parsed.name,
      every: parsed.every,
      schedule: parsed.every || undefined,
      message: parsed.message,
      enabled: parsed.enabled,
      nextRunMs: parsed.nextRunMs,
      source: `~/.hermes/cron/${entry.name}`,
      lastRunMs: fileStat?.mtimeMs,
      metadata: { path },
    }));
  }
  return schedules;
}

function parseScheduleContent(raw: string, filename: string): ParsedSchedule[] {
  let parsed: Record<string, unknown> = {};
  if (/\.json$/i.test(filename)) {
    parsed = parseJsonObject(raw) ?? {};
  }
  const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.filter(isRecord) : [];
  if (jobs.length) {
    return jobs.map((job, index) => {
      const message = stringFrom(job.prompt) || stringFrom(job.message) || stringFrom(job.task) || "";
      return {
        id: stringFrom(job.id) || String(index),
        name: stringFrom(job.name) || stringFrom(job.title) || filename.replace(/\.[^.]+$/, ""),
        every: scheduleText(job),
        nextRunMs: dateMsFrom(job.next_run_at) ?? dateMsFrom(job.nextRunAt),
        message: message || raw.slice(0, 1200),
        enabled: job.enabled !== false,
      };
    });
  }
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.replace(/^#+\s*/, "").trim();
  const enabled = parsed.enabled !== false && !/^paused:/im.test(raw);
  return [{
    name: stringFrom(parsed.name) || stringFrom(parsed.title) || firstLine || filename.replace(/\.[^.]+$/, ""),
    every: scheduleText(parsed),
    nextRunMs: dateMsFrom(parsed.next_run_at) ?? dateMsFrom(parsed.nextRunAt),
    message: stringFrom(parsed.message) || stringFrom(parsed.prompt) || stringFrom(parsed.task) || raw.slice(0, 1200),
    enabled,
  }];
}

function scheduleText(record: Record<string, unknown>) {
  const direct = stringFrom(record.every) || stringFrom(record.interval) || stringFrom(record.schedule_display);
  if (direct) return direct;
  const schedule = record.schedule;
  if (typeof schedule === "string") return schedule;
  if (isRecord(schedule)) {
    return stringFrom(schedule.display)
      || stringFrom(schedule.value)
      || stringFrom(schedule.expr)
      || stringFrom(schedule.run_at);
  }
  return "";
}

function dateMsFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    // Some exported cron files have a stray leading "{" before the real JSON object.
  }

  const trimmed = raw.trim();
  if (trimmed.startsWith("{\n{") || trimmed.startsWith("{{")) {
    return parseFirstJsonObject(trimmed.slice(1));
  }
  return null;
}

function parseFirstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      try {
        const parsed = JSON.parse(raw.slice(start, index + 1)) as unknown;
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function runHermesScheduleAction(_profile: AgentProfile | undefined, action: RuntimeScheduleAction, jobId: string) {
  if (action === "run-now") {
    const fileName = jobId.split(":")[2] || "";
    const home = resolve(expandHome(_profile?.localDataDir?.trim() || "~/.hermes"));
    const raw = fileName ? await readFile(join(home, "cron", fileName), "utf8").catch(() => "") : "";
    const prompt = parseScheduleContent(raw || fileName, fileName || "schedule.txt")[0]?.message.trim() ?? "";
    if (!prompt) return { ok: false, error: "Hermes schedule prompt is empty." };
    const id = `hermes-schedule-${Date.now().toString(36)}`;
    const logPath = join(homedir(), ".hivemindos", "runtime-runs", `${id}.log`);
    await mkdir(dirname(logPath), { recursive: true });
    const child = spawn("hermes", ["-z", prompt], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    const append = (chunk: Buffer) => void writeFile(logPath, chunk.toString(), { flag: "a" }).catch(() => undefined);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.unref();
    return { ok: true, result: { id, logPath }, error: undefined };
  }
  if (action === "enable" || action === "disable") {
    return { ok: false, error: "Hermes file-backed schedule enable/disable is not safely editable yet. Import it, then pause the HivemindOS copy." };
  }
  return { ok: false, error: `Unsupported Hermes schedule action: ${action}` };
}

export const hermesAdapter: RuntimeAdapter = {
  runtime: "hermes",
  label: "Hermes",
  kind: "interactive",
  capabilities: {
    status: true,
    chat: true,
    runs: true,
    memory: true,
    sessionSearch: true,
    backgroundTasks: true,
    xSearch: true,
    imageGeneration: true,
    videoGeneration: true,
    codexRuntime: true,
    kanbanDecompose: true,
    setup: true,
    walletTools: true,
    modelSelection: true,
  },
  defaultProfile: {
    gatewayUrl: process.env.NEXT_PUBLIC_HERMES_BASE_URL ?? "http://127.0.0.1:8642",
    chatPath: "/chat",
    statusPath: "/health",
    localDataDir: "~/.hermes",
  },
  listSchedules: listHermesSchedules,
  runScheduleAction: runHermesScheduleAction,
};

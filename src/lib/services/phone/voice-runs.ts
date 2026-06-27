import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";

export type VoiceRunMode = "byok" | "cloud" | "local-tts" | "queen" | "unknown";
export type VoiceRunStatus = "created" | "ringing" | "connected" | "active" | "ended" | "failed";
export type VoiceRunEventType =
  | "call.created"
  | "call.connected"
  | "call.ended"
  | "user.transcript"
  | "agent.caption"
  | "tool.call.started"
  | "tool.call.completed"
  | "runtime.turn.started"
  | "runtime.turn.completed"
  | "runtime.turn.failed"
  | "qa.completed"
  | "extraction.completed"
  | "note";

export type VoiceRunParticipant = {
  id?: string;
  name?: string;
  runtime?: string;
  role?: string;
  task?: string;
};

export type VoiceRunProvider = {
  id?: string;
  label?: string;
  model?: string;
  voice?: string;
  transport?: string;
};

export type VoiceRunEvent = {
  id: string;
  type: VoiceRunEventType;
  ts: string;
  speaker?: "user" | "agent" | "system" | "tool";
  text?: string;
  detail?: string;
  payload?: Record<string, unknown>;
};

export type VoiceRunQaCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type VoiceRunQaResult = {
  score: number;
  status: "pass" | "warn" | "fail";
  completedAt: string;
  checks: VoiceRunQaCheck[];
};

export type VoiceRun = {
  version: 1;
  id: string;
  title: string;
  mode: VoiceRunMode;
  status: VoiceRunStatus;
  recipeId: string;
  toolBundleId: string;
  createdAt: string;
  updatedAt: string;
  endedAt?: string;
  agent?: VoiceRunParticipant;
  machine?: { id?: string; name?: string };
  provider?: VoiceRunProvider;
  initialContext: Record<string, unknown>;
  gatheredContext: Record<string, unknown>;
  summary?: string;
  qa?: VoiceRunQaResult;
  events: VoiceRunEvent[];
};

const VOICE_RUN_ROOT = join(homedir(), ".hivemindos", "voice-runs");
const MAX_CONTEXT_CHARS = 8_000;
const MAX_TEXT_CHARS = 2_000;
let writeQueue: Promise<unknown> = Promise.resolve();

function nowIso() {
  return new Date().toISOString();
}

function voiceRunPath(id: string) {
  return join(VOICE_RUN_ROOT, `${id.replace(/[^A-Za-z0-9._-]+/g, "-")}.json`);
}

export function createVoiceRunId(prefix = "voice") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clean(value: unknown, maxChars = 300) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

function sanitizeText(raw: unknown, maxChars = MAX_TEXT_CHARS) {
  return String(raw || "")
    .split(/\r?\n/)
    .filter((line) => !/(api[_-]?key|token|secret|password|authorization|bearer|private key)/i.test(line))
    .join("\n")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<redacted-ip>")
    .trim()
    .slice(0, maxChars);
}

function sanitizeJson(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return sanitizeText(value, depth === 0 ? MAX_CONTEXT_CHARS : 1000);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeJson(item, depth + 1));
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim()) continue;
    if (/(api[_-]?key|token|secret|password|authorization|bearer|privateKey|private_key|rawTailnetIp|tailnetIp|ip)$/i.test(key)) continue;
    const sanitized = sanitizeJson(item, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

function normalizeRun(value: unknown): VoiceRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<VoiceRun>;
  if (typeof record.id !== "string" || !record.id.trim()) return null;
  return {
    version: 1,
    id: record.id,
    title: clean(record.title, 200) || "Voice run",
    mode: record.mode || "unknown",
    status: record.status || "created",
    recipeId: clean(record.recipeId, 100) || "agent-runtime-bridge",
    toolBundleId: clean(record.toolBundleId, 100) || "agent-call-default",
    createdAt: clean(record.createdAt, 80) || nowIso(),
    updatedAt: clean(record.updatedAt, 80) || nowIso(),
    endedAt: clean(record.endedAt, 80),
    agent: record.agent,
    machine: record.machine,
    provider: record.provider,
    initialContext: record.initialContext && typeof record.initialContext === "object" ? record.initialContext : {},
    gatheredContext: record.gatheredContext && typeof record.gatheredContext === "object" ? record.gatheredContext : {},
    summary: clean(record.summary, 1000),
    qa: record.qa,
    events: Array.isArray(record.events) ? record.events.filter((event): event is VoiceRunEvent => Boolean(event && typeof event.id === "string" && typeof event.type === "string")) : [],
  };
}

async function readRunFile(id: string): Promise<VoiceRun | null> {
  const raw = await readFile(voiceRunPath(id), "utf8").catch(() => "");
  if (!raw.trim()) return null;
  try {
    return normalizeRun(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

async function writeRunFile(run: VoiceRun) {
  await mkdir(VOICE_RUN_ROOT, { recursive: true, mode: 0o700 });
  const path = voiceRunPath(run.id);
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(run, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}

async function mutateRun(id: string, mutate: (run: VoiceRun) => VoiceRun | Promise<VoiceRun>) {
  const write = async () => {
    const current = await readRunFile(id);
    if (!current) throw new Error(`Voice run not found: ${id}`);
    const next = await mutate(current);
    next.updatedAt = nowIso();
    await writeRunFile(next);
    return next;
  };
  writeQueue = writeQueue.catch(() => undefined).then(write);
  return writeQueue as Promise<VoiceRun>;
}

export async function createVoiceRun(input: {
  id?: string;
  title: string;
  mode: VoiceRunMode;
  recipeId?: string;
  toolBundleId?: string;
  agent?: VoiceRunParticipant;
  machine?: { id?: string; name?: string };
  provider?: VoiceRunProvider;
  initialContext?: Record<string, unknown>;
}) {
  const createdAt = nowIso();
  const id = input.id || createVoiceRunId(input.mode === "unknown" ? "voice" : input.mode);
  const run: VoiceRun = {
    version: 1,
    id,
    title: clean(input.title, 200) || "Voice run",
    mode: input.mode,
    status: "created",
    recipeId: input.recipeId || "agent-runtime-bridge",
    toolBundleId: input.toolBundleId || "agent-call-default",
    createdAt,
    updatedAt: createdAt,
    agent: sanitizeVoiceParticipant(input.agent),
    machine: input.machine ? { id: clean(input.machine.id, 120), name: clean(input.machine.name, 200) } : undefined,
    provider: sanitizeJson(input.provider) as VoiceRunProvider | undefined,
    initialContext: (sanitizeJson(input.initialContext || {}) as Record<string, unknown>) || {},
    gatheredContext: {},
    events: [{
      id: createVoiceRunId("event"),
      type: "call.created",
      ts: createdAt,
      speaker: "system",
      text: "Voice run created.",
      payload: {
        mode: input.mode,
        recipeId: input.recipeId || "agent-runtime-bridge",
        toolBundleId: input.toolBundleId || "agent-call-default",
      },
    }],
  };
  await writeRunFile(run);
  return run;
}

function sanitizeVoiceParticipant(agent?: VoiceRunParticipant): VoiceRunParticipant | undefined {
  if (!agent) return undefined;
  return {
    id: clean(agent.id, 160),
    name: clean(agent.name, 200),
    runtime: clean(agent.runtime, 100),
    role: clean(agent.role, 120),
    task: clean(agent.task, 600),
  };
}

export async function appendVoiceRunEvent(id: string | undefined, input: Omit<VoiceRunEvent, "id" | "ts"> & { ts?: string }) {
  if (!id) return null;
  return mutateRun(id, (run) => {
    const event: VoiceRunEvent = {
      id: createVoiceRunId("event"),
      type: input.type,
      ts: input.ts || nowIso(),
      speaker: input.speaker,
      text: input.text ? sanitizeText(input.text) : undefined,
      detail: input.detail ? sanitizeText(input.detail, 4_000) : undefined,
      payload: input.payload ? sanitizeJson(input.payload) as Record<string, unknown> : undefined,
    };
    const status = statusFromEvent(run.status, event.type);
    return {
      ...run,
      status,
      events: [...run.events, event].slice(-500),
    };
  });
}

function statusFromEvent(current: VoiceRunStatus, type: VoiceRunEventType): VoiceRunStatus {
  if (type === "call.ended") return current === "failed" ? "failed" : "ended";
  if (type === "runtime.turn.failed") return "active";
  if (type === "call.connected") return "connected";
  if (type === "user.transcript" || type === "agent.caption" || type.startsWith("tool.") || type.startsWith("runtime.")) return "active";
  return current;
}

export async function completeVoiceRun(id: string | undefined, status: "ended" | "failed" = "ended", reason = "") {
  if (!id) return null;
  const run = await mutateRun(id, (current) => {
    const endedAt = nowIso();
    const next: VoiceRun = {
      ...current,
      status,
      endedAt,
      events: [...current.events, {
        id: createVoiceRunId("event"),
        type: "call.ended",
        ts: endedAt,
        speaker: "system",
        text: reason || (status === "failed" ? "Voice run failed." : "Voice run ended."),
      }],
    };
    const gatheredContext = extractGatheredContext(next);
    const qa = evaluateVoiceRun({ ...next, gatheredContext });
    const summary = summarizeVoiceRun({ ...next, gatheredContext, qa });
    const extractionEvent: VoiceRunEvent = {
      id: createVoiceRunId("event"),
      type: "extraction.completed",
      ts: endedAt,
      speaker: "system",
      text: "Post-call context extraction completed.",
      payload: gatheredContext,
    };
    const qaEvent: VoiceRunEvent = {
      id: createVoiceRunId("event"),
      type: "qa.completed",
      ts: endedAt,
      speaker: "system",
      text: `Voice QA ${qa.status} (${qa.score}/100).`,
      payload: { score: qa.score, status: qa.status },
    };
    return {
      ...next,
      gatheredContext,
      qa,
      summary,
      events: [...next.events, extractionEvent, qaEvent].slice(-500),
    };
  });
  return run;
}

export async function runVoiceRunQa(id: string) {
  return mutateRun(id, (run) => {
    const gatheredContext = Object.keys(run.gatheredContext).length ? run.gatheredContext : extractGatheredContext(run);
    const qa = evaluateVoiceRun({ ...run, gatheredContext });
    const qaEvent: VoiceRunEvent = {
      id: createVoiceRunId("event"),
      type: "qa.completed",
      ts: nowIso(),
      speaker: "system",
      text: `Voice QA ${qa.status} (${qa.score}/100).`,
      payload: { score: qa.score, status: qa.status },
    };
    return {
      ...run,
      gatheredContext,
      qa,
      summary: summarizeVoiceRun({ ...run, gatheredContext, qa }),
      events: [...run.events, qaEvent].slice(-500),
    };
  });
}

function extractGatheredContext(run: VoiceRun): Record<string, unknown> {
  const userTurns = run.events.filter((event) => event.type === "user.transcript" && event.text);
  const agentTurns = run.events.filter((event) => event.type === "agent.caption" && event.text);
  const toolStarts = run.events.filter((event) => event.type === "tool.call.started");
  const toolFailures = run.events.filter((event) => event.type === "runtime.turn.failed" || /fail|error/i.test(`${event.text || ""} ${event.detail || ""}`));
  const latestRequest = [...userTurns].reverse().find((event) => event.text)?.text || "";
  const memoryCandidate = userTurns.find((event) => /\bremember\b/i.test(event.text || ""))?.text || "";
  return {
    latest_request: latestRequest,
    user_turn_count: userTurns.length,
    agent_turn_count: agentTurns.length,
    tool_call_count: toolStarts.length,
    failed_tool: toolFailures[0]?.text || toolFailures[0]?.detail || "",
    follow_up_needed: Boolean(/\b(remind|follow up|later|next|todo|task|fix|build|ship)\b/i.test(latestRequest)),
    memory_candidate: memoryCandidate,
  };
}

function evaluateVoiceRun(run: VoiceRun): VoiceRunQaResult {
  const hasUserInput = run.events.some((event) => event.type === "user.transcript" && event.text && !/^(listening|finalizing transcript)/i.test(event.text));
  const hasAgentOutput = run.events.some((event) => event.type === "agent.caption" && event.text);
  const hasRuntimeFailure = run.events.some((event) => event.type === "runtime.turn.failed");
  const hasToolTrace = run.events.some((event) => event.type === "tool.call.started") === run.events.some((event) => event.type === "tool.call.completed");
  const hasExtraction = Object.keys(run.gatheredContext).length > 0;
  const checks: VoiceRunQaCheck[] = [
    { id: "has_user_or_opening", label: "User/input captured", passed: hasUserInput || hasAgentOutput, detail: hasUserInput ? "User speech was transcribed." : hasAgentOutput ? "Agent produced an opening/status turn." : "No transcript or agent caption was captured." },
    { id: "has_agent_output", label: "Agent output captured", passed: hasAgentOutput, detail: hasAgentOutput ? "At least one agent caption was captured." : "No spoken agent output was captured." },
    { id: "runtime_failures_visible", label: "Runtime failures visible", passed: !hasRuntimeFailure, detail: hasRuntimeFailure ? "One or more runtime failures are present in the timeline." : "No runtime turn failures recorded." },
    { id: "tool_trace_balanced", label: "Tool calls are traceable", passed: hasToolTrace, detail: hasToolTrace ? "Tool starts and completions are balanced." : "A tool call appears to be missing a completion event." },
    { id: "context_extracted", label: "Context extracted", passed: hasExtraction, detail: hasExtraction ? "Gathered context is present." : "No gathered context has been extracted yet." },
  ];
  const passed = checks.filter((check) => check.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  return {
    score,
    status: score >= 80 ? "pass" : score >= 50 ? "warn" : "fail",
    completedAt: nowIso(),
    checks,
  };
}

function summarizeVoiceRun(run: VoiceRun) {
  const context = run.gatheredContext;
  const request = typeof context.latest_request === "string" && context.latest_request ? `Latest request: ${context.latest_request}` : "";
  const failures = typeof context.failed_tool === "string" && context.failed_tool ? `Issue: ${context.failed_tool}` : "";
  const qa = run.qa ? `QA: ${run.qa.status} (${run.qa.score}/100).` : "";
  return [request, failures, qa].filter(Boolean).join(" ");
}

export async function getVoiceRun(id: string) {
  return readRunFile(id);
}

export async function listVoiceRuns(options: { limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 200);
  const entries = await readdir(VOICE_RUN_ROOT, { withFileTypes: true }).catch(() => []);
  const runs = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readRunFile(entry.name.replace(/\.json$/i, ""))));
  return runs
    .filter((run): run is VoiceRun => Boolean(run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map((run) => ({
      id: run.id,
      title: run.title,
      mode: run.mode,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      endedAt: run.endedAt,
      agent: run.agent,
      machine: run.machine,
      provider: run.provider,
      recipeId: run.recipeId,
      toolBundleId: run.toolBundleId,
      summary: run.summary,
      qa: run.qa,
      eventCount: run.events.length,
    }));
}

export function voiceRunTimeline(run: VoiceRun) {
  return run.events.map((event) => ({
    id: event.id,
    type: event.type,
    ts: event.ts,
    speaker: event.speaker || "system",
    label: event.text || event.type,
    detail: event.detail,
    payload: event.payload,
  }));
}

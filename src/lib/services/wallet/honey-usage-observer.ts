import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { hostname } from "os";
import { homedir } from "@/lib/home-dir";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { recordObservedHoneyUsage } from "@/lib/services/wallet/honey-ledger";

const execFileAsync = promisify(execFile);
const HERMES_DB_PATH = join(homedir(), ".hermes", "state.db");
const OPENCLAW_AGENTS_DIR = join(homedir(), ".openclaw", "agents");
const STATE_PATH = join(homedir(), ".hivemindos", "honey-usage-observer.json");

type ObserverState = {
  initialized: boolean;
  sessions: Record<string, number>;
};

type HermesUsageRow = {
  id: string;
  source: string;
  model: string | null;
  started_at: number;
  updated_at: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
};

type OpenClawUsageRow = {
  agentId: string;
  sessionId: string;
  model: string;
  updatedAt: string;
  totalTokens: number;
};

export type HoneyUsageObserverResult = {
  ok: boolean;
  initialized: boolean;
  observed: number;
  credited: number;
  events: Array<{
    id: string;
    runtime: "hermes" | "openclaw";
    sessionId: string;
    tokensUsed: number;
    honeyDelta: number;
  }>;
  errors: string[];
};

export async function observeHoneyUsage(): Promise<HoneyUsageObserverResult> {
  const state = await readObserverState();
  const hermesRows = await readHermesUsageRows().catch(() => []);
  const openClawRows = await readOpenClawUsageRows().catch(() => []);
  const events: HoneyUsageObserverResult["events"] = [];
  const errors: string[] = [];
  let observed = 0;

  for (const row of hermesRows) {
    const sessionKey = `hermes:${row.id}`;
    const totalTokens = totalHermesTokens(row);
    if (totalTokens <= 0) continue;
    observed += 1;

    const previousTokens = Math.max(0, Math.round(state.sessions[sessionKey] ?? 0));
    const deltaTokens = Math.max(0, totalTokens - previousTokens);
    state.sessions[sessionKey] = Math.max(previousTokens, totalTokens);

    if (!state.initialized || deltaTokens <= 0) continue;

    const eventId = observedEventId("hermes", row.id, totalTokens);
    const result = await recordObservedHoneyUsage({
      eventId,
      agentId: "local-hermes",
      agentName: "Hermes",
      source: "observed-hermes-usage",
      model: row.model?.trim() || "hermes",
      tokensUsed: deltaTokens,
      timestamp: new Date((row.updated_at || row.started_at || Date.now() / 1000) * 1000).toISOString(),
    }).catch((error) => {
      errors.push(error instanceof Error ? error.message : "Failed to credit Hermes usage.");
      return null;
    });

    if (result?.event) {
      events.push({
        id: eventId,
        runtime: "hermes",
        sessionId: row.id,
        tokensUsed: result.event.tokensUsed,
        honeyDelta: result.event.honeyDelta,
      });
    }
  }

  for (const row of openClawRows) {
    const sessionKey = `openclaw:${row.agentId}:${row.sessionId}`;
    if (row.totalTokens <= 0) continue;
    observed += 1;

    const previousTokens = Math.max(0, Math.round(state.sessions[sessionKey] ?? 0));
    const deltaTokens = Math.max(0, row.totalTokens - previousTokens);
    state.sessions[sessionKey] = Math.max(previousTokens, row.totalTokens);

    if (!state.initialized || deltaTokens <= 0) continue;

    const eventId = observedEventId("openclaw", `${row.agentId}:${row.sessionId}`, row.totalTokens);
    const result = await recordObservedHoneyUsage({
      eventId,
      agentId: `openclaw-${cleanAgentId(row.agentId)}`,
      agentName: `OpenClaw ${row.agentId}`,
      source: "observed-openclaw-usage",
      model: row.model || "openclaw",
      tokensUsed: deltaTokens,
      timestamp: row.updatedAt,
    }).catch((error) => {
      errors.push(error instanceof Error ? error.message : "Failed to credit OpenClaw usage.");
      return null;
    });

    if (result?.event) {
      events.push({
        id: eventId,
        runtime: "openclaw",
        sessionId: row.sessionId,
        tokensUsed: result.event.tokensUsed,
        honeyDelta: result.event.honeyDelta,
      });
    }
  }

  state.initialized = true;
  trimObserverState(state);
  await writeObserverState(state);

  return {
    ok: errors.length === 0,
    initialized: true,
    observed,
    credited: events.length,
    events,
    errors,
  };
}

async function readOpenClawUsageRows() {
  const agentDirs = await readdir(OPENCLAW_AGENTS_DIR, { withFileTypes: true }).catch(() => []);
  const rows: OpenClawUsageRow[] = [];
  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const sessionsDir = resolve(OPENCLAW_AGENTS_DIR, agentId, "sessions");
    if (!sessionsDir.startsWith(resolve(OPENCLAW_AGENTS_DIR))) continue;

    const sessionStoreRows = await readOpenClawSessionStore(agentId, join(sessionsDir, "sessions.json"));
    rows.push(...sessionStoreRows);

    const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
      const fullPath = join(sessionsDir, file.name);
      const fileStats = await stat(fullPath).catch(() => null);
      if (!fileStats || fileStats.size > 5_000_000) continue;
      const transcript = await readOpenClawTranscript(agentId, fullPath);
      if (transcript) rows.push(transcript);
    }
  }
  return dedupeOpenClawRows(rows).slice(0, 100);
}

async function readOpenClawSessionStore(agentId: string, filePath: string) {
  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats || fileStats.size > 5_000_000) return [];
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { sessions?: unknown[] })?.sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : Array.isArray((parsed as { rows?: unknown[] })?.rows)
        ? (parsed as { rows: unknown[] }).rows
        : [];
  return records
    .map((record, index) => openClawRowFromValue(agentId, record, `store-${index}`, new Date(fileStats.mtimeMs).toISOString()))
    .filter((row): row is OpenClawUsageRow => Boolean(row));
}

async function readOpenClawTranscript(agentId: string, filePath: string) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);
  let totalTokens = 0;
  let model = "openclaw";
  let updatedAt = new Date().toISOString();
  for (const line of lines.slice(-500)) {
    const value = parseJsonLine(line);
    if (!value) continue;
    totalTokens = Math.max(totalTokens, usageTokens(value));
    const foundModel = findString(value, ["model", "modelId", "modelRef"]);
    if (foundModel) model = foundModel;
    const foundTime = findString(value, ["timestamp", "createdAt", "updatedAt", "time"]);
    if (foundTime && !Number.isNaN(Date.parse(foundTime))) updatedAt = new Date(foundTime).toISOString();
  }
  if (totalTokens <= 0) return null;
  return {
    agentId,
    sessionId: filePath.split("/").pop()?.replace(/\.jsonl$/, "") || filePath,
    model,
    updatedAt,
    totalTokens,
  };
}

function parseJsonLine(line: string): unknown | null {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function openClawRowFromValue(agentId: string, value: unknown, fallbackId: string, fallbackUpdatedAt: string): OpenClawUsageRow | null {
  const totalTokens = usageTokens(value);
  if (totalTokens <= 0) return null;
  const sessionId = findString(value, ["sessionKey", "sessionId", "id", "key"]) || fallbackId;
  const model = findString(value, ["model", "modelId", "modelRef"]) || "openclaw";
  const time = findString(value, ["updatedAt", "lastActivityAt", "createdAt", "timestamp"]) || fallbackUpdatedAt;
  return {
    agentId,
    sessionId,
    model,
    updatedAt: Number.isNaN(Date.parse(time)) ? fallbackUpdatedAt : new Date(time).toISOString(),
    totalTokens,
  };
}

function dedupeOpenClawRows(rows: OpenClawUsageRow[]) {
  const byKey = new Map<string, OpenClawUsageRow>();
  for (const row of rows) {
    const key = `${row.agentId}:${row.sessionId}`;
    const existing = byKey.get(key);
    if (!existing || row.totalTokens > existing.totalTokens) byKey.set(key, row);
  }
  return [...byKey.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

async function readHermesUsageRows() {
  const sql = `
    select
      id,
      source,
      model,
      started_at,
      coalesce(ended_at, started_at) as updated_at,
      coalesce(input_tokens, 0) as input_tokens,
      coalesce(output_tokens, 0) as output_tokens,
      coalesce(cache_read_tokens, 0) as cache_read_tokens,
      coalesce(cache_write_tokens, 0) as cache_write_tokens,
      coalesce(reasoning_tokens, 0) as reasoning_tokens
    from sessions
    where (coalesce(input_tokens, 0)
      + coalesce(output_tokens, 0)
      + coalesce(cache_read_tokens, 0)
      + coalesce(cache_write_tokens, 0)
      + coalesce(reasoning_tokens, 0)) > 0
    order by started_at desc
    limit 50;
  `;
  const { stdout } = await execFileAsync("sqlite3", ["-json", HERMES_DB_PATH, sql], { timeout: 5_000 });
  const parsed = JSON.parse(stdout || "[]") as HermesUsageRow[];
  return Array.isArray(parsed) ? parsed : [];
}

function totalHermesTokens(row: HermesUsageRow) {
  return [
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens,
    row.cache_write_tokens,
    row.reasoning_tokens,
  ].reduce((total, value) => total + Math.max(0, Math.round(Number(value) || 0)), 0);
}

function usageTokens(value: unknown): number {
  const usageValues = collectUsageObjects(value);
  let best = 0;
  for (const usage of usageValues) {
    const directTotal = firstNumber(usage, ["total", "totalTokens", "total_tokens", "tokens", "tokenCount", "token_count"]);
    const input = firstNumber(usage, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
    const output = firstNumber(usage, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
    const cacheRead = firstNumber(usage, ["cacheRead", "cache_read", "cacheReadTokens", "cache_read_tokens", "cached"]);
    const cacheWrite = firstNumber(usage, ["cacheWrite", "cache_write", "cacheWriteTokens", "cache_write_tokens"]);
    const reasoning = firstNumber(usage, ["reasoning", "reasoningTokens", "reasoning_tokens"]);
    const summed = input + output + cacheRead + cacheWrite + reasoning;
    best = Math.max(best, directTotal, summed);
  }
  return Math.max(0, Math.round(best));
}

function collectUsageObjects(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const record = value as Record<string, unknown>;
  const matches: Array<Record<string, unknown>> = [];
  if (looksLikeUsage(record)) matches.push(record);
  for (const [key, child] of Object.entries(record)) {
    if (/usage|stats|cost/i.test(key) && child && typeof child === "object" && !Array.isArray(child)) {
      const usage = child as Record<string, unknown>;
      if (looksLikeUsage(usage)) matches.push(usage);
    }
    if (child && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child.slice(-20)) matches.push(...collectUsageObjects(item, depth + 1));
      } else {
        matches.push(...collectUsageObjects(child, depth + 1));
      }
    }
  }
  return matches;
}

function looksLikeUsage(record: Record<string, unknown>) {
  return [
    "total",
    "totalTokens",
    "total_tokens",
    "input",
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "output",
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
    "cacheRead",
    "cacheReadTokens",
    "cache_read_tokens",
    "cached",
    "reasoningTokens",
    "reasoning_tokens",
  ].some((key) => Number.isFinite(Number(record[key])));
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const numeric = Number(record[key]);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function findString(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  for (const child of Object.values(record)) {
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const item of child.slice(-10)) {
        const found = findString(item, keys, depth + 1);
        if (found) return found;
      }
    } else {
      const found = findString(child, keys, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function cleanAgentId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "default";
}

async function readObserverState(): Promise<ObserverState> {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8")) as Partial<ObserverState>;
    return {
      initialized: parsed.initialized === true,
      sessions: parsed.sessions && typeof parsed.sessions === "object" && !Array.isArray(parsed.sessions)
        ? Object.fromEntries(Object.entries(parsed.sessions).map(([key, value]) => [key, Math.max(0, Math.round(Number(value) || 0))]))
        : {},
    };
  } catch {
    return { initialized: false, sessions: {} };
  }
}

async function writeObserverState(state: ObserverState) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  const content = `${JSON.stringify(state, null, 2)}\n`;
  const current = await readFile(STATE_PATH, "utf8").catch(() => null);
  if (current === content) return;
  await writeFile(STATE_PATH, content, "utf8");
}

function trimObserverState(state: ObserverState) {
  const entries = Object.entries(state.sessions).slice(-500);
  state.sessions = Object.fromEntries(entries);
}

function observedEventId(runtime: string, sessionId: string, totalTokens: number) {
  const digest = createHash("sha256")
    .update([runtime, hostname(), sessionId, totalTokens].join("."))
    .digest("hex")
    .slice(0, 32);
  return `observed-${runtime}-${digest}`;
}

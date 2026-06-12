import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "@/lib/home-dir";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERMES_DB_PATH = join(homedir(), ".hermes", "state.db");
const OPENCLAW_AGENTS_DIR = join(homedir(), ".openclaw", "agents");

export type RuntimeUsageRow = {
  runtime: "hermes" | "openclaw";
  agentId: string;
  sessionId: string;
  source: string;
  model: string;
  updatedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type RuntimeUsageAnalytics = {
  ok: boolean;
  rows: RuntimeUsageRow[];
  totals: {
    sessions: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    reasoningTokens: number;
    estimatedCostUsd: number;
  };
  models: Array<{ model: string; sessions: number; tokens: number; estimatedCostUsd: number }>;
  runtimes: Array<{ runtime: string; sessions: number; tokens: number }>;
  sources: Array<{ source: string; sessions: number; tokens: number }>;
};

export async function readRuntimeUsageAnalytics(limit = 200): Promise<RuntimeUsageAnalytics> {
  const [hermesRows, openClawRows] = await Promise.all([
    readHermesUsageRows(limit).catch(() => []),
    readOpenClawUsageRows(limit).catch(() => []),
  ]);
  const rows = [...hermesRows, ...openClawRows]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, Math.max(1, Math.min(500, limit)));
  return {
    ok: true,
    rows,
    totals: {
      sessions: rows.length,
      tokens: sum(rows, "totalTokens"),
      inputTokens: sum(rows, "inputTokens"),
      outputTokens: sum(rows, "outputTokens"),
      cacheTokens: sum(rows, "cacheTokens"),
      reasoningTokens: sum(rows, "reasoningTokens"),
      estimatedCostUsd: estimateRowsCost(rows),
    },
    models: groupUsage(rows, "model").map((item) => ({ ...item, estimatedCostUsd: estimateRowsCost(rows.filter((row) => row.model === item.model)) })),
    runtimes: groupUsage(rows, "runtime"),
    sources: groupUsage(rows, "source"),
  };
}

async function readHermesUsageRows(limit: number): Promise<RuntimeUsageRow[]> {
  const sql = `
    select id, source, model, started_at, coalesce(ended_at, started_at) as updated_at,
      coalesce(input_tokens, 0) as input_tokens,
      coalesce(output_tokens, 0) as output_tokens,
      coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) as cache_tokens,
      coalesce(reasoning_tokens, 0) as reasoning_tokens
    from sessions
    where (coalesce(input_tokens, 0) + coalesce(output_tokens, 0) + coalesce(cache_read_tokens, 0) + coalesce(cache_write_tokens, 0) + coalesce(reasoning_tokens, 0)) > 0
    order by started_at desc
    limit ${Math.max(1, Math.min(500, limit))};
  `;
  const { stdout } = await execFileAsync("sqlite3", ["-json", HERMES_DB_PATH, sql], { timeout: 5_000, maxBuffer: 2_000_000 });
  const rows = JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const inputTokens = positive(row.input_tokens);
    const outputTokens = positive(row.output_tokens);
    const cacheTokens = positive(row.cache_tokens);
    const reasoningTokens = positive(row.reasoning_tokens);
    return {
      runtime: "hermes" as const,
      agentId: "local-hermes",
      sessionId: String(row.id ?? ""),
      source: String(row.source || "cli"),
      model: String(row.model || "hermes"),
      updatedAt: toIsoSeconds(row.updated_at),
      inputTokens,
      outputTokens,
      cacheTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens + cacheTokens + reasoningTokens,
    };
  }).filter((row) => row.sessionId && row.totalTokens > 0);
}

async function readOpenClawUsageRows(limit: number): Promise<RuntimeUsageRow[]> {
  const agentDirs = await readdir(OPENCLAW_AGENTS_DIR, { withFileTypes: true }).catch(() => []);
  const rows: RuntimeUsageRow[] = [];
  for (const entry of agentDirs) {
    if (!entry.isDirectory()) continue;
    const sessionsDir = resolve(OPENCLAW_AGENTS_DIR, entry.name, "sessions");
    if (!sessionsDir.startsWith(resolve(OPENCLAW_AGENTS_DIR))) continue;
    const files = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !/\.(json|jsonl)$/i.test(file.name)) continue;
      const fullPath = join(sessionsDir, file.name);
      const stats = await stat(fullPath).catch(() => null);
      if (!stats || stats.size > 5_000_000) continue;
      const row = await openClawUsageFromFile(entry.name, fullPath, stats.mtimeMs);
      if (row) rows.push(row);
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

async function openClawUsageFromFile(agentId: string, path: string, mtimeMs: number): Promise<RuntimeUsageRow | null> {
  const raw = await readFile(path, "utf8");
  const values = path.endsWith(".jsonl")
    ? raw.split(/\r?\n/).filter(Boolean).slice(-500).map(parseJsonLine).filter(Boolean)
    : [parseJsonLine(raw)].filter(Boolean);
  let bestTokens = 0;
  let model = "openclaw";
  for (const value of values) {
    bestTokens = Math.max(bestTokens, usageTokens(value));
    model = findString(value, ["model", "modelId", "modelRef"]) ?? model;
  }
  if (bestTokens <= 0) return null;
  return {
    runtime: "openclaw",
    agentId,
    sessionId: path.split("/").pop()?.replace(/\.(json|jsonl)$/i, "") || path,
    source: "sessions",
    model,
    updatedAt: new Date(mtimeMs).toISOString(),
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    reasoningTokens: 0,
    totalTokens: bestTokens,
  };
}

function groupUsage<T extends "model" | "runtime" | "source">(rows: RuntimeUsageRow[], key: T) {
  const groups = new Map<string, { sessions: number; tokens: number }>();
  for (const row of rows) {
    const name = String(row[key] || "unknown");
    const current = groups.get(name) ?? { sessions: 0, tokens: 0 };
    current.sessions += 1;
    current.tokens += row.totalTokens;
    groups.set(name, current);
  }
  return [...groups.entries()]
    .map(([name, value]) => ({ [key]: name, ...value }) as { [K in T]: string } & { sessions: number; tokens: number })
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 12);
}

function estimateRowsCost(rows: RuntimeUsageRow[]) {
  const usd = rows.reduce((total, row) => total + row.totalTokens * 0.000002, 0);
  return Math.round(usd * 10000) / 10000;
}

function usageTokens(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const matches = collectUsageObjects(value);
  return matches.reduce((best, usage) => {
    const direct = firstNumber(usage, ["total", "totalTokens", "total_tokens", "tokens", "tokenCount", "token_count"]);
    const summed = firstNumber(usage, ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"])
      + firstNumber(usage, ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"])
      + firstNumber(usage, ["cacheRead", "cache_read", "cacheReadTokens", "cache_read_tokens", "cached"])
      + firstNumber(usage, ["cacheWrite", "cache_write", "cacheWriteTokens", "cache_write_tokens"])
      + firstNumber(usage, ["reasoning", "reasoningTokens", "reasoning_tokens"]);
    return Math.max(best, direct, summed);
  }, 0);
}

function collectUsageObjects(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const record = value as Record<string, unknown>;
  const matches = looksLikeUsage(record) ? [record] : [];
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.slice(-20).forEach((item) => matches.push(...collectUsageObjects(item, depth + 1)));
    else if (child && typeof child === "object") matches.push(...collectUsageObjects(child, depth + 1));
  }
  return matches;
}

function looksLikeUsage(record: Record<string, unknown>) {
  return ["total", "totalTokens", "total_tokens", "inputTokens", "input_tokens", "outputTokens", "output_tokens", "tokens"].some((key) => Number.isFinite(Number(record[key])));
}

function firstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 0;
}

function findString(value: unknown, keys: string[], depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  for (const child of Object.values(record)) {
    const found = findString(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

function sum(rows: RuntimeUsageRow[], key: keyof RuntimeUsageRow) {
  return rows.reduce((total, row) => total + positive(row[key]), 0);
}

function positive(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function toIsoSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

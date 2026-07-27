import { readdir, readFile, stat } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";

import {
  readRuntimeUsageAnalytics,
  type RuntimeUsageRow,
} from "@/lib/services/runtime-usage-analytics";
import type { RuntimeChatSessionRecord } from "@/lib/services/chat/runtime-session-store";

/**
 * Per-thread token + cost telemetry for the chat shelf's "Run telemetry"
 * section. A chat "thread" is identified by its `chatStorageKey`; it can span
 * one or more runtime chat sessions. Real token counts only exist on runtime
 * usage rows (~/.hermes/state.db, ~/.openclaw/agents) — chat messages only
 * carry cost/balance billing, never token counts. So tokens are recovered by
 * joining usage rows to the thread's sessions on `sessionId`, and cost/balance
 * come from the sessions' per-message billing.
 *
 * When no usage row matches the thread's sessions, `tokensAvailable` is false
 * and `tokens` stays at 0 so the UI can hide the Tokens row rather than render
 * a fabricated "0".
 */
export type ChatThreadUsage = {
  ok: boolean;
  chatStorageKey: string;
  sessionCount: number;
  messageCount: number;
  tokens: { input: number; output: number; cache: number; reasoning: number; total: number };
  costUsd: number;
  balanceUsd?: number;
  models: string[];
  providers: string[];
  runtimes: string[];
  tokensAvailable: boolean;
};

// Mirrors the storage path + directory-walk convention used by
// src/lib/services/queen-bee/outcome-stats.ts, since the session store's
// readRuntimeChatSession only returns the single most-recent match and there is
// no exported "list every session for a thread" helper.
const SESSION_DIR = join(homedir(), ".hivemindos", "chat-runtime-sessions");
const MAX_THREAD_SESSION_FILES = 240;
// readRuntimeUsageAnalytics clamps to 500; pull the widest window so an older
// session in the thread still has a chance to match a usage row.
const USAGE_ROW_LIMIT = 500;

function finite(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Pure join used by both the live reader and the hermetic test: match usage
 * `rows` to the thread's `sessions` on `sessionId`, sum tokens from matched
 * rows, and sum cost/collect billing metadata from the sessions' messages.
 */
export function joinThreadUsage(
  rows: RuntimeUsageRow[],
  sessions: RuntimeChatSessionRecord[],
  chatStorageKey = "",
): ChatThreadUsage {
  const key = chatStorageKey || sessions.find((session) => session.chatStorageKey)?.chatStorageKey || "";
  const sessionIds = new Set(sessions.map((session) => session.sessionId).filter(Boolean));
  const matchedRows = rows.filter((row) => row.sessionId && sessionIds.has(row.sessionId));
  const tokensAvailable = matchedRows.length > 0;

  const tokens = { input: 0, output: 0, cache: 0, reasoning: 0, total: 0 };
  const models = new Set<string>();
  const runtimes = new Set<string>();
  for (const row of matchedRows) {
    tokens.input += finite(row.inputTokens);
    tokens.output += finite(row.outputTokens);
    tokens.cache += finite(row.cacheTokens);
    tokens.reasoning += finite(row.reasoningTokens);
    tokens.total += finite(row.totalTokens);
    if (row.model?.trim()) models.add(row.model.trim());
    if (row.runtime) runtimes.add(row.runtime);
  }

  let costUsd = 0;
  let messageCount = 0;
  let latestBalance: { at: number; balanceUsd: number } | null = null;
  const providers = new Set<string>();
  for (const session of sessions) {
    if (session.runtime) runtimes.add(session.runtime);
    for (const message of session.messages ?? []) {
      messageCount += 1;
      const billing = message.billing;
      if (!billing) continue;
      if (Number.isFinite(billing.costUsd)) costUsd += Number(billing.costUsd);
      if (billing.provider?.trim()) providers.add(billing.provider.trim());
      if (Number.isFinite(billing.balanceUsd)) {
        const at = finite(message.createdAt);
        if (!latestBalance || at >= latestBalance.at) latestBalance = { at, balanceUsd: Number(billing.balanceUsd) };
      }
    }
  }

  return {
    ok: true,
    chatStorageKey: key,
    sessionCount: sessions.length,
    messageCount,
    tokens,
    costUsd: roundUsd(costUsd),
    balanceUsd: latestBalance ? roundUsd(latestBalance.balanceUsd) : undefined,
    models: [...models].sort(),
    providers: [...providers].sort(),
    runtimes: [...runtimes].sort(),
    tokensAvailable,
  };
}

async function readThreadSessions(chatStorageKey: string): Promise<RuntimeChatSessionRecord[]> {
  const entries = await readdir(SESSION_DIR, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const stamped = (await Promise.all(files.map(async (entry) => {
    const path = join(SESSION_DIR, entry.name);
    const info = await stat(path).catch(() => null);
    return info ? { path, mtimeMs: info.mtimeMs } : null;
  })))
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_THREAD_SESSION_FILES);
  const sessions = await Promise.all(stamped.map(async ({ path }) => {
    const raw = await readFile(path, "utf8").catch(() => "");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RuntimeChatSessionRecord;
      if (!parsed?.sessionId || !Array.isArray(parsed.messages)) return null;
      return parsed;
    } catch {
      return null;
    }
  }));
  return sessions.filter((session): session is RuntimeChatSessionRecord =>
    session !== null && session.chatStorageKey === chatStorageKey);
}

export async function readChatThreadUsage(chatStorageKey: string): Promise<ChatThreadUsage> {
  const key = (chatStorageKey ?? "").trim();
  if (!key) return joinThreadUsage([], [], "");
  const [analytics, sessions] = await Promise.all([
    readRuntimeUsageAnalytics(USAGE_ROW_LIMIT).catch(() => null),
    readThreadSessions(key),
  ]);
  return joinThreadUsage(analytics?.rows ?? [], sessions, key);
}

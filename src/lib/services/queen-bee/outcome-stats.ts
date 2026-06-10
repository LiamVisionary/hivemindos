import { homedir } from "os";
import { join } from "path";
import { readdir, readFile, stat } from "fs/promises";

const SESSION_DIR = join(homedir(), ".hivemindos", "chat-runtime-sessions");
const OUTCOME_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_SESSION_FILES = 240;
const OUTCOME_CACHE_MS = 60_000;

export type QueenBeeAgentOutcome = {
  completed: number;
  failed: number;
};

export type QueenBeeOutcomeStats = Record<string, QueenBeeAgentOutcome>;

let outcomeCache: { stats: QueenBeeOutcomeStats; readAt: number } | null = null;

type SessionOutcomeRecord = {
  agentId?: string;
  endedAt?: number;
  endReason?: string;
};

/**
 * Aggregates recent runtime chat session outcomes per agent so Queen Bee can
 * learn which agents actually finish the work they are routed, instead of
 * trusting keyword inference alone.
 */
export async function readQueenBeeOutcomeStats(): Promise<QueenBeeOutcomeStats> {
  const now = Date.now();
  if (outcomeCache && now - outcomeCache.readAt < OUTCOME_CACHE_MS) return outcomeCache.stats;
  const stats: QueenBeeOutcomeStats = {};
  const entries = await readdir(SESSION_DIR, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const stamped = (await Promise.all(files.map(async (entry) => {
    const path = join(SESSION_DIR, entry.name);
    const info = await stat(path).catch(() => null);
    return info ? { path, mtimeMs: info.mtimeMs } : null;
  })))
    .filter((entry): entry is { path: string; mtimeMs: number } => entry !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SESSION_FILES);
  for (const file of stamped) {
    if (now - file.mtimeMs > OUTCOME_WINDOW_MS) continue;
    const raw = await readFile(file.path, "utf8").catch(() => "");
    if (!raw) continue;
    let session: SessionOutcomeRecord;
    try {
      session = JSON.parse(raw) as SessionOutcomeRecord;
    } catch {
      continue;
    }
    const agentId = session.agentId?.trim();
    if (!agentId || !session.endedAt) continue;
    const reason = (session.endReason ?? "").toLowerCase();
    const bucket = stats[agentId] ?? (stats[agentId] = { completed: 0, failed: 0 });
    if (reason === "completed") bucket.completed += 1;
    else if (reason === "failed" || reason === "blocked") bucket.failed += 1;
  }
  outcomeCache = { stats, readAt: now };
  return stats;
}

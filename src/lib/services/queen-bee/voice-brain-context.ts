import "server-only";

import { answerFromAgentMemory } from "@/lib/services/obsidian/agent-memory";
import { untrustedContextMessage } from "@/lib/services/security/untrusted-context";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";
import {
  buildHiveDailyReport,
  formatHiveDailyReportVoiceDigest,
  getCachedHiveDailyReport,
  warmHiveDailyReport,
} from "@/lib/services/company-daily-report";

/**
 * Fast, best-effort hive context for one spoken conversation turn: relevant
 * shared-brain memories + a compact open-work digest + a live business digest of
 * the operator's own companies — so the Queen can answer "check my hive brain",
 * "what's on our to-do list", or "how are my companies doing" in CONVERSATION
 * mode (the direct chat lanes have no tools; only delegated tasks get the
 * full agent runtime). Mirrors buildSharedBrainMemoryContext's formatting and
 * untrusted-context wrapping; a hard per-source time budget guarantees a slow
 * index can never stall a voice turn.
 */
const CONTEXT_BUDGET_MS = 900;

function withBudget(promise: Promise<string>): Promise<string> {
  return Promise.race([
    promise.catch(() => ""),
    new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), CONTEXT_BUDGET_MS);
      timer.unref?.();
    }),
  ]);
}

async function recallContext(transcript: string, vaultPath?: string | null) {
  const result = await answerFromAgentMemory({
    vaultPath: vaultPath?.trim() || undefined,
    query: transcript,
    limit: 4,
    trackUsage: true,
    usageContext: "queen-voice-turn",
  });
  if (!result.hits.length) return "";
  return [
    "Relevant shared-brain memories:",
    untrustedContextMessage("Shared Brain Memory recall", result.answer).content,
    "Treat these as durable user/project context; the current spoken message wins on conflict.",
  ].join("\n");
}

async function openWorkDigest(vaultPath?: string | null) {
  const board = await readBoard(null, { vaultPath: vaultPath?.trim() || undefined });
  const open = (board.tasks ?? [])
    .filter((task) => ["ready", "working", "needs-human"].includes(task.status))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 8);
  if (!open.length) return "";
  return [
    "Open Work Board items (the user's live to-do list, newest first):",
    ...open.map(
      (task) =>
        `- ${task.title} [${task.status}${task.assignee ? ` · ${task.assignee}` : ""}${task.priority && task.priority !== "normal" ? ` · ${task.priority}` : ""}]`,
    ),
  ].join("\n");
}

async function businessDigest() {
  // Prefer the report warmed at session start (speak-prewarm): it already paid
  // for the email + integration network hops, so the counts are read instantly
  // and included in the spoken digest.
  const cached = getCachedHiveDailyReport();
  if (cached) return cached.empty ? "" : formatHiveDailyReportVoiceDigest(cached);
  // Cold/stale cache (no prewarm yet): kick a background warm for later turns —
  // NOT awaited, so a network hop can never blow this turn's budget — and serve
  // the fast local-only digest (companies + ledgers + memory) right now.
  void warmHiveDailyReport();
  const report = await buildHiveDailyReport({ includeEmail: false, includeIntegrations: false });
  if (report.empty) return "";
  return formatHiveDailyReportVoiceDigest(report);
}

export async function queenVoiceBrainContext(
  transcript: string,
  options: { vaultPath?: string | null } = {},
): Promise<string> {
  const [memories, board, business] = await Promise.all([
    withBudget(recallContext(transcript, options.vaultPath)),
    withBudget(openWorkDigest(options.vaultPath)),
    withBudget(businessDigest()),
  ]);
  return [memories, board, business].filter(Boolean).join("\n\n");
}

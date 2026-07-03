import "server-only";

import { answerFromAgentMemory } from "@/lib/services/obsidian/agent-memory";
import { untrustedContextMessage } from "@/lib/services/security/untrusted-context";
import { readBoard } from "@/lib/services/kanban/local-kanban-store";

/**
 * Fast, best-effort hive context for one spoken conversation turn: relevant
 * shared-brain memories + a compact open-work digest — so the Queen can
 * answer "check my hive brain" or "what's on our to-do list" in CONVERSATION
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

export async function queenVoiceBrainContext(
  transcript: string,
  options: { vaultPath?: string | null } = {},
): Promise<string> {
  const [memories, board] = await Promise.all([
    withBudget(recallContext(transcript, options.vaultPath)),
    withBudget(openWorkDigest(options.vaultPath)),
  ]);
  return [memories, board].filter(Boolean).join("\n\n");
}

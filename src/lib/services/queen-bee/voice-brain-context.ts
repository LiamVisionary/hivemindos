import "server-only";

import { answerFromAgentMemory } from "@/lib/services/obsidian/agent-memory";
import {
  formatBrainAccessInsightsForAgent,
  readBrainAccessInsights,
} from "@/lib/services/obsidian/brain-access-insights";
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

function withBudget(
  promise: Promise<string>,
  budgetMs = CONTEXT_BUDGET_MS,
): Promise<string> {
  return Promise.race([
    promise.catch(() => ""),
    new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve(""), budgetMs);
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

type VoiceBoardTask = Awaited<ReturnType<typeof readBoard>>["tasks"][number];

function compactVoiceText(value: string, limit = 520) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function marketplaceReportFromResult(result: string) {
  const match = result.match(/```json\s+MARKETPLACE_REPORT\s*([\s\S]*?)```/i);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as {
      conversations?: Array<{
        buyerName?: unknown;
        listingTitle?: unknown;
        messages?: Array<{ from?: unknown; text?: unknown }>;
      }>;
      escalations?: Array<{ question?: unknown; reason?: unknown }>;
      note?: unknown;
    };
  } catch {
    return null;
  }
}

/** Voice-specific detail for a live Marketplace Work Board card. The normal
 * digest used to expose only five identical titles, even though each card's
 * result already contained the buyer, exact messages, and requested decision. */
export function marketplaceInboxTaskVoiceDetail(task: VoiceBoardTask) {
  const result = typeof task.result === "string" ? task.result : "";
  const report = marketplaceReportFromResult(result);
  const parts: string[] = [];
  for (const conversation of report?.conversations?.slice(0, 2) ?? []) {
    const buyer = typeof conversation.buyerName === "string"
      ? conversation.buyerName.trim()
      : "Unknown buyer";
    const listing = typeof conversation.listingTitle === "string"
      ? conversation.listingTitle.trim()
      : "Marketplace listing";
    const messages = (conversation.messages ?? [])
      .slice(-4)
      .map((message) => {
        const from = typeof message.from === "string" ? message.from.trim() : "unknown";
        const text = typeof message.text === "string" ? compactVoiceText(message.text, 220) : "";
        return text ? `${from}: “${text}”` : "";
      })
      .filter(Boolean);
    parts.push(`${buyer} about ${listing}${messages.length ? ` — ${messages.join("; ")}` : ""}`);
  }
  const escalation = report?.escalations?.find((item) => item?.question || item?.reason);
  if (escalation) {
    const question = typeof escalation.question === "string" ? escalation.question : "";
    const reason = typeof escalation.reason === "string" ? escalation.reason : "";
    const detail = compactVoiceText(question || reason, 320);
    if (detail) parts.push(`Needs the user: ${detail}`);
  }
  if (!parts.length) {
    // Runtime failure text can quote the task's own "ACTION NEEDED" authoring
    // instructions. Only trust a terminal action block; otherwise the result's
    // first paragraph is the honest outcome summary.
    const actionIndex = result.lastIndexOf("ACTION NEEDED:");
    const terminalAction = actionIndex >= Math.max(0, result.length - 1_500)
      ? result.slice(actionIndex + "ACTION NEEDED:".length).split(/\n\n|```/)[0]
      : "";
    const firstParagraph = result.split(/\n\s*\n/).find((part) => part.trim()) ?? "";
    const fallback = compactVoiceText(terminalAction || firstParagraph, 520);
    if (fallback) parts.push(fallback);
  }
  return parts.join(" ");
}

async function openWorkDigest(query: string, vaultPath?: string | null) {
  const board = await readBoard(null, { vaultPath: vaultPath?.trim() || undefined });
  const allOpen = (board.tasks ?? [])
    .filter((task) => ["ready", "working", "needs-human"].includes(task.status))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const wantsInboxDetails = /\b(?:marketplace|inbox|individual|specific|actual|each|messages?|threads?)\b/i.test(query);
  const marketplaceOpen = wantsInboxDetails
    ? allOpen.filter((task) => /marketplace|facebook:primary|work-inbox/i.test(
        `${task.title ?? ""}\n${task.body ?? ""}`,
      ))
    : [];
  const open = (marketplaceOpen.length ? marketplaceOpen : allOpen)
    .slice(0, wantsInboxDetails ? 5 : 8);
  if (!open.length) return "";
  if (wantsInboxDetails && marketplaceOpen.length) {
    return [
      "Exact live Marketplace inbox Work Board cards (newest first). These are card results, not aggregate counts; repeated buyers may represent repeated monitor runs:",
      ...open.map((task) => {
        const detail = marketplaceInboxTaskVoiceDetail(task);
        return `- ${task.id}: ${task.title} [${task.status}${task.assignee ? ` · ${task.assignee}` : ""}]${detail ? ` — ${detail}` : ""}`;
      }),
      "Answer the user's question directly from these exact card details. Never say only aggregate counts when individual messages are present here.",
    ].join("\n");
  }
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

async function accessHistoryDigest(vaultPath?: string | null) {
  const insights = await readBrainAccessInsights({
    vaultPath: vaultPath?.trim() || undefined,
  });
  return formatBrainAccessInsightsForAgent(insights);
}

export async function queenVoiceBrainContext(
  transcript: string,
  options: {
    vaultPath?: string | null;
    includeAccessHistory?: boolean;
    includeMemories?: boolean;
    includeBoard?: boolean;
    includeBusiness?: boolean;
    budgetMs?: number;
  } = {},
): Promise<string> {
  const budgetMs = Math.min(10_000, Math.max(250, options.budgetMs ?? CONTEXT_BUDGET_MS));
  const [memories, board, business, accessHistory] = await Promise.all([
    options.includeMemories === false
      ? Promise.resolve("")
      : withBudget(recallContext(transcript, options.vaultPath), budgetMs),
    options.includeBoard === false
      ? Promise.resolve("")
      : withBudget(openWorkDigest(transcript, options.vaultPath), budgetMs),
    options.includeBusiness === false
      ? Promise.resolve("")
      : withBudget(businessDigest(), budgetMs),
    options.includeAccessHistory
      ? withBudget(accessHistoryDigest(options.vaultPath), budgetMs)
      : Promise.resolve(""),
  ]);
  return [memories, board, business, accessHistory].filter(Boolean).join("\n\n");
}

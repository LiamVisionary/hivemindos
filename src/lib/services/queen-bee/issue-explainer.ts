// Turns a blocked Zero-Human-Company task — its own result and eval-gate
// receipts (with the concrete command/probe evidence) — into a plain-language
// explanation the human owner can act on: what is blocking it, what that means,
// and the concrete next step(s) to unblock it.
//
// This is the "on-demand explain" behind the Task Detail alert. It is strictly
// READ-ONLY: one tool-less chat completion over context the caller already has,
// no fleet tools, no mutation, no spend. It rides the same OpenAI key/model the
// Queen chat overlay uses (transcriptionApiKey + OPENAI_VOICE_CHAT_MODEL), so a
// good answer needs no extra configuration — the evidence is already in-context,
// which is why the model does not need live tools to reach it.
import { transcriptionApiKey } from "@/lib/services/phone/transcription";

export type IssueExplainerReceipt = {
  status?: string;
  summary?: string;
  evidence?: string[];
};

export type IssueExplainerInput = {
  taskTitle: string;
  companyName?: string;
  apexGoal?: string;
  metric?: string;
  result?: string;
  receipts?: IssueExplainerReceipt[];
};

/** Structured, human-facing explanation of a blocked task. */
export type IssueExplanation = {
  /** One plain-language sentence: what is actually blocking this. */
  headline: string;
  /** 1–4 concrete next actions the human owner can take to unblock it. */
  steps: string[];
  /** Optional short extra context; empty string when nothing to add. */
  detail: string;
};

const EXPLAIN_FALLBACK_MODEL = "gpt-4o-mini";
const EXPLAIN_TIMEOUT_MS = 30_000;
// Keep the prompt bounded so a verbose result/evidence trail can't blow the
// context or the token bill — the tail of a result is rarely the load-bearing part.
const MAX_RESULT_CHARS = 4_000;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_EVIDENCE_CHARS = 400;

function explainModel(): string {
  return process.env.OPENAI_VOICE_CHAT_MODEL || EXPLAIN_FALLBACK_MODEL;
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function formatContext(input: IssueExplainerInput): string {
  const lines: string[] = [`Task: ${input.taskTitle.trim()}`];
  if (input.companyName?.trim()) lines.push(`Company: ${input.companyName.trim()}`);
  if (input.apexGoal?.trim()) lines.push(`Company goal: ${input.apexGoal.trim()}`);
  if (input.metric?.trim()) lines.push(`Tracked metric: ${input.metric.trim()}`);
  if (input.result?.trim()) {
    lines.push("", "Latest agent result:", clamp(input.result, MAX_RESULT_CHARS));
  }
  const receipts = (input.receipts ?? []).filter((r) => (r.summary ?? "").trim() || (r.evidence ?? []).length);
  if (receipts.length) {
    lines.push("", "Eval-gate receipts (the checks the autonomous run recorded):");
    for (const receipt of receipts) {
      const status = (receipt.status ?? "").trim() || "unknown";
      lines.push(`- [${status}] ${clamp(receipt.summary ?? "", 600)}`);
      const evidence = (receipt.evidence ?? []).slice(0, MAX_EVIDENCE_ITEMS);
      for (const item of evidence) {
        const text = clamp(String(item ?? ""), MAX_EVIDENCE_CHARS);
        if (text) lines.push(`    · ${text}`);
      }
    }
  }
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are Queen Bee, explaining a blocked task from one of the owner's autonomous companies to the non-technical human who owns it. " +
  "You are given the task, its latest result, and its eval-gate receipts including the exact commands/probes that ran (the evidence). " +
  "Explain in plain language: what is actually blocking this task right now, what that means, and the concrete next step(s) the owner should take to unblock it. " +
  "Ground every claim in the evidence provided — name the exact provider, setting, quota, credential, or action involved. Never invent facts, URLs, or steps that the evidence does not support; if the evidence is thin, say what is unknown. " +
  "Do not tell them to write code or read files unless the evidence shows that is the actual fix. Prefer the smallest real action that unblocks it. " +
  'Respond with STRICT JSON only, no markdown fences, matching exactly: {"headline": string, "steps": string[], "detail": string}. ' +
  "headline: one plain sentence stating what is blocking it (no jargon, no gate IDs). " +
  "steps: 1 to 4 short imperative actions the human can take, most important first; empty array only if truly nothing is actionable. " +
  "detail: one or two extra sentences of context, or an empty string when the headline and steps already say it all.";

function coerceExplanation(raw: unknown): IssueExplanation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const headline = typeof record.headline === "string" ? record.headline.trim() : "";
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  const steps = Array.isArray(record.steps)
    ? record.steps.map((step) => (typeof step === "string" ? step.trim() : "")).filter(Boolean).slice(0, 4)
    : [];
  if (!headline && !steps.length && !detail) return null;
  return { headline: headline || "Here's what's going on with this task.", steps, detail };
}

/**
 * Generate the plain-language, actionable explanation for a blocked task.
 * Throws when no OpenAI key is configured or the model call fails, so the route
 * can surface an honest "couldn't generate an explanation" instead of a fake one.
 */
export async function explainBlockedIssue(input: IssueExplainerInput): Promise<IssueExplanation> {
  const title = input.taskTitle?.trim();
  if (!title) throw new Error("A task title is required to explain the issue.");

  const apiKey = await transcriptionApiKey();
  if (!apiKey) throw new Error("No OpenAI key is configured for issue explanations.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: explainModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: formatContext(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 600,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(EXPLAIN_TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string } | string;
  } | null;

  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(detail || `Explanation model returned HTTP ${response.status}.`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("The explanation model returned an empty response.");
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    // response_format should guarantee JSON, but fall back to treating the raw
    // text as the detail rather than dead-ending on a stray non-JSON reply.
    return { headline: "Here's what's going on with this task.", steps: [], detail: content.trim() };
  }

  const explanation = coerceExplanation(parsed);
  if (!explanation) throw new Error("The explanation model returned an unusable response.");
  return explanation;
}

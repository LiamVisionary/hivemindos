// LLM half of the company email-QA scan. Reviews ONE outreach email a company's
// crew actually sent, against the company's charter/goal and the specific
// recipient, and returns content/judgment problems a deterministic scan can't
// see: off-strategy or off-brand copy, factual/personalization mismatch, raw
// machine-signal text, unprofessional tone, or compliance gaps.
//
// Strictly READ-ONLY: one tool-less chat completion over context the caller
// already has — no fleet tools, no mutation. Mirrors issue-explainer.ts and rides
// the same OpenAI key (transcriptionApiKey). Deliberately uses a stronger default
// model than the voice/explain path because email QA is a quality-over-cost
// judgment task; override with OPENAI_EMAIL_QA_MODEL.
import { transcriptionApiKey } from "@/lib/services/phone/transcription";

export type EmailQaAiFinding = {
  severity: "high" | "medium" | "low";
  /** Short kebab/space category, e.g. "off-strategy", "personalization mismatch", "tone". */
  category: string;
  /** One plain sentence: what is wrong with THIS email. */
  summary: string;
  /** One concrete standing rule the crew should follow next time. */
  suggestion: string;
};

export type EmailQaReviewInput = {
  companyName?: string;
  charter?: string;
  apexGoal?: string;
  recipient?: string;
  subject?: string;
  body: string;
};

const FALLBACK_MODEL = "gpt-4o";
const TIMEOUT_MS = 45_000;
const MAX_BODY_CHARS = 6_000;
const MAX_CHARTER_CHARS = 1_400;

function reviewModel(): string {
  return process.env.OPENAI_EMAIL_QA_MODEL || FALLBACK_MODEL;
}

function clamp(value: string, max: number): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

const SYSTEM_PROMPT =
  "You are Queen Bee QA, reviewing an outreach email that one of the owner's autonomous companies ALREADY SENT to a real prospect. " +
  "Judge it against the company's charter/goal and the specific recipient. Flag only problems a careful human owner would want to fix: " +
  "off-strategy or off-brand content; a factual or personalization mismatch (wrong business, wrong detail, a claim the email can't back up); " +
  "raw internal/machine-signal text left in the copy (e.g. a scan string used as a human sentence); unprofessional, robotic, or embarrassing tone; " +
  "a pushy/hard CTA where the strategy calls for a soft one; or a clear compliance gap. " +
  "Do NOT flag mechanical issues that are checked separately — dead links, template placeholders, or a visible tracking-pixel line — ignore those entirely. " +
  "Ground every finding in the actual email text and the charter; never invent problems. If the email is on-strategy and clean, return an empty findings array. " +
  'Respond with STRICT JSON only, no markdown fences, matching exactly: {"findings": [{"severity": "high"|"medium"|"low", "category": string, "summary": string, "suggestion": string}]}. ' +
  "summary: one plain sentence naming the specific problem in THIS email. suggestion: one short imperative standing rule the crew should follow next time. " +
  "Be strict but fair — at most 3 findings, most important first, only real problems.";

function formatContext(input: EmailQaReviewInput): string {
  const lines: string[] = [];
  if (input.companyName?.trim()) lines.push(`Company: ${input.companyName.trim()}`);
  if (input.charter?.trim()) lines.push(`Company charter: ${clamp(input.charter, MAX_CHARTER_CHARS)}`);
  if (input.apexGoal?.trim()) lines.push(`Company goal: ${input.apexGoal.trim()}`);
  if (input.recipient?.trim()) lines.push(`Recipient (the prospect): ${input.recipient.trim()}`);
  lines.push("", `Subject: ${(input.subject ?? "").trim() || "(no subject)"}`, "", "Email body as sent:", clamp(input.body, MAX_BODY_CHARS));
  return lines.join("\n");
}

function coerceFindings(raw: unknown): EmailQaAiFinding[] {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(record.findings) ? record.findings : [];
  const findings: EmailQaAiFinding[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!summary) continue;
    const severityRaw = typeof item.severity === "string" ? item.severity.toLowerCase() : "";
    const severity: EmailQaAiFinding["severity"] = severityRaw === "high" || severityRaw === "low" ? severityRaw : "medium";
    findings.push({
      severity,
      category: (typeof item.category === "string" && item.category.trim()) || "content",
      summary,
      suggestion: typeof item.suggestion === "string" ? item.suggestion.trim() : "",
    });
  }
  return findings.slice(0, 3);
}

/** Review one sent email for content/alignment problems. Returns [] on a clean
 *  email. Throws when no OpenAI key is configured or the model call fails, so the
 *  scanner can record that the AI layer was unavailable rather than fake a pass. */
export async function reviewOutreachEmail(input: EmailQaReviewInput): Promise<EmailQaAiFinding[]> {
  if (!input.body?.trim()) return [];
  const apiKey = await transcriptionApiKey();
  if (!apiKey) throw new Error("No OpenAI key is configured for email QA review.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: reviewModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: formatContext(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 700,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const data = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string } | string;
  } | null;

  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : data?.error?.message;
    throw new Error(detail || `Email QA model returned HTTP ${response.status}.`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("The email QA model returned an empty response.");

  try {
    return coerceFindings(JSON.parse(content));
  } catch {
    return []; // response_format guarantees JSON; a stray non-JSON reply is treated as "no findings" rather than a hard error.
  }
}

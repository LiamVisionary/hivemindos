export type ReasoningTrail = {
  /** One direct sentence naming the decision or issue. */
  headline: string;
  /** What this request or blocker is in normal language. */
  summary: string;
  /** Why it surfaced for human attention now. */
  whyNow: string;
  /** What changes if the human approves, rejects, or ignores it. */
  impact?: string;
  /** The specific decision or action the human is being asked to take. */
  requestedAction?: string;
  /** Concrete facts the system used to form the explanation. */
  evidence: string[];
  /** Important context the system does not have. */
  missingContext?: string[];
  /** Useful follow-up checks or actions. */
  nextSteps?: string[];
  /** Product or subsystem that produced the explanation. */
  source?: string;
};

export const REASONING_TRAIL_STYLE_RULES = [
  "Write like a real operator note: direct, specific, and low fluff.",
  "Use short and medium sentences.",
  "Name the concrete blocker, asset, provider, endpoint, task, or missing credential.",
  "Say what is confirmed and what context is missing.",
  "Avoid corporate filler, motivational language, vague phrases, em dashes, and semicolons.",
] as const;

export const REASONING_TRAIL_FIELD_LABELS = {
  summary: "What this is",
  whyNow: "Why now",
  impact: "Impact",
  requestedAction: "Decision needed",
  evidence: "Evidence",
  missingContext: "Missing context",
  nextSteps: "Next steps",
} as const;

const MAX_FIELD_CHARS = 420;
const MAX_LIST_ITEMS = 8;

function cleanText(value: unknown, max = MAX_FIELD_CHARS): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > max ? `${compact.slice(0, max - 1).trimEnd()}...` : compact;
}

function cleanList(values: unknown, maxItems = MAX_LIST_ITEMS): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const line = cleanText(value);
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function compactReasoningTrailList(values: unknown, maxItems = MAX_LIST_ITEMS): string[] {
  return cleanList(values, maxItems);
}

export function normalizeReasoningTrail(value: unknown): ReasoningTrail | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const headline = cleanText(record.headline);
  const summary = cleanText(record.summary);
  const whyNow = cleanText(record.whyNow);
  const evidence = cleanList(record.evidence);
  if (!headline && !summary && !whyNow && evidence.length === 0) return undefined;
  return {
    headline: headline || summary || whyNow || "This needs a human decision.",
    summary: summary || headline || "The system needs a human to review this before it continues.",
    whyNow: whyNow || "The request crossed a review boundary and was paused for approval.",
    ...(cleanText(record.impact) ? { impact: cleanText(record.impact) } : {}),
    ...(cleanText(record.requestedAction) ? { requestedAction: cleanText(record.requestedAction) } : {}),
    evidence,
    ...(cleanList(record.missingContext).length ? { missingContext: cleanList(record.missingContext) } : {}),
    ...(cleanList(record.nextSteps).length ? { nextSteps: cleanList(record.nextSteps) } : {}),
    ...(cleanText(record.source, 120) ? { source: cleanText(record.source, 120) } : {}),
  };
}

export function reasoningTrailPromptRules(): string {
  return REASONING_TRAIL_STYLE_RULES.map((rule) => `- ${rule}`).join("\n");
}

export function formatReasoningTrailForPlainText(trail: ReasoningTrail): string {
  const lines = [
    trail.headline,
    `${REASONING_TRAIL_FIELD_LABELS.summary}: ${trail.summary}`,
    `${REASONING_TRAIL_FIELD_LABELS.whyNow}: ${trail.whyNow}`,
    trail.impact ? `${REASONING_TRAIL_FIELD_LABELS.impact}: ${trail.impact}` : null,
    trail.requestedAction ? `${REASONING_TRAIL_FIELD_LABELS.requestedAction}: ${trail.requestedAction}` : null,
  ];
  if (trail.evidence.length) {
    lines.push(`${REASONING_TRAIL_FIELD_LABELS.evidence}:`);
    for (const item of trail.evidence.slice(0, 5)) lines.push(`- ${item}`);
  }
  if (trail.missingContext?.length) {
    lines.push(`${REASONING_TRAIL_FIELD_LABELS.missingContext}:`);
    for (const item of trail.missingContext.slice(0, 4)) lines.push(`- ${item}`);
  }
  if (trail.nextSteps?.length) {
    lines.push(`${REASONING_TRAIL_FIELD_LABELS.nextSteps}:`);
    for (const item of trail.nextSteps.slice(0, 4)) lines.push(`- ${item}`);
  }
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

import type { FusionAnalysis, FusionMessage, FusionParticipantResult } from "./types";

/** Flatten an OpenAI-style message content into plain text. */
export function messageText(content: FusionMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      if (part.type === "image_url") return part.image_url?.url ? "[image]" : "";
      if (part.type === "file") return part.file?.filename ? `[file: ${part.file.filename}]` : "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** The user's latest question, used to anchor judge + synthesizer. */
export function extractQuestion(messages: FusionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== "user") continue;
    const text = messageText(messages[i].content).trim();
    if (text) return text;
  }
  return "";
}

function transcript(results: FusionParticipantResult[]): string {
  return results
    .map((result, index) => {
      const header = `### Response ${index + 1} — ${result.member.label}`;
      const body = result.text.trim() || "(empty response)";
      return `${header}\n${body}`;
    })
    .join("\n\n");
}

export const JUDGE_SYSTEM_PROMPT = [
  "You are the JUDGE in a compound-model pipeline. Several independent models each answered the same task.",
  "Your job is NOT to answer the task. Your job is to extract the STRUCTURE across their answers so a synthesizer can write one grounded answer.",
  "Read every response carefully and return ONLY a JSON object (no prose, no markdown fences) with these keys:",
  '- "consensus": string[] — claims most/all responses agree on.',
  '- "contradictions": string[] — points where responses directly disagree (state both sides).',
  '- "partialCoverage": string[] — subtopics only some responses addressed.',
  '- "uniqueInsights": string[] — valuable points raised by only one response (note which).',
  '- "blindSpots": string[] — important aspects of the task that NO response covered.',
  '- "recommendedFocus": string — one sentence on what the final answer should prioritize.',
  "Be specific and concise. Prefer 2-6 items per array. If an array is empty, return [].",
].join("\n");

export function buildJudgeUserPrompt(question: string, results: FusionParticipantResult[]): string {
  return [
    "TASK GIVEN TO THE PANEL:",
    question || "(see responses)",
    "",
    "PANEL RESPONSES:",
    transcript(results),
    "",
    "Return the structured JSON analysis now.",
  ].join("\n");
}

export const SYNTHESIZER_SYSTEM_PROMPT = [
  "You are the SYNTHESIZER in a compound-model pipeline. Independent models answered the user's task, and a judge extracted the structure of their answers.",
  "Write the single best final answer for the user, grounded in that material. You are not summarizing the panel — you are producing the definitive answer.",
  "Guidelines:",
  "- Lead with consensus, but resolve contradictions explicitly using your own judgement; do not hedge by listing both sides unless the disagreement is genuinely unresolved.",
  "- Fold in unique insights and cover the blind spots the judge flagged.",
  "- Do not mention 'the panel', 'the responses', 'model 1/2/3', or this pipeline. Speak directly to the user as one coherent voice.",
  "- Match the user's language and the task's required format. Be accurate and well-organized; do not pad for length.",
].join("\n");

export function buildSynthesizerUserPrompt(
  question: string,
  results: FusionParticipantResult[],
  analysis: FusionAnalysis | null,
): string {
  const parts = ["USER TASK:", question || "(see source answers)", ""];
  if (analysis) {
    parts.push("JUDGE ANALYSIS:");
    parts.push(JSON.stringify(analysis, null, 2));
    parts.push("");
  }
  parts.push("SOURCE ANSWERS (for grounding; cite facts, not their existence):");
  parts.push(transcript(results));
  parts.push("");
  parts.push("Write the final answer now.");
  return parts.join("\n");
}

/** Best-effort parse of the judge's JSON reply into a FusionAnalysis. */
export function parseJudgeAnalysis(raw: string): FusionAnalysis {
  const fallback = (): FusionAnalysis => ({
    consensus: [],
    contradictions: [],
    partialCoverage: [],
    uniqueInsights: [],
    blindSpots: [],
    raw: raw.trim() || undefined,
  });
  const text = raw.trim();
  if (!text) return fallback();
  // Strip ```json fences and locate the outermost JSON object.
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return fallback();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return fallback();
  }
  const arr = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim()) : [];
  return {
    consensus: arr(parsed.consensus),
    contradictions: arr(parsed.contradictions),
    partialCoverage: arr(parsed.partialCoverage),
    uniqueInsights: arr(parsed.uniqueInsights),
    blindSpots: arr(parsed.blindSpots),
    recommendedFocus: typeof parsed.recommendedFocus === "string" ? parsed.recommendedFocus : undefined,
  };
}

/** A compact human-readable summary of the analysis for the reasoning stream. */
export function analysisSummary(analysis: FusionAnalysis): string {
  const lines: string[] = [];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`**${title}**`);
    for (const item of items.slice(0, 6)) lines.push(`- ${item}`);
  };
  section("Consensus", analysis.consensus);
  section("Contradictions", analysis.contradictions);
  section("Unique insights", analysis.uniqueInsights);
  section("Blind spots", analysis.blindSpots);
  if (analysis.recommendedFocus) lines.push(`**Focus:** ${analysis.recommendedFocus}`);
  return lines.join("\n");
}

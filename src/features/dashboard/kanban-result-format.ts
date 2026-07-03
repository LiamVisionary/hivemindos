// Presentation-layer formatting for Work Board results and notes.
//
// Agent results often arrive as one long unformatted paragraph (a "wall of
// text"). These helpers structure them for display WITHOUT mutating stored
// data: extract artifact paths into openable chips, split plain prose into
// readable paragraphs, and surface the human-actionable ask on needs-human
// tasks. The `ACTION NEEDED:` labeled-section convention mirrors the existing
// `VISUAL_BRIEF:` convention in dashboard-light-helpers.tsx.

export type TaskResultArtifact = { label: string; path: string };

// One path "word": no whitespace/quotes/brackets/sentence separators.
const PATH_TOKEN = `[^\\s"'\`)\\]},;]`;
// Paths may contain single spaces inside directory names ("Work Board/...").
// A space is absorbed only when the following token still contains a "/" —
// prose after a path ("…/RESULT.md was created") never matches.
const PATH_SOURCE = `(?:~|\\/(?:Users|home|var|opt|private|tmp|srv|mnt))\\/${PATH_TOKEN}+(?: ${PATH_TOKEN}*\\/${PATH_TOKEN}+)*`;
const ABSOLUTE_PATH_PATTERN = new RegExp(PATH_SOURCE, "g");

/** Pull `Artifact: <path>` clauses and bare absolute paths out of prose so the
 * UI can render them as open/reveal chips instead of inline noise. */
export function extractResultArtifacts(text: string): { artifacts: TaskResultArtifact[]; remainder: string } {
  const artifacts: TaskResultArtifact[] = [];
  const seen = new Set<string>();
  let remainder = text;
  const record = (rawPath: string) => {
    const path = rawPath.replace(/[.,;:]+$/, "");
    if (seen.has(path)) return;
    seen.add(path);
    const segments = path.split("/").filter(Boolean);
    artifacts.push({
      label: segments.slice(-2).join("/") || path,
      path,
    });
  };
  // Labeled clauses first ("Artifact: /path", "Artifacts: /a, /b").
  remainder = remainder.replace(
    new RegExp(`\\bArtifacts?\\s*:\\s*((?:~|\\/)${PATH_TOKEN}+(?: ${PATH_TOKEN}*\\/${PATH_TOKEN}+)*(?:\\s*,\\s*(?:~|\\/)${PATH_TOKEN}+(?: ${PATH_TOKEN}*\\/${PATH_TOKEN}+)*)*)`, "gi"),
    (_match, paths: string) => {
      for (const raw of paths.split(/\s*,\s*/)) {
        const trimmed = raw.trim();
        if (trimmed) record(trimmed);
      }
      return "";
    },
  );
  // Then bare absolute paths still in the prose (kept in place, just indexed).
  for (const match of remainder.match(ABSOLUTE_PATH_PATTERN) ?? []) record(match);
  return { artifacts, remainder: remainder.replace(/[ \t]+([.,;])/g, "$1").replace(/[ \t]{2,}/g, " ").trim() };
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'(~/])/;

function looksStructured(text: string) {
  return /\n/.test(text) || /(^|\n)\s*(?:[-*#>]|\d+\.|```|\|)/.test(text);
}

/** Break a single-paragraph wall of text into one sentence per paragraph so
 * markdown rendering has real structure to work with. Structured text (already
 * has newlines/lists/code) passes through untouched. */
export function formatPlainResultBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || looksStructured(trimmed) || trimmed.length <= 220) return trimmed;
  const sentences = trimmed.split(SENTENCE_SPLIT).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length < 2) return trimmed;
  return sentences.join("\n\n");
}

const ACTION_NEEDED_SECTION = /(?:^|\n)\s*ACTION[\s_-]*NEEDED\s*:\s*([\s\S]*?)(?=\n\s*(?:[A-Z][A-Z0-9_ -]{2,}:)|$)/i;

const BLOCKER_KEYWORDS = /\b(block(?:ed|er|ing)?|needs?|requires?|decision|decide|approv(?:e|al)|choose|upgrade|manual(?:ly)?|human|cannot|can['’]t|unable|waiting for|missing|denied|permission|quota|limit exceeded|expired|rate[- ]limit)\b/i;

/** The human-facing ask for a needs-human task. Prefers an explicit
 * `ACTION NEEDED:` section; falls back to the blocker-flavored sentences of
 * the result; returns "" when there is nothing to extract. */
export function extractActionNeeded(result: string | undefined | null): string {
  const text = result?.trim();
  if (!text) return "";
  const labeled = text.match(ACTION_NEEDED_SECTION)?.[1]?.replace(/\s+/g, " ").trim();
  if (labeled) return clipActionText(labeled);
  const sentences = text.replace(/\s+/g, " ").split(SENTENCE_SPLIT).map((sentence) => sentence.trim()).filter(Boolean);
  const blockers = sentences.filter((sentence) => BLOCKER_KEYWORDS.test(sentence));
  if (blockers.length) return clipActionText(blockers.slice(0, 2).join(" "));
  return clipActionText(sentences[sentences.length - 1] ?? "");
}

function clipActionText(text: string) {
  if (text.length <= 300) return text;
  const cut = text.slice(0, 300);
  const lastBreak = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return `${cut.slice(0, lastBreak > 120 ? lastBreak + 1 : 300).trim()} …`;
}

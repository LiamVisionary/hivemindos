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
// Root allowlist mirrors `isOpenableFilePath` (deliverables-model) and the
// read-file route: `root` (Linux fleet agents home under /root) and `Volumes`
// (external/mounted disks) were missing, so Linux-agent artifact paths were never
// indexed as openable chips anywhere.
const PATH_SOURCE = `(?:~|\\/(?:Users|home|root|var|opt|private|tmp|srv|mnt|Volumes))\\/${PATH_TOKEN}+(?: ${PATH_TOKEN}*\\/${PATH_TOKEN}+)*`;
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

// Text that is NOT a human decision, even though the extractors above may surface
// it: worker-facing retry directives, control-plane brief boilerplate, and bare
// completion/claim report lines. A "Needs You" card must never dump these on the
// owner as their "decision" (real leak 2026-07-08: a worker "re-run or revise the
// worker result…" directive shown as the human ask). Surfaces treat a match as
// "no genuine ask" and fall back to an honest prompt instead.
const NON_HUMAN_ASK_PATTERNS = [
  /re-?run or revise the worker result/i,
  /created by the queen bee control plane/i,
  /final response must declare whether/i,
  /required work board evidence fields/i,
  /^\s*status\s*:\s*(?:sent|blocked)\b/i,
  /^\s*(?:completed|claimed(?: and recorded)?) work board task\b/i,
];

/** True when `text` reads as a genuine decision or action a human owner can act
 * on — false for worker/control-plane boilerplate or a bare completion report. */
export function isGenuineHumanAsk(text: string | undefined | null): boolean {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < 8) return false;
  return !NON_HUMAN_ASK_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// ---------------------------------------------------------------------------
// Structured needs-human asks. Agents may follow their `ACTION NEEDED:` section
// with optional sibling labeled lines (same ALL-CAPS-label convention, so the
// ask extractor above naturally stops before them):
//   LINK: https://platform.openai.com/api-keys
//   OPTIONS: Yes | No
//   NEEDS: api-key OPENAI_API_KEY   (or `NEEDS: file` / `NEEDS: text`)
// extractHumanAsk parses those into a shape the Work Board can render as
// one-click controls: link buttons, decision buttons, an API-key input, or an
// attach-a-file hint.

export type HumanAskLink = { url: string; label: string };
export type HumanAskInput = { kind: "api-key" | "file" | "text"; envKey?: string };
export type HumanAsk = {
  ask: string;
  links: HumanAskLink[];
  options: string[];
  inputs?: HumanAskInput[];
  input?: HumanAskInput;
};

const LINK_LINE = /(?:^|\n)\s*LINKS?\s*:\s*(\S[^\n]*)/gi;
const OPTIONS_LINE = /(?:^|\n)\s*OPTIONS\s*:\s*(\S[^\n]*)/i;
const NEEDS_LINE = /(?:^|\n)\s*NEEDS\s*:\s*(api[\s_-]?key|key|secret|token|env|variable|file|text)\b[ \t]*([^\n]*)/gi;
const BARE_URL = /https?:\/\/[^\s"'<>()\[\]]+/g;
// An env-var-shaped name mentioned in prose, e.g. OPENAI_API_KEY or OUTREACH_PHYSICAL_ADDRESS.
const ENV_KEY_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const ENV_KEY_TOKEN_SINGLE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    return path && path !== "/" ? `${host}${path.length > 24 ? `${path.slice(0, 24)}…` : path}` : host;
  } catch {
    return url;
  }
}

function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

function envKeysFromText(value: string) {
  return [...new Set((value.match(ENV_KEY_TOKEN) ?? []).filter((key) => /^[A-Z_][A-Z0-9_]*$/.test(key)))];
}

function addInput(inputs: HumanAskInput[], input: HumanAskInput) {
  const dedupeKey = `${input.kind}:${input.envKey ?? ""}`;
  if (inputs.some((existing) => `${existing.kind}:${existing.envKey ?? ""}` === dedupeKey)) return;
  inputs.push(input);
}

/** Structured, renderable form of a needs-human ask: the human-facing text plus
 * any links, decision options, and expected input the agent declared (or that
 * can be conservatively inferred). Returns null when there is no ask at all. */
export function extractHumanAsk(result: string | undefined | null): HumanAsk | null {
  const text = result?.trim();
  if (!text) return null;
  let ask = extractActionNeeded(text);
  if (!ask) return null;

  const links: HumanAskLink[] = [];
  const seenUrls = new Set<string>();
  const addLink = (rawUrl: string, label?: string) => {
    const url = trimUrl(rawUrl.trim());
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) return;
    seenUrls.add(url);
    links.push({ url, label: label?.trim() || linkLabel(url) });
  };
  for (const match of text.matchAll(LINK_LINE)) {
    // `LINK: <url>` or `LINK: <url> — optional label`
    const value = match[1].trim();
    const url = value.match(BARE_URL)?.[0];
    if (!url) continue;
    const label = value.replace(url, "").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "");
    addLink(url, label || undefined);
  }
  // Bare URLs inside the ask itself become link buttons and leave the prose.
  for (const url of ask.match(BARE_URL) ?? []) addLink(url);
  ask = ask.replace(BARE_URL, "").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:])/g, "$1").trim();

  const optionsRaw = text.match(OPTIONS_LINE)?.[1] ?? "";
  const options = optionsRaw
    .split("|")
    .map((option) => option.trim())
    .filter(Boolean)
    .filter((option, index, all) => all.indexOf(option) === index)
    .slice(0, 6);

  const inputs: HumanAskInput[] = [];
  for (const needs of text.matchAll(NEEDS_LINE)) {
    const kindRaw = needs[1].toLowerCase().replace(/[\s_-]/g, "");
    const kind: HumanAskInput["kind"] = kindRaw === "file" ? "file" : kindRaw === "text" ? "text" : "api-key";
    if (kind === "file" || kind === "text") {
      addInput(inputs, { kind, envKey: undefined });
      continue;
    }
    const envKeys = envKeysFromText(needs[2] ?? "");
    if (envKeys.length) {
      for (const envKey of envKeys) addInput(inputs, { kind: "api-key", envKey });
    } else {
      addInput(inputs, { kind: "api-key", envKey: undefined });
    }
  }
  const askEnvKeys = envKeysFromText(ask);
  if (askEnvKeys.length && (inputs.some((item) => item.kind === "api-key") || /\b(?:shared\s+)?env|API[ _-]?key|token|secret|variable\b/i.test(ask))) {
    for (const envKey of askEnvKeys) addInput(inputs, { kind: "api-key", envKey });
  }
  if (!inputs.length) {
    if (askEnvKeys.length) {
      for (const envKey of askEnvKeys) addInput(inputs, { kind: "api-key", envKey });
    } else if (/\bAPI[ _-]?key\b/i.test(ask)) {
      // Conservative inference: the ask names an API key and may not name a
      // specific env var. Rendering an optional key input is harmless.
      addInput(inputs, { kind: "api-key", envKey: ask.match(ENV_KEY_TOKEN_SINGLE)?.[0] });
    }
  }
  const input = inputs[0];

  return { ask, links, options, inputs: inputs.length ? inputs : undefined, input };
}

// --- Control-plane task briefs ---------------------------------------------
// Queen Bee control-plane dispatches write long machine-shaped task bodies
// (key-value routing lines, "Loop contract"/"Request"/"Routing contract"
// sections, and a `[YYYY-MM-DD] KIND: ...` company-memory digest). Parsed here
// so the UI can lay them out legibly instead of dumping raw prompt text.

export type TaskBriefField = { key: string; value: string };
export type TaskBriefActivity = { date: string; kind: string; text: string };
export type TaskBriefBlock =
  | { kind: "fields"; fields: TaskBriefField[] }
  | { kind: "prose"; text: string }
  | { kind: "activity"; items: TaskBriefActivity[] };
export type TaskBriefSection = { title?: string; blocks: TaskBriefBlock[] };
export type ParsedTaskBrief = { sections: TaskBriefSection[] };

const BRIEF_FIELD_LINE = /^([A-Z][A-Za-z][A-Za-z /&'-]{0,30}):\s+(.+)$/;
const BRIEF_ACTIVITY_LINE = /^\[(\d{4}-\d{2}-\d{2})\]\s+([A-Z][A-Z-]{2,14}):\s*(.+)$/;
const BRIEF_HEADER_LINE = /^(?:#{1,3}\s+)?([A-Z][A-Za-z ]{2,38})$/;

/** Parse a control-plane dispatch brief into ordered sections of key-value
 * fields, prose, and activity-digest items. Returns null for ordinary task
 * bodies (fewer than 3 key-value lines) so hand-written briefs render as-is. */
export function parseTaskBrief(text: string | undefined | null): ParsedTaskBrief | null {
  const raw = text?.trim();
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  if (lines.filter((line) => BRIEF_FIELD_LINE.test(line)).length < 3) return null;

  const sections: TaskBriefSection[] = [];
  let current: TaskBriefSection = { blocks: [] };
  const flush = () => {
    if (current.title || current.blocks.length) sections.push(current);
  };
  const block = <K extends TaskBriefBlock["kind"]>(kind: K): Extract<TaskBriefBlock, { kind: K }> => {
    const last = current.blocks[current.blocks.length - 1];
    if (last?.kind === kind) return last as Extract<TaskBriefBlock, { kind: K }>;
    const created = (kind === "fields"
      ? { kind, fields: [] }
      : kind === "activity"
        ? { kind, items: [] }
        : { kind, text: "" }) as Extract<TaskBriefBlock, { kind: K }>;
    current.blocks.push(created);
    return created;
  };

  for (const line of lines) {
    if (!line) continue;
    if (line === "---") {
      flush();
      current = { blocks: [] };
      continue;
    }
    const activity = line.match(BRIEF_ACTIVITY_LINE);
    if (activity) {
      block("activity").items.push({ date: activity[1], kind: activity[2], text: activity[3] });
      continue;
    }
    if (/^What the company has done recently/i.test(line)) {
      flush();
      current = { title: "Recent company activity", blocks: [] };
      continue;
    }
    const header = line.match(BRIEF_HEADER_LINE);
    if (header) {
      flush();
      current = { title: header[1], blocks: [] };
      continue;
    }
    const field = line.match(BRIEF_FIELD_LINE);
    if (field) {
      block("fields").fields.push({ key: field[1], value: field[2] });
      continue;
    }
    const prose = block("prose");
    prose.text = prose.text ? `${prose.text}\n\n${line}` : line;
  }
  flush();
  return sections.length ? { sections } : null;
}

/** The human-meaning headline of a control-plane brief: the first prose line
 * of its Request section. Used for compact card previews. */
export function taskBriefHeadline(brief: ParsedTaskBrief): string {
  const request = brief.sections.find((section) => section.title?.toLowerCase() === "request");
  const prose = request?.blocks.find((item): item is Extract<TaskBriefBlock, { kind: "prose" }> => item.kind === "prose");
  return prose?.text.split("\n\n")[0] ?? "";
}

// Agent-facing boilerplate inside a brief (routing contracts, "do not repeat
// work", ACTION NEEDED formatting rules). The modal hides these behind a
// "Show technical details" toggle — humans reading a brief want the request
// and the state, not the worker's operating manual.
const GUIDANCE_SECTION_TITLE = /^(?:routing contract|queen bee delegation)$/i;
const GUIDANCE_PROSE = /\b(?:do not repeat work listed|if you are blocked on human input|when it helps the human act faster|complete (?:this|the) (?:scoped )?task and record|record (?:a concrete, durable|the) result on the work board|use shared brain memory|treat existing notes as authoritative|end with a concise result summary|include a final section named exactly|suggested worker class)\b/i;

// Machine-facing dispatch/routing fields — intent fingerprints, worker class,
// target machine, source, and the loop's mode/eval-gate plumbing. These are how
// the control plane routed the task, not what the human needs to understand it,
// so they collapse under the same "technical details" toggle as the guidance
// above. Company identity (Company/Apex goal/Metric/Charter) and the loop's
// Goal/Success criteria stay visible on purpose.
const TECHNICAL_FIELD_KEY = /^(?:source|mode|intent fingerprint|worker class|delegated agent|target machine|eval gates)$/i;

/** True when a brief section is agent operating instructions by title. */
export function isBriefGuidanceSection(section: TaskBriefSection): boolean {
  return Boolean(section.title && GUIDANCE_SECTION_TITLE.test(section.title));
}

/** True when a prose paragraph is agent operating boilerplate. */
export function isBriefGuidanceText(text: string): boolean {
  return GUIDANCE_PROSE.test(text);
}

/** True when a brief field is machine-facing dispatch/routing plumbing rather
 * than something a human owner needs to read. */
export function isBriefTechnicalField(field: TaskBriefField): boolean {
  return TECHNICAL_FIELD_KEY.test(field.key.trim());
}

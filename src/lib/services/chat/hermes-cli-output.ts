import {
  HERMES_CLI_STREAM_EVENT_PREFIX,
  hermesCliFailureSummary,
} from "../../../../scripts/lib/hermes-cli-stream-protocol.mjs";

const HERMES_INLINE_DIFF_HEADER = /^┊\s*review diff$/i;
const INTERNAL_TOOL_NARRATION_MARKERS = [
  /\bsubagent\b/i,
  /\btool (?:list|schema)\b/i,
  /\binvoke_hive_capability\b/i,
  /\bcallable tool\b/i,
  /\bwrit(?:e|ing|ten) (?:the )?files? directly\b/i,
  /\bChat Preview runtime\b/i,
];

/** Replaces an already-persisted private Hermes transport dump with safe UI text. */
export function hermesLeakedTransportFailureNotice(value: string) {
  const text = String(value || "");
  if (!text.includes(HERMES_CLI_STREAM_EVENT_PREFIX)) return "";
  const summary = hermesCliFailureSummary(text);
  return summary
    ? `Hermes could not complete this response. ${summary}`
    : "Hermes did not produce a usable response. Internal runtime output was hidden.";
}

function isHermesInlineDiffLine(line: string) {
  const trimmed = line.trim();
  return /^a\/.+\s+→\s+b\/.+$/.test(trimmed)
    || /^@@\s/.test(trimmed)
    || /^[ +-]/.test(line)
    || /^\\ No newline at end of file$/.test(trimmed);
}

/** Removes Hermes CLI file-edit previews, which are tool progress rather than assistant prose. */
export function stripHermesInlineDiffPreviews(value: string) {
  const output: string[] = [];
  let insideDiffPreview = false;
  for (const line of String(value || "").replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (HERMES_INLINE_DIFF_HEADER.test(trimmed)) {
      insideDiffPreview = true;
      continue;
    }
    if (!insideDiffPreview) {
      output.push(line);
      continue;
    }
    if (/^… omitted \d+ diff line\(s\)/i.test(trimmed)) {
      insideDiffPreview = false;
      continue;
    }
    if (isHermesInlineDiffLine(line)) continue;
    if (!trimmed) {
      insideDiffPreview = false;
      continue;
    }
    insideDiffPreview = false;
    output.push(line);
  }
  return output.join("\n").replace(/^\n+|\n+$/g, "");
}

function looksLikeLeadingInternalToolNarration(paragraph: string) {
  const markerCount = INTERNAL_TOOL_NARRATION_MARKERS.filter((pattern) => pattern.test(paragraph)).length;
  return markerCount >= 3;
}

/** Removes Hermes transport/tool-scope narration that is not part of the user-facing result. */
export function stripHermesInternalToolNarration(value: string) {
  let text = String(value || "").replace(/\r\n/g, "\n").trim();
  const paragraphEnd = text.indexOf("\n\n");
  if (paragraphEnd >= 0) {
    const firstParagraph = text.slice(0, paragraphEnd).trim();
    const remainder = text.slice(paragraphEnd + 2).trimStart();
    if (
      looksLikeLeadingInternalToolNarration(firstParagraph)
      && /\b(?:complete|completed|verified|built|finished|done|summary)\b/i.test(remainder.slice(0, 240))
    ) {
      text = remainder;
    }
  }
  return text
    .split("\n")
    .filter((line) => !(
      /^\s*[-*]\s+/.test(line)
      && /\binvoke_hive_capability\b/i.test(line)
      && /\b(?:not exposed|callable tool|wrote|written|directly)\b/i.test(line)
    ))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isAssistantColonSectionHeading(line: string, nextLine: string) {
  const trimmed = line.trim();
  const next = nextLine.trim();
  if (!trimmed.endsWith(":")) return false;
  if (!/^[-*]\s+|^\d+[.)]\s+/.test(next)) return false;
  const label = trimmed.slice(0, -1).trim();
  if (!label || label.length > 88 || label.split(/\s+/).length > 13) return false;
  return !/^(?:Location|Path|URL|Status|Time|Model|Provider|Note):?$/i.test(label);
}

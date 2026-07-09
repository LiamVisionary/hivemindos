// The `/transcript <x-link>` command renders a sophisticated transcript card in
// the chat thread. Like the MiroShark / JSON-render cards, the card lives inside
// the assistant message *content* (a fenced `hive-transcript` block) rather than
// a structured ChatMessage field — so it persists and rehydrates for free with
// no changes to chat storage or the message type. The agent's short summary +
// follow-up question is the plain text that follows the block.

export type ChatTranscriptCardStatus = "running" | "ready" | "error";
export type ChatTranscriptKind = "video" | "thread" | "single";

export type ChatTranscriptCard = {
  id: string;
  status: ChatTranscriptCardStatus;
  url: string;
  canonicalUrl?: string;
  kind?: ChatTranscriptKind;
  author?: { handle?: string; name?: string };
  title?: string;
  transcript?: string;
  durationSec?: number;
  postCount?: number;
  source?: string;
  error?: string;
  warnings?: string[];
};

const TRANSCRIPT_MARKER_PREFIX = "<!--hive-transcript:";
// The payload is percent-encoded JSON inside an HTML comment. encodeURIComponent
// output can never contain ">" (every ">" becomes %3E), a backtick, or a raw
// newline — so the closing "-->" is unambiguous even when the transcript itself
// contains code fences, and the marker is invisible if ever rendered raw. It is
// also UTF-8 safe (emoji / non-English transcripts) unlike btoa.
const TRANSCRIPT_MARKER_RE = /<!--hive-transcript:([^>]*?)-->/;

export function buildTranscriptCardContent(card: ChatTranscriptCard, trailingText?: string): string {
  const block = `${TRANSCRIPT_MARKER_PREFIX}${encodeURIComponent(JSON.stringify(card))}-->`;
  const trailing = (trailingText ?? "").trim();
  return trailing ? `${block}\n\n${trailing}` : block;
}

function coerceCard(raw: unknown): ChatTranscriptCard | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  const status = record.status === "ready" || record.status === "error" ? record.status : "running";
  const kind = record.kind === "video" || record.kind === "thread" || record.kind === "single" ? record.kind : undefined;
  const author = record.author && typeof record.author === "object"
    ? {
        handle: typeof (record.author as Record<string, unknown>).handle === "string" ? (record.author as Record<string, string>).handle : undefined,
        name: typeof (record.author as Record<string, unknown>).name === "string" ? (record.author as Record<string, string>).name : undefined,
      }
    : undefined;
  return {
    id: record.id,
    status,
    url: typeof record.url === "string" ? record.url : "",
    canonicalUrl: typeof record.canonicalUrl === "string" ? record.canonicalUrl : undefined,
    kind,
    author,
    title: typeof record.title === "string" ? record.title : undefined,
    transcript: typeof record.transcript === "string" ? record.transcript : undefined,
    durationSec: typeof record.durationSec === "number" ? record.durationSec : undefined,
    postCount: typeof record.postCount === "number" ? record.postCount : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : undefined,
  };
}

/** Split an assistant message into its transcript card + the trailing prose (the summary). */
export function extractTranscriptCard(content: string): { card: ChatTranscriptCard; remainingText: string } | null {
  if (!content || !content.includes(TRANSCRIPT_MARKER_PREFIX)) return null;
  const match = content.match(TRANSCRIPT_MARKER_RE);
  if (!match || match.index === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
  const card = coerceCard(parsed);
  if (!card) return null;
  const remainingText = `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`.trim();
  return { card, remainingText };
}

// Deliverable extraction for kanban task results: turn free-form agent output
// (result text, completion blocks) into structured KanbanDeliverable rows by
// scanning for absolute file paths and http(s) URLs, then classifying each one.
//
// Split out of local-kanban-store.ts as a pure helper module — it has no
// back-references into the store. Everything here is one-way: the store imports
// these, nothing here imports the store. Deliverable *merging* (mergeDeliverables,
// sourceDeliverableKeys) intentionally stays in the store because it depends on
// store-local normalization and visual-handoff logic.

import { existsSync, statSync } from "fs";
import { isAbsolute } from "path";
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";
import type {
  KanbanDeliverable,
  KanbanDeliverableKind,
} from "@/lib/types/kanban";

export function simpleStableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function deliverableId(target: string) {
  return `d_${simpleStableHash(target)}`;
}

export function normalizeDeliverableKind(
  kind?: string,
  path?: string,
  url?: string,
): KanbanDeliverableKind {
  if (
    kind &&
    [
      "website",
      "video",
      "image",
      "audio",
      "document",
      "directory",
      "file",
      "url",
    ].includes(kind)
  ) {
    return kind as KanbanDeliverableKind;
  }
  if (url && !url.startsWith("file:")) return "url";
  if (path && existsSync(path)) {
    try {
      if (statSync(path).isDirectory()) return "directory";
    } catch {
      // Fall through to extension-based detection.
    }
  }
  const target = (path || url || "").toLowerCase().split(/[?#]/)[0];
  if (/\.(?:html?)$/.test(target)) return "website";
  if (/\.(?:mp4|mov|m4v|webm|avi|mkv)$/.test(target)) return "video";
  if (/\.(?:png|jpe?g|gif|webp|svg|avif)$/.test(target)) return "image";
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/.test(target)) return "audio";
  if (/\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|md)$/.test(target)) return "document";
  return path ? "file" : "url";
}

export function deliverableLabel(target: string, kind: KanbanDeliverableKind) {
  const clean = target
    .replace(/^file:\/\//, "")
    .split(/[?#]/)[0]
    .replace(/\/+$/, "");
  return clean.split(/[\\/]/).filter(Boolean).at(-1) || kind;
}

// A real artifact path, not a route pattern or endpoint description. Agents
// describe API surfaces with paths like `/preview/:slug`, `/paid and /api/...`,
// `/book?lead=` — those are absolute-looking but are not files on disk, so they
// 404 when opened. Require a clean path with a real fs root or a file extension.
function looksLikeArtifactFilePath(path: string): boolean {
  // NB: whitespace is allowed — real vault/macOS paths contain spaces
  // ("Brain Services", "Queen Bee", "Work Board"). Only query/glob/template/param
  // syntax signals a route rather than a file.
  if (/[?*<>{}]/.test(path)) return false; // query / glob / template → route or prose
  if (/\/:[A-Za-z_]/.test(path)) return false; // `/:slug` style route params
  const hasRealRoot = /^\/(?:Users|home|root|var|tmp|private|opt|mnt|Volumes)\//.test(path);
  const hasFileExt = /\.[A-Za-z0-9]{1,8}$/.test(path.split("/").pop() ?? "");
  return hasRealRoot || hasFileExt;
}

function deliverableFromTarget(
  target: string,
  label?: string,
  createdAt = Date.now(),
): KanbanDeliverable | null {
  const trimmed = target
    .trim()
    .replace(/[),.;:}\]]+$/, "")
    .replace(/`+$/, "");
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    if (/^https?:\/\/(?:www\.)?w3\.org\/2000\/svg\b/i.test(trimmed))
      return null;
    if (isReservedOrMockUrl(trimmed)) return null;
    const kind = normalizeDeliverableKind(undefined, undefined, trimmed);
    return {
      id: deliverableId(trimmed),
      label: label?.trim() || deliverableLabel(trimmed, kind),
      kind,
      url: trimmed,
      createdAt,
    };
  }
  const fileUrl = trimmed.match(/^file:\/\/(.+)/i)?.[1];
  const path = decodeURIComponent(fileUrl || trimmed);
  if (!isAbsolute(path)) return null;
  if (!looksLikeArtifactFilePath(path)) return null;
  const kind = normalizeDeliverableKind(undefined, path);
  return {
    id: deliverableId(path),
    label: label?.trim() || deliverableLabel(path, kind),
    kind,
    path,
    exists: existsSync(path),
    createdAt,
  };
}

export function extractKanbanDeliverables(
  text: string,
  createdAt = Date.now(),
): KanbanDeliverable[] {
  const deliverables = new Map<string, KanbanDeliverable>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const labeled = line.match(
      /^\s*(?:[-*]\s*)?([^:\n]{3,80}?)\s*:\s*(file:\/\/\/[^\s]+|https?:\/\/[^\s]+|\/[^\s"'<>]+(?:\s+[^\s"'<>]+)*?)(?:\s*)$/i,
    );
    if (labeled) {
      const item = deliverableFromTarget(labeled[2], labeled[1], createdAt);
      if (item) deliverables.set(item.path || item.url || item.id, item);
    }
  }
  const targetPattern =
    /(?:file:\/\/\/[^\s"'<>]+|https?:\/\/[^\s"'<>]+|\/(?:Users|Volumes|tmp|var|private|home|opt)\/[^\s"'<>]+(?:\s[^\s"'<>]+)*?(?=\s{2,}|\n|$|[),.;]))/gi;
  for (const match of text.matchAll(targetPattern)) {
    const item = deliverableFromTarget(match[0], undefined, createdAt);
    if (item) deliverables.set(item.path || item.url || item.id, item);
  }
  return [...deliverables.values()].slice(0, 24);
}

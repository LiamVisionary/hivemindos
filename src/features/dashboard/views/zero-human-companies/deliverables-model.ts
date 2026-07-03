// Human-facing deliverable model for Zero Human Companies. Pure + React-free so
// it is hermetically testable. Agents emit a lot of raw, engineer-flavored
// "deliverables" — command strings, route patterns, internal scratch JSON,
// fabricated example URLs, brain-memory notes. This module turns that firehose
// into something an operator can read at a glance: it hides the junk, dedupes,
// and buckets the rest into Links / Reports / Data / Media / (collapsed) Working
// files, each with a human label, a file-type icon key, and a clear action.
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";
import type { IssueDeliverable } from "./types";

export type DeliverableCategory = "link" | "report" | "data" | "media" | "internal";
/** Icon key the UI maps to a skeuomorphic file-type glyph. */
export type DeliverableIcon = "site" | "payment" | "booking" | "status" | "link" | "doc" | "sheet" | "data" | "image" | "video" | "cog";
export type DeliverableAction = "visit" | "open" | "download" | "none";

export interface ClassifiedDeliverable {
  deliverable: IssueDeliverable;
  category: DeliverableCategory;
  icon: DeliverableIcon;
  /** Short human noun for what this is, e.g. "Preview site", "Report", "Spreadsheet". */
  kindLabel: string;
  /** Cleaned, human-readable title (task-hash suffixes / timestamps stripped). */
  title: string;
  /** How to open it. */
  action: DeliverableAction;
  /** Reachable web URL (for action "visit"). */
  url?: string;
  /** True for a per-lead/customer-facing preview a human would want to review before it goes out. */
  reviewable?: boolean;
  /** Why it was bucketed internal (for the collapsed group's tooltip). */
  internalReason?: string;
}

// ── low-level target helpers (shared with the React components) ────────────

/** A directly-openable web URL, or null for a file path / non-URL. */
export function deliverableHref(d: IssueDeliverable): string | null {
  if (d.url) return d.url;
  const path = d.path?.trim() ?? "";
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`; // schemeless extractor artifact
  return null;
}

/** Route that resolves a (possibly cross-machine) file path to the local synced copy. */
export function deliverableFileHref(d: IssueDeliverable, opts: { download?: boolean } = {}): string {
  const params = new URLSearchParams({ path: d.path ?? "" });
  if (opts.download) params.set("download", "1");
  return `/api/fleet/read-file?${params.toString()}`;
}

/**
 * Can /api/fleet/read-file actually resolve + serve this path? The load-bearing
 * discriminator is that the WHOLE trimmed path must END in a file extension:
 *  - real files end in `.md`/`.json`/… → openable (dir names with spaces like
 *    "Brain Services"/"Work Board" are fine — the extension is what matters);
 *  - command strings (`hivemind_bridge.py --resolve esc approve`) end in a word;
 *  - truncated/route paths (`/scripts/orchestrate`, `/preview/:slug`) have no ext.
 * Plus route-syntax markers (`?`, `*`, `<>`, `{}`, `/:param`) are never files.
 */
function isOpenableFilePath(path: string): boolean {
  if (/[?*<>{}]/.test(path) || /\/:[A-Za-z_]/.test(path)) return false;
  if (!/\.[A-Za-z0-9]{1,8}$/.test(path)) return false; // must END in an extension
  const underRealRoot = /^\/(?:Users|home|root|var|tmp|private|opt|mnt|Volumes)\//.test(path);
  return underRealRoot || path.includes("hivemindos-vault");
}

/** url = real web link · file = openable file · placeholder = fabricated/route/command/unopenable. */
export function deliverableOpenKind(d: IssueDeliverable): "url" | "file" | "placeholder" {
  const href = deliverableHref(d);
  // Reserved / example.* / non-public / mock-marker hrefs are placeholders, not
  // live links (shared strict helper — now also hides `*.example.com` subdomains
  // and private/loopback hosts the old apex-only check let through).
  if (href) return isReservedOrMockUrl(href) ? "placeholder" : "url";
  const path = d.path?.trim();
  if (!path) return "placeholder";
  return isOpenableFilePath(path) ? "file" : "placeholder";
}

export function isFileDeliverable(d: IssueDeliverable): boolean {
  return deliverableOpenKind(d) === "file";
}

// ── classification ─────────────────────────────────────────────────────────

function fileExt(path: string): string {
  const name = path.split(/[?#]/)[0].split(/[\\/]/).pop() ?? "";
  return name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase() ?? "";
}

/** Strip task-hash suffixes, ISO date prefixes, and extensions; humanize separators. */
function humanizeLabel(raw: string, fallback: string): string {
  let s = (raw || "").trim();
  if (!s) return fallback;
  s = s.split(/[\\/]/).pop() ?? s; // filename only
  s = s.replace(/\.[A-Za-z0-9]{1,8}$/, ""); // drop extension
  s = s.replace(/[-_]?t_[a-z0-9]{6,}.*$/i, ""); // drop `-t_mr397...` task-hash tails
  s = s.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, ""); // drop leading ISO date
  s = s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return fallback;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function linkKind(url: string): { icon: DeliverableIcon; kindLabel: string; reviewable: boolean } {
  const u = url.toLowerCase();
  if (/\/preview\//.test(u)) return { icon: "site", kindLabel: "Preview site", reviewable: true };
  if (/\/(?:paid|checkout|pay)\b/.test(u) || /buy\.stripe\.com/.test(u)) return { icon: "payment", kindLabel: "Payment page", reviewable: false };
  if (/cal\.com/.test(u) || /\/book\b/.test(u)) return { icon: "booking", kindLabel: "Booking link", reviewable: false };
  if (/\/(?:ops|status|health|metrics)\b/.test(u)) return { icon: "status", kindLabel: "Ops status", reviewable: false };
  return { icon: "link", kindLabel: "Live link", reviewable: false };
}

function internal(d: IssueDeliverable, reason: string): ClassifiedDeliverable {
  return { deliverable: d, category: "internal", icon: "cog", kindLabel: "Working file", title: humanizeLabel(d.label ?? "", d.kind || "file"), action: "none", internalReason: reason };
}

const JUNK_LABEL = /^(?:https?|www|[A-Z][A-Z0-9_]*=.*)$/;

export function classifyDeliverable(d: IssueDeliverable): ClassifiedDeliverable {
  const label = (d.label ?? "").trim();
  if (JUNK_LABEL.test(label)) return internal(d, "extraction fragment");

  const openKind = deliverableOpenKind(d);
  if (openKind === "placeholder") {
    const isCmd = /[\s]/.test(d.path ?? "") && /--|\bpython3?\b|\bnode\b|\.py\b/.test(d.path ?? "");
    return internal(d, isCmd ? "command, not a file" : deliverableHref(d) ? "placeholder link" : "route pattern");
  }

  if (openKind === "url") {
    const url = deliverableHref(d)!;
    // A third-party API-docs / reference page is something an agent READ, not a
    // company output — agents leak these when they hit an error (e.g. a rate-limit
    // 429 referencing the provider's rate-limiting docs). Not a deliverable.
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* keep */ }
    const path = url.toLowerCase();
    if (host.startsWith("docs.") || /\/api-reference\/|\/rate-limit/.test(path)) {
      return internal(d, "third-party reference doc");
    }
    const { icon, kindLabel, reviewable } = linkKind(url);
    const leadMatch = url.match(/\/preview\/([^/?#]+)/i);
    const title = leadMatch ? `Preview — ${leadMatch[1].replace(/[-_]+/g, " ")}` : humanizeLabel(label, kindLabel);
    return { deliverable: d, category: "link", icon, kindLabel, title, action: "visit", url, reviewable };
  }

  // file
  const path = d.path ?? "";
  const ext = fileExt(path);
  if (!ext) return internal(d, "no file extension"); // truncated/route-like paths (orchestrate, escalations)
  if (/\/Memory\/Distillations\//i.test(path) || /\blearning note\b/i.test(label)) return internal(d, "brain memory note");

  const title = humanizeLabel(label || path, d.kind || "file");
  if (["md", "markdown", "txt", "pdf", "rtf"].includes(ext)) return { deliverable: d, category: "report", icon: "doc", kindLabel: "Report", title, action: "open" };
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return { deliverable: d, category: "data", icon: "sheet", kindLabel: "Spreadsheet", title, action: "open" };
  if (["json", "jsonl", "ndjson", "xml", "yaml", "yml"].includes(ext)) return { deliverable: d, category: "data", icon: "data", kindLabel: "Data file", title, action: "open" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)) return { deliverable: d, category: "media", icon: "image", kindLabel: "Image", title, action: "open" };
  if (["mp4", "webm", "mov", "mp3", "wav"].includes(ext)) return { deliverable: d, category: "media", icon: "video", kindLabel: "Media", title, action: "open" };
  return { deliverable: d, category: "data", icon: "data", kindLabel: "File", title, action: "download" };
}

/** Dedupe by resolved target, preferring the classified (non-internal) copy. */
export function dedupeClassified(items: ClassifiedDeliverable[]): ClassifiedDeliverable[] {
  const byKey = new Map<string, ClassifiedDeliverable>();
  for (const item of items) {
    const d = item.deliverable;
    const key = (deliverableHref(d) || d.path || d.label || d.id || "").replace(/\/+$/, "").toLowerCase();
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, item); continue; }
    // Prefer a non-internal classification over an internal one for the same target.
    if (existing.category === "internal" && item.category !== "internal") byKey.set(key, item);
  }
  return [...byKey.values()];
}

const CATEGORY_ORDER: DeliverableCategory[] = ["link", "report", "data", "media", "internal"];

export interface DeliverableBuckets {
  visible: ClassifiedDeliverable[];   // links, reports, data, media (in that order)
  internal: ClassifiedDeliverable[];  // collapsed working files / hidden junk
  reviewable: ClassifiedDeliverable[]; // customer-facing previews worth a human look
}

/** Classify + dedupe a flat deliverable list into display buckets. */
export function bucketDeliverables(deliverables: IssueDeliverable[]): DeliverableBuckets {
  const classified = dedupeClassified(deliverables.map(classifyDeliverable));
  classified.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));
  return {
    visible: classified.filter((c) => c.category !== "internal"),
    internal: classified.filter((c) => c.category === "internal"),
    reviewable: classified.filter((c) => c.reviewable),
  };
}

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hiveEnvValue } from "@/lib/services/shared-hive-env";
import { readProjectRegistry } from "@/lib/services/projects/project-registry";
import type { CompanyEmailThread, CompanyMailbox, MailReaderContext, MailReaderResult } from "@/lib/services/agent-mailboxes";

// ── Outreach Engine (maps-agency outbox) mail provider ───────────────────────
// A company's deterministic operations engine (its domain code repo, e.g.
// maps-agency) runs the real outreach pipeline and appends every generated/sent
// message to state/messages/outbox.jsonl. THAT log — not any AgentMail
// inbox keyed to the crew's agent ids — is the source of truth for what the
// company actually sent and what's queued. The engine sends from a shared inbox
// (e.g. liamvisionary@agentmail.to) whose AgentMail client_id isn't one of the
// crew's, so the agentmail provider can't see these; we read the outbox directly
// and hydrate delivered rows from that shared AgentMail inbox so the Emails tab
// reflects both the real campaign and live replies. Registered as a provider in
// agent-mailboxes.ts (one entry + this reader); the API route and UI are generic.
//
// Scoping: the outbox lives INSIDE this company's own engine repo, so its rows are
// this company's outreach. We keep a row if its company_id matches this company OR
// is unset (the field is only partially stamped today), and drop rows explicitly
// stamped for a different company. Read-only, local file, bounded work.

const OUTREACH_ENGINE_LABEL = "Outreach Engine";
const MAPS_AGENCY_OUTBOX_RELATIVES = [
  join("state", "messages", "outbox.jsonl"),
  // Compatibility fallback for older installs whose raw outbox is absent.
  join("state", "messages", "outbox.tracked.jsonl"),
];
const OUTREACH_OUTBOX_MAX_LINES = 5000; // bound parse work on a large append log
const OUTREACH_OUTBOX_MAX_THREADS = 150; // bound threads emitted to the UI
const OUTREACH_AGENTMAIL_SYNC_LIMIT = 50; // bound live per-thread reply probes
const DEFAULT_AGENTMAIL_API_BASE_URL = "https://api.agentmail.to";

type OutboxRow = {
  message_id?: string;
  thread_id?: string;
  lead_id?: string;
  company_id?: string;
  to?: string;
  inbox?: string;
  subject?: string;
  body?: string;
  business_name?: string;
  status?: string;
  provider?: string;
  external_send?: boolean;
  send_blockers?: unknown;
  sent_at?: string;
  generated_at?: string;
  triggered_at?: string;
  scheduled_for?: string;
  attachments?: unknown;
};

type AgentMailOutreachMessage = {
  message_id?: string;
  timestamp?: string;
  created_at?: string;
  updated_at?: string;
  from?: unknown;
  to?: unknown;
  preview?: string;
  text?: string;
  extracted_text?: string;
};

type AgentMailOutreachThread = {
  thread_id?: string;
  subject?: string;
  preview?: string;
  senders?: unknown;
  recipients?: unknown;
  labels?: unknown;
  sent_timestamp?: string;
  received_timestamp?: string;
  timestamp?: string;
  updated_at?: string;
  created_at?: string;
  message_count?: number;
  messages?: AgentMailOutreachMessage[];
};

type AgentMailReplySync = {
  attempted: number;
  failures: number;
  byThreadId: Map<string, AgentMailOutreachThread>;
};

async function resolveMapsAgencyOutboxPath(ctx: MailReaderContext): Promise<string | undefined> {
  const override = (await hiveEnvValue("MAPS_AGENCY_OUTBOX_PATH"))?.trim();
  if (override) return override;
  let localPath: string | undefined;
  try {
    const registry = await readProjectRegistry();
    const byId = ctx.projectId ? registry.projects.find((project) => project.id === ctx.projectId) : undefined;
    const byName = registry.projects.find((project) => project.name.trim().toLowerCase() === "maps-agency");
    localPath = byId?.localPath || byName?.localPath;
  } catch {
    localPath = undefined;
  }
  if (!localPath) return undefined;
  for (const relative of MAPS_AGENCY_OUTBOX_RELATIVES) {
    const candidate = join(localPath, relative);
    if (existsSync(candidate)) return candidate;
  }
  return join(localPath, MAPS_AGENCY_OUTBOX_RELATIVES[0]);
}

type ScopedOutbox = { found: boolean; owned: boolean; rows: OutboxRow[] };

/**
 * Read the company's engine outbox and scope it to that company. Ownership guard:
 * the outbox is only treated as this company's if at least one row is stamped with
 * its company_id — so a different, project-unlinked company that resolves the same
 * shared engine repo by name doesn't inherit these rows. When owned, unstamped rows
 * (the field is only partially populated) are included; rows stamped for another
 * company are always excluded.
 */
async function readScopedOutboxRows(ctx: MailReaderContext): Promise<ScopedOutbox> {
  const outboxPath = await resolveMapsAgencyOutboxPath(ctx);
  if (!outboxPath || !existsSync(outboxPath)) return { found: false, owned: false, rows: [] };
  let raw: string;
  try {
    raw = await readFile(outboxPath, "utf8");
  } catch {
    return { found: false, owned: false, rows: [] };
  }
  const all: OutboxRow[] = [];
  for (const line of raw.split("\n").slice(0, OUTREACH_OUTBOX_MAX_LINES)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      all.push(JSON.parse(trimmed) as OutboxRow);
    } catch {
      // skip a malformed line rather than sink the whole reader
    }
  }
  const owned = all.some((row) => typeof row.company_id === "string" && row.company_id.trim() === ctx.companyId);
  if (!owned) return { found: true, owned: false, rows: [] };
  const rows = all.filter((row) => {
    const rowCompany = typeof row.company_id === "string" ? row.company_id.trim() : "";
    return !rowCompany || rowCompany === ctx.companyId;
  });
  return { found: true, owned: true, rows };
}

export async function readMapsAgencyOutboxForCompany(ctx: MailReaderContext): Promise<MailReaderResult> {
  if (!ctx.companyId) return { connected: false, mailboxes: [], threads: [] };
  const scoped = await readScopedOutboxRows(ctx);
  if (!scoped.found) {
    return { connected: false, mailboxes: [], threads: [], note: "Outreach engine outbox isn't on this machine." };
  }
  if (!scoped.owned) {
    // The resolved outbox isn't this company's (e.g. a different, project-unlinked
    // company resolved the shared engine repo by name) — attribute it no mail.
    return { connected: false, mailboxes: [], threads: [] };
  }
  const rows = scoped.rows;
  if (rows.length === 0) {
    return { connected: true, mailboxes: [], threads: [], note: "No outreach recorded for this company yet." };
  }

  const senderAddress = mostCommonInbox(rows) || (await hiveEnvValue("AGENTMAIL_INBOX"))?.trim() || "outreach inbox";
  const replySync = await readAgentMailOutreachThreads(rows, senderAddress);

  // Collapse a lead's multiple touches (initial + follow-ups) into one thread.
  const groups = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const key = (row.lead_id || row.to || row.business_name || row.message_id || "").trim() || `row-${groups.size}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  let delivered = 0;
  let queued = 0;
  let replied = 0;
  const blockerCounts = new Map<string, number>();
  const threads: CompanyEmailThread[] = [];
  for (const [key, list] of groups) {
    const sorted = list.slice().sort((left, right) => outboxRowTime(right) - outboxRowTime(left));
    const latest = sorted[0];
    const sentRow = sorted.find(isDeliveredOutboxRow);
    const isDelivered = Boolean(sentRow);
    const sentAt = sentRow ? outboxRowTime(sentRow) : 0;
    const liveThread = sorted
      .map((row) => (row.thread_id || "").trim())
      .filter(Boolean)
      .map((threadId) => replySync.byThreadId.get(threadId))
      .find(Boolean);
    const latestInbound = liveThread ? latestInboundMessage(liveThread, senderAddress) : undefined;
    const hasReply = Boolean(latestInbound || liveThread?.received_timestamp);
    if (isDelivered) delivered += 1;
    else queued += 1;
    if (hasReply) replied += 1;
    const blocker = isDelivered ? "" : summarizeBlocker(latest.send_blockers);
    if (!isDelivered && blocker) blockerCounts.set(blocker, (blockerCounts.get(blocker) || 0) + 1);
    const providerCorrespondents = liveThread ? agentMailCorrespondents(liveThread, senderAddress) : [];
    const correspondent = (latest.business_name || latest.to || "").trim();
    const outboundSnippet = compactPreview(latest.body);
    const replySnippet = latestInbound ? compactPreview(agentMailMessageBody(latestInbound)) : "";
    const snippet = replySnippet || compactPreview(liveThread?.preview) || outboundSnippet;
    const updatedAt = Math.max(outboxRowTime(latest), agentMailThreadTime(liveThread));
    const body = hasReply
      ? `Latest reply:\n${replySnippet || compactPreview(liveThread?.preview) || "Reply received."}\n\nOriginal outreach:\n${(latest.body || "").slice(0, 10000)}`
      : (latest.body || "").slice(0, 12000);
    threads.push({
      id: `maps-agency-outbox:${ctx.companyId}:${key}`,
      provider: "maps-agency-outbox",
      providerLabel: OUTREACH_ENGINE_LABEL,
      inboxAddress: (sentRow?.inbox || latest.inbox || senderAddress).trim(),
      threadId: (liveThread?.thread_id || sentRow?.thread_id || latest.thread_id || key).trim(),
      subject: (liveThread?.subject || latest.subject || "").trim() || "(no subject)",
      preview: isDelivered ? snippet : `Queued — ${blocker || latest.status || "not sent"}${snippet ? ` · ${snippet}` : ""}`,
      correspondents: providerCorrespondents.length > 0 ? providerCorrespondents : correspondent ? [correspondent] : [],
      direction: isDelivered ? (hasReply ? "mixed" : "outbound") : "queued",
      messageCount: Math.max(list.length, Math.round(Number(liveThread?.message_count) || 0)),
      // Outreach emails carry no real file attachments — the outbox "attachments"
      // field holds CTA/booking/preview links, surfaced as openable links instead.
      attachmentCount: 0,
      body,
      links: extractOutboxLinks(latest),
      attachments: [],
      updatedAt,
      ...(sentAt ? { sentAt } : {}),
      labels: isDelivered
        ? hasReply ? ["delivered", "reply received"] : ["delivered"]
        : blocker ? ["queued", blocker] : ["queued"],
    });
  }
  threads.sort((left, right) => right.updatedAt - left.updatedAt);

  const mailboxes: CompanyMailbox[] = [
    {
      provider: "maps-agency-outbox",
      providerLabel: OUTREACH_ENGINE_LABEL,
      address: senderAddress,
      status: "ready",
      threadCount: 0,
    },
  ];
  const topBlocker = [...blockerCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  const syncNote = replySync.failures > 0 ? ` · ${replySync.failures}/${replySync.attempted} reply checks unavailable` : "";
  const note = `${delivered} sent · ${replied} replied · ${queued} queued${topBlocker ? ` (${topBlocker[1]} ${topBlocker[0]})` : ""}${syncNote}`;
  return { connected: true, mailboxes, threads: threads.slice(0, OUTREACH_OUTBOX_MAX_THREADS), note };
}

async function readAgentMailOutreachThreads(rows: OutboxRow[], inboxAddress: string): Promise<AgentMailReplySync> {
  const threadIds = [...new Set(rows
    .filter(isDeliveredOutboxRow)
    .map((row) => (row.thread_id || "").trim())
    .filter(Boolean))]
    .slice(0, OUTREACH_AGENTMAIL_SYNC_LIMIT);
  if (threadIds.length === 0) return { attempted: 0, failures: 0, byThreadId: new Map() };

  const token = (await hiveEnvValue("AGENTMAIL_API_KEY"))?.trim();
  if (!token) return { attempted: 0, failures: 0, byThreadId: new Map() };
  const configuredBase = (await hiveEnvValue("AGENTMAIL_API_BASE_URL"))
    || (await hiveEnvValue("AGENTMAIL_API_URL"))
    || DEFAULT_AGENTMAIL_API_BASE_URL;
  let apiBaseUrl: string;
  try {
    const parsed = new URL(configuredBase);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid AgentMail URL");
    parsed.pathname = parsed.pathname.replace(/\/$/, "");
    apiBaseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    return { attempted: threadIds.length, failures: threadIds.length, byThreadId: new Map() };
  }

  const entries = await Promise.all(threadIds.map(async (threadId) => {
    try {
      const response = await fetch(
        `${apiBaseUrl}/v0/inboxes/${encodeURIComponent(inboxAddress)}/threads/${encodeURIComponent(threadId)}`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(6_000),
        },
      );
      if (!response.ok) return undefined;
      const thread = await response.json() as AgentMailOutreachThread;
      return thread.thread_id ? [threadId, thread] as const : undefined;
    } catch {
      return undefined;
    }
  }));
  const byThreadId = new Map(entries.filter((entry): entry is readonly [string, AgentMailOutreachThread] => Boolean(entry)));
  return { attempted: threadIds.length, failures: threadIds.length - byThreadId.size, byThreadId };
}

function isDeliveredOutboxRow(row: OutboxRow): boolean {
  if (row.status !== "delivered") return false;
  // Current senders stamp external_send explicitly. Historical AgentMail rows
  // predate that field but carry provider + real message/thread receipts; keep
  // them visible as sent without ever treating fixture rows as customer mail.
  return row.external_send === true
    || (row.provider === "agentmail" && Boolean(row.message_id) && Boolean(row.thread_id));
}

function latestInboundMessage(thread: AgentMailOutreachThread, inboxAddress: string): AgentMailOutreachMessage | undefined {
  const self = inboxAddress.trim().toLowerCase();
  return (thread.messages ?? [])
    .filter((message) => !agentMailAddresses(message.from).some((address) => address.toLowerCase().includes(self)))
    .sort((left, right) => agentMailMessageTime(right) - agentMailMessageTime(left))[0];
}

function agentMailMessageBody(message: AgentMailOutreachMessage): string {
  return String(message.text || message.extracted_text || message.preview || "");
}

function agentMailCorrespondents(thread: AgentMailOutreachThread, inboxAddress: string): string[] {
  const self = inboxAddress.trim().toLowerCase();
  return [...new Set([
    ...agentMailAddresses(thread.senders),
    ...agentMailAddresses(thread.recipients),
  ].filter((address) => !self || !address.toLowerCase().includes(self)))];
}

function agentMailAddresses(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(agentMailAddresses);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate = record.email || record.address || record.name;
    return typeof candidate === "string" && candidate.trim() ? [candidate.trim()] : [];
  }
  return [];
}

function agentMailThreadTime(thread: AgentMailOutreachThread | undefined): number {
  if (!thread) return 0;
  return parseOutboxTimeMs(thread.updated_at)
    || parseOutboxTimeMs(thread.timestamp)
    || parseOutboxTimeMs(thread.received_timestamp)
    || parseOutboxTimeMs(thread.sent_timestamp)
    || parseOutboxTimeMs(thread.created_at);
}

function agentMailMessageTime(message: AgentMailOutreachMessage): number {
  return parseOutboxTimeMs(message.updated_at)
    || parseOutboxTimeMs(message.timestamp)
    || parseOutboxTimeMs(message.created_at);
}

// The engine writes send-blocker strings like "OUTREACH_PHYSICAL_ADDRESS is not
// configured, so CAN-SPAM …". This captures the env-key name it names as missing.
const ENV_KEY_NOT_SET = /\b([A-Z][A-Z0-9_]{3,})\b\s+is not (?:configured|set)/g;

/**
 * Distinct shared-env key names the company's outreach engine reports as "not
 * configured/set" in its outbox send-blockers — the raw signal for surfacing a
 * setup issue. Presence is NOT checked here (the caller filters to keys still
 * absent, so a since-set key self-resolves). Empty when the engine isn't on this
 * machine or nothing is blocked. Scoped to this company (or unstamped rows).
 */
export async function readMapsAgencyOutboxSendBlockerKeys(ctx: { companyId: string; projectId?: string }): Promise<string[]> {
  if (!ctx.companyId) return [];
  const scoped = await readScopedOutboxRows({ agentIds: [], companyId: ctx.companyId, projectId: ctx.projectId });
  if (!scoped.owned) return [];
  const keys = new Set<string>();
  for (const row of scoped.rows) {
    if (keys.size >= 20) break;
    const blob = JSON.stringify(row.send_blockers ?? "");
    ENV_KEY_NOT_SET.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ENV_KEY_NOT_SET.exec(blob)) && keys.size < 20) keys.add(match[1]);
  }
  return [...keys];
}

/** Most-used non-empty sender inbox across outbox rows (the campaign's from-address). */
function mostCommonInbox(rows: OutboxRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const inbox = typeof row.inbox === "string" ? row.inbox.trim() : "";
    if (inbox) counts.set(inbox, (counts.get(inbox) || 0) + 1);
  }
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top ? top[0] : "";
}

/** Latest activity time for an outbox row, tolerant of missing fields. */
function outboxRowTime(row: OutboxRow): number {
  return (
    parseOutboxTimeMs(row.sent_at)
    || parseOutboxTimeMs(row.generated_at)
    || parseOutboxTimeMs(row.triggered_at)
    || parseOutboxTimeMs(row.scheduled_for)
    || 0
  );
}

/** ISO string or epoch (s/ms) → epoch ms; 0 when unparseable. */
function parseOutboxTimeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value.trim());
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/** Turn a verbose send-blocker string into a short, human hold reason. */
function summarizeBlocker(value: unknown): string {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const first = list.map((entry) => (typeof entry === "string" ? entry : "")).find((entry) => entry.trim());
  if (!first) return "";
  const lower = first.toLowerCase();
  if (lower.includes("outreach_physical_address") || lower.includes("can-spam")) return "needs mailing address";
  if (lower.includes("email address") || lower.includes("contact discovery") || lower.includes("public email")) return "needs contact email";
  if (lower.includes("sms")) return "SMS disabled";
  if (lower.includes("contact form")) return "form not submitted";
  return first.split(/[.;]/)[0].trim().slice(0, 48);
}

/** Collapse whitespace and cap an email body to a short preview. */
function compactPreview(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

const OUTBOX_URL_RE = /https?:\/\/[^\s<>")\]]+/g;

/** A short label for a link, inferred from its URL. */
function labelForOutboxUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes("booked_call") || lower.includes("cal.com") || lower.includes("consult") || lower.includes("booking")) return "Booking link";
  if (lower.includes("preview") || lower.includes("demo")) return "Preview site";
  if (lower.includes("checkout") || lower.includes("stripe") || lower.includes("/pay")) return "Payment link";
  return "Link";
}

/** Openable links embedded in an outreach email (CTA/booking/preview), from the
 *  tracked-attachments field and the body, deduped and labelled. */
function extractOutboxLinks(row: OutboxRow): { label: string; url: string }[] {
  const urls = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value !== "string") return;
    const matches = value.match(OUTBOX_URL_RE);
    if (!matches) return;
    for (const match of matches) {
      const url = match.replace(/[.,);]+$/, "");
      // Skip passive open-tracking beacons (e.g. /t/open.gif) — not user-facing links.
      if (/\/open\.gif|\/t\/open\b|\.gif(?:$|\?)/i.test(url)) continue;
      urls.add(url);
    }
  };
  if (Array.isArray(row.attachments)) for (const entry of row.attachments) collect(entry);
  collect(row.body);
  const out: { label: string; url: string }[] = [];
  for (const url of urls) {
    if (out.length >= 8) break;
    out.push({ label: labelForOutboxUrl(url), url });
  }
  return out;
}

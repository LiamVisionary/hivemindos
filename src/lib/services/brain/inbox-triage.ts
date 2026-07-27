import { constants } from "fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { isAbsolute, join, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

// Inbox Triage: a report-only brain service that reads the shared vault's
// capture folders (Inbox/ + the configured intake folder), classifies each
// item with local heuristics (no LLM, no network), and writes a daily report
// proposing a routing rail per item. It NEVER modifies, moves, or deletes the
// captured notes, and never writes inside the Synthesis folder — long-form
// sources are only LISTED as candidates for the Syntho pipeline; a human
// stages them. Config truth lives in the vault service note (Inbox Triage.md)
// so the toggle follows the vault across machines; there is no second copy in
// dashboard state to drift.

const SERVICE_NOTE = "Inbox Triage.md";
const REPORT_FOLDER = "Inbox Triage";
const MAX_ITEMS = 500;
const MAX_READ_CHARS = 200_000;

export type InboxTriageCategory = "task" | "idea" | "memory" | "source" | "review";
export type InboxTriageConfidence = "high" | "medium" | "low";

export const INBOX_TRIAGE_RAIL_LABELS: Record<InboxTriageCategory, string> = {
  task: "Work Board task",
  idea: "Ideas folder",
  memory: "Agent Memory (hive-brain remember)",
  source: "Syntho candidate (stage into Synthesis/raw on approval)",
  review: "Needs review",
};

export interface InboxTriageClassification {
  category: InboxTriageCategory;
  confidence: InboxTriageConfidence;
  reasons: string[];
}

export interface InboxTriageItem extends InboxTriageClassification {
  path: string;
  folder: string;
  bytes: number;
  ageDays: number;
  hash: string;
  rail: string;
  status: "new" | "changed" | "unchanged";
}

export interface InboxTriageInput {
  vaultPath?: string;
  brainServicesFolder?: string;
  inboxFolder?: string;
}

export interface InboxTriageRunResult {
  ran: boolean;
  reason?: string;
  reportPath?: string;
  reportDate?: string;
  itemCount?: number;
  newCount?: number;
  counts?: Partial<Record<InboxTriageCategory, number>>;
}

export interface InboxTriageStatus {
  service: "inbox-triage";
  enabled: boolean;
  reportHour: number;
  vaultPath: string;
  folders: string[];
  lastReportDate?: string;
  lastReportPath?: string;
  lastItemCount?: number;
  lastNewCount?: number;
}

export interface InboxTriageNoteConfig {
  enabled: boolean;
  reportHour: number;
  lastRun?: string;
  lastReportDate?: string;
}

export const DEFAULT_INBOX_TRIAGE_NOTE: InboxTriageNoteConfig = {
  // Report-only and cheap, so it ships on; the vault note or
  // HIVEMINDOS_INBOX_TRIAGE=0 turns it off.
  enabled: true,
  reportHour: 20,
};

function safeVaultFolder(folder: string | undefined, fallback: string) {
  const value = (folder || fallback).trim();
  if (!value) return fallback;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Inbox Triage folders must be relative paths inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function brainServicesRoot(vaultPath: string, folder?: string) {
  return join(vaultPath, safeVaultFolder(folder, DEFAULT_SHARED_VAULT.brainServicesFolder));
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Capture folders to scan: a literal Inbox/ plus the configured intake folder. */
function inboxFolders(inboxFolder?: string): string[] {
  const configured = safeVaultFolder(inboxFolder, DEFAULT_SHARED_VAULT.inboxFolder);
  return [...new Set(["Inbox", configured])];
}

/**
 * Heuristic classifier — pure so the hermetic suite can exercise it directly.
 * Signals compete; a weak or contested winner degrades to "review" or low
 * confidence rather than guessing, because the report is reviewed by a human
 * and a wrong-but-confident rail erodes trust faster than an honest "unsure".
 */
export function classifyInboxNote(relPath: string, text: string): InboxTriageClassification {
  const name = relPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
  const extension = relPath.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  if (extension && !["md", "txt"].includes(extension)) {
    return { category: "review", confidence: "low", reasons: [`non-text file (.${extension})`] };
  }
  const lines = text.split("\n").filter((line) => line.trim());
  const chars = text.length;
  const scores: Record<Exclude<InboxTriageCategory, "review">, number> = { task: 0, idea: 0, memory: 0, source: 0 };
  const reasons: string[] = [];

  const checkboxes = (text.match(/^\s*[-*]\s*\[[ xX]?\]/gm) ?? []).length;
  if (checkboxes) {
    scores.task += Math.min(3, 1 + checkboxes / 3);
    reasons.push(`${checkboxes} checkbox line(s)`);
  }
  if (/\b(to ?do|task|checklist|action items?)\b/.test(name)) {
    scores.task += 2;
    reasons.push("task-like filename");
  }

  if (/transcript/i.test(relPath)) {
    scores.source += 3;
    reasons.push("transcript path");
  }
  if (/\b(article|case study|paper|thread|newsletter)\b/.test(name)) {
    scores.source += 2;
    reasons.push("source-like filename");
  }
  if (chars > 3_500) {
    scores.source += 2;
    reasons.push(`long-form (${chars} chars)`);
  }
  const urlLines = lines.filter((line) => /https?:\/\//.test(line)).length;
  if (lines.length >= 3 && urlLines / lines.length > 0.4) {
    scores.source += 1.5;
    reasons.push("mostly links");
  }
  if (/^---\n[\s\S]*?^(source|url):/m.test(text)) {
    scores.source += 1.5;
    reasons.push("source/url frontmatter");
  }

  if (/\b(ideas?|strategy|strategies|monetization|concept|pitch|brainstorm)\b/.test(name)) {
    scores.idea += 2.5;
    reasons.push("idea-like filename");
  }
  if (/\b(what if|we could|idea:|concept:)\b/i.test(text.slice(0, 2_000))) {
    scores.idea += 1;
    reasons.push("idea phrasing");
  }

  if (/\b(decision|decided|preference|always|never|policy|rule)\b/.test(name)) {
    scores.memory += 2;
    reasons.push("decision/preference filename");
  }
  if (chars > 0 && chars <= 800 && !checkboxes) {
    scores.memory += 1;
    reasons.push(`short note (${chars} chars)`);
  }

  const ranked = (Object.entries(scores) as Array<[Exclude<InboxTriageCategory, "review">, number]>)
    .sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  const margin = bestScore - ranked[1][1];
  if (bestScore < 1.5) {
    // A strong signal (checkboxes, a transcript path) beats size; the
    // near-empty label is only for notes that carried no signal at all.
    const reason = chars < 60 ? `near-empty (${chars} chars)` : "no strong signal";
    return { category: "review", confidence: "low", reasons: [...reasons, reason] };
  }
  const confidence: InboxTriageConfidence = bestScore >= 3 && margin >= 1.5 ? "high" : margin >= 0.5 ? "medium" : "low";
  return {
    category: best,
    confidence,
    reasons: confidence === "low" ? [...reasons, "competing signals"] : reasons,
  };
}

async function walkFiles(root: string, out: string[]): Promise<void> {
  if (out.length >= MAX_ITEMS) return;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_ITEMS) return;
    if (entry.name.startsWith(".") || entry.name.includes("sync-conflict")) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "Processed" || entry.name === "Review") continue;
      await walkFiles(path, out);
    }
    else if (entry.isFile()) out.push(path);
  }
}

async function scanItems(vaultPath: string, inboxFolder: string | undefined, now: Date): Promise<InboxTriageItem[]> {
  const items: InboxTriageItem[] = [];
  for (const folder of inboxFolders(inboxFolder)) {
    const root = join(vaultPath, folder);
    if (!(await exists(root))) continue;
    const files: string[] = [];
    await walkFiles(root, files);
    for (const file of files.sort()) {
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      const text = (await readFile(file, "utf8").catch(() => "")).slice(0, MAX_READ_CHARS);
      const relPath = file.slice(vaultPath.length + 1);
      const classified = classifyInboxNote(relPath, text);
      items.push({
        ...classified,
        path: relPath,
        folder,
        bytes: info.size,
        ageDays: Math.max(0, Math.floor((now.getTime() - info.mtimeMs) / 86_400_000)),
        hash: createHash("sha256").update(text).digest("hex").slice(0, 12),
        rail: INBOX_TRIAGE_RAIL_LABELS[classified.category],
        status: "new",
      });
    }
  }
  return items;
}

function reportRoot(vaultPath: string, brainServicesFolder?: string) {
  return join(brainServicesRoot(vaultPath, brainServicesFolder), REPORT_FOLDER);
}

function noteValue(raw: string, key: string): string | undefined {
  const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return undefined;
  return frontmatter[1].match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, "m"))?.[1]?.trim();
}

export async function readInboxTriageNoteConfig(vaultPath: string, brainServicesFolder?: string): Promise<InboxTriageNoteConfig> {
  const raw = await readFile(join(brainServicesRoot(vaultPath, brainServicesFolder), SERVICE_NOTE), "utf8").catch(() => "");
  const reportHour = Number(noteValue(raw, "reportHour"));
  return {
    enabled: noteValue(raw, "enabled") !== "false",
    reportHour: Number.isInteger(reportHour) && reportHour >= 0 && reportHour <= 23
      ? reportHour
      : DEFAULT_INBOX_TRIAGE_NOTE.reportHour,
    lastRun: noteValue(raw, "lastRun"),
    lastReportDate: noteValue(raw, "lastReportDate"),
  };
}

export async function writeInboxTriageNoteConfig(
  input: InboxTriageInput,
  patch: Partial<InboxTriageNoteConfig>,
): Promise<InboxTriageNoteConfig> {
  const vaultPath = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const servicesRoot = brainServicesRoot(vaultPath, input.brainServicesFolder);
  await mkdir(servicesRoot, { recursive: true });
  const config = { ...(await readInboxTriageNoteConfig(vaultPath, input.brainServicesFolder)), ...patch };
  const body = [
    "---",
    "type: brain-service",
    "service: inbox-triage",
    `enabled: ${config.enabled}`,
    `reportHour: ${config.reportHour}`,
    config.lastRun ? `lastRun: ${config.lastRun}` : "",
    config.lastReportDate ? `lastReportDate: ${config.lastReportDate}` : "",
    "---",
    "",
    "# Inbox Triage",
    "",
    "Report-only capture triage for this vault's Inbox and intake folders.",
    "Daily reports live next to this note under " + `\`${REPORT_FOLDER}/\`.` ,
    "This service never edits, moves, or deletes captured notes, and never",
    "writes inside the Synthesis folder.",
    "",
  ].filter((line) => line !== "").join("\n") + "\n";
  await writeFile(join(servicesRoot, SERVICE_NOTE), body, "utf8");
  return config;
}

// "New" means new since the LATEST report — including an earlier report from
// today that this run is about to overwrite, so a same-day forced re-run
// doesn't re-flag everything.
async function latestPreviousAudit(reportDir: string): Promise<{ items?: Array<{ path: string; hash: string }> } | null> {
  const entries = await readdir(reportDir).catch(() => []);
  const candidates = entries
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
  if (!candidates.length) return null;
  try {
    return JSON.parse(await readFile(join(reportDir, candidates[0]), "utf8")) as { items?: Array<{ path: string; hash: string }> };
  } catch {
    return null;
  }
}

function localDateKey(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function renderReport(dateKey: string, generatedAt: string, items: InboxTriageItem[], newCount: number, counts: Partial<Record<InboxTriageCategory, number>>): string {
  const summary = (Object.entries(counts) as Array<[InboxTriageCategory, number]>)
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => `${INBOX_TRIAGE_RAIL_LABELS[category]}: ${count}`)
    .join(" · ");
  const rows = [...items]
    .sort((a, b) => Number(a.confidence !== "high") - Number(b.confidence !== "high") || b.ageDays - a.ageDays)
    .map((item) => {
      const flag = item.status === "new" ? " *(new)*" : item.status === "changed" ? " *(changed)*" : "";
      const why = item.reasons.slice(0, 3).join("; ") || "—";
      const name = item.path.split(/[\\/]/).pop() ?? item.path;
      return `| [[${item.path}\\|${name}]]${flag} | ${item.ageDays}d | ${item.rail} | ${item.confidence} | ${why} |`;
    });
  return [
    "---",
    "type: report",
    `date: ${dateKey}`,
    "automation: inbox-triage",
    "mode: report-only",
    "---",
    "",
    `# Inbox Triage — ${dateKey}`,
    "",
    `Mode: **report-only** — no captured files were modified, moved, or deleted. Generated ${generatedAt}.`,
    "",
    `**${items.length} item(s)** across the capture folders (${newCount} new since the last report). ${summary || "Inbox is empty."}`,
    "",
    "| Item | Age | Proposed rail | Confidence | Why |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Proposed rails",
    "",
    "- **Work Board task** — actionable; belongs on the Work Board.",
    "- **Ideas folder** — idea or strategy sketch worth keeping visible.",
    "- **Agent Memory** — durable fact, decision, or preference for `hive-brain remember`.",
    "- **Syntho candidate** — long-form source material worth staging into `Synthesis/raw` for the Syntho pipeline. Only a human stages files; this service never writes inside Synthesis.",
    "- **Needs review** — ambiguous; a human should decide.",
    "",
  ].join("\n");
}

/**
 * Run one triage pass. Without `force` it is self-gating: disabled service,
 * pre-report-hour time, an existing report for today, or no capture folders
 * all skip quietly — the driver can tick often and stay idempotent. Several
 * server processes may tick on one machine; the today's-report-exists check is
 * the dedupe (a lost race rewrites the same report, which is harmless).
 */
export async function runInboxTriage(input: InboxTriageInput & { force?: boolean } = {}): Promise<InboxTriageRunResult> {
  const vaultPath = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  if (!(await exists(vaultPath))) return { ran: false, reason: "vault-unavailable" };
  const config = await readInboxTriageNoteConfig(vaultPath, input.brainServicesFolder);
  const now = new Date();
  const dateKey = localDateKey(now);
  const reportDir = reportRoot(vaultPath, input.brainServicesFolder);
  const reportPath = join(reportDir, `${dateKey}.md`);
  if (!input.force) {
    if (!config.enabled) return { ran: false, reason: "disabled" };
    // Today's report existing beats the hour gate: once reported, there is
    // nothing left to do today no matter what time it is.
    if (await exists(reportPath)) return { ran: false, reason: "already-reported", reportPath, reportDate: dateKey };
    if (now.getHours() < config.reportHour) return { ran: false, reason: "before-report-hour" };
  }

  const folders = [];
  for (const folder of inboxFolders(input.inboxFolder)) {
    if (await exists(join(vaultPath, folder))) folders.push(folder);
  }
  if (!folders.length) return { ran: false, reason: "no-inbox-folders" };

  const items = await scanItems(vaultPath, input.inboxFolder, now);
  const previous = await latestPreviousAudit(reportDir);
  const previousByPath = new Map((previous?.items ?? []).map((item) => [item.path, item.hash]));
  let newCount = 0;
  for (const item of items) {
    const previousHash = previousByPath.get(item.path);
    if (previousHash === undefined) {
      item.status = "new";
      newCount += 1;
    } else {
      item.status = previousHash === item.hash ? "unchanged" : "changed";
    }
  }
  const counts: Partial<Record<InboxTriageCategory, number>> = {};
  for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1;

  await mkdir(reportDir, { recursive: true });
  const generatedAt = now.toISOString();
  await writeFile(reportPath, renderReport(dateKey, generatedAt, items, newCount, counts), "utf8");
  await writeFile(
    join(reportDir, `${dateKey}.json`),
    JSON.stringify({ ok: true, createdAt: generatedAt, mode: "report-only", itemCount: items.length, newCount, counts, items }, null, 2) + "\n",
    "utf8",
  );
  await writeInboxTriageNoteConfig(input, { lastRun: generatedAt, lastReportDate: dateKey });
  return { ran: true, reportPath, reportDate: dateKey, itemCount: items.length, newCount, counts };
}

export async function getInboxTriageStatus(input: InboxTriageInput = {}): Promise<InboxTriageStatus> {
  const vaultPath = resolveObsidianVaultPath(input.vaultPath);
  const config = await readInboxTriageNoteConfig(vaultPath, input.brainServicesFolder);
  const folders = [];
  for (const folder of inboxFolders(input.inboxFolder)) {
    if (await exists(join(vaultPath, folder))) folders.push(folder);
  }
  const status: InboxTriageStatus = {
    service: "inbox-triage",
    enabled: config.enabled,
    reportHour: config.reportHour,
    vaultPath,
    folders,
    lastReportDate: config.lastReportDate,
  };
  if (config.lastReportDate) {
    const reportDir = reportRoot(vaultPath, input.brainServicesFolder);
    status.lastReportPath = join(reportDir, `${config.lastReportDate}.md`);
    try {
      const audit = JSON.parse(await readFile(join(reportDir, `${config.lastReportDate}.json`), "utf8")) as { itemCount?: number; newCount?: number };
      status.lastItemCount = audit.itemCount;
      status.lastNewCount = audit.newCount;
    } catch {
      // Report note may exist without its audit twin; status stays partial.
    }
  }
  return status;
}

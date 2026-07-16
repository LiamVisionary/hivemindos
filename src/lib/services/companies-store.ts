import "server-only";

import { promises as fs } from "fs";
import { statSync } from "fs";
import { hostname } from "os";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { recordCompanyConfigChange, type CompanyConfigAction } from "@/lib/services/company-governance";
import {
  createCompanyProposal,
  settleCompanyProposal,
} from "@/lib/services/company-runs";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { KanbanDeliverableKind } from "@/lib/types/kanban";
import type {
  Company,
  CompanyApexGoal,
  CompanyApiBudget,
  CompanyApprovalPolicy,
  CompanyAutonomyPause,
  CompanyAutonomyPauseMode,
  CompanyDirective,
  CompanyIntegrationLimit,
  CompanyMember,
  CompanyMemberSpend,
  CompanyMetricUnit,
  CompanyPricingProposal,
  CompanyProduct,
  CompanyProductCatalog,
  CompanyRevenue,
  CompanySpendRollup,
  CompanyStatus,
} from "@/lib/types/company";
import type {
  CompanyImportedOperations,
  ImportedSchedule,
  ImportedScript,
  ImportedService,
  ImportedWorkflow,
} from "@/lib/types/company-import";
import { normalizeCompanyApprovalPolicies } from "@/lib/services/company-approval-policies";
import { normalizeCompanyExecutionConfig } from "@/lib/services/company-execution-capabilities";
import { normalizeImportedKnowledge } from "@/lib/services/company-imported-knowledge";
import { normalizeCompanyProductCatalog } from "@/lib/services/company-product-normalization";
import { sameCompanyApiBudgetScope } from "@/lib/services/company-api-budget";
import {
  assertExclusiveCompanyMembership,
  exclusiveCompanyForAgent,
} from "@/lib/services/company-membership";
import {
  ROLLING_DAY_MS,
  ROLLING_MONTH_MS,
  readSpendLedger,
  sumCompanySpendUsdSince,
  sumCompanyKindSpendUsdSince,
  type SpendLedgerRecord,
} from "@/lib/services/wallet/spend-ledger";

/**
 * Storage model (vault-primary, local-fallback — the project-registry pattern):
 *
 * - DEFINITIONS (charter, apex goal, crew, budgets, policy flags) live in the
 *   Syncthing-replicated shared vault at Operations/Companies/companies.json so
 *   every fleet machine sees the same portfolio and Obsidian can edit it.
 * - HOT OPERATIONAL STATE (dispatch stamps + metric readings: lastDispatchedAt,
 *   apexGoal.current/progress, revenue) lives per machine in
 *   ~/.hivemindos/companies-runtime.json so tick-level writes never churn sync.
 * - With no vault available, everything falls back to the legacy single local
 *   file (~/.hivemindos/companies.json) with the original behavior.
 *
 * Existing local records are migrated into the vault once per machine (guarded
 * by migratedCompanyIds in the overlay so a later delete can't be resurrected);
 * the legacy file is left untouched as the rollback copy. Because definitions
 * replicate, auto-dispatch is gated per company by homeMachineKey — see
 * companyRunsOnThisMachine().
 */

export const COMPANIES_PATH = path.join(homedir(), ".hivemindos", "companies.json");
export const COMPANIES_RUNTIME_PATH = path.join(homedir(), ".hivemindos", "companies-runtime.json");
const VAULT_COMPANIES_FILE = path.join("Operations", "Companies", "companies.json");

type CompaniesStorage = { source: "obsidian" | "local"; file: string };

function resolveCompaniesStorage(): CompaniesStorage {
  const configured = DEFAULT_SHARED_VAULT.vaultPath?.trim();
  if (configured) {
    const root = resolveObsidianVaultPath(configured);
    try {
      if (statSync(root).isDirectory()) return { source: "obsidian", file: path.join(root, VAULT_COMPANIES_FILE) };
    } catch {
      // Vault unavailable — fall back to the legacy local file.
    }
  }
  return { source: "local", file: COMPANIES_PATH };
}

/** Per-company hot state kept out of the replicated definitions file. */
type CompanyRuntimeState = {
  lastDispatchedAt?: number;
  apexGoal?: { current?: string; progress?: number };
  revenue?: CompanyRevenue;
  updatedAt?: string;
};

type CompanyRuntimeOverlay = {
  version: 1;
  /** Ids ever migrated from the legacy local file — a vault delete must stay deleted. */
  migratedCompanyIds?: string[];
  companies: Record<string, CompanyRuntimeState>;
};

/**
 * Thrown when a companies definitions/local file is present but unparseable.
 * Returning [] on this used to be catastrophic: the next config write persisted
 * (and Syncthing replicated) a portfolio wiped down to whatever the caller was
 * appending. We fail closed instead so a corrupt file is loud and recoverable.
 */
export class CompaniesFileCorruptError extends Error {
  // Explicit fields (no constructor parameter properties): the hermetic suites
  // import this via Node's strip-only TS, which rejects parameter-property syntax.
  readonly file: string;
  readonly reason?: unknown;
  constructor(file: string, reason?: unknown) {
    super(
      `[companies-store] refusing to read a corrupt companies file at ${file}. ` +
        `The portfolio was NOT wiped or overwritten. Restore from a sibling ${path.basename(file)}.bak.N ` +
        `backup or fix the JSON, then retry.`,
    );
    this.name = "CompaniesFileCorruptError";
    this.file = file;
    this.reason = reason;
  }
}

type CorruptFilePolicy = "throw" | "empty";

/** How many rotated backups of the durable definitions file to keep. Bounded so
 *  these can never bloat the vault the way unbounded *.bak files have. */
const DEFINITIONS_BACKUP_COUNT = 5;

/**
 * Guarantee a stable identity + display name so one malformed record can't crash
 * a whole-portfolio read (`.sort` on a missing name) or poison dispatch. Records
 * with no usable id are dropped (they can't be merged, governed, or dispatched);
 * a missing name degrades to a placeholder rather than discarding the charter.
 */
function normalizeCompanyRecord(raw: unknown): Company | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;
  const name = typeof record.name === "string" && record.name.trim() ? record.name : "Untitled company";
  return { ...(record as unknown as Company), id, name };
}

/**
 * Reads a companies JSON array. A MISSING file is a normal empty portfolio. A
 * PRESENT-but-unparseable file is a hazard — see CompaniesFileCorruptError — so
 * by default we fail closed (throw) and let the caller refuse to overwrite it.
 * The one-shot legacy migration source passes "empty": a corrupt legacy file
 * must never block the vault-backed portfolio. Records are normalized so one bad
 * entry degrades to a skipped company, not a portfolio-wide throw.
 */
async function readCompaniesFile(file: string, onCorrupt: CorruptFilePolicy = "throw"): Promise<Company[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    if (onCorrupt === "throw") throw new CompaniesFileCorruptError(file, error);
    console.error(`[companies-store] unreadable companies file at ${file}:`, error);
    return [];
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    if (onCorrupt === "throw") {
      console.error(
        `[companies-store] CORRUPT companies file at ${file} — refusing to overwrite it (restore from a .bak.N sibling):`,
        error,
      );
      throw new CompaniesFileCorruptError(file, error);
    }
    console.error(`[companies-store] ignoring corrupt legacy companies file at ${file}:`, error);
    return [];
  }
  if (!Array.isArray(parsed)) {
    if (onCorrupt === "throw") throw new CompaniesFileCorruptError(file);
    return [];
  }
  const out: Company[] = [];
  let dropped = 0;
  for (const raw of parsed) {
    const record = normalizeCompanyRecord(raw);
    if (record) out.push(record);
    else dropped++;
  }
  if (dropped > 0) {
    console.error(`[companies-store] dropped ${dropped} malformed company record(s) from ${file} (missing/invalid id)`);
  }
  return out;
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  await fs.rename(tmp, file);
}

/**
 * Keep a few rotated copies of the durable definitions before overwriting it, so
 * a bad hand-edit, a Syncthing-conflicted overwrite, or a partial write stays
 * recoverable. .bak.0 is the most recent prior version. Best-effort: a backup
 * failure must never block the real write.
 */
async function rotateDefinitionsBackups(file: string): Promise<void> {
  try {
    await fs.access(file);
  } catch {
    return; // nothing to back up yet
  }
  for (let i = DEFINITIONS_BACKUP_COUNT - 1; i >= 0; i--) {
    const from = i === 0 ? file : `${file}.bak.${i - 1}`;
    const to = `${file}.bak.${i}`;
    try {
      await fs.copyFile(from, to);
    } catch {
      // a missing intermediate backup is fine; keep rotating the ones that exist
    }
  }
}

/** Atomic write of the durable definitions/local file, preceded by a rotated backup. */
async function writeDurableDefinitions(file: string, contents: string): Promise<void> {
  await rotateDefinitionsBackups(file);
  await writeFileAtomic(file, contents);
}

/** Serializes read-modify-write cycles within a process so two concurrent
 *  mutations (e.g. a freeze and a routine metric write) can't clobber each
 *  other's changes. Mirrors company-runs' enqueueCompanyRunsWrite. */
let companiesWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueCompaniesWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = companiesWriteQueue.then(fn, fn);
  companiesWriteQueue = next.catch(() => undefined);
  return next;
}

async function readRuntimeOverlay(): Promise<CompanyRuntimeOverlay> {
  try {
    const parsed = JSON.parse(await fs.readFile(COMPANIES_RUNTIME_PATH, "utf8")) as CompanyRuntimeOverlay;
    if (parsed && typeof parsed === "object" && parsed.companies && typeof parsed.companies === "object") {
      return { version: 1, migratedCompanyIds: parsed.migratedCompanyIds ?? [], companies: parsed.companies };
    }
  } catch {
    // Missing/corrupt overlay → start empty; definitions are the durable layer.
  }
  return { version: 1, migratedCompanyIds: [], companies: {} };
}

async function writeRuntimeOverlay(overlay: CompanyRuntimeOverlay): Promise<void> {
  await writeFileAtomic(COMPANIES_RUNTIME_PATH, JSON.stringify(overlay, null, 2));
}

/** The replicated definition projection: everything except hot operational state. */
function companyDefinitionOf(record: Company): Company {
  return {
    id: record.id,
    name: record.name,
    agentIds: record.agentIds,
    charter: record.charter,
    dailyBudgetUsd: record.dailyBudgetUsd,
    monthlyBudgetUsd: record.monthlyBudgetUsd,
    totalBudgetUsd: record.totalBudgetUsd,
    frozen: record.frozen,
    createdAt: record.createdAt,
    createdAtMs: record.createdAtMs,
    updatedAt: record.updatedAt,
    ticker: record.ticker,
    sector: record.sector,
    blurb: record.blurb,
    status: record.status,
    alignment: record.alignment,
    apexGoal: record.apexGoal
      ? {
          title: record.apexGoal.title,
          metric: record.apexGoal.metric,
          target: record.apexGoal.target,
          unit: record.apexGoal.unit,
        }
      : undefined,
    members: record.members,
    autonomy: record.autonomy,
    autonomyPause: record.autonomyPause,
    process: record.process,
    execution: record.execution,
    flowTemplateId: record.flowTemplateId,
    homeMachineKey: record.homeMachineKey,
    projectId: record.projectId,
    products: record.products,
    pricingProposals: record.pricingProposals,
    approvalPolicies: record.approvalPolicies,
    analyticsProvider: record.analyticsProvider,
    analyticsConfig: record.analyticsConfig,
    importedOperations: record.importedOperations,
    importedKnowledge: record.importedKnowledge,
    directives: record.directives,
    apiBudgets: record.apiBudgets,
    integrationLimits: record.integrationLimits,
  };
}

function companyRuntimeStateOf(record: Company): CompanyRuntimeState {
  const hotGoal =
    record.apexGoal && (record.apexGoal.current !== undefined || record.apexGoal.progress !== undefined)
      ? { current: record.apexGoal.current, progress: record.apexGoal.progress }
      : undefined;
  return {
    lastDispatchedAt: record.lastDispatchedAt,
    apexGoal: hotGoal,
    revenue: record.revenue,
    updatedAt: record.updatedAt,
  };
}

function mergeCompany(definition: Company, runtime?: CompanyRuntimeState): Company {
  if (!runtime) return definition;
  const apexGoal = definition.apexGoal
    ? { ...definition.apexGoal, ...(runtime.apexGoal ?? {}) }
    : definition.apexGoal;
  // Callers read updatedAt as "last time anything happened" — hot or config.
  const updatedAt =
    runtime.updatedAt && runtime.updatedAt > definition.updatedAt ? runtime.updatedAt : definition.updatedAt;
  return {
    ...definition,
    apexGoal,
    revenue: runtime.revenue,
    lastDispatchedAt: runtime.lastDispatchedAt,
    updatedAt,
  };
}

/** Definitions serialization, updatedAt excluded — hot writes must not churn Syncthing. */
function definitionsFingerprint(records: Company[]): string {
  return JSON.stringify(records.map((record) => ({ ...companyDefinitionOf(record), updatedAt: undefined })));
}

async function writeDefinitionsIfChanged(file: string, records: Company[]): Promise<boolean> {
  const definitions = records.map(companyDefinitionOf);
  const current = await readCompaniesFile(file);
  if (current.length === definitions.length && definitionsFingerprint(current) === definitionsFingerprint(definitions)) {
    return false;
  }
  await writeDurableDefinitions(file, JSON.stringify(definitions, null, 2));
  return true;
}

/**
 * One-shot-per-record migration of legacy local companies into the vault. The
 * legacy file stays in place as the rollback copy; migratedCompanyIds prevents
 * a company deleted from the vault from being resurrected on the next read.
 */
async function migrateLegacyCompanies(
  definitions: Company[],
  overlay: CompanyRuntimeOverlay,
  storageFile: string,
): Promise<Company[]> {
  // A corrupt legacy file must never block the vault-backed portfolio.
  const legacy = await readCompaniesFile(COMPANIES_PATH, "empty");
  if (legacy.length === 0) return definitions;
  const known = new Set(definitions.map((record) => record.id));
  const migratedIds = new Set(overlay.migratedCompanyIds ?? []);
  const pending = legacy.filter((record) => record?.id && !known.has(record.id) && !migratedIds.has(record.id));
  if (pending.length === 0) return definitions;

  const localKey = hostname();
  const next = [...definitions];
  for (const record of pending) {
    const claimed: Company = { ...record, homeMachineKey: record.homeMachineKey?.trim() || localKey };
    next.push(companyDefinitionOf(claimed));
    overlay.companies[record.id] = companyRuntimeStateOf(claimed);
    migratedIds.add(record.id);
  }
  overlay.migratedCompanyIds = [...migratedIds];
  await writeRuntimeOverlay(overlay);
  await writeDefinitionsIfChanged(storageFile, next);
  console.log(
    `[companies-store] migrated ${pending.length} local company record(s) into the shared vault (home machine: ${localKey})`,
  );
  for (const record of pending) {
    await recordConfigChange("migrated", null, { ...record, homeMachineKey: record.homeMachineKey?.trim() || localKey }, "companies-store:migration");
  }
  return next;
}

async function readRaw(): Promise<Company[]> {
  const storage = resolveCompaniesStorage();
  if (storage.source === "local") return readCompaniesFile(storage.file);
  const [definitions, overlay] = await Promise.all([readCompaniesFile(storage.file), readRuntimeOverlay()]);
  const migrated = await migrateLegacyCompanies(definitions, overlay, storage.file);
  return migrated.map((definition) => mergeCompany(definition, overlay.companies[definition.id]));
}

// writeRaw runs under the write queue so the multi-step persist (overlay write +
// backup rotation + definitions write) of two concurrent callers can't interleave
// and corrupt the rotation or leave overlay/definitions inconsistent. NOTE: this
// serializes the WRITE, not the whole read-modify-write — two mutations that each
// readRaw() before either writes can still lose an update in-process, and nothing
// here guards cross-process writers (5020 + 5021 + Tauri). Rotated backups above
// make those clobbers recoverable; full RMW/cross-process locking is a follow-up.
function writeRaw(records: Company[]): Promise<void> {
  return enqueueCompaniesWrite(async () => {
    const storage = resolveCompaniesStorage();
    if (storage.source === "local") {
      // Fail closed on a corrupt current file so a routine write can't wipe it.
      await readCompaniesFile(storage.file);
      await writeDurableDefinitions(storage.file, JSON.stringify(records, null, 2));
      return;
    }
    const overlay = await readRuntimeOverlay();
    const nextRuntime: CompanyRuntimeOverlay["companies"] = {};
    for (const record of records) nextRuntime[record.id] = companyRuntimeStateOf(record);
    overlay.companies = nextRuntime; // entries for deleted companies drop out here
    await writeRuntimeOverlay(overlay);
    await writeDefinitionsIfChanged(storage.file, records);
  });
}

/** Governance trail is best-effort: it must never block or fail a company write. */
async function recordConfigChange(
  action: CompanyConfigAction,
  before: Company | null,
  after: Company | null,
  source: string,
): Promise<void> {
  const subject = after ?? before;
  if (!subject) return;
  try {
    await recordCompanyConfigChange({
      action,
      companyId: subject.id,
      companyName: subject.name,
      before: before ? (companyDefinitionOf(before) as unknown as Record<string, unknown>) : null,
      after: after ? (companyDefinitionOf(after) as unknown as Record<string, unknown>) : null,
      source,
    });
  } catch (error) {
    console.warn("[companies-store] governance trail write failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * May THIS machine's autonomy driver auto-dispatch this company? In vault mode
 * definitions replicate fleet-wide, so only the claimed home machine runs the
 * company; an unclaimed company waits for an explicit Launch (claim-on-launch).
 * In local mode the file is per-machine — no duplication is possible — so the
 * gate stays open for backward compatibility.
 *
 * The match is drift-tolerant (sameMachineIdentity): a macOS box whose `.local`
 * name rotated its numeric suffix (e.g. `…-20942.local` → `…-21403.local`) still
 * counts as its own home machine, instead of silently stranding the company as
 * "homed elsewhere" and dispatching nothing.
 */
export function companyRunsOnThisMachine(company: Pick<Company, "homeMachineKey">): boolean {
  if (resolveCompaniesStorage().source === "local") return true;
  const home = (company.homeMachineKey ?? "").trim();
  if (!home) return false;
  return sameMachineIdentity(home, hostname());
}

export function localCompanyMachineKey(): string {
  return hostname();
}

/** Set homeMachineKey to this machine when unset (called on explicit Launch). */
export async function claimCompanyHomeMachine(id: string): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  if (company.homeMachineKey?.trim()) return company;
  const before = companyDefinitionOf(company);
  company.homeMachineKey = hostname();
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:claim-home-machine");
  return company;
}

export async function readCompanies(): Promise<Company[]> {
  return (await readRaw()).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

export async function getCompany(id: string): Promise<Company | null> {
  if (!id) return null;
  const records = await readRaw();
  return records.find((record) => record.id === id) ?? null;
}

/** Reverse lookup: the company this agent belongs to, if any. */
export async function getCompanyForAgent(agentId: string, records?: Company[]): Promise<Company | null> {
  if (!agentId) return null;
  const all = records ?? (await readRaw());
  return exclusiveCompanyForAgent(all, agentId);
}

function normalizeAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (id) seen.add(id);
  }
  return [...seen];
}

const VALID_STATUSES: CompanyStatus[] = ["shipping", "drift", "review", "setup", "paused"];

function normalizeStatus(value: unknown): CompanyStatus | undefined {
  return typeof value === "string" && (VALID_STATUSES as string[]).includes(value)
    ? (value as CompanyStatus)
    : undefined;
}

const VALID_DELIVERABLE_KINDS: KanbanDeliverableKind[] = [
  "website",
  "video",
  "image",
  "audio",
  "document",
  "directory",
  "file",
  "url",
];

/**
 * Clean an autonomy-pause config. A non-positive threshold means "disabled" and
 * is stored as `undefined` so a cleared setting drops out of the definition
 * entirely (rather than persisting a dead `0`). Kinds are validated against the
 * known deliverable kinds; an empty kind list leaves the driver to fall back to
 * counting every waiting item.
 */
function normalizeAutonomyPause(value: unknown): CompanyAutonomyPause | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as CompanyAutonomyPause;
  const rawMax = input.maxWaitingOnHuman;
  const max = typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.max(0, Math.floor(rawMax)) : 0;
  if (max <= 0) return undefined;
  const countMode: CompanyAutonomyPauseMode = input.countMode === "deliverable-kinds" ? "deliverable-kinds" : "all";
  const kinds =
    countMode === "deliverable-kinds"
      ? (Array.isArray(input.deliverableKinds) ? input.deliverableKinds : []).filter(
          (kind): kind is KanbanDeliverableKind => VALID_DELIVERABLE_KINDS.includes(kind as KanbanDeliverableKind),
        )
      : undefined;
  return {
    maxWaitingOnHuman: max,
    countMode,
    ...(kinds && kinds.length > 0 ? { deliverableKinds: kinds } : {}),
  };
}

function trimmed(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeAlignment(value: unknown): number | undefined {
  if (value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

const METRIC_UNITS: CompanyMetricUnit[] = ["number", "percent", "currency", "users"];

function normalizeMetricUnit(value: unknown): CompanyMetricUnit | undefined {
  return typeof value === "string" && (METRIC_UNITS as string[]).includes(value)
    ? (value as CompanyMetricUnit)
    : undefined;
}

function normalizeApexGoal(value: unknown): CompanyApexGoal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const title = trimmed(raw.title);
  const metric = trimmed(raw.metric);
  const target = trimmed(raw.target);
  const current = trimmed(raw.current);
  // Keep the goal if there's any substance to it, even without an explicit title.
  if (!title && !metric && !target) return undefined;
  const progress = raw.progress === null || raw.progress === "" ? NaN : Number(raw.progress);
  return {
    title: title || metric || "Apex goal",
    metric,
    target,
    current,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : undefined,
    unit: normalizeMetricUnit(raw.unit),
  };
}

function normalizeRevenue(value: unknown): CompanyRevenue | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const label = trimmed(raw.label);
  const display = trimmed(raw.value);
  if (!label || !display) return undefined;
  const pctRaw = Number(raw.pct);
  return {
    kind: raw.kind === "users" ? "users" : raw.kind === "revenue" ? "revenue" : undefined,
    label,
    value: display,
    target: trimmed(raw.target) ?? null,
    mau: trimmed(raw.mau),
    pct: Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, Math.round(pctRaw))) : null,
    delta: trimmed(raw.delta) ?? null,
    up: raw.up !== false,
    isApex: raw.isApex === true,
  };
}

function normalizeImportedOperations(value: unknown): CompanyImportedOperations | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<CompanyImportedOperations>;
  return {
    source: "repo",
    importedAt: normalizedIsoDate(raw.importedAt),
    lastDiscoveredAt: normalizedIsoDate(raw.lastDiscoveredAt),
    projectPath: trimmed(raw.projectPath),
    packageName: trimmed(raw.packageName),
    git: raw.git && typeof raw.git === "object"
      ? {
          remoteUrl: trimmed(raw.git.remoteUrl),
          repoName: trimmed(raw.git.repoName),
          branch: trimmed(raw.git.branch),
          commit: trimmed(raw.git.commit),
        }
      : undefined,
    workflows: Array.isArray(raw.workflows) ? raw.workflows.map(normalizeImportedWorkflow).filter((item): item is ImportedWorkflow => Boolean(item)) : [],
    schedules: Array.isArray(raw.schedules) ? raw.schedules.map(normalizeImportedSchedule).filter((item): item is ImportedSchedule => Boolean(item)) : [],
    services: Array.isArray(raw.services) ? raw.services.map(normalizeImportedService).filter((item): item is ImportedService => Boolean(item)) : [],
    scripts: Array.isArray(raw.scripts) ? raw.scripts.map(normalizeImportedScript).filter((item): item is ImportedScript => Boolean(item)) : [],
  };
}

function normalizeImportedWorkflow(value: unknown): ImportedWorkflow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedWorkflow>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  const triggers = Array.isArray(raw.triggers) ? raw.triggers.map(trimmed).filter((item): item is string => Boolean(item)) : [];
  const schedules = Array.isArray(raw.schedules) ? raw.schedules.map(trimmed).filter((item): item is string => Boolean(item)) : undefined;
  return { id, name, path: sourcePath, triggers, schedules };
}

function normalizeImportedSchedule(value: unknown): ImportedSchedule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedSchedule>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  return {
    id,
    kind: raw.kind ?? "other",
    name,
    path: sourcePath,
    schedule: trimmed(raw.schedule),
    command: trimmed(raw.command),
    target: trimmed(raw.target),
    detail: trimmed(raw.detail),
  };
}

function normalizeImportedService(value: unknown): ImportedService | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedService>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !sourcePath) return null;
  return {
    id,
    kind: raw.kind ?? "other",
    name,
    path: sourcePath,
    serviceType: trimmed(raw.serviceType),
    schedule: trimmed(raw.schedule),
    detail: trimmed(raw.detail),
  };
}

function normalizeImportedScript(value: unknown): ImportedScript | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ImportedScript>;
  const id = trimmed(raw.id);
  const name = trimmed(raw.name);
  const command = trimmed(raw.command);
  const sourcePath = trimmed(raw.path);
  if (!id || !name || !command || !sourcePath) return null;
  return {
    id,
    name,
    command,
    path: sourcePath,
    category: raw.category ?? "other",
  };
}

function normalizedIsoDate(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

async function mutateCompanyDefinition(
  id: string,
  source: string,
  mutate: (company: Company) => void,
): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  mutate(company);
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, source);
  return company;
}

/** Replace a company's product catalog in the replicated definition and governance trail. */
export async function setCompanyProducts(
  id: string,
  input: { items: CompanyProduct[] | unknown[]; seededFrom?: string },
  source = "companies-store:set-products",
): Promise<Company | null> {
  return mutateCompanyDefinition(id, source, (company) => {
    company.products = normalizeCompanyProductCatalog({
      items: input.items,
      seededFrom: input.seededFrom ?? company.products?.seededFrom ?? "ui",
      updatedAt: new Date().toISOString(),
    });
  });
}

/**
 * Write a company's per-API cloud cost guardrail into the replicated definition
 * (mirrors {@link setCompanyProducts}). Only the dedicated apply route calls
 * this, so a generic treasury/upsert save can never blank `apiBudgets`. Replaces
 * the entry for the given service in place (keyed by provider + project +
 * service) and leaves other projects/services untouched. The server owns `appliedAt` /
 * `appliedError` / `budgetResourceName`; callers pass whatever the provider
 * apply returned.
 */
export async function setCompanyApiBudget(
  id: string,
  apiBudget: CompanyApiBudget,
  source = "companies-store:set-api-budget",
): Promise<Company | null> {
  return mutateCompanyDefinition(id, source, (company) => {
    const current = Array.isArray(company.apiBudgets) ? company.apiBudgets : [];
    company.apiBudgets = [
      ...current.filter((entry) => !sameCompanyApiBudgetScope(entry, apiBudget)),
      apiBudget,
    ];
  });
}

/** Replace one provider/operation integration limit without touching other company config. */
export async function setCompanyIntegrationLimit(
  id: string,
  input: Omit<CompanyIntegrationLimit, "id" | "createdAt" | "updatedAt"> & { id?: string },
  source = "companies-store:set-integration-limit",
): Promise<Company | null> {
  const now = new Date().toISOString();
  const limitId = input.id?.trim() || `${input.providerKey}:${input.operationId?.trim() || "all"}`;
  return mutateCompanyDefinition(id, source, (company) => {
    const current = Array.isArray(company.integrationLimits) ? company.integrationLimits : [];
    const existing = current.find((limit) => limit.id === limitId);
    const limit: CompanyIntegrationLimit = {
      ...input,
      id: limitId,
      operationId: input.operationId?.trim() || undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    company.integrationLimits = [...current.filter((entry) => entry.id !== limitId), limit];
  });
}

/** Remove exactly one integration limit; usage history remains intact for charts/audit. */
export async function removeCompanyIntegrationLimit(
  id: string,
  limitId: string,
  source = "companies-store:remove-integration-limit",
): Promise<Company | null> {
  return mutateCompanyDefinition(id, source, (company) => {
    company.integrationLimits = (company.integrationLimits ?? []).filter((limit) => limit.id !== limitId);
  });
}

export async function setCompanyApprovalPolicy(
  id: string,
  input: CompanyApprovalPolicy,
): Promise<Company | null> {
  const [policy] = normalizeCompanyApprovalPolicies([{ ...input, updatedAt: new Date().toISOString() }]) ?? [];
  if (!policy) throw new Error("Approval policy subject is required.");
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  const current = normalizeCompanyApprovalPolicies(company.approvalPolicies) ?? [];
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  byId.set(policy.id, policy);
  company.approvalPolicies = [...byId.values()];
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:set-approval-policy");
  return company;
}

export type ProposePricingChangeInput = {
  /** Catalog product reference: matched against CompanyProduct.key, then name (case-insensitive). */
  productRef: string;
  proposedAmountUsd: number;
  why?: string;
  sourceTaskId?: string;
  proposedBy?: string;
};

/**
 * File a crew-raised price-change request against a catalog product. The
 * proposal is pending human review under Approvals — prices NEVER change here.
 * One pending proposal per product: a newer one for the same product replaces
 * the older (freshest evidence wins). Returns null when the company or the
 * referenced product doesn't exist, or the proposal is a no-op (same price).
 */
export async function proposeCompanyPricingChange(
  companyId: string,
  input: ProposePricingChangeInput,
): Promise<CompanyPricingProposal | null> {
  const proposedAmountUsd = Math.round(Number(input.proposedAmountUsd) * 100) / 100;
  if (!Number.isFinite(proposedAmountUsd) || proposedAmountUsd < 0) return null;
  const ref = input.productRef?.trim().toLowerCase();
  if (!ref) return null;

  const records = await readRaw();
  const company = records.find((record) => record.id === companyId);
  if (!company) return null;
  const items = company.products?.items ?? [];
  const product = items.find((item) => item.key === ref) ?? items.find((item) => item.name.toLowerCase() === ref);
  if (!product) return null;
  if (product.amountUsd === proposedAmountUsd) return null;

  const before = companyDefinitionOf(company);
  const superseded = (company.pricingProposals ?? []).find((pending) => pending.productKey === product.key);
  const proposal: CompanyPricingProposal = {
    id: `prc_${randomUUID()}`,
    productKey: product.key,
    productName: product.name,
    currentAmountUsd: product.amountUsd,
    proposedAmountUsd,
    why: trimmed(input.why),
    sourceTaskId: trimmed(input.sourceTaskId),
    proposedBy: trimmed(input.proposedBy),
    createdAt: new Date().toISOString(),
  };
  company.pricingProposals = [
    ...(company.pricingProposals ?? []).filter((pending) => pending.productKey !== product.key),
    proposal,
  ];
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:propose-pricing");

  const { appendCompanyMemory } = await import("@/lib/services/company-memory");
  await appendCompanyMemory(companyId, {
    kind: "note",
    title: `Pricing change requested: ${product.name} $${product.amountUsd.toLocaleString("en-US")} → $${proposedAmountUsd.toLocaleString("en-US")} (awaiting human approval)`,
    detail: proposal.why,
    taskId: proposal.sourceTaskId,
    agent: proposal.proposedBy,
  }).catch(() => undefined);
  if (superseded) {
    await settleCompanyProposal(companyId, superseded.id, {
      status: "superseded",
      decision: "A newer pricing proposal for the same product replaced this one.",
      decidedBy: proposal.proposedBy ?? "company",
    }).catch(() => undefined);
  }
  await createCompanyProposal(companyId, {
    id: proposal.id,
    kind: "pricing-change",
    status: "pending",
    title: `Pricing change requested: ${proposal.productName}`,
    summary: proposal.why,
    sourceTaskId: proposal.sourceTaskId,
    idempotencyKey: `pricing:${proposal.id}`,
    risk: Math.abs(proposal.proposedAmountUsd - proposal.currentAmountUsd) >= proposal.currentAmountUsd * 0.25 ? "high" : "medium",
    proposedChange: {
      productKey: proposal.productKey,
      productName: proposal.productName,
      currentAmountUsd: proposal.currentAmountUsd,
      proposedAmountUsd: proposal.proposedAmountUsd,
    },
    evidence: proposal.why ? [proposal.why] : undefined,
    createdBy: proposal.proposedBy ?? "company",
  }).catch(() => undefined);
  return proposal;
}

/**
 * Human decision on a pending pricing proposal. Approve applies the new price
 * to the catalog (the shared-brain value every agent quotes); reject leaves the
 * catalog untouched. Either way the proposal is removed and the outcome is
 * recorded in company memory, so the crew learns the decision instead of
 * re-proposing it every cycle.
 */
export async function resolveCompanyPricingProposal(
  companyId: string,
  proposalId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === companyId);
  if (!company) return null;
  const proposal = (company.pricingProposals ?? []).find((pending) => pending.id === proposalId);
  if (!proposal) return null;

  const before = companyDefinitionOf(company);
  company.pricingProposals = (company.pricingProposals ?? []).filter((pending) => pending.id !== proposalId);
  if (decision === "approve" && company.products) {
    company.products = {
      ...company.products,
      items: company.products.items.map((item) =>
        item.key === proposal.productKey ? { ...item, amountUsd: proposal.proposedAmountUsd } : item,
      ),
      updatedAt: new Date().toISOString(),
    };
  }
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, `companies-store:pricing-${decision}`);

  const { appendCompanyMemory } = await import("@/lib/services/company-memory");
  const priceMove = `${proposal.productName} $${proposal.currentAmountUsd.toLocaleString("en-US")} → $${proposal.proposedAmountUsd.toLocaleString("en-US")}`;
  await appendCompanyMemory(companyId, {
    kind: "note",
    title:
      decision === "approve"
        ? `Pricing approved by the human: ${priceMove} — the catalog now carries the new price; quote it everywhere.`
        : `Pricing change rejected by the human: ${priceMove} stays at $${proposal.currentAmountUsd.toLocaleString("en-US")} — do not re-propose without materially new evidence.`,
    detail: note?.trim() || proposal.why,
    taskId: proposal.sourceTaskId,
  }).catch(() => undefined);
  await settleCompanyProposal(companyId, proposal.id, {
    status: decision === "approve" ? "applied" : "rejected",
    decision:
      decision === "approve"
        ? "Human approved the pricing proposal and the official catalog was updated."
        : "Human rejected the pricing proposal and the catalog stayed unchanged.",
    decidedBy: "human",
    summary: note?.trim() || proposal.why,
  }).catch(() => undefined);
  return company;
}

/** Normalize a per-agent member list, deduping by agentId (last write wins). */
function normalizeMembers(value: unknown): CompanyMember[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const byId = new Map<string, CompanyMember>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
    if (!agentId) continue;
    const capRaw = Number(raw.companyCap);
    byId.set(agentId, {
      agentId,
      companyCap: Number.isFinite(capRaw) && capRaw > 0 ? Math.round(capRaw * 100) / 100 : undefined,
      roleInCompany: trimmed(raw.roleInCompany),
      reportsTo: typeof raw.reportsTo === "string" ? raw.reportsTo.trim() || null : raw.reportsTo === null ? null : undefined,
      task: trimmed(raw.task),
      state: trimmed(raw.state),
    });
  }
  return [...byId.values()];
}

/** Agent ids implied by a member list, preserving order. */
function agentIdsFromMembers(members: CompanyMember[]): string[] {
  return normalizeAgentIds(members.map((member) => member.agentId));
}

/**
 * Replace a company's member list (membership is managed from the company side).
 * Accepts plain agent ids or rich CompanyMember records; `agentIds` is kept in
 * sync with whichever is provided.
 */
export async function setCompanyAgents(
  id: string,
  agentIds: string[],
  members?: CompanyMember[],
): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  const normalizedMembers = members ? normalizeMembers(members) : undefined;
  const nextAgentIds = normalizedMembers ? agentIdsFromMembers(normalizedMembers) : normalizeAgentIds(agentIds);
  assertExclusiveCompanyMembership(records, company.id, nextAgentIds);
  if (normalizedMembers) {
    company.members = normalizedMembers;
    company.agentIds = nextAgentIds;
  } else {
    company.agentIds = nextAgentIds;
    if (company.members) {
      // Drop member metadata for agents that are no longer on the roster.
      const keep = new Set(company.agentIds);
      company.members = company.members.filter((member) => keep.has(member.agentId));
    }
  }
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:set-agents");
  return company;
}

/**
 * Additively merge members into a company against the CURRENT persisted state
 * (server-authoritative), so concurrent clients can't clobber each other's
 * roster. Existing members are preserved; new agents are appended.
 */
export async function addCompanyMembers(id: string, members: CompanyMember[]): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  const existing: CompanyMember[] = company.members?.length
    ? company.members
    : (company.agentIds ?? []).map((agentId) => ({ agentId }));
  const byId = new Map(existing.map((m) => [m.agentId, m]));
  for (const m of normalizeMembers(members) ?? []) {
    if (!byId.has(m.agentId)) byId.set(m.agentId, m);
  }
  const merged = [...byId.values()];
  assertExclusiveCompanyMembership(records, company.id, agentIdsFromMembers(merged));
  company.members = merged;
  company.agentIds = agentIdsFromMembers(merged);
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:add-members");
  return company;
}

function normalizeBudget(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.round(numeric * 100) / 100;
}

export type UpsertCompanyInput = {
  id?: string;
  name: string;
  agentIds?: string[];
  charter?: string;
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  totalBudgetUsd?: number;
  frozen?: boolean;
  // Zero Human Companies metadata (all optional/additive).
  ticker?: string;
  sector?: string;
  blurb?: string;
  status?: CompanyStatus | string;
  alignment?: number | string | null;
  apexGoal?: CompanyApexGoal;
  revenue?: CompanyRevenue;
  members?: CompanyMember[];
  /** Which machine's driver owns auto-dispatch (defaults to this machine on create). */
  homeMachineKey?: string;
  /** Project-registry id of the company's domain code repo. */
  projectId?: string;
  /** Autonomy execution engine and, for AEON, its saved profile + skill binding. */
  execution?: Company["execution"];
  /** Official product catalog (what the company sells, at what price). */
  products?: CompanyProductCatalog;
  /** Explicit company approval policy overrides. */
  approvalPolicies?: CompanyApprovalPolicy[];
  /** Approval backpressure: auto-pause new-work dispatch when too many items wait on a human. */
  autonomyPause?: CompanyAutonomyPause | null;
  /** Which analytics provider this company's numbers come from. */
  analyticsProvider?: Company["analyticsProvider"];
  /** Per-company analytics link (project/site id + optional self-host). */
  analyticsConfig?: Company["analyticsConfig"];
  /** Imported legacy operations discovered from an existing repo. */
  importedOperations?: Company["importedOperations"];
  /** Reviewable knowledge extracted from a local data room. */
  importedKnowledge?: Company["importedKnowledge"];
  /** Standing directives (Learning-tab injections + deliverable-rejection feedback). */
  directives?: Company["directives"];
};

export async function upsertCompany(input: UpsertCompanyInput): Promise<Company> {
  const name = input.name?.trim();
  if (!name) throw new Error("Company name is required.");
  const now = Date.now();
  const records = await readRaw();
  const existing = input.id ? records.find((record) => record.id === input.id) : undefined;

  // Members (when supplied) are authoritative for membership; otherwise fall
  // back to an explicit agentIds list, then to the existing roster.
  const members = input.members !== undefined ? normalizeMembers(input.members) : existing?.members;
  const agentIds = members
    ? agentIdsFromMembers(members)
    : input.agentIds !== undefined
      ? normalizeAgentIds(input.agentIds)
      : (existing?.agentIds ?? []);
  const companyId = existing?.id ?? input.id?.trim() ?? randomUUID();
  assertExclusiveCompanyMembership(records, companyId, agentIds);

  const company: Company = {
    id: companyId,
    name,
    agentIds,
    charter: input.charter !== undefined ? trimmed(input.charter) : existing?.charter,
    dailyBudgetUsd: input.dailyBudgetUsd !== undefined ? normalizeBudget(input.dailyBudgetUsd) : existing?.dailyBudgetUsd,
    monthlyBudgetUsd: input.monthlyBudgetUsd !== undefined ? normalizeBudget(input.monthlyBudgetUsd) : existing?.monthlyBudgetUsd,
    totalBudgetUsd: input.totalBudgetUsd !== undefined ? normalizeBudget(input.totalBudgetUsd) : existing?.totalBudgetUsd,
    frozen: input.frozen ?? existing?.frozen ?? false,
    createdAt: existing?.createdAt ?? new Date(now).toISOString(),
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAt: new Date(now).toISOString(),
    // Optional metadata: explicit input overrides, else preserve what exists.
    ticker: input.ticker !== undefined ? trimmed(input.ticker)?.toUpperCase() : existing?.ticker,
    sector: input.sector !== undefined ? trimmed(input.sector) : existing?.sector,
    blurb: input.blurb !== undefined ? trimmed(input.blurb) : existing?.blurb,
    status: input.status !== undefined ? normalizeStatus(input.status) : existing?.status,
    alignment: input.alignment !== undefined ? normalizeAlignment(input.alignment) : existing?.alignment,
    apexGoal: input.apexGoal !== undefined ? normalizeApexGoal(input.apexGoal) : existing?.apexGoal,
    revenue: input.revenue !== undefined ? normalizeRevenue(input.revenue) : existing?.revenue,
    members: members ?? undefined,
    lastDispatchedAt: existing?.lastDispatchedAt,
    autonomy: existing?.autonomy,
    autonomyPause: input.autonomyPause !== undefined ? normalizeAutonomyPause(input.autonomyPause) : existing?.autonomyPause,
    process: existing?.process,
    execution: input.execution !== undefined ? normalizeCompanyExecutionConfig(input.execution) : existing?.execution,
    flowTemplateId: existing?.flowTemplateId,
    // New companies are claimed by the machine that created them so exactly one
    // fleet driver auto-dispatches (definitions replicate through the vault).
    homeMachineKey: input.homeMachineKey !== undefined ? trimmed(input.homeMachineKey) : (existing?.homeMachineKey ?? (existing ? undefined : hostname())),
    projectId: input.projectId !== undefined ? trimmed(input.projectId) : existing?.projectId,
    products: input.products !== undefined ? normalizeCompanyProductCatalog(input.products) : existing?.products,
    // Proposals are crew/human-resolved only — never writable through upsert.
    pricingProposals: existing?.pricingProposals,
    approvalPolicies: input.approvalPolicies !== undefined ? normalizeCompanyApprovalPolicies(input.approvalPolicies) : existing?.approvalPolicies,
    analyticsProvider: input.analyticsProvider !== undefined ? input.analyticsProvider : existing?.analyticsProvider,
    analyticsConfig:
      input.analyticsConfig !== undefined
        ? { projectId: trimmed(input.analyticsConfig.projectId), host: trimmed(input.analyticsConfig.host) }
        : existing?.analyticsConfig,
    importedOperations: input.importedOperations !== undefined ? normalizeImportedOperations(input.importedOperations) : existing?.importedOperations,
    importedKnowledge: input.importedKnowledge !== undefined ? normalizeImportedKnowledge(input.importedKnowledge) : existing?.importedKnowledge,
    directives: input.directives !== undefined ? input.directives : existing?.directives,
    // Guardrails have dedicated merge-safe mutation paths and are never writable
    // through generic company edits, but they must survive those edits.
    apiBudgets: existing?.apiBudgets,
    integrationLimits: existing?.integrationLimits,
  };

  const next = existing
    ? records.map((record) => (record.id === company.id ? company : record))
    : [...records, company];
  await writeRaw(next);
  await recordConfigChange(existing ? "updated" : "created", existing ?? null, company, "companies-store:upsert");
  return company;
}

/**
 * Append a standing directive to a company (Learning-tab injection or a
 * deliverable-rejection redirect). It lands in the crew's dispatch context on
 * the next cycle without any charter edit.
 */
function normalizeDirectiveSkillSlugs(input: { skill?: string; skills?: string[] }) {
  return [...new Set([
    ...(Array.isArray(input.skills) ? input.skills : []),
    ...(input.skill ? [input.skill] : []),
  ].map((slug) => slug.trim()).filter(Boolean))];
}

export async function addCompanyDirective(
  companyId: string,
  input: { text: string; skill?: string; skills?: string[]; attachments?: CompanyDirective["attachments"]; source?: CompanyDirective["source"]; deliverableRef?: string },
): Promise<Company | null> {
  const text = input.text?.trim();
  if (!text) throw new Error("Directive text is required.");
  const records = await readRaw();
  const existing = records.find((record) => record.id === companyId);
  if (!existing) return null;
  const skills = normalizeDirectiveSkillSlugs(input);
  const entry: CompanyDirective = {
    id: `dir_${randomUUID()}`,
    text,
    source: input.source === "reject" ? "reject" : "inject",
    createdAt: new Date().toISOString(),
    ...(skills.length ? { skill: skills[0], skills } : {}),
    ...(input.deliverableRef?.trim() ? { deliverableRef: input.deliverableRef.trim() } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
  const company: Company = { ...existing, directives: [...(existing.directives ?? []), entry], updatedAt: new Date().toISOString() };
  await writeRaw(records.map((record) => (record.id === companyId ? company : record)));
  await recordConfigChange("updated", existing, company, "companies-store:add-directive");
  if (entry.source === "reject") {
    const { appendCompanyMemory } = await import("@/lib/services/company-memory");
    await appendCompanyMemory(companyId, {
      kind: "note",
      title: `Deliverable redirected: ${entry.deliverableRef ?? "output"}`,
      detail: entry.text,
      data: { directiveId: entry.id, skills: entry.skills ?? (entry.skill ? [entry.skill] : []) },
    }).catch(() => undefined);
    await createCompanyProposal(companyId, {
      kind: "deliverable-redirect",
      status: "applied",
      title: `Deliverable redirected: ${entry.deliverableRef ?? "output"}`,
      summary: entry.text,
      idempotencyKey: `deliverable-redirect:${entry.id}`,
      risk: "medium",
      proposedChange: {
        directiveId: entry.id,
        deliverableRef: entry.deliverableRef,
        skills: entry.skills ?? (entry.skill ? [entry.skill] : []),
      },
      evidence: [entry.text],
      createdBy: "human",
      decidedBy: "human",
      decision: "Rejected the deliverable and added a standing directive for future dispatches.",
    }).catch(() => undefined);
  }
  return company;
}

/** Remove a standing directive by id. */
export async function removeCompanyDirective(companyId: string, directiveId: string): Promise<Company | null> {
  const records = await readRaw();
  const existing = records.find((record) => record.id === companyId);
  if (!existing) return null;
  const company: Company = {
    ...existing,
    directives: (existing.directives ?? []).filter((directive) => directive.id !== directiveId),
    updatedAt: new Date().toISOString(),
  };
  await writeRaw(records.map((record) => (record.id === companyId ? company : record)));
  await recordConfigChange("updated", existing, company, "companies-store:remove-directive");
  return company;
}

/** Record that the apex goal was just decomposed + dispatched to the crew. */
export async function markCompanyDispatched(id: string, when = Date.now()): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  company.lastDispatchedAt = when;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  return company;
}

/** Turn perpetual autonomy on/off for a company (the driver's per-company gate). */
export async function setCompanyAutonomy(id: string, enabled: boolean): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  company.autonomy = enabled;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:set-autonomy");
  return company;
}

/** Loose business-number parse: "$1,234.50", "12k", "30%", "1.2m" → number. */
export function parseMetricNumber(value?: string | number | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = (value ?? "").replace(/[$,\s%]/g, "").toLowerCase();
  if (!cleaned) return null;
  const match = /^(-?\d+(?:\.\d+)?)(k|m|b)?$/.exec(cleaned);
  if (!match) return null;
  const multiplier = match[2] === "k" ? 1e3 : match[2] === "m" ? 1e6 : match[2] === "b" ? 1e9 : 1;
  return Number(match[1]) * multiplier;
}

export type UpdateCompanyMetricInput = {
  /** New reading for apexGoal.current (any business unit: "$1,240", "312", "4.8%"). */
  current?: string | number;
  /** Explicit 0–100 progress; derived from current/target when both parse numerically. */
  progress?: number;
  /** Optional headline revenue/DAU display value + delta. */
  revenueValue?: string;
  revenueDelta?: string;
  /** Attribution recorded in company memory, e.g. "maps-agency daily metrics". */
  source?: string;
  note?: string;
};

/**
 * Generic trackable rail: any business (script, bridge, or agent) posts its
 * metric readings here — apexGoal.current/progress and the headline revenue
 * stay live without manual edits, and every update lands in company memory.
 */
export async function updateCompanyMetric(id: string, input: UpdateCompanyMetricInput): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;

  if (input.current !== undefined) {
    const currentText = typeof input.current === "number" ? String(input.current) : input.current.trim();
    company.apexGoal = { ...(company.apexGoal ?? { title: company.name }), current: currentText || undefined };
  }
  const explicitProgress = normalizeAlignment(input.progress);
  if (explicitProgress !== undefined) {
    company.apexGoal = { ...(company.apexGoal ?? { title: company.name }), progress: explicitProgress };
  } else if (input.current !== undefined) {
    const currentNum = parseMetricNumber(company.apexGoal?.current);
    const targetNum = parseMetricNumber(company.apexGoal?.target);
    if (currentNum !== null && targetNum !== null && targetNum > 0) {
      company.apexGoal = {
        ...(company.apexGoal ?? { title: company.name }),
        progress: Math.max(0, Math.min(100, Math.round((currentNum / targetNum) * 100))),
      };
    }
  }
  if (input.revenueValue !== undefined) {
    const value = input.revenueValue.trim();
    if (value) {
      company.revenue = {
        ...(company.revenue ?? { label: company.apexGoal?.metric?.trim() || "Revenue", value }),
        value,
        delta: input.revenueDelta?.trim() || company.revenue?.delta || null,
      };
    }
  }
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);

  const { appendCompanyMemory } = await import("@/lib/services/company-memory");
  const readings = [
    input.current !== undefined ? `${company.apexGoal?.metric?.trim() || "metric"} = ${company.apexGoal?.current}` : null,
    input.revenueValue !== undefined ? `revenue = ${input.revenueValue}` : null,
    company.apexGoal?.progress !== undefined ? `${company.apexGoal.progress}% to target` : null,
  ].filter(Boolean).join(", ");
  await appendCompanyMemory(company.id, {
    kind: "metric",
    title: `Metric update: ${readings || "reading recorded"}`,
    detail: [input.note?.trim(), input.source ? `Source: ${input.source.trim()}` : null].filter(Boolean).join(" — ") || undefined,
  }).catch(() => undefined);

  return company;
}

export async function setCompanyFrozen(id: string, frozen: boolean): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  company.frozen = frozen;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:set-frozen");
  return company;
}

/** Merge-safe update of ONLY a company's analytics link (provider + project/site/
 *  property config), so the Analytics tab's cards can (re)point a company without a
 *  full upsert that could blank other fields. An empty provider unlinks and clears
 *  the config. */
export async function setCompanyAnalytics(
  id: string,
  provider: Company["analyticsProvider"] | "" | undefined,
  config?: { projectId?: string; host?: string },
): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  const nextProvider = provider ? provider : undefined;
  company.analyticsProvider = nextProvider;
  company.analyticsConfig = nextProvider
    ? { projectId: trimmed(config?.projectId), host: trimmed(config?.host) }
    : undefined;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, "companies-store:set-analytics");
  return company;
}

export async function deleteCompany(id: string): Promise<boolean> {
  const records = await readRaw();
  const removed = records.find((record) => record.id === id) ?? null;
  const next = records.filter((record) => record.id !== id);
  if (next.length === records.length) return false;
  await writeRaw(next);
  await recordConfigChange("deleted", removed, null, "companies-store:delete");
  return true;
}

function remaining(cap: number | undefined, spent: number): number | null {
  if (!cap || cap <= 0) return null;
  return Math.round((cap - spent) * 100) / 100;
}

/** Sum one member agent's company-scoped executed spend since `sinceMs`. */
function sumMemberSpendUsd(records: SpendLedgerRecord[], companyId: string, agentId: string, sinceMs: number): number {
  let total = 0;
  for (const record of records) {
    if (record.status !== "executed") continue;
    if (record.createdAtMs < sinceMs) continue;
    if (record.companyId !== companyId || record.agentId !== agentId) continue;
    total += Number(record.amountUsd) || 0;
  }
  return Math.round(total * 100) / 100;
}

export async function companySpendRollup(company: Company, memberCount: number, now = Date.now()): Promise<CompanySpendRollup> {
  const ledger = await readSpendLedger();
  const dailySpentUsd = await sumCompanySpendUsdSince(company.id, now - ROLLING_DAY_MS, ledger);
  const monthlySpentUsd = await sumCompanySpendUsdSince(company.id, now - ROLLING_MONTH_MS, ledger);
  const totalSpentUsd = await sumCompanySpendUsdSince(company.id, 0, ledger);
  const apiSpentUsd = await sumCompanyKindSpendUsdSince(company.id, "api", now - ROLLING_DAY_MS, ledger);
  const apiMonthlySpentUsd = await sumCompanyKindSpendUsdSince(company.id, "api", now - ROLLING_MONTH_MS, ledger);

  const memberSpend: Record<string, CompanyMemberSpend> = {};
  for (const agentId of company.agentIds ?? []) {
    memberSpend[agentId] = {
      dailyUsd: sumMemberSpendUsd(ledger, company.id, agentId, now - ROLLING_DAY_MS),
      monthlyUsd: sumMemberSpendUsd(ledger, company.id, agentId, now - ROLLING_MONTH_MS),
      totalUsd: sumMemberSpendUsd(ledger, company.id, agentId, 0),
    };
  }

  return {
    companyId: company.id,
    memberCount,
    dailySpentUsd,
    monthlySpentUsd,
    totalSpentUsd,
    dailyRemainingUsd: remaining(company.dailyBudgetUsd, dailySpentUsd),
    monthlyRemainingUsd: remaining(company.monthlyBudgetUsd, monthlySpentUsd),
    totalRemainingUsd: remaining(company.totalBudgetUsd, totalSpentUsd),
    apiSpentUsd,
    apiMonthlySpentUsd,
    memberSpend,
  };
}

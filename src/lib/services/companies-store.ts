import "server-only";

import { promises as fs } from "fs";
import { statSync } from "fs";
import { hostname } from "os";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import { sameMachineIdentity } from "@/features/fleet/fleet-identity";
import { recordCompanyConfigChange, type CompanyConfigAction } from "@/lib/services/company-governance";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type {
  Company,
  CompanyApexGoal,
  CompanyDirective,
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
import {
  ROLLING_DAY_MS,
  ROLLING_MONTH_MS,
  readSpendLedger,
  sumCompanySpendUsdSince,
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

async function readCompaniesFile(file: string): Promise<Company[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Company[]) : [];
  } catch {
    return [];
  }
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, contents, { mode: 0o600 });
  await fs.rename(tmp, file);
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
    process: record.process,
    flowTemplateId: record.flowTemplateId,
    homeMachineKey: record.homeMachineKey,
    projectId: record.projectId,
    products: record.products,
    pricingProposals: record.pricingProposals,
    analyticsProvider: record.analyticsProvider,
    analyticsConfig: record.analyticsConfig,
    directives: record.directives,
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
  await writeFileAtomic(file, JSON.stringify(definitions, null, 2));
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
  const legacy = await readCompaniesFile(COMPANIES_PATH);
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

async function writeRaw(records: Company[]): Promise<void> {
  const storage = resolveCompaniesStorage();
  if (storage.source === "local") {
    await writeFileAtomic(storage.file, JSON.stringify(records, null, 2));
    return;
  }
  const overlay = await readRuntimeOverlay();
  const nextRuntime: CompanyRuntimeOverlay["companies"] = {};
  for (const record of records) nextRuntime[record.id] = companyRuntimeStateOf(record);
  overlay.companies = nextRuntime; // entries for deleted companies drop out here
  await writeRuntimeOverlay(overlay);
  await writeDefinitionsIfChanged(storage.file, records);
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
  return (await readRaw()).sort((a, b) => a.name.localeCompare(b.name));
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
  return all.find((company) => company.agentIds?.includes(agentId)) ?? null;
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

/** Slug key for a product derived from its name when none is given. */
function productKeyFrom(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "product";
}

const PRODUCT_INTERVALS: NonNullable<CompanyProduct["interval"]>[] = ["one-time", "month", "year"];

/** Normalize one product entry; null when it has no usable name or price. */
function normalizeProduct(value: unknown, taken: Set<string>): CompanyProduct | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = trimmed(raw.name);
  const amount = Number(raw.amountUsd);
  if (!name || !Number.isFinite(amount) || amount < 0) return null;
  let key = trimmed(raw.key)?.toLowerCase() || productKeyFrom(name);
  while (taken.has(key)) key = `${key}-2`;
  taken.add(key);
  const interval = typeof raw.interval === "string" && (PRODUCT_INTERVALS as string[]).includes(raw.interval)
    ? (raw.interval as CompanyProduct["interval"])
    : undefined;
  return {
    key,
    name,
    amountUsd: Math.round(amount * 100) / 100,
    description: trimmed(raw.description),
    recommended: raw.recommended === true || undefined,
    interval: interval === "one-time" ? undefined : interval,
    kind: raw.kind === "addon" ? "addon" : undefined,
  };
}

/** Normalize a product catalog; undefined when the input has no valid items and no seed marker. */
function normalizeProductCatalog(value: unknown): CompanyProductCatalog | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const taken = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => normalizeProduct(item, taken))
    .filter((item): item is CompanyProduct => item !== null);
  // "Recommended" is THE default pick agents lead with in offers — at most one
  // per group (packages / add-ons); the first marked one wins, extras clear.
  const recommendedSeen = new Set<string>();
  for (const item of items) {
    if (!item.recommended) continue;
    const group = item.kind === "addon" ? "addon" : "package";
    if (recommendedSeen.has(group)) delete item.recommended;
    else recommendedSeen.add(group);
  }
  const seededFrom = trimmed(raw.seededFrom);
  // An empty catalog with a seed marker is meaningful: "seeded/considered, then
  // emptied by the human" — it must not be re-seeded on the next read.
  if (items.length === 0 && !seededFrom) return undefined;
  return { items, seededFrom, updatedAt: trimmed(raw.updatedAt) };
}

/**
 * Replace a company's product catalog (the Products tab save path and the
 * seeders both land here so every change hits the replicated vault file and the
 * governance trail).
 */
export async function setCompanyProducts(
  id: string,
  input: { items: CompanyProduct[] | unknown[]; seededFrom?: string },
  source = "companies-store:set-products",
): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  const before = companyDefinitionOf(company);
  const catalog = normalizeProductCatalog({
    items: input.items,
    seededFrom: input.seededFrom ?? company.products?.seededFrom ?? "ui",
    updatedAt: new Date().toISOString(),
  });
  company.products = catalog;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  await recordConfigChange("updated", before, company, source);
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
  if (normalizedMembers) {
    company.members = normalizedMembers;
    company.agentIds = agentIdsFromMembers(normalizedMembers);
  } else {
    company.agentIds = normalizeAgentIds(agentIds);
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
  /** Official product catalog (what the company sells, at what price). */
  products?: CompanyProductCatalog;
  /** Which analytics provider this company's numbers come from. */
  analyticsProvider?: Company["analyticsProvider"];
  /** Per-company analytics link (project/site id + optional self-host). */
  analyticsConfig?: Company["analyticsConfig"];
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

  const company: Company = {
    id: existing?.id ?? input.id?.trim() ?? randomUUID(),
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
    process: existing?.process,
    flowTemplateId: existing?.flowTemplateId,
    // New companies are claimed by the machine that created them so exactly one
    // fleet driver auto-dispatches (definitions replicate through the vault).
    homeMachineKey: input.homeMachineKey !== undefined ? trimmed(input.homeMachineKey) : (existing?.homeMachineKey ?? (existing ? undefined : hostname())),
    projectId: input.projectId !== undefined ? trimmed(input.projectId) : existing?.projectId,
    products: input.products !== undefined ? normalizeProductCatalog(input.products) : existing?.products,
    // Proposals are crew/human-resolved only — never writable through upsert.
    pricingProposals: existing?.pricingProposals,
    analyticsProvider: input.analyticsProvider !== undefined ? input.analyticsProvider : existing?.analyticsProvider,
    analyticsConfig:
      input.analyticsConfig !== undefined
        ? { projectId: trimmed(input.analyticsConfig.projectId), host: trimmed(input.analyticsConfig.host) }
        : existing?.analyticsConfig,
    directives: input.directives !== undefined ? input.directives : existing?.directives,
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
    memberSpend,
  };
}

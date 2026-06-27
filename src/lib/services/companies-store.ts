import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import type {
  Company,
  CompanyApexGoal,
  CompanyMember,
  CompanyMemberSpend,
  CompanyMetricUnit,
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

export const COMPANIES_PATH = path.join(homedir(), ".hivemindos", "companies.json");

async function readRaw(): Promise<Company[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(COMPANIES_PATH, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as Company[]) : [];
  } catch {
    return [];
  }
}

async function writeRaw(records: Company[]): Promise<void> {
  await fs.mkdir(path.dirname(COMPANIES_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(COMPANIES_PATH, JSON.stringify(records, null, 2), { mode: 0o600 });
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
  };

  const next = existing
    ? records.map((record) => (record.id === company.id ? company : record))
    : [...records, company];
  await writeRaw(next);
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
  company.autonomy = enabled;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  return company;
}

export async function setCompanyFrozen(id: string, frozen: boolean): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  company.frozen = frozen;
  company.updatedAt = new Date().toISOString();
  await writeRaw(records);
  return company;
}

export async function deleteCompany(id: string): Promise<boolean> {
  const records = await readRaw();
  const next = records.filter((record) => record.id !== id);
  if (next.length === records.length) return false;
  await writeRaw(next);
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

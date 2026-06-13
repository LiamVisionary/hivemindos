import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import type { Company, CompanySpendRollup } from "@/lib/types/company";
import {
  ROLLING_DAY_MS,
  ROLLING_MONTH_MS,
  readSpendLedger,
  sumCompanySpendUsdSince,
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

/** Replace a company's member list (membership is managed from the company side). */
export async function setCompanyAgents(id: string, agentIds: string[]): Promise<Company | null> {
  const records = await readRaw();
  const company = records.find((record) => record.id === id);
  if (!company) return null;
  company.agentIds = normalizeAgentIds(agentIds);
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
};

export async function upsertCompany(input: UpsertCompanyInput): Promise<Company> {
  const name = input.name?.trim();
  if (!name) throw new Error("Company name is required.");
  const now = Date.now();
  const records = await readRaw();
  const existing = input.id ? records.find((record) => record.id === input.id) : undefined;

  const company: Company = {
    id: existing?.id ?? input.id?.trim() ?? randomUUID(),
    name,
    agentIds: input.agentIds !== undefined ? normalizeAgentIds(input.agentIds) : (existing?.agentIds ?? []),
    charter: input.charter?.trim() || existing?.charter,
    dailyBudgetUsd: input.dailyBudgetUsd !== undefined ? normalizeBudget(input.dailyBudgetUsd) : existing?.dailyBudgetUsd,
    monthlyBudgetUsd: input.monthlyBudgetUsd !== undefined ? normalizeBudget(input.monthlyBudgetUsd) : existing?.monthlyBudgetUsd,
    totalBudgetUsd: input.totalBudgetUsd !== undefined ? normalizeBudget(input.totalBudgetUsd) : existing?.totalBudgetUsd,
    frozen: input.frozen ?? existing?.frozen ?? false,
    createdAt: existing?.createdAt ?? new Date(now).toISOString(),
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAt: new Date(now).toISOString(),
  };

  const next = existing
    ? records.map((record) => (record.id === company.id ? company : record))
    : [...records, company];
  await writeRaw(next);
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

export async function companySpendRollup(company: Company, memberCount: number, now = Date.now()): Promise<CompanySpendRollup> {
  const ledger = await readSpendLedger();
  const dailySpentUsd = await sumCompanySpendUsdSince(company.id, now - ROLLING_DAY_MS, ledger);
  const monthlySpentUsd = await sumCompanySpendUsdSince(company.id, now - ROLLING_MONTH_MS, ledger);
  const totalSpentUsd = await sumCompanySpendUsdSince(company.id, 0, ledger);
  return {
    companyId: company.id,
    memberCount,
    dailySpentUsd,
    monthlySpentUsd,
    totalSpentUsd,
    dailyRemainingUsd: remaining(company.dailyBudgetUsd, dailySpentUsd),
    monthlyRemainingUsd: remaining(company.monthlyBudgetUsd, monthlySpentUsd),
    totalRemainingUsd: remaining(company.totalBudgetUsd, totalSpentUsd),
  };
}

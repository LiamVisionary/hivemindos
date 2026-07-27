import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import type { Company, CompanyIntegrationLimit } from "@/lib/types/company";
import type { ConnectionProviderKey } from "@/lib/types/integrations";

export const COMPANY_API_USAGE_PATH = path.join(homedir(), ".hivemindos", "company-api-usage.json");
const COMPANY_API_USAGE_LOCK_PATH = `${COMPANY_API_USAGE_PATH}.lock`;
const MAX_RECORDS = 10_000;
const LOCK_TIMEOUT_MS = 3_000;
const STALE_LOCK_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type CompanyApiUsageStatus = "reserved" | "observed" | "voided";

export interface CompanyApiUsageRecord {
  id: string;
  companyId: string;
  providerKey: ConnectionProviderKey;
  operationId?: string;
  requestCount: number;
  amountUsd: number;
  status: CompanyApiUsageStatus;
  source: string;
  idempotencyKey?: string;
  createdAt: string;
  createdAtMs: number;
}

export interface CompanyApiUsageInput {
  providerKey: ConnectionProviderKey;
  operationId?: string;
  requestCount?: number;
  amountUsd?: number;
  source?: string;
  idempotencyKey?: string;
}

export interface CompanyApiUsageTotals {
  dailyRequests: number;
  monthlyRequests: number;
  dailySpendUsd: number;
  monthlySpendUsd: number;
}

export interface CompanyApiUsageDecision {
  decision: "allow" | "block";
  reason?: string;
  limitId?: string;
  usage: CompanyApiUsageTotals;
}

export interface CompanyApiUsageSeriesPoint {
  date: string;
  requests: number;
  spendUsd: number;
}

export interface CompanyApiProviderUsage extends CompanyApiUsageTotals {
  providerKey: ConnectionProviderKey;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  dailySpendLimitUsd?: number;
  monthlySpendLimitUsd?: number;
}

export interface CompanyApiUsageSnapshot extends CompanyApiUsageTotals {
  series: CompanyApiUsageSeriesPoint[];
  byProvider: CompanyApiProviderUsage[];
  recent: CompanyApiUsageRecord[];
}

export class CompanyApiUsageLedgerCorruptError extends Error {
  readonly file: string;
  readonly reason?: unknown;

  constructor(file: string, reason?: unknown) {
    super(
      `[company-api-usage] refusing to read a corrupt usage ledger at ${file}. ` +
        "Existing API usage was not overwritten; repair or restore the file before retrying.",
    );
    this.name = "CompanyApiUsageLedgerCorruptError";
    this.file = file;
    this.reason = reason;
  }
}

function utcDayStart(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcMonthStart(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function positiveFinite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizedUsageInput(input: CompanyApiUsageInput): Required<Pick<CompanyApiUsageInput, "requestCount" | "amountUsd">> {
  const requestCount = input.requestCount ?? 1;
  const amountUsd = input.amountUsd ?? 0;
  if (!Number.isInteger(requestCount) || requestCount < 0) {
    throw new Error("requestCount must be a non-negative integer.");
  }
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    throw new Error("amountUsd must be a finite non-negative number.");
  }
  if (requestCount === 0 && amountUsd === 0) {
    throw new Error("API usage must include at least one request or a positive amountUsd.");
  }
  return { requestCount, amountUsd };
}

function recordIsCounted(record: CompanyApiUsageRecord): boolean {
  return record.status !== "voided";
}

function recordMatchesInput(
  record: CompanyApiUsageRecord,
  input: CompanyApiUsageInput,
  increment: { requestCount: number; amountUsd: number },
  status: Exclude<CompanyApiUsageStatus, "voided">,
): boolean {
  return record.status === status &&
    record.providerKey === input.providerKey &&
    record.operationId === (input.operationId?.trim() || undefined) &&
    record.requestCount === increment.requestCount &&
    record.amountUsd === increment.amountUsd;
}

function totalsFor(
  companyId: string,
  records: CompanyApiUsageRecord[],
  now: number,
  providerKey?: ConnectionProviderKey,
  operationId?: string,
): CompanyApiUsageTotals {
  const dayStart = utcDayStart(now);
  const monthStart = utcMonthStart(now);
  let dailyRequests = 0;
  let monthlyRequests = 0;
  let dailySpendUsd = 0;
  let monthlySpendUsd = 0;

  for (const record of records) {
    if (record.companyId !== companyId || !recordIsCounted(record)) continue;
    if (providerKey && record.providerKey !== providerKey) continue;
    if (operationId && record.operationId !== operationId) continue;
    if (record.createdAtMs >= monthStart && record.createdAtMs <= now) {
      monthlyRequests += record.requestCount;
      monthlySpendUsd += record.amountUsd;
    }
    if (record.createdAtMs >= dayStart && record.createdAtMs <= now) {
      dailyRequests += record.requestCount;
      dailySpendUsd += record.amountUsd;
    }
  }
  return { dailyRequests, monthlyRequests, dailySpendUsd, monthlySpendUsd };
}

function applicableLimits(company: Pick<Company, "integrationLimits">, input: CompanyApiUsageInput): CompanyIntegrationLimit[] {
  return (company.integrationLimits ?? []).filter(
    (limit) =>
      limit.providerKey === input.providerKey &&
      (!limit.operationId || limit.operationId === input.operationId),
  );
}

export function evaluateCompanyApiUsage(
  company: Pick<Company, "id" | "frozen" | "integrationLimits">,
  input: CompanyApiUsageInput,
  records: CompanyApiUsageRecord[],
  now = Date.now(),
): CompanyApiUsageDecision {
  const increment = normalizedUsageInput(input);
  const providerUsage = totalsFor(company.id, records, now, input.providerKey);
  if (company.frozen) {
    return { decision: "block", reason: "The company is frozen by its kill switch.", usage: providerUsage };
  }

  for (const limit of applicableLimits(company, input)) {
    const usage = totalsFor(company.id, records, now, input.providerKey, limit.operationId);
    const dailyRequestLimit = positiveFinite(limit.dailyRequestLimit);
    if (dailyRequestLimit && usage.dailyRequests + increment.requestCount > dailyRequestLimit) {
      return { decision: "block", reason: `This call would exceed the daily request limit of ${dailyRequestLimit}.`, limitId: limit.id, usage: providerUsage };
    }
    const monthlyRequestLimit = positiveFinite(limit.monthlyRequestLimit);
    if (monthlyRequestLimit && usage.monthlyRequests + increment.requestCount > monthlyRequestLimit) {
      return { decision: "block", reason: `This call would exceed the monthly request limit of ${monthlyRequestLimit}.`, limitId: limit.id, usage: providerUsage };
    }
    const dailySpendLimitUsd = positiveFinite(limit.dailySpendLimitUsd);
    if (dailySpendLimitUsd && usage.dailySpendUsd + increment.amountUsd > dailySpendLimitUsd) {
      return { decision: "block", reason: `This call would exceed the daily spend limit of $${dailySpendLimitUsd}.`, limitId: limit.id, usage: providerUsage };
    }
    const monthlySpendLimitUsd = positiveFinite(limit.monthlySpendLimitUsd);
    if (monthlySpendLimitUsd && usage.monthlySpendUsd + increment.amountUsd > monthlySpendLimitUsd) {
      return { decision: "block", reason: `This call would exceed the monthly spend limit of $${monthlySpendLimitUsd}.`, limitId: limit.id, usage: providerUsage };
    }
  }

  return { decision: "allow", usage: providerUsage };
}

export function buildCompanyApiUsageSnapshot(
  companyId: string,
  records: CompanyApiUsageRecord[],
  limits: CompanyIntegrationLimit[] = [],
  now = Date.now(),
): CompanyApiUsageSnapshot {
  const totals = totalsFor(companyId, records, now);
  const currentDayStart = utcDayStart(now);
  const firstDayStart = currentDayStart - 29 * DAY_MS;
  const series = Array.from({ length: 30 }, (_, index) => {
    const dayStart = firstDayStart + index * DAY_MS;
    return {
      date: new Date(dayStart).toISOString().slice(0, 10),
      requests: 0,
      spendUsd: 0,
    };
  });
  const seriesByDate = new Map(series.map((point) => [point.date, point]));
  const providerKeys = new Set<ConnectionProviderKey>(limits.map((limit) => limit.providerKey));

  for (const record of records) {
    if (record.companyId !== companyId || !recordIsCounted(record)) continue;
    providerKeys.add(record.providerKey);
    if (record.createdAtMs < firstDayStart || record.createdAtMs > now) continue;
    const point = seriesByDate.get(new Date(utcDayStart(record.createdAtMs)).toISOString().slice(0, 10));
    if (!point) continue;
    point.requests += record.requestCount;
    point.spendUsd += record.amountUsd;
  }

  const byProvider = [...providerKeys]
    .map((providerKey): CompanyApiProviderUsage => {
      const providerTotals = totalsFor(companyId, records, now, providerKey);
      const providerWide = limits.find((limit) => limit.providerKey === providerKey && !limit.operationId);
      return {
        providerKey,
        ...providerTotals,
        dailyRequestLimit: positiveFinite(providerWide?.dailyRequestLimit),
        monthlyRequestLimit: positiveFinite(providerWide?.monthlyRequestLimit),
        dailySpendLimitUsd: positiveFinite(providerWide?.dailySpendLimitUsd),
        monthlySpendLimitUsd: positiveFinite(providerWide?.monthlySpendLimitUsd),
      };
    })
    .sort((a, b) => b.monthlySpendUsd - a.monthlySpendUsd || b.monthlyRequests - a.monthlyRequests);

  const recent = records
    .filter((record) => record.companyId === companyId && recordIsCounted(record))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .slice(0, 20);

  return { ...totals, series, byProvider, recent };
}

function normalizeRecord(value: unknown): CompanyApiUsageRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CompanyApiUsageRecord>;
  const createdAtMs = Number(record.createdAtMs);
  const requestCount = Number(record.requestCount);
  const amountUsd = Number(record.amountUsd);
  if (
    typeof record.id !== "string" ||
    typeof record.companyId !== "string" ||
    typeof record.providerKey !== "string" ||
    !Number.isInteger(requestCount) ||
    requestCount < 0 ||
    !Number.isFinite(amountUsd) ||
    amountUsd < 0 ||
    !Number.isFinite(createdAtMs)
  ) return null;
  return {
    id: record.id,
    companyId: record.companyId,
    providerKey: record.providerKey as ConnectionProviderKey,
    operationId: typeof record.operationId === "string" ? record.operationId : undefined,
    requestCount,
    amountUsd,
    status: record.status === "observed" || record.status === "voided" ? record.status : "reserved",
    source: typeof record.source === "string" ? record.source : "unknown",
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(createdAtMs).toISOString(),
    createdAtMs,
  };
}

export async function readCompanyApiUsage(): Promise<CompanyApiUsageRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(COMPANY_API_USAGE_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CompanyApiUsageLedgerCorruptError(COMPANY_API_USAGE_PATH, error);
  }
  if (!Array.isArray(parsed)) throw new CompanyApiUsageLedgerCorruptError(COMPANY_API_USAGE_PATH);
  const normalized = parsed.map(normalizeRecord);
  if (normalized.some((record) => record === null)) {
    throw new CompanyApiUsageLedgerCorruptError(COMPANY_API_USAGE_PATH);
  }
  return normalized as CompanyApiUsageRecord[];
}

async function writeCompanyApiUsage(records: CompanyApiUsageRecord[]): Promise<void> {
  const directory = path.dirname(COMPANY_API_USAGE_PATH);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${COMPANY_API_USAGE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(records.slice(-MAX_RECORDS), null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, COMPANY_API_USAGE_PATH);
}

async function releaseStaleLock(): Promise<void> {
  try {
    const stat = await fs.stat(COMPANY_API_USAGE_LOCK_PATH);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      await fs.rm(COMPANY_API_USAGE_LOCK_PATH, { recursive: true, force: true });
    }
  } catch {
    // Missing locks are the common path.
  }
}

async function withUsageLock<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(COMPANY_API_USAGE_LOCK_PATH), { recursive: true, mode: 0o700 });
  while (true) {
    try {
      await fs.mkdir(COMPANY_API_USAGE_LOCK_PATH, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      await releaseStaleLock();
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error("API usage ledger is busy; retry the preflight request.");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.rm(COMPANY_API_USAGE_LOCK_PATH, { recursive: true, force: true });
  }
}

export async function consumeCompanyApiUsage(
  company: Pick<Company, "id" | "frozen" | "integrationLimits">,
  input: CompanyApiUsageInput,
  deps: { now?: () => number } = {},
): Promise<CompanyApiUsageDecision & { duplicate: boolean; record?: CompanyApiUsageRecord }> {
  return withUsageLock(async () => {
    const now = deps.now?.() ?? Date.now();
    const records = await readCompanyApiUsage();
    const increment = normalizedUsageInput(input);
    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = records.find(
        (record) => record.companyId === company.id && record.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        if (!recordMatchesInput(existing, input, increment, "reserved")) {
          throw new Error("The idempotency key was already used for different API usage.");
        }
        const usage = totalsFor(company.id, records, now, input.providerKey);
        return { decision: "allow", usage, duplicate: true, record: existing };
      }
    }

    const decision = evaluateCompanyApiUsage(company, input, records, now);
    if (decision.decision === "block") return { ...decision, duplicate: false };
    const record: CompanyApiUsageRecord = {
      id: randomUUID(),
      companyId: company.id,
      providerKey: input.providerKey,
      operationId: input.operationId?.trim() || undefined,
      requestCount: increment.requestCount,
      amountUsd: increment.amountUsd,
      status: "reserved",
      source: input.source?.trim() || "company-api-preflight",
      idempotencyKey,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
    };
    records.push(record);
    await writeCompanyApiUsage(records);
    return { ...decision, duplicate: false, record };
  });
}

/**
 * Append usage reported by an external meter after execution. Unlike preflight
 * consumption this does not apply a limit retroactively; it preserves the
 * observed fact for charts and future decisions, with retry-safe idempotency.
 */
export async function recordCompanyApiUsage(
  companyId: string,
  input: CompanyApiUsageInput,
  deps: { now?: () => number } = {},
): Promise<{ duplicate: boolean; record: CompanyApiUsageRecord }> {
  return withUsageLock(async () => {
    const now = deps.now?.() ?? Date.now();
    const records = await readCompanyApiUsage();
    const increment = normalizedUsageInput(input);
    const idempotencyKey = input.idempotencyKey?.trim();
    if (idempotencyKey) {
      const existing = records.find(
        (record) => record.companyId === companyId && record.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        if (!recordMatchesInput(existing, input, increment, "observed")) {
          throw new Error("The idempotency key was already used for different API usage.");
        }
        return { duplicate: true, record: existing };
      }
    }
    const record: CompanyApiUsageRecord = {
      id: randomUUID(),
      companyId,
      providerKey: input.providerKey,
      operationId: input.operationId?.trim() || undefined,
      requestCount: increment.requestCount,
      amountUsd: increment.amountUsd,
      status: "observed",
      source: input.source?.trim() || "external-api-meter",
      idempotencyKey,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
    };
    records.push(record);
    await writeCompanyApiUsage(records);
    return { duplicate: false, record };
  });
}

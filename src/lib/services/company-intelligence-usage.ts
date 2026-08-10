import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  FRONTIER_LAB_MODEL_LADDER,
  normalizeFrontierLabPolicy,
} from "@/lib/frontier-lab";
import {
  EARNED_SCALE_POLICY_VERSION,
  type EarnedScaleSettlementEvidence,
} from "@/lib/earned-scale";
import { homedir } from "@/lib/home-dir";
import type {
  Company,
  CompanyFrontierLabModel,
  CompanyFrontierLabPolicy,
  CompanyFrontierLabStage,
  CompanyFrontierLabTaskTier,
} from "@/lib/types/company";

const DEFAULT_LEDGER_PATH = path.join(homedir(), ".hivemindos", "company-intelligence-usage.json");
const MAX_EVENTS = 20_000;
const LOCK_TIMEOUT_MS = 3_000;
const STALE_LOCK_MS = 30_000;

export type CompanyIntelligenceOutcome = "completed" | "blocked" | "failed";
export type CompanyIntelligenceEventStatus = "reserved" | "settled" | "released";

export interface CompanyIntelligenceUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface CompanyIntelligenceUsageEvent {
  id: string;
  reservationId: string;
  companyId: string;
  taskId: string;
  stage?: CompanyFrontierLabStage;
  tier: CompanyFrontierLabTaskTier;
  provider: "openai-oauth";
  model: CompanyFrontierLabModel;
  status: CompanyIntelligenceEventStatus;
  reservedTokens: number;
  usage?: CompanyIntelligenceUsage;
  estimated?: boolean;
  outcome?: CompanyIntelligenceOutcome;
  scaleEvidence?: EarnedScaleSettlementEvidence;
  reason?: string;
  createdAt: string;
  createdAtMs: number;
}

export interface CompanyIntelligenceSnapshot {
  monthlyTokenLimit: number;
  settledTokens: number;
  estimatedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  activeReservations: number;
  settledTasks: number;
  completedTasks: number;
  blockedTasks: number;
  failedTasks: number;
  successRate: number;
  byTier: Record<CompanyFrontierLabTaskTier, { settledTokens: number; reservedTokens: number; tasks: number }>;
  recent: CompanyIntelligenceUsageEvent[];
  periodStart: string;
}

export interface CompanyIntelligenceLedgerOptions {
  filePath?: string;
  now?: () => number;
}

export class CompanyIntelligenceLedgerCorruptError extends Error {
  readonly file: string;
  readonly reason?: unknown;

  constructor(file: string, reason?: unknown) {
    super(`[company-intelligence-usage] refusing to overwrite corrupt intelligence usage at ${file}. Repair or restore the file before retrying.`);
    this.name = "CompanyIntelligenceLedgerCorruptError";
    this.file = file;
    this.reason = reason;
  }
}

function ledgerPath(options: CompanyIntelligenceLedgerOptions): string {
  return options.filePath?.trim() || process.env.HIVEMINDOS_COMPANY_INTELLIGENCE_USAGE_FILE?.trim() || DEFAULT_LEDGER_PATH;
}

function utcMonthStart(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeUsage(input: Partial<CompanyIntelligenceUsage> | undefined): CompanyIntelligenceUsage {
  const inputTokens = nonNegativeInteger(input?.inputTokens);
  const outputTokens = nonNegativeInteger(input?.outputTokens);
  const cachedTokens = nonNegativeInteger(input?.cachedTokens);
  const reasoningTokens = nonNegativeInteger(input?.reasoningTokens);
  const reportedTotal = nonNegativeInteger(input?.totalTokens);
  // Cached tokens are a subset of input and reasoning tokens are a subset of
  // output in the OpenAI/Hermes shapes; keep their detail without double-counting.
  const calculatedTotal = inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens: reportedTotal || calculatedTotal,
  };
}

function normalizeScaleEvidence(input: unknown): EarnedScaleSettlementEvidence | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Partial<EarnedScaleSettlementEvidence>;
  if (value.policyVersion !== EARNED_SCALE_POLICY_VERSION) return undefined;
  const finite = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
  const bool = (candidate: unknown) => typeof candidate === "boolean" ? candidate : undefined;
  return {
    policyVersion: EARNED_SCALE_POLICY_VERSION,
    outcomeScore: finite(value.outcomeScore) === undefined ? undefined : Math.max(0, Math.min(1, finite(value.outcomeScore)!)),
    proofSatisfied: bool(value.proofSatisfied),
    latencyMs: finite(value.latencyMs) === undefined ? undefined : Math.max(0, finite(value.latencyMs)!),
    uniqueContribution: bool(value.uniqueContribution),
    duplicationConflict: bool(value.duplicationConflict),
    humanIntervention: bool(value.humanIntervention),
    reviewerDisagreement: bool(value.reviewerDisagreement),
  };
}

function normalizeEvent(raw: unknown): CompanyIntelligenceUsageEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const event = raw as Partial<CompanyIntelligenceUsageEvent>;
  const tier = event.tier === "builder" || event.tier === "reviewer" ? event.tier : event.tier === "scout" ? "scout" : null;
  const status = event.status === "settled" || event.status === "released" ? event.status : event.status === "reserved" ? "reserved" : null;
  const createdAtMs = typeof event.createdAtMs === "number" && Number.isFinite(event.createdAtMs) ? event.createdAtMs : null;
  if (!event.id || !event.reservationId || !event.companyId || !event.taskId || !tier || !status || createdAtMs === null) return null;
  const model = FRONTIER_LAB_MODEL_LADDER[tier];
  const stage = event.stage === "pilot" || event.stage === "team" || event.stage === "frontier" ? event.stage : undefined;
  return {
    id: event.id,
    reservationId: event.reservationId,
    companyId: event.companyId,
    taskId: event.taskId,
    stage,
    tier,
    provider: "openai-oauth",
    model,
    status,
    reservedTokens: nonNegativeInteger(event.reservedTokens),
    usage: status === "settled" ? normalizeUsage(event.usage) : undefined,
    estimated: event.estimated === true,
    outcome: event.outcome === "completed" || event.outcome === "blocked" || event.outcome === "failed" ? event.outcome : undefined,
    scaleEvidence: status === "settled" ? normalizeScaleEvidence(event.scaleEvidence) : undefined,
    reason: typeof event.reason === "string" && event.reason.trim() ? event.reason.trim() : undefined,
    createdAt: typeof event.createdAt === "string" ? event.createdAt : new Date(createdAtMs).toISOString(),
    createdAtMs,
  };
}

async function readEvents(filePath: string): Promise<CompanyIntelligenceUsageEvent[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CompanyIntelligenceLedgerCorruptError(filePath, error);
  }
  if (!Array.isArray(parsed)) throw new CompanyIntelligenceLedgerCorruptError(filePath);
  const events = parsed.map(normalizeEvent);
  if (events.some((event) => event === null)) throw new CompanyIntelligenceLedgerCorruptError(filePath);
  return events as CompanyIntelligenceUsageEvent[];
}

async function writeEvents(filePath: string, events: CompanyIntelligenceUsageEvent[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(events.slice(-MAX_EVENTS), null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function releaseStaleLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) await fs.rm(lockPath, { recursive: true, force: true });
  } catch {
    // Missing locks are the normal path.
  }
}

async function withLedgerLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
      await releaseStaleLock(lockPath);
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) throw new Error("Company intelligence ledger is busy; retry shortly.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

function monthEvents(events: CompanyIntelligenceUsageEvent[], companyId: string, now: number): CompanyIntelligenceUsageEvent[] {
  const start = utcMonthStart(now);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const reservationStart = new Map<string, number>();
  for (const event of events) {
    if (event.companyId === companyId && event.status === "reserved" && !reservationStart.has(event.reservationId)) {
      reservationStart.set(event.reservationId, event.createdAtMs);
    }
  }
  return events.filter((event) => {
    if (event.companyId !== companyId) return false;
    const reservedAt = reservationStart.get(event.reservationId) ?? event.createdAtMs;
    return reservedAt >= start && reservedAt < next.getTime();
  });
}

function snapshotFromEvents(
  events: CompanyIntelligenceUsageEvent[],
  companyId: string,
  policyInput: CompanyFrontierLabPolicy | undefined,
  now: number,
): CompanyIntelligenceSnapshot {
  const policy = normalizeFrontierLabPolicy(policyInput);
  const periodEvents = monthEvents(events, companyId, now);
  const latest = new Map<string, CompanyIntelligenceUsageEvent>();
  for (const event of periodEvents) latest.set(event.reservationId, event);
  const latestAcrossPeriods = new Map<string, CompanyIntelligenceUsageEvent>();
  for (const event of events) {
    if (event.companyId === companyId) latestAcrossPeriods.set(event.reservationId, event);
  }
  let settledTokens = 0;
  let estimatedTokens = 0;
  let reservedTokens = 0;
  let completedTasks = 0;
  let blockedTasks = 0;
  let failedTasks = 0;
  const latestSettledOutcomeByTask = new Map<string, CompanyIntelligenceUsageEvent>();
  const tierTasks: Record<CompanyFrontierLabTaskTier, Set<string>> = {
    scout: new Set(),
    builder: new Set(),
    reviewer: new Set(),
  };
  const byTier: CompanyIntelligenceSnapshot["byTier"] = {
    scout: { settledTokens: 0, reservedTokens: 0, tasks: 0 },
    builder: { settledTokens: 0, reservedTokens: 0, tasks: 0 },
    reviewer: { settledTokens: 0, reservedTokens: 0, tasks: 0 },
  };
  for (const event of latest.values()) {
    if (event.status === "reserved") {
      reservedTokens += event.reservedTokens;
      byTier[event.tier].reservedTokens += event.reservedTokens;
      continue;
    }
    if (event.status === "settled") {
      const total = event.usage?.totalTokens ?? event.reservedTokens;
      settledTokens += total;
      byTier[event.tier].settledTokens += total;
      if (event.estimated) estimatedTokens += total;
      tierTasks[event.tier].add(event.taskId);
      const prior = latestSettledOutcomeByTask.get(event.taskId);
      if (!prior || event.createdAtMs >= prior.createdAtMs) latestSettledOutcomeByTask.set(event.taskId, event);
    }
  }
  for (const tier of Object.keys(tierTasks) as CompanyFrontierLabTaskTier[]) {
    byTier[tier].tasks = tierTasks[tier].size;
  }
  // Only inference-observed settlements are scale evidence. A released
  // reservation records infrastructure recovery but cannot earn a larger stage.
  for (const event of latestSettledOutcomeByTask.values()) {
    if (event.outcome === "completed") completedTasks += 1;
    else if (event.outcome === "blocked") blockedTasks += 1;
    else if (event.outcome === "failed") failedTasks += 1;
  }
  const settledTasks = completedTasks + blockedTasks + failedTasks;
  return {
    monthlyTokenLimit: policy.monthlyTokenLimit,
    settledTokens,
    estimatedTokens,
    reservedTokens,
    remainingTokens: Math.max(0, policy.monthlyTokenLimit - settledTokens - reservedTokens),
    // A task reserved before the UTC rollover is still active capacity even
    // though its token reservation belongs to the prior accounting period.
    activeReservations: [...latestAcrossPeriods.values()].filter((event) => event.status === "reserved").length,
    settledTasks,
    completedTasks,
    blockedTasks,
    failedTasks,
    successRate: settledTasks > 0 ? completedTasks / settledTasks : 0,
    byTier,
    recent: periodEvents.slice(-20).reverse(),
    periodStart: new Date(utcMonthStart(now)).toISOString(),
  };
}

export async function readCompanyIntelligenceSnapshot(
  companyId: string,
  policy: CompanyFrontierLabPolicy | undefined,
  options: CompanyIntelligenceLedgerOptions = {},
): Promise<CompanyIntelligenceSnapshot> {
  const now = options.now?.() ?? Date.now();
  return snapshotFromEvents(await readEvents(ledgerPath(options)), companyId, policy, now);
}

export async function reserveCompanyIntelligence(
  company: Pick<Company, "id" | "frozen" | "frontierLab">,
  input: { reservationId: string; taskId: string; tier: CompanyFrontierLabTaskTier },
  options: CompanyIntelligenceLedgerOptions = {},
): Promise<{ decision: "allow" | "block"; reason?: string; duplicate: boolean; record?: CompanyIntelligenceUsageEvent; snapshot: CompanyIntelligenceSnapshot }> {
  const filePath = ledgerPath(options);
  return withLedgerLock(filePath, async () => {
    const now = options.now?.() ?? Date.now();
    const policy = normalizeFrontierLabPolicy(company.frontierLab);
    const events = await readEvents(filePath);
    const snapshot = snapshotFromEvents(events, company.id, policy, now);
    if (company.frozen) return { decision: "block", reason: "The company is frozen.", duplicate: false, snapshot };
    if (!policy.enabled) return { decision: "block", reason: "Frontier Lab is disabled for this company.", duplicate: false, snapshot };
    const reservationId = input.reservationId.trim();
    const taskId = input.taskId.trim();
    if (!reservationId || !taskId) throw new Error("reservationId and taskId are required.");
    const existing = events.find((event) => event.companyId === company.id && event.reservationId === reservationId);
    if (existing) {
      if (existing.taskId !== taskId || existing.tier !== input.tier) throw new Error("The reservation id was already used for different company work.");
      return { decision: "allow", duplicate: true, record: existing, snapshot };
    }
    if (snapshot.remainingTokens < policy.perTaskTokenLimit) {
      return {
        decision: "block",
        reason: `The company intelligence token budget has ${snapshot.remainingTokens.toLocaleString()} tokens remaining; another task requires a ${policy.perTaskTokenLimit.toLocaleString()} token reservation.`,
        duplicate: false,
        snapshot,
      };
    }
    if (snapshot.activeReservations >= policy.maxParallelTasks) {
      return {
        decision: "block",
        reason: `The company already has ${snapshot.activeReservations} active Frontier Lab reservation${snapshot.activeReservations === 1 ? "" : "s"}; its ${policy.stage} policy permits ${policy.maxParallelTasks}.`,
        duplicate: false,
        snapshot,
      };
    }
    const event: CompanyIntelligenceUsageEvent = {
      id: randomUUID(),
      reservationId,
      companyId: company.id,
      taskId,
      stage: policy.stage,
      tier: input.tier,
      provider: "openai-oauth",
      model: FRONTIER_LAB_MODEL_LADDER[input.tier],
      status: "reserved",
      reservedTokens: policy.perTaskTokenLimit,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
    };
    events.push(event);
    await writeEvents(filePath, events);
    return { decision: "allow", duplicate: false, record: event, snapshot: snapshotFromEvents(events, company.id, policy, now) };
  });
}

export async function settleCompanyIntelligenceReservation(
  companyId: string,
  reservationId: string,
  input: { outcome: CompanyIntelligenceOutcome; usage?: Partial<CompanyIntelligenceUsage>; estimated?: boolean; reason?: string; scaleEvidence?: EarnedScaleSettlementEvidence },
  options: CompanyIntelligenceLedgerOptions = {},
): Promise<{ duplicate: boolean; record: CompanyIntelligenceUsageEvent }> {
  const filePath = ledgerPath(options);
  return withLedgerLock(filePath, async () => {
    const events = await readEvents(filePath);
    const matching = events.filter((event) => event.companyId === companyId && event.reservationId === reservationId);
    const reserved = matching.find((event) => event.status === "reserved");
    if (!reserved) throw new Error("Company intelligence reservation was not found.");
    const terminal = matching.find((event) => event.status !== "reserved");
    if (terminal) return { duplicate: true, record: terminal };
    const now = options.now?.() ?? Date.now();
    const usage = normalizeUsage(input.usage);
    const estimated = input.estimated === true || usage.totalTokens <= 0;
    const finalUsage = estimated
      ? { ...usage, totalTokens: Math.max(usage.totalTokens, reserved.reservedTokens) }
      : usage;
    const event: CompanyIntelligenceUsageEvent = {
      ...reserved,
      id: randomUUID(),
      status: "settled",
      usage: finalUsage,
      estimated,
      outcome: input.outcome,
      scaleEvidence: normalizeScaleEvidence(input.scaleEvidence),
      reason: input.reason?.trim() || undefined,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
    };
    events.push(event);
    await writeEvents(filePath, events);
    return { duplicate: false, record: event };
  });
}

export async function releaseCompanyIntelligenceReservation(
  companyId: string,
  reservationId: string,
  input: { outcome: Exclude<CompanyIntelligenceOutcome, "completed">; reason?: string },
  options: CompanyIntelligenceLedgerOptions = {},
): Promise<{ duplicate: boolean; record: CompanyIntelligenceUsageEvent }> {
  const filePath = ledgerPath(options);
  return withLedgerLock(filePath, async () => {
    const events = await readEvents(filePath);
    const matching = events.filter((event) => event.companyId === companyId && event.reservationId === reservationId);
    const reserved = matching.find((event) => event.status === "reserved");
    if (!reserved) throw new Error("Company intelligence reservation was not found.");
    const terminal = matching.find((event) => event.status !== "reserved");
    if (terminal) return { duplicate: true, record: terminal };
    const now = options.now?.() ?? Date.now();
    const event: CompanyIntelligenceUsageEvent = {
      ...reserved,
      id: randomUUID(),
      status: "released",
      outcome: input.outcome,
      reason: input.reason?.trim() || undefined,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
    };
    events.push(event);
    await writeEvents(filePath, events);
    return { duplicate: false, record: event };
  });
}

/** Normalize the common OpenAI/Hermes usage shapes without trusting one collector version. */
export function companyIntelligenceUsageFromResponse(raw: unknown): CompanyIntelligenceUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const root = raw as Record<string, unknown>;
  const nested = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : undefined;
  const usage = (root.usage && typeof root.usage === "object" ? root.usage : nested?.usage) as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  const value = (...keys: string[]): number => {
    for (const key of keys) {
      const candidate = usage[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) return nonNegativeInteger(candidate);
    }
    return 0;
  };
  const normalized = normalizeUsage({
    inputTokens: value("input_tokens", "prompt_tokens", "inputTokens", "promptTokens"),
    outputTokens: value("output_tokens", "completion_tokens", "outputTokens", "completionTokens"),
    cachedTokens: value("cached_tokens", "cache_read_input_tokens", "cachedTokens"),
    reasoningTokens: value("reasoning_tokens", "reasoningTokens"),
    totalTokens: value("total_tokens", "totalTokens"),
  });
  return normalized.totalTokens > 0 ? normalized : undefined;
}

export function addCompanyIntelligenceUsage(
  current: CompanyIntelligenceUsage | undefined,
  addition: CompanyIntelligenceUsage | undefined,
): CompanyIntelligenceUsage | undefined {
  if (!current) return addition;
  if (!addition) return current;
  return {
    inputTokens: current.inputTokens + addition.inputTokens,
    outputTokens: current.outputTokens + addition.outputTokens,
    cachedTokens: current.cachedTokens + addition.cachedTokens,
    reasoningTokens: current.reasoningTokens + addition.reasoningTokens,
    totalTokens: current.totalTokens + addition.totalTokens,
  };
}

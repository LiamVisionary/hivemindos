import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { captureDecision } from "@/lib/services/security/decision-capture";
import type {
  CompanyProposal,
  CompanyProposalKind,
  CompanyProposalRisk,
  CompanyProposalStatus,
  CompanyRun,
  CompanyRunEvent,
  CompanyRunKind,
  CompanyRunLedgerFile,
  CompanyRunStatus,
} from "@/lib/types/company-runs";

export const COMPANY_RUNS_DIR = path.join(homedir(), ".hivemindos", "company-runs");

const MAX_RUNS = 500;
const MAX_PROPOSALS = 1_000;
const MAX_EVENTS_PER_RUN = 80;
const MAX_TEXT_CHARS = 1_200;
const MAX_TITLE_CHARS = 180;
const MAX_EVIDENCE = 12;

let companyRunsWriteQueue: Promise<unknown> = Promise.resolve();

export type CompanyRunListOptions = {
  runLimit?: number;
  proposalLimit?: number;
  status?: CompanyProposalStatus | "all";
};

export type StartCompanyRunInput = {
  id?: string;
  kind: CompanyRunKind;
  title: string;
  summary?: string;
  actor?: string;
  parentRunId?: string;
  replayOfRunId?: string;
  sourceTaskId?: string;
  flowRunId?: string;
  snapshot?: CompanyRun["snapshot"];
  input?: Record<string, unknown>;
  evidence?: string[];
  artifacts?: CompanyRun["artifacts"];
};

export type FinishCompanyRunInput = {
  status?: Extract<CompanyRunStatus, "completed" | "blocked" | "failed" | "canceled">;
  summary?: string;
  output?: Record<string, unknown>;
  evidence?: string[];
  artifacts?: CompanyRun["artifacts"];
};

export type CreateCompanyProposalInput = {
  id?: string;
  kind: CompanyProposalKind;
  status?: CompanyProposalStatus;
  title: string;
  summary?: string;
  runId?: string;
  sourceTaskId?: string;
  idempotencyKey?: string;
  risk?: CompanyProposalRisk;
  proposedChange?: Record<string, unknown>;
  evidence?: string[];
  links?: CompanyProposal["links"];
  createdBy?: string;
  decision?: string;
  decidedBy?: string;
};

export type SettleCompanyProposalInput = {
  status: Exclude<CompanyProposalStatus, "pending">;
  decision?: string;
  decidedBy?: string;
  summary?: string;
  evidence?: string[];
};

export function companyRunLedgerPath(companyId: string): string {
  const safe = companyId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "company";
  return path.join(COMPANY_RUNS_DIR, `${safe}.json`);
}

export async function readCompanyRunLedger(companyId: string): Promise<CompanyRunLedgerFile> {
  const id = cleanId(companyId);
  if (!id) return emptyLedger("company");
  try {
    const parsed = JSON.parse(await fs.readFile(companyRunLedgerPath(id), "utf8")) as unknown;
    return normalizeLedger(parsed, id);
  } catch {
    return emptyLedger(id);
  }
}

export async function listCompanyRuns(
  companyId: string,
  opts: CompanyRunListOptions = {},
): Promise<CompanyRunLedgerFile> {
  const ledger = await readCompanyRunLedger(companyId);
  const runLimit = Math.max(1, Math.min(opts.runLimit ?? 80, MAX_RUNS));
  const proposalLimit = Math.max(1, Math.min(opts.proposalLimit ?? 120, MAX_PROPOSALS));
  const proposals = opts.status && opts.status !== "all"
    ? ledger.proposals.filter((proposal) => proposal.status === opts.status)
    : ledger.proposals;
  return {
    ...ledger,
    runs: ledger.runs.slice(0, runLimit),
    proposals: proposals.slice(0, proposalLimit),
  };
}

export async function startCompanyRun(companyId: string, input: StartCompanyRunInput): Promise<CompanyRun> {
  const id = cleanId(companyId);
  if (!id) throw new Error("companyId is required.");
  const title = cleanText(input.title, MAX_TITLE_CHARS);
  if (!title) throw new Error("Company run title is required.");
  return enqueueCompanyRunsWrite(async () => {
    const ledger = await readCompanyRunLedger(id);
    const now = new Date().toISOString();
    const run: CompanyRun = {
      id: cleanId(input.id) || `crun_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      companyId: id,
      kind: normalizeRunKind(input.kind),
      status: "running",
      title,
      summary: cleanText(input.summary, MAX_TEXT_CHARS),
      actor: cleanText(input.actor, 160),
      parentRunId: cleanId(input.parentRunId),
      replayOfRunId: cleanId(input.replayOfRunId),
      sourceTaskId: cleanId(input.sourceTaskId),
      flowRunId: cleanId(input.flowRunId),
      createdAt: now,
      updatedAt: now,
      snapshot: input.snapshot,
      input: scrubRecord(input.input),
      evidence: cleanEvidence(input.evidence),
      artifacts: normalizeArtifacts(input.artifacts),
      events: [],
    };
    const next = { ...ledger, runs: [run, ...ledger.runs.filter((item) => item.id !== run.id)].slice(0, MAX_RUNS), updatedAt: now };
    await writeCompanyRunLedger(next);
    return run;
  });
}

export async function appendCompanyRunEvent(
  companyId: string,
  runId: string | undefined,
  input: Omit<CompanyRunEvent, "id" | "at"> & { id?: string; at?: string },
): Promise<CompanyRun | null> {
  const id = cleanId(companyId);
  const targetRunId = cleanId(runId);
  const title = cleanText(input.title, MAX_TITLE_CHARS);
  if (!id || !targetRunId || !title) return null;
  return enqueueCompanyRunsWrite(async () => {
    const ledger = await readCompanyRunLedger(id);
    let updated: CompanyRun | null = null;
    const now = new Date().toISOString();
    const runs = ledger.runs.map((run) => {
      if (run.id !== targetRunId) return run;
      const event: CompanyRunEvent = {
        id: cleanId(input.id) || `evt_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`,
        at: cleanIso(input.at) || now,
        kind: cleanText(input.kind, 80) || "event",
        title,
        detail: cleanText(input.detail, MAX_TEXT_CHARS),
        taskId: cleanId(input.taskId),
        proposalId: cleanId(input.proposalId),
        data: scrubRecord(input.data),
      };
      updated = {
        ...run,
        updatedAt: now,
        events: [...(run.events ?? []), event].slice(-MAX_EVENTS_PER_RUN),
      };
      return updated;
    });
    if (!updated) return null;
    await writeCompanyRunLedger({ ...ledger, runs, updatedAt: now });
    return updated;
  });
}

export async function finishCompanyRun(
  companyId: string,
  runId: string | undefined,
  input: FinishCompanyRunInput = {},
): Promise<CompanyRun | null> {
  const id = cleanId(companyId);
  const targetRunId = cleanId(runId);
  if (!id || !targetRunId) return null;
  const status = input.status ?? "completed";
  return enqueueCompanyRunsWrite(async () => {
    const ledger = await readCompanyRunLedger(id);
    let updated: CompanyRun | null = null;
    const now = new Date().toISOString();
    const runs = ledger.runs.map((run) => {
      if (run.id !== targetRunId) return run;
      updated = {
        ...run,
        status,
        summary: cleanText(input.summary, MAX_TEXT_CHARS) ?? run.summary,
        output: scrubRecord(input.output) ?? run.output,
        evidence: cleanEvidence([...(run.evidence ?? []), ...(input.evidence ?? [])]),
        artifacts: normalizeArtifacts(input.artifacts) ?? run.artifacts,
        completedAt: status === "completed" || status === "blocked" || status === "canceled" ? now : run.completedAt,
        failedAt: status === "failed" ? now : run.failedAt,
        updatedAt: now,
      };
      return updated;
    });
    if (!updated) return null;
    await writeCompanyRunLedger({ ...ledger, runs, updatedAt: now });
    return updated;
  });
}

export async function createCompanyProposal(
  companyId: string,
  input: CreateCompanyProposalInput,
): Promise<CompanyProposal> {
  const id = cleanId(companyId);
  if (!id) throw new Error("companyId is required.");
  const title = cleanText(input.title, MAX_TITLE_CHARS);
  if (!title) throw new Error("Company proposal title is required.");
  return enqueueCompanyRunsWrite(async () => {
    const ledger = await readCompanyRunLedger(id);
    const now = new Date().toISOString();
    const explicitId = cleanId(input.id);
    const idempotencyKey = cleanText(input.idempotencyKey, 240);
    const existing = ledger.proposals.find((proposal) =>
      (explicitId && proposal.id === explicitId) || (idempotencyKey && proposal.idempotencyKey === idempotencyKey),
    );
    const nextProposal: CompanyProposal = {
      ...(existing ?? {}),
      id: explicitId || existing?.id || `cprop_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      companyId: id,
      kind: normalizeProposalKind(input.kind),
      status: input.status ? normalizeProposalStatus(input.status) : (existing?.status ?? "pending"),
      title,
      summary: cleanText(input.summary, MAX_TEXT_CHARS),
      runId: cleanId(input.runId) ?? existing?.runId,
      sourceTaskId: cleanId(input.sourceTaskId) ?? existing?.sourceTaskId,
      idempotencyKey: idempotencyKey ?? existing?.idempotencyKey,
      risk: normalizeRisk(input.risk),
      proposedChange: scrubRecord(input.proposedChange),
      evidence: cleanEvidence(input.evidence),
      links: normalizeLinks(input.links),
      createdBy: cleanText(input.createdBy, 160) ?? existing?.createdBy,
      decision: cleanText(input.decision, MAX_TEXT_CHARS) ?? existing?.decision,
      decidedBy: cleanText(input.decidedBy, 160) ?? existing?.decidedBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      decidedAt: input.status && input.status !== "pending" ? now : existing?.decidedAt,
    };
    const proposals = [
      nextProposal,
      ...ledger.proposals.filter((proposal) => proposal.id !== nextProposal.id),
    ].slice(0, MAX_PROPOSALS);
    await writeCompanyRunLedger({ ...ledger, proposals, updatedAt: now });
    return nextProposal;
  });
}

export async function settleCompanyProposal(
  companyId: string,
  proposalId: string | undefined,
  input: SettleCompanyProposalInput,
): Promise<CompanyProposal | null> {
  return settleCompanyProposalWhere(companyId, (proposal) => proposal.id === cleanId(proposalId), input);
}

export async function settleCompanyProposalByIdempotencyKey(
  companyId: string,
  idempotencyKey: string | undefined,
  input: SettleCompanyProposalInput,
): Promise<CompanyProposal | null> {
  const key = cleanText(idempotencyKey, 240);
  if (!key) return null;
  return settleCompanyProposalWhere(companyId, (proposal) => proposal.idempotencyKey === key, input);
}

export async function requestCompanyRunReplay(input: {
  companyId: string;
  runId: string;
  title?: string;
  summary?: string;
  requestedBy?: string;
}): Promise<CompanyProposal> {
  const runId = cleanId(input.runId);
  if (!runId) throw new Error("runId is required.");
  return createCompanyProposal(input.companyId, {
    kind: "replay",
    status: "pending",
    title: input.title || "Replay requested",
    summary: input.summary || "Replay this run with the latest company directives before settling the next branch.",
    runId,
    idempotencyKey: `replay:${runId}`,
    risk: "medium",
    proposedChange: { replayOfRunId: runId },
    createdBy: input.requestedBy || "dashboard",
  });
}

async function settleCompanyProposalWhere(
  companyId: string,
  predicate: (proposal: CompanyProposal) => boolean,
  input: SettleCompanyProposalInput,
): Promise<CompanyProposal | null> {
  const id = cleanId(companyId);
  if (!id) return null;
  return enqueueCompanyRunsWrite(async () => {
    const ledger = await readCompanyRunLedger(id);
    let updated: CompanyProposal | null = null;
    const now = new Date().toISOString();
    const status = normalizeSettledStatus(input.status);
    const proposals = ledger.proposals.map((proposal) => {
      if (!predicate(proposal)) return proposal;
      updated = {
        ...proposal,
        status,
        decision: cleanText(input.decision, MAX_TEXT_CHARS) ?? proposal.decision,
        decidedBy: cleanText(input.decidedBy, 160) ?? proposal.decidedBy,
        summary: cleanText(input.summary, MAX_TEXT_CHARS) ?? proposal.summary,
        evidence: cleanEvidence([...(proposal.evidence ?? []), ...(input.evidence ?? [])]),
        decidedAt: now,
        updatedAt: now,
      };
      return updated;
    });
    if (!updated) return null;
    await writeCompanyRunLedger({ ...ledger, proposals, updatedAt: now });
    // An approval settled by a human is the cleanest decision signal there is:
    // an explicit proposal, an explicit verdict. Best-effort, after the write.
    const settled: CompanyProposal = updated;
    void captureDecision({
      sourceKind: "approval",
      sourceId: settled.id,
      companyId: id,
      subject: settled.title ?? settled.kind ?? "proposal",
      question: settled.summary ?? "",
      outcome: `${status}${settled.decision ? `: ${settled.decision}` : ""}`,
      actor: settled.decidedBy ?? "operator",
      context: { kind: settled.kind ?? null, status },
    }).catch(() => undefined);
    return updated;
  });
}

async function enqueueCompanyRunsWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = companyRunsWriteQueue.then(fn, fn);
  companyRunsWriteQueue = next.catch(() => undefined);
  return next;
}

async function writeCompanyRunLedger(file: CompanyRunLedgerFile): Promise<void> {
  await fs.mkdir(COMPANY_RUNS_DIR, { recursive: true, mode: 0o700 });
  const target = companyRunLedgerPath(file.companyId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({
    version: 1,
    companyId: file.companyId,
    updatedAt: file.updatedAt,
    runs: file.runs.slice(0, MAX_RUNS),
    proposals: file.proposals.slice(0, MAX_PROPOSALS),
  }, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
}

function emptyLedger(companyId: string): CompanyRunLedgerFile {
  return {
    version: 1,
    companyId,
    updatedAt: new Date(0).toISOString(),
    runs: [],
    proposals: [],
  };
}

function normalizeLedger(value: unknown, companyId: string): CompanyRunLedgerFile {
  if (!value || typeof value !== "object") return emptyLedger(companyId);
  const raw = value as Record<string, unknown>;
  return {
    version: 1,
    companyId,
    updatedAt: cleanIso(raw.updatedAt) || new Date(0).toISOString(),
    runs: (Array.isArray(raw.runs) ? raw.runs : []).map((item) => normalizeRun(item, companyId)).filter(Boolean) as CompanyRun[],
    proposals: (Array.isArray(raw.proposals) ? raw.proposals : []).map((item) => normalizeProposal(item, companyId)).filter(Boolean) as CompanyProposal[],
  };
}

function normalizeRun(value: unknown, companyId: string): CompanyRun | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const title = cleanText(raw.title, MAX_TITLE_CHARS);
  const createdAt = cleanIso(raw.createdAt);
  if (!id || !title || !createdAt) return null;
  return {
    id,
    companyId,
    kind: normalizeRunKind(raw.kind),
    status: normalizeRunStatus(raw.status),
    title,
    summary: cleanText(raw.summary, MAX_TEXT_CHARS),
    actor: cleanText(raw.actor, 160),
    parentRunId: cleanId(raw.parentRunId),
    replayOfRunId: cleanId(raw.replayOfRunId),
    sourceTaskId: cleanId(raw.sourceTaskId),
    flowRunId: cleanId(raw.flowRunId),
    createdAt,
    updatedAt: cleanIso(raw.updatedAt) || createdAt,
    completedAt: cleanIso(raw.completedAt),
    failedAt: cleanIso(raw.failedAt),
    snapshot: raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot as CompanyRun["snapshot"] : undefined,
    input: scrubRecord(raw.input),
    output: scrubRecord(raw.output),
    evidence: cleanEvidence(raw.evidence),
    artifacts: normalizeArtifacts(raw.artifacts),
    events: (Array.isArray(raw.events) ? raw.events : []).map(normalizeEvent).filter(Boolean).slice(-MAX_EVENTS_PER_RUN) as CompanyRunEvent[],
  };
}

function normalizeProposal(value: unknown, companyId: string): CompanyProposal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const title = cleanText(raw.title, MAX_TITLE_CHARS);
  const createdAt = cleanIso(raw.createdAt);
  if (!id || !title || !createdAt) return null;
  return {
    id,
    companyId,
    kind: normalizeProposalKind(raw.kind),
    status: normalizeProposalStatus(raw.status),
    title,
    summary: cleanText(raw.summary, MAX_TEXT_CHARS),
    runId: cleanId(raw.runId),
    sourceTaskId: cleanId(raw.sourceTaskId),
    idempotencyKey: cleanText(raw.idempotencyKey, 240),
    risk: normalizeRisk(raw.risk),
    proposedChange: scrubRecord(raw.proposedChange),
    evidence: cleanEvidence(raw.evidence),
    links: normalizeLinks(raw.links),
    createdBy: cleanText(raw.createdBy, 160),
    decidedBy: cleanText(raw.decidedBy, 160),
    decision: cleanText(raw.decision, MAX_TEXT_CHARS),
    createdAt,
    updatedAt: cleanIso(raw.updatedAt) || createdAt,
    decidedAt: cleanIso(raw.decidedAt),
  };
}

function normalizeEvent(value: unknown): CompanyRunEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const at = cleanIso(raw.at);
  const title = cleanText(raw.title, MAX_TITLE_CHARS);
  if (!id || !at || !title) return null;
  return {
    id,
    at,
    kind: cleanText(raw.kind, 80) || "event",
    title,
    detail: cleanText(raw.detail, MAX_TEXT_CHARS),
    taskId: cleanId(raw.taskId),
    proposalId: cleanId(raw.proposalId),
    data: scrubRecord(raw.data),
  };
}

function normalizeRunKind(value: unknown): CompanyRunKind {
  const kinds: CompanyRunKind[] = ["dispatch", "flow", "task-outcome", "pricing", "preview-review", "deliverable-review", "revenue", "replay", "manual"];
  return typeof value === "string" && (kinds as string[]).includes(value) ? value as CompanyRunKind : "manual";
}

function normalizeRunStatus(value: unknown): CompanyRunStatus {
  const statuses: CompanyRunStatus[] = ["running", "completed", "blocked", "failed", "canceled"];
  return typeof value === "string" && (statuses as string[]).includes(value) ? value as CompanyRunStatus : "running";
}

function normalizeProposalKind(value: unknown): CompanyProposalKind {
  const kinds: CompanyProposalKind[] = ["pricing-change", "human-input", "preview-review", "deliverable-redirect", "revenue-share", "replay", "manual"];
  return typeof value === "string" && (kinds as string[]).includes(value) ? value as CompanyProposalKind : "manual";
}

function normalizeProposalStatus(value: unknown): CompanyProposalStatus {
  const statuses: CompanyProposalStatus[] = ["pending", "approved", "rejected", "applied", "superseded"];
  return typeof value === "string" && (statuses as string[]).includes(value) ? value as CompanyProposalStatus : "pending";
}

function normalizeSettledStatus(value: CompanyProposalStatus): Exclude<CompanyProposalStatus, "pending"> {
  if (value === "pending") return "approved";
  return value;
}

function normalizeRisk(value: unknown): CompanyProposalRisk | undefined {
  if (value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

function cleanId(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 180) : undefined;
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function cleanIso(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function cleanEvidence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value.map((item) => cleanText(item, MAX_TEXT_CHARS)).filter((item): item is string => Boolean(item));
  return lines.length ? lines.slice(0, MAX_EVIDENCE) : undefined;
}

function scrubRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "string") return entry.slice(0, 2_000);
    return entry;
  })) as Record<string, unknown>;
}

function normalizeArtifacts(value: unknown): CompanyRun["artifacts"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const id = cleanId(raw.id) || `art_${randomUUID().slice(0, 8)}`;
      const label = cleanText(raw.label, 180);
      const kind = cleanText(raw.kind, 80);
      if (!label || !kind) return null;
      return {
        id,
        label,
        kind,
        taskId: cleanId(raw.taskId),
        path: cleanText(raw.path, 500),
        url: cleanText(raw.url, 500),
      };
    })
    .filter(Boolean) as NonNullable<CompanyRun["artifacts"]>;
  return artifacts.length ? artifacts.slice(0, 40) : undefined;
}

function normalizeLinks(value: unknown): CompanyProposal["links"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const raw = entry as Record<string, unknown>;
      const label = cleanText(raw.label, 80);
      const url = cleanText(raw.url, 500);
      if (!label || !url) return null;
      return { label, url };
    })
    .filter(Boolean) as NonNullable<CompanyProposal["links"]>;
  return links.length ? links.slice(0, 8) : undefined;
}

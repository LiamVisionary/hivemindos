import "server-only";

import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import {
  appendCompanyRunEvent,
  createCompanyProposal,
  settleCompanyProposalByIdempotencyKey,
} from "@/lib/services/company-runs";
import type { Company } from "@/lib/types/company";
import type { KanbanTask } from "@/lib/types/kanban";

/**
 * Durable per-company operating memory: an append-only JSONL ledger of what the
 * company actually did — dispatches, task outcomes, metric movements, operator
 * notes. This is the layer that stops a zero-human company from planning cold
 * every cycle: the goal planner and every dispatched worker receive a digest of
 * it, so cycle N+1 builds on cycle N instead of re-planning from a blank slate.
 *
 * Deliberately business-agnostic: records are typed events with free-text
 * titles/details, so a web agency, a content studio, and a trading desk all
 * accumulate memory through the same rail.
 */

export const COMPANY_MEMORY_DIR = path.join(homedir(), ".hivemindos", "company-memory");

export type CompanyMemoryKind = "dispatch" | "task-completed" | "task-blocked" | "metric" | "note";

export type CompanyMemoryRecord = {
  at: number;
  kind: CompanyMemoryKind;
  title: string;
  detail?: string;
  taskId?: string;
  agent?: string;
  data?: Record<string, unknown>;
};

const MAX_TAIL_BYTES = 512 * 1024; // digest/read work on the newest ~0.5MB of ledger
const MAX_DETAIL_CHARS = 500;

export function companyMemoryPath(companyId: string): string {
  const safe = companyId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "company";
  return path.join(COMPANY_MEMORY_DIR, `${safe}.jsonl`);
}

/**
 * Coerce a timestamp to epoch ms. The `at` field MUST always be stored as a
 * number: a string `at` (e.g. an ISO `task.completedAt` that leaked past the
 * KanbanTask `number` type) is invisible to readCompanyMemory's number guard,
 * so it never lands in syncCompanyTaskOutcomes' dedup set — and the same task
 * outcome gets re-appended on every autonomy-driver tick, ballooning the ledger
 * with hundreds of identical lines. Coercing at BOTH the write and read boundary
 * makes that failure impossible regardless of what a caller passes.
 */
function toEpochMs(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export async function appendCompanyMemory(companyId: string, record: Omit<CompanyMemoryRecord, "at"> & { at?: number }): Promise<void> {
  const entry: CompanyMemoryRecord = {
    at: toEpochMs(record.at, Date.now()),
    kind: record.kind,
    title: (record.title ?? "").trim().slice(0, 200),
    detail: record.detail ? record.detail.trim().slice(0, MAX_DETAIL_CHARS) : undefined,
    taskId: record.taskId,
    agent: record.agent,
    data: record.data,
  };
  if (!entry.title) return;
  await fs.mkdir(COMPANY_MEMORY_DIR, { recursive: true, mode: 0o700 });
  await fs.appendFile(companyMemoryPath(companyId), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** Newest-last tail of the ledger (bounded read so huge histories stay cheap). */
export async function readCompanyMemory(companyId: string, opts: { limit?: number } = {}): Promise<CompanyMemoryRecord[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 2_000));
  let raw: string;
  try {
    const file = companyMemoryPath(companyId);
    const stat = await fs.stat(file);
    if (stat.size > MAX_TAIL_BYTES) {
      const handle = await fs.open(file, "r");
      try {
        const buffer = new Uint8Array(MAX_TAIL_BYTES);
        await handle.read(buffer, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES);
        raw = Buffer.from(buffer).toString("utf8");
        raw = raw.slice(raw.indexOf("\n") + 1); // drop the partial first line
      } finally {
        await handle.close();
      }
    } else {
      raw = await fs.readFile(file, "utf8");
    }
  } catch {
    return [];
  }
  const records: CompanyMemoryRecord[] = [];
  const seenLines = new Set<string>();
  for (const line of raw.split("\n")) {
    const text = line.trim();
    // Drop exact-duplicate ledger lines so a machine whose file still carries the
    // legacy re-append dupes reads clean without waiting on a compaction pass.
    if (!text || seenLines.has(text)) continue;
    seenLines.add(text);
    try {
      const parsed = JSON.parse(text) as CompanyMemoryRecord;
      if (!parsed || typeof parsed.title !== "string") continue;
      // Coerce a legacy string `at` back to a number instead of dropping the
      // record: dropping it is exactly what hid these lines from the deduper.
      const at = toEpochMs((parsed as { at?: unknown }).at, NaN);
      if (!Number.isFinite(at)) continue;
      records.push({ ...parsed, at });
    } catch {
      // Skip a corrupt line rather than losing the ledger.
    }
  }
  return records.slice(-limit);
}

const KIND_LABEL: Record<CompanyMemoryKind, string> = {
  dispatch: "DISPATCHED",
  "task-completed": "DONE",
  "task-blocked": "BLOCKED",
  metric: "METRIC",
  note: "NOTE",
};

function companyRunIdFromTaskSource(source?: string): string | undefined {
  const match = /^company:[^:]+:(.+)$/.exec(source ?? "");
  return match?.[1]?.trim() || undefined;
}

/**
 * Compact newest-first digest for prompts. Bounded by characters so callers can
 * budget context: planners get a longer digest, worker task bodies a shorter one.
 */
export async function companyMemoryDigest(companyId: string, opts: { maxChars?: number; maxRecords?: number } = {}): Promise<string> {
  const maxChars = Math.max(200, Math.min(opts.maxChars ?? 1_600, 8_000));
  const records = await readCompanyMemory(companyId, { limit: opts.maxRecords ?? 120 });
  if (records.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  for (const record of [...records].reverse()) {
    const when = new Date(record.at).toISOString().slice(0, 10);
    const parts = [`[${when}] ${KIND_LABEL[record.kind] ?? record.kind}: ${record.title}`];
    if (record.agent) parts.push(`(${record.agent})`);
    if (record.detail) parts.push(`— ${record.detail}`);
    const line = parts.join(" ").slice(0, 320);
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/**
 * Fold finished company-sourced Work Board tasks into company memory. Idempotent:
 * a (taskId, terminal-status) pair is recorded once. Called from the autonomy
 * driver's tick so memory accumulates headless, whatever path finished the task.
 */
export async function syncCompanyTaskOutcomes(companies: Company[], tasks: KanbanTask[]): Promise<number> {
  let recorded = 0;
  const byCompany = new Map<string, KanbanTask[]>();
  for (const task of tasks) {
    const source = task.source ?? "";
    if (!source.startsWith("company:")) continue;
    if (task.status !== "done" && task.status !== "needs-human") continue;
    const companyId = source.split(":")[1] ?? "";
    if (!companyId) continue;
    const list = byCompany.get(companyId) ?? [];
    list.push(task);
    byCompany.set(companyId, list);
  }
  for (const [companyId, companyTasks] of byCompany) {
    const company = companies.find((entry) => entry.id === companyId);
    if (!company) continue;
    try {
      // Reconcile legacy pending proposals even when the task-completion memory
      // record is still inside the bounded `seen` window. This consumes the new
      // durable marker receipt and removes a request if the task's immutable
      // catalog snapshot no longer matches the live catalog.
      const pendingPricingTaskIds = new Set(
        (company.pricingProposals ?? [])
          .map((proposal) => proposal.sourceTaskId)
          .filter((taskId): taskId is string => Boolean(taskId)),
      );
      if (pendingPricingTaskIds.size > 0) {
        const { fileTaskPricingProposals } = await import("@/lib/services/company-products");
        for (const task of companyTasks) {
          if (pendingPricingTaskIds.has(task.id) && /PRICING PROPOSAL:/i.test(task.result ?? "")) {
            await fileTaskPricingProposals(companyId, task);
          }
        }
      }
      const seen = new Set(
        (await readCompanyMemory(companyId, { limit: 2_000 }))
          .filter((record) => record.taskId && (record.kind === "task-completed" || record.kind === "task-blocked"))
          .map((record) => `${record.taskId}:${record.kind}`),
      );
      for (const task of companyTasks) {
        const kind: CompanyMemoryKind = task.status === "done" ? "task-completed" : "task-blocked";
        if (seen.has(`${task.id}:${kind}`)) continue;
        await appendCompanyMemory(companyId, {
          kind,
          title: task.title,
          detail: (task.result ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS) || undefined,
          taskId: task.id,
          agent: task.assignee ?? undefined,
          at: task.completedAt ?? task.updatedAt ?? Date.now(),
        });
        const companyRunId = companyRunIdFromTaskSource(task.source);
        await appendCompanyRunEvent(companyId, companyRunId, {
          kind,
          title: task.status === "done" ? `Task completed: ${task.title}` : `Human input needed: ${task.title}`,
          detail: (task.result ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS) || undefined,
          taskId: task.id,
          data: {
            status: task.status,
            assignee: task.assignee ?? undefined,
          },
        }).catch(() => undefined);
        if (task.status === "needs-human") {
          await createCompanyProposal(companyId, {
            kind: "human-input",
            title: `Human input needed: ${task.title}`,
            summary: (task.result ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS) || undefined,
            runId: companyRunId,
            sourceTaskId: task.id,
            idempotencyKey: `task-human:${task.id}`,
            risk: "medium",
            evidence: task.result ? [task.result.slice(0, MAX_DETAIL_CHARS)] : undefined,
            createdBy: task.assignee ?? "company",
          }).catch(() => undefined);
        } else {
          await settleCompanyProposalByIdempotencyKey(companyId, `task-human:${task.id}`, {
            status: "applied",
            decision: "Task completed; pending human-input proposal closed.",
            decidedBy: task.assignee ?? "company",
          }).catch(() => undefined);
        }
        recorded += 1;
        // A result carrying `PRICING PROPOSAL:` markers files pending
        // price-change requests for human review under Approvals. Proposal
        // idempotency is durable in the replicated company definition; it does
        // not rely on this bounded memory window. Best-effort — a filing failure
        // must never block memory accrual. (Dynamic import avoids a static cycle.)
        if (/PRICING PROPOSAL:/i.test(task.result ?? "")) {
          try {
            const { fileTaskPricingProposals } = await import("@/lib/services/company-products");
            await fileTaskPricingProposals(companyId, task);
          } catch (error) {
            console.warn(`[company-memory] pricing-proposal filing failed for ${task.id}:`, error instanceof Error ? error.message : error);
          }
        }
      }
    } catch (error) {
      console.warn(`[company-memory] sync failed for ${companyId}:`, error instanceof Error ? error.message : error);
    }
  }
  return recorded;
}

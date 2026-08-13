import "server-only";

import { appendFile, mkdir, open, rename, stat } from "fs/promises";
import { dirname, join } from "path";

import { homedir } from "@/lib/home-dir";
import { readSharedHiveEnvValues } from "@/lib/services/shared-hive-env";
import { redactRecord, redactSecretValues } from "@/lib/services/security/secret-scope";

/**
 * Durable record of decisions a human actually made.
 *
 * The existing `learnedApprovalPoliciesFromDirectives` learns only approval
 * SUBJECTS, by regex-matching permission phrases out of directive text. That
 * captures "Liam said outreach emails need approval" but not "the crew asked X,
 * Liam answered Y, in this context" — which is the material an agent would need
 * to predict the answer next time rather than asking again.
 *
 * The three source kinds mirror the distinct shapes an operator decision takes:
 *   interaction        — the operator answered a question an agent asked
 *   approval           — the operator settled a pending proposal
 *   execution_decision — the operator accepted or rejected produced work
 *
 * This is a corpus, not a policy engine. Nothing here changes behavior; it makes
 * the raw material exist so it can later be mined, reviewed, and — only after
 * review — promoted into policy. Writing straight from captured decisions into
 * enforcement would let one impatient click become a standing rule.
 */
const DECISIONS_FILE = join(homedir(), ".hivemindos", "decisions", "decisions.jsonl");

const DECISIONS_MAX_FILE_BYTES = Number(
  process.env.HIVEMINDOS_DECISIONS_MAX_FILE_BYTES || 25 * 1024 * 1024,
);
const DECISIONS_QUERY_TAIL_BYTES = Number(
  process.env.HIVEMINDOS_DECISIONS_QUERY_TAIL_BYTES || 4 * 1024 * 1024,
);

export const DECISION_SOURCE_KINDS = ["interaction", "approval", "execution_decision"] as const;

export type DecisionSourceKind = typeof DECISION_SOURCE_KINDS[number];

export type CapturedDecision = {
  id: string;
  ts: number;
  sourceKind: DecisionSourceKind;
  /** Stable id of the thing decided about — task id, proposal id, deliverable id. */
  sourceId: string;
  /** Company the decision belongs to, when it belongs to one. */
  companyId: string | null;
  /** Short human-readable subject, for grouping similar decisions. */
  subject: string;
  /** What the agent asked or proposed, as the operator saw it. */
  question: string;
  /** What the operator decided. */
  outcome: string;
  /** Who decided. */
  actor: string;
  /** Anything else worth keeping for later mining. Never secrets. */
  context: Record<string, unknown>;
};

let decisionWrites: Promise<unknown> = Promise.resolve();

function serializeDecisionWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = decisionWrites.then(task, task);
  decisionWrites = next.catch(() => undefined);
  return next;
}

async function rotateIfNeeded() {
  try {
    const stats = await stat(DECISIONS_FILE);
    if (stats.size < DECISIONS_MAX_FILE_BYTES) return;
    await rename(DECISIONS_FILE, `${DECISIONS_FILE}.1`);
  } catch {
    // First write.
  }
}

export function decisionsLogPath() {
  return DECISIONS_FILE;
}

function clamp(value: string | undefined | null, max: number) {
  const text = (value ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function captureDecision(input: {
  sourceKind: DecisionSourceKind;
  sourceId: string;
  companyId?: string | null;
  subject?: string;
  question?: string;
  outcome: string;
  actor?: string;
  context?: Record<string, unknown>;
  now?: number;
}): Promise<CapturedDecision | null> {
  if (!DECISION_SOURCE_KINDS.includes(input.sourceKind)) return null;
  const sourceId = clamp(input.sourceId, 200);
  if (!sourceId) return null;
  const record: CapturedDecision = {
    id: crypto.randomUUID(),
    ts: input.now ?? Date.now(),
    sourceKind: input.sourceKind,
    sourceId,
    companyId: clamp(input.companyId, 200) || null,
    // Bounded: a decision corpus is for pattern mining, and an unbounded body
    // would turn one pasted document into a multi-megabyte line.
    subject: clamp(input.subject, 300),
    question: clamp(input.question, 4000),
    outcome: clamp(input.outcome, 4000),
    actor: clamp(input.actor, 200) || "operator",
    context: input.context ?? {},
  };
  // `question` and `outcome` are free text lifted from task bodies and operator
  // answers, so a pasted credential lands here verbatim and then persists
  // forever in an append-only log. Mask known secret values before writing.
  // Best-effort: if the env cannot be read we still capture the decision, since
  // losing the corpus entry is worse than a redaction pass that found nothing.
  const secrets = await readSharedHiveEnvValues().catch(() => ({}));
  const safe: CapturedDecision = {
    ...record,
    subject: redactSecretValues(record.subject, secrets),
    question: redactSecretValues(record.question, secrets),
    outcome: redactSecretValues(record.outcome, secrets),
    context: redactRecord(record.context, secrets),
  };
  await serializeDecisionWrite(async () => {
    await mkdir(dirname(DECISIONS_FILE), { recursive: true });
    await rotateIfNeeded();
    await appendFile(DECISIONS_FILE, `${JSON.stringify(safe)}\n`, "utf8");
  });
  return safe;
}

async function readTail(file: string, bytes: number): Promise<string> {
  let handle;
  try {
    handle = await open(file, "r");
    const { size } = await handle.stat();
    if (size === 0) return "";
    const start = Math.max(0, size - bytes);
    const length = size - start;
    const buffer = new Uint8Array(length);
    await handle.read(buffer, 0, length, start);
    let text = new TextDecoder().decode(buffer);
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline === -1 ? "" : text.slice(firstNewline + 1);
    }
    return text;
  } catch {
    return "";
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function queryDecisions(options: {
  limit?: number;
  sourceKind?: DecisionSourceKind;
  companyId?: string;
  subject?: string;
} = {}): Promise<CapturedDecision[]> {
  const raw = await readTail(DECISIONS_FILE, DECISIONS_QUERY_TAIL_BYTES);
  const records: CapturedDecision[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CapturedDecision;
      if (options.sourceKind && parsed.sourceKind !== options.sourceKind) continue;
      if (options.companyId && parsed.companyId !== options.companyId) continue;
      if (options.subject && !parsed.subject.toLowerCase().includes(options.subject.toLowerCase())) continue;
      records.push(parsed);
    } catch {
      // Torn final line from a concurrent append.
    }
  }
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  return records.slice(-limit).reverse();
}

/**
 * Groups decisions by subject so a reviewer can see "this same question was
 * answered the same way N times" — the shape worth promoting to a policy.
 * Deliberately reports the raw counts and does NOT decide anything itself.
 */
export function summarizeDecisionPatterns(records: readonly CapturedDecision[]) {
  const bySubject = new Map<string, { subject: string; count: number; outcomes: Map<string, number> }>();
  for (const record of records) {
    const key = record.subject.toLowerCase();
    if (!key) continue;
    const entry = bySubject.get(key) ?? { subject: record.subject, count: 0, outcomes: new Map() };
    entry.count += 1;
    entry.outcomes.set(record.outcome, (entry.outcomes.get(record.outcome) ?? 0) + 1);
    bySubject.set(key, entry);
  }
  return [...bySubject.values()]
    .map((entry) => {
      const outcomes = [...entry.outcomes.entries()].sort((a, b) => b[1] - a[1]);
      const [topOutcome, topCount] = outcomes[0] ?? ["", 0];
      return {
        subject: entry.subject,
        count: entry.count,
        topOutcome,
        // How consistently the operator answered the same way. A subject decided
        // the same way every time is a promotion candidate; a split one is not.
        consistency: entry.count > 0 ? topCount / entry.count : 0,
        outcomes: outcomes.map(([outcome, count]) => ({ outcome, count })),
      };
    })
    .sort((a, b) => b.count - a.count);
}

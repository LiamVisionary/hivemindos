import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import { booleanEnv } from "@/lib/config/env";
import type { KanbanLoopSpec, KanbanPriority } from "@/lib/types/kanban";
import type { LoopEvaluationRubric, LoopReceipt } from "@/lib/types/loops";
import { loopGateFromVerifier } from "@/lib/services/loops/verifier-registry";
import type { FlowNode, FlowNodeResult, FlowRunState, FlowSpec } from "@/lib/types/agent-flow";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { applyNodeResult, flowNodeById, instantiateFlow, isTerminal, normalizeFlowRunState, renderNodePrompt } from "@/lib/services/queen-bee/flow-engine";

// Drives a flow run: submits runnable task nodes via the Queen Bee, persists run state to the
// vault, and advances when a node completes (or a human resolves an approval). The dispatch is
// injectable so the engine + scheduling can be unit-tested without a live fleet. Execution is
// event-driven — submit the runnable nodes, then advance() when each result arrives — matching the
// async autonomous-pickup model rather than blocking on each node. Parallel branches dispatch
// together; joins hold until every inbound branch has fired (flow-engine).

export type FlowDispatch = (
  node: FlowNode,
  run: FlowRunState,
  opts: FlowRunnerOptions,
  /** The full spec, so the default dispatch can see the node's outgoing edges. Injected mocks may ignore it. */
  ctx?: { spec: FlowSpec },
) => Promise<{ taskId?: string }>;

export interface FlowRunnerOptions {
  vaultPath?: string | null;
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  priority?: KanbanPriority;
  dispatch?: FlowDispatch;
  runId?: string;
  now?: number;
  state?: Record<string, unknown>;
  /** Which active node a result belongs to (required to disambiguate parallel branches). */
  nodeId?: string;
}

interface PersistedRun {
  spec: FlowSpec;
  run: FlowRunState;
  // Persisted so later nodes (dispatched when the worker auto-advances, which has no fleet of its
  // own) are delegated against the same fleet the run started with — otherwise they stall undelegated.
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  priority?: KanbanPriority;
}

function runsDir(vaultPath?: string | null): string {
  const root = resolveObsidianVaultPath(vaultPath || DEFAULT_SHARED_VAULT.vaultPath);
  return join(root, "Operations", "Flows", "runs");
}

async function saveRun(record: PersistedRun, opts: FlowRunnerOptions): Promise<void> {
  const dir = runsDir(opts.vaultPath);
  await mkdir(dir, { recursive: true });
  const safe = record.run.runId.replace(/[^a-z0-9-]/gi, "-");
  await writeFile(join(dir, `${safe}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

async function loadRun(runId: string, opts: FlowRunnerOptions): Promise<PersistedRun | null> {
  const safe = runId.replace(/[^a-z0-9-]/gi, "-");
  const file = join(runsDir(opts.vaultPath), `${safe}.json`);
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(await readFile(file, "utf8")) as PersistedRun;
    // Legacy (single-active-node) runs migrate on read; the migrated shape is
    // written back on the next save.
    return { ...record, run: normalizeFlowRunState(record.run) };
  } catch {
    return null;
  }
}

/** A node whose outgoing edges include a score condition must emit a score for routing. */
export function flowNodeEmitsScore(spec: FlowSpec, nodeId: string): boolean {
  return spec.edges.some((edge) => edge.from === nodeId && edge.when.on === "score");
}

// Rubric the independent judge scores a score-emitting flow node against. Defined
// here (not per-template) so the advance path can recompute the same weighted
// score from the judge receipt's axes without loading the task's loop spec.
const FLOW_SCORE_RUBRIC_AXES = [
  { id: "goal-fit", title: "Goal fit", weight: 0.4, description: "The output actually accomplishes the node's instruction, not an adjacent task." },
  { id: "evidence", title: "Evidence", weight: 0.3, description: "Claims are specific and backed by the inputs/receipts, not asserted." },
  { id: "usability", title: "Usability", weight: 0.3, description: "Downstream nodes can consume the result as-is: complete, structured, no gaps." },
] as const;

export function buildFlowScoreRubric(node: FlowNode): LoopEvaluationRubric {
  return {
    id: `rubric_flow_score_${node.id.replace(/[^a-z0-9_-]+/gi, "-")}`,
    title: `Flow score rubric for ${node.title}`,
    scale: "0-1",
    passThreshold: 0.6,
    axes: FLOW_SCORE_RUBRIC_AXES.map((axis) => ({ ...axis })),
    notes: [
      "The weighted axis score routes this flow's score-conditioned edges; a low score loops the flow back rather than blocking completion.",
    ],
  };
}

/**
 * Loop attached to a score-emitting flow node so an INDEPENDENT judge (not the
 * completing agent's own free text) produces the routing score. The judge gate is
 * deliberately not required: the score is a routing signal — a low score should
 * follow the flow's lt-edge (revise/loop back), never park the task needs-human.
 * QUEEN_BEE_FLOW_SCORE_JUDGE=0 disables — default ON, disable-flag semantics like
 * the other QUEEN_BEE_LOOP_* integrity gates (see loop-templates.ts).
 */
export function buildFlowScoreJudgeLoop(node: FlowNode, spec: FlowSpec, now = Date.now()): KanbanLoopSpec | undefined {
  if (!flowNodeEmitsScore(spec, node.id)) return undefined;
  if (!booleanEnv("QUEEN_BEE_FLOW_SCORE_JUDGE", true)) return undefined;
  return {
    mode: "closed",
    goal: `Independently score the output of flow node "${node.title}" so the flow can route on quality.`,
    successCriteria: [
      "The node's instruction is genuinely accomplished with evidence.",
      "The judge scores every rubric axis from the output itself.",
    ],
    evaluationRubric: buildFlowScoreRubric(node),
    evalGates: [
      loopGateFromVerifier("agent:judge", {
        id: `flow-${node.id.replace(/[^a-z0-9_-]+/gi, "-")}-score-judge`,
        title: `Independent score for ${node.title}`,
        required: false,
        now,
      }),
    ],
  };
}

// Default dispatch: submit the node's rendered task to the Queen Bee control plane. Imported lazily
// so unit tests that inject a mock dispatch never pull in the full control plane. Score-emitting
// nodes carry the judge loop so their routing score comes from an independent judge.
const defaultDispatch: FlowDispatch = async (node, run, opts, ctx) => {
  const { submitQueenBeeMessage } = await import("@/lib/services/queen-bee/control-plane");
  const loop = ctx?.spec ? buildFlowScoreJudgeLoop(node, ctx.spec) : undefined;
  const result = await submitQueenBeeMessage({
    message: renderNodePrompt(node, run),
    taskTitle: node.title,
    mode: "act",
    priority: opts.priority ?? "high",
    source: `flow:${run.runId}:${node.id}`,
    fleetSnapshot: opts.fleetSnapshot ?? [],
    skills: node.skills ?? (node.workerClass ? [node.workerClass] : []),
    loop,
    vaultPath: opts.vaultPath,
  });
  return { taskId: result.task?.id };
};

function nowOf(opts: FlowRunnerOptions): number {
  return typeof opts.now === "number" ? opts.now : Date.now();
}

function genRunId(opts: FlowRunnerOptions): string {
  if (opts.runId) return opts.runId;
  return `flow-${nowOf(opts).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Dispatch every newly-activated task node (parallel branches dispatch together) and record the
// task ids in shared state. Approval nodes wait for a human, not a dispatch.
async function dispatchPendingTasks(spec: FlowSpec, run: FlowRunState, opts: FlowRunnerOptions): Promise<FlowRunState> {
  if (isTerminal(run) || !run.pendingDispatchNodeIds.length) return run;
  const dispatch = opts.dispatch ?? defaultDispatch;
  let state = run.state;
  for (const nodeId of run.pendingDispatchNodeIds) {
    const node = flowNodeById(spec, nodeId);
    if (!node || node.kind !== "task") continue;
    const { taskId } = await dispatch(node, { ...run, state }, opts, { spec });
    state = { ...state, [`task.${node.id}`]: taskId ?? null };
  }
  return { ...run, state, pendingDispatchNodeIds: [] };
}

export async function startFlowRun(spec: FlowSpec, opts: FlowRunnerOptions = {}): Promise<FlowRunState> {
  let run = instantiateFlow(spec, { runId: genRunId(opts), now: nowOf(opts), state: opts.state });
  run = await dispatchPendingTasks(spec, run, opts);
  await saveRun({ spec, run, fleetSnapshot: opts.fleetSnapshot ?? null, priority: opts.priority }, opts);
  return run;
}

export async function advanceFlowRun(runId: string, result: FlowNodeResult, opts: FlowRunnerOptions = {}): Promise<FlowRunState> {
  const record = await loadRun(runId, opts);
  if (!record) throw new Error(`Flow run "${runId}" not found`);
  // Reuse the run's original fleet/priority so worker-driven advances still delegate later nodes.
  const mergedOpts: FlowRunnerOptions = {
    ...opts,
    fleetSnapshot: opts.fleetSnapshot ?? record.fleetSnapshot ?? null,
    priority: opts.priority ?? record.priority,
  };
  let run = applyNodeResult(record.spec, record.run, result, { now: nowOf(opts), nodeId: opts.nodeId });
  run = await dispatchPendingTasks(record.spec, run, mergedOpts);
  await saveRun({ spec: record.spec, run, fleetSnapshot: record.fleetSnapshot, priority: record.priority }, mergedOpts);
  return run;
}

export async function resolveFlowApproval(runId: string, approved: boolean, opts: FlowRunnerOptions = {}): Promise<FlowRunState> {
  return advanceFlowRun(runId, { kind: "approval", approved }, opts);
}

export async function getFlowRun(runId: string, opts: FlowRunnerOptions = {}): Promise<PersistedRun | null> {
  return loadRun(runId, opts);
}

/** Parse a task's "flow:<runId>:<nodeId>" origin tag. */
export function parseFlowTaskSource(source?: string | null): { runId: string; nodeId: string } | null {
  const m = String(source || "").match(/^flow:([^:]+):(.+)$/);
  return m ? { runId: m[1], nodeId: m[2] } : null;
}

// Best-effort score extraction from a node's free-text output (for score-gated edges, e.g. a QA
// review that returns "score: 0.8"). Returns undefined when no clear 0–1 value is present. This is
// the FALLBACK — when the node carried the judge loop, the judge's weighted rubric score wins.
function parseFlowScore(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.match(/score[^0-9]{0,16}(0?\.\d+|1(?:\.0+)?)\b/i) || text.match(/\b(0?\.\d+|1(?:\.0+)?)\s*\/\s*1\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

/**
 * The independent judge's weighted rubric score from completion loop receipts:
 * the same weighted-axes formula the loop runner gates on, recomputed from the
 * judge receipt's axes with the flow score rubric's weights. Falls back to the
 * judge's overall confidence when it returned no usable axes; undefined when no
 * judge receipt exists (callers then regex the node's own text).
 */
export function flowScoreFromReceipts(receipts?: readonly LoopReceipt[] | null): number | undefined {
  const judgeReceipts = (receipts ?? []).filter((receipt) => (receipt.metadata as { source?: unknown } | undefined)?.source === "judge");
  if (!judgeReceipts.length) return undefined;
  const receipt = [...judgeReceipts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0]!;
  const metadata = (receipt.metadata ?? {}) as { axes?: unknown; confidence?: unknown };
  const axes = Array.isArray(metadata.axes) ? metadata.axes : [];
  const scoreByAxis = new Map<string, number>();
  for (const axis of axes) {
    if (!axis || typeof axis !== "object") continue;
    const { id, score } = axis as { id?: unknown; score?: unknown };
    if (typeof id !== "string" || typeof score !== "number" || !Number.isFinite(score)) continue;
    scoreByAxis.set(id, Math.max(0, Math.min(1, score)));
  }
  let weightTotal = 0;
  let weighted = 0;
  for (const axis of FLOW_SCORE_RUBRIC_AXES) {
    const score = scoreByAxis.get(axis.id);
    if (score === undefined) continue;
    weightTotal += axis.weight;
    weighted += score * axis.weight;
  }
  if (weightTotal > 0) return weighted / weightTotal;
  const confidence = metadata.confidence;
  if (typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) return confidence;
  return undefined;
}

// The autonomous worker persists loop receipts onto the task BEFORE advancing the flow, so when the
// caller does not hand receipts over we read them back off the board by the task's flow source tag.
async function loadReceiptsForFlowTask(source: string, vaultPath?: string | null): Promise<LoopReceipt[] | null> {
  try {
    const { readBoard } = await import("@/lib/services/kanban/local-kanban-store");
    const board = await readBoard(null, { vaultPath });
    const candidates = board.tasks
      .filter((task) => task.source === source && task.loopReceipts?.length)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return candidates[0]?.loopReceipts ?? null;
  } catch {
    return null;
  }
}

// Advance a flow when one of its task nodes completes (called from the autonomous worker). No-ops
// unless the task is flow-tagged AND its node is one the run is actively waiting on, so it is safe
// to call for every completed task and never double-advances.
export async function maybeAdvanceFlowForTask(input: {
  source?: string | null;
  outcome: "passed" | "failed";
  output?: string;
  vaultPath?: string | null;
  /** Completion loop receipts for the task; when omitted they are read off the board by source tag. */
  loopReceipts?: LoopReceipt[] | null;
  /** Injectable dispatch for tests; production omits it and uses the live Queen Bee submit. */
  dispatch?: FlowDispatch;
}): Promise<FlowRunState | null> {
  const tag = parseFlowTaskSource(input.source);
  if (!tag) return null;
  const record = await loadRun(tag.runId, { vaultPath: input.vaultPath });
  if (!record) return null;
  // Parallel branches keep completing while a sibling approval node holds the run
  // in "awaiting-human", so gate on the node being active — not on status "running".
  if (isTerminal(record.run) || !record.run.activeNodeIds.includes(tag.nodeId)) return null;
  let score: number | undefined;
  if (input.outcome === "passed" && flowNodeEmitsScore(record.spec, tag.nodeId)) {
    const receipts = input.loopReceipts !== undefined
      ? input.loopReceipts
      : await loadReceiptsForFlowTask(String(input.source), input.vaultPath);
    // The independent judge's weighted rubric score wins; the node's own
    // free-text "score: 0.NN" is only trusted when no judge receipt exists.
    score = flowScoreFromReceipts(receipts) ?? parseFlowScore(input.output);
  }
  const result: FlowNodeResult = {
    kind: "task",
    outcome: input.outcome,
    output: input.output,
    score,
  };
  return advanceFlowRun(tag.runId, result, { vaultPath: input.vaultPath, dispatch: input.dispatch, nodeId: tag.nodeId });
}

export async function listFlowRuns(opts: FlowRunnerOptions = {}): Promise<FlowRunState[]> {
  const dir = runsDir(opts.vaultPath);
  if (!existsSync(dir)) return [];
  const runs: FlowRunState[] = [];
  for (const entry of await readdir(dir).catch(() => [])) {
    if (!entry.endsWith(".json")) continue;
    try {
      runs.push(normalizeFlowRunState((JSON.parse(await readFile(join(dir, entry), "utf8")) as PersistedRun).run));
    } catch {
      // skip
    }
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

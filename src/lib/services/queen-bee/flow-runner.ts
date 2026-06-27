import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { KanbanPriority } from "@/lib/types/kanban";
import type { FlowNode, FlowNodeResult, FlowRunState, FlowSpec } from "@/lib/types/agent-flow";
import type { QueenBeeFleetMachine } from "@/lib/services/queen-bee/control-plane";
import { applyNodeResult, flowNodeById, instantiateFlow, renderNodePrompt } from "@/lib/services/queen-bee/flow-engine";

// Drives a flow run: submits the current task node via the Queen Bee, persists run state to the
// vault, and advances when a node completes (or a human resolves an approval). The dispatch is
// injectable so the engine + scheduling can be unit-tested without a live fleet. Execution is
// event-driven — submit a node, then advance() when its result arrives — matching the async
// autonomous-pickup model rather than blocking on each node.

export type FlowDispatch = (node: FlowNode, run: FlowRunState, opts: FlowRunnerOptions) => Promise<{ taskId?: string }>;

export interface FlowRunnerOptions {
  vaultPath?: string | null;
  fleetSnapshot?: QueenBeeFleetMachine[] | null;
  priority?: KanbanPriority;
  dispatch?: FlowDispatch;
  runId?: string;
  now?: number;
  state?: Record<string, unknown>;
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
    return JSON.parse(await readFile(file, "utf8")) as PersistedRun;
  } catch {
    return null;
  }
}

// Default dispatch: submit the node's rendered task to the Queen Bee control plane. Imported lazily
// so unit tests that inject a mock dispatch never pull in the full control plane.
const defaultDispatch: FlowDispatch = async (node, run, opts) => {
  const { submitQueenBeeMessage } = await import("@/lib/services/queen-bee/control-plane");
  const result = await submitQueenBeeMessage({
    message: renderNodePrompt(node, run),
    taskTitle: node.title,
    mode: "act",
    priority: opts.priority ?? "high",
    source: `flow:${run.runId}:${node.id}`,
    fleetSnapshot: opts.fleetSnapshot ?? [],
    skills: node.skills ?? (node.workerClass ? [node.workerClass] : []),
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

// If the run is at a runnable task node, dispatch it and record the task id in shared state.
async function dispatchCurrentIfTask(spec: FlowSpec, run: FlowRunState, opts: FlowRunnerOptions): Promise<FlowRunState> {
  if (run.status !== "running" || !run.currentNodeId) return run;
  const node = flowNodeById(spec, run.currentNodeId);
  if (!node || node.kind !== "task") return run;
  const dispatch = opts.dispatch ?? defaultDispatch;
  const { taskId } = await dispatch(node, run, opts);
  return { ...run, state: { ...run.state, [`task.${node.id}`]: taskId ?? null } };
}

export async function startFlowRun(spec: FlowSpec, opts: FlowRunnerOptions = {}): Promise<FlowRunState> {
  let run = instantiateFlow(spec, { runId: genRunId(opts), now: nowOf(opts), state: opts.state });
  run = await dispatchCurrentIfTask(spec, run, opts);
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
  let run = applyNodeResult(record.spec, record.run, result, { now: nowOf(opts) });
  run = await dispatchCurrentIfTask(record.spec, run, mergedOpts);
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
// review that returns "score: 0.8"). Returns undefined when no clear 0–1 value is present.
function parseFlowScore(text?: string): number | undefined {
  if (!text) return undefined;
  const m = text.match(/score[^0-9]{0,16}(0?\.\d+|1(?:\.0+)?)\b/i) || text.match(/\b(0?\.\d+|1(?:\.0+)?)\s*\/\s*1\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

// Advance a flow when one of its task nodes completes (called from the autonomous worker). No-ops
// unless the task is flow-tagged AND is the node the run is currently waiting on, so it is safe to
// call for every completed task and never double-advances.
export async function maybeAdvanceFlowForTask(input: {
  source?: string | null;
  outcome: "passed" | "failed";
  output?: string;
  vaultPath?: string | null;
  /** Injectable dispatch for tests; production omits it and uses the live Queen Bee submit. */
  dispatch?: FlowDispatch;
}): Promise<FlowRunState | null> {
  const tag = parseFlowTaskSource(input.source);
  if (!tag) return null;
  const record = await loadRun(tag.runId, { vaultPath: input.vaultPath });
  if (!record) return null;
  if (record.run.currentNodeId !== tag.nodeId || record.run.status !== "running") return null;
  const result: FlowNodeResult = {
    kind: "task",
    outcome: input.outcome,
    output: input.output,
    score: input.outcome === "passed" ? parseFlowScore(input.output) : undefined,
  };
  return advanceFlowRun(tag.runId, result, { vaultPath: input.vaultPath, dispatch: input.dispatch });
}

export async function listFlowRuns(opts: FlowRunnerOptions = {}): Promise<FlowRunState[]> {
  const dir = runsDir(opts.vaultPath);
  if (!existsSync(dir)) return [];
  const runs: FlowRunState[] = [];
  for (const entry of await readdir(dir).catch(() => [])) {
    if (!entry.endsWith(".json")) continue;
    try {
      runs.push((JSON.parse(await readFile(join(dir, entry), "utf8")) as PersistedRun).run);
    } catch {
      // skip
    }
  }
  return runs.sort((a, b) => b.startedAt - a.startedAt);
}

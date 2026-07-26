import {
  FLOW_RUN_STATE_VERSION,
  type FlowEdge,
  type FlowNode,
  type FlowNodeResult,
  type FlowRunState,
  type FlowSpec,
} from "@/lib/types/agent-flow";

// Pure flow engine: no I/O. Given a flow spec and the result of a completed node, it computes the
// next run state — firing conditional edges, fanning out to ALL matching successors (parallel
// branches), holding joins until every distinct inbound source has fired, looping back (bounded by
// maxSteps and node maxAttempts), pausing for human approval, threading shared state, and
// terminating on DONE/FAIL. All scheduling and dispatch live in flow-runner.ts; this module is the
// deterministic, unit-testable core.

const DEFAULT_MAX_STEPS = 50;

export function flowNodeById(spec: FlowSpec, id: string | null): FlowNode | undefined {
  if (!id) return undefined;
  return spec.nodes.find((n) => n.id === id);
}

export function validateFlow(spec: FlowSpec): string[] {
  const errors: string[] = [];
  const ids = new Set(spec.nodes.map((n) => n.id));
  if (!ids.has(spec.start)) errors.push(`start node "${spec.start}" not found`);
  if (spec.nodes.length !== ids.size) errors.push("duplicate node ids");
  const terminals = new Set(["DONE", "FAIL"]);
  for (const edge of spec.edges) {
    if (!ids.has(edge.from)) errors.push(`edge from unknown node "${edge.from}"`);
    if (!terminals.has(edge.to) && !ids.has(edge.to)) errors.push(`edge to unknown node "${edge.to}"`);
  }
  for (const node of spec.nodes) {
    if (node.kind === "task" && !spec.edges.some((e) => e.from === node.id)) {
      // A task node with no outgoing edge is a dead end unless it is meant to terminate;
      // allowed, but flagged so authors notice.
      errors.push(`node "${node.id}" has no outgoing edge (will terminate after running)`);
    }
  }
  return errors;
}

/**
 * Upgrade a persisted run to the current shape. Legacy runs (pre-parallel) carry
 * only `currentNodeId`; they become a single-element `activeNodeIds` with an empty
 * join ledger. Already-current runs are returned as-is.
 */
export function normalizeFlowRunState(run: FlowRunState): FlowRunState {
  if (
    run.version === FLOW_RUN_STATE_VERSION &&
    Array.isArray(run.activeNodeIds) &&
    Array.isArray(run.firedEdges) &&
    Array.isArray(run.pendingDispatchNodeIds)
  ) {
    return run;
  }
  const activeNodeIds = Array.isArray(run.activeNodeIds)
    ? run.activeNodeIds
    : run.currentNodeId
      ? [run.currentNodeId]
      : [];
  return {
    ...run,
    version: FLOW_RUN_STATE_VERSION,
    activeNodeIds,
    currentNodeId: activeNodeIds[0] ?? null,
    firedEdges: Array.isArray(run.firedEdges) ? run.firedEdges : [],
    pendingDispatchNodeIds: Array.isArray(run.pendingDispatchNodeIds) ? run.pendingDispatchNodeIds : [],
  };
}

function firedEdgeKey(from: string, to: string): string {
  return `${from}=>${to}`;
}

function statusForActive(spec: FlowSpec, activeNodeIds: string[]): FlowRunState["status"] {
  return activeNodeIds.some((id) => flowNodeById(spec, id)?.kind === "approval") ? "awaiting-human" : "running";
}

export function instantiateFlow(spec: FlowSpec, opts: { runId: string; now: number; state?: Record<string, unknown> }): FlowRunState {
  const activeNodeIds = [spec.start];
  return {
    version: FLOW_RUN_STATE_VERSION,
    flowId: spec.id,
    flowName: spec.name,
    runId: opts.runId,
    status: statusForActive(spec, activeNodeIds),
    currentNodeId: spec.start,
    activeNodeIds,
    firedEdges: [],
    pendingDispatchNodeIds: [spec.start],
    state: { ...(opts.state ?? {}) },
    history: [],
    stepCount: 0,
    startedAt: opts.now,
  };
}

function edgeMatches(edge: FlowEdge, outcome: "passed" | "failed", score?: number): boolean {
  const when = edge.when;
  switch (when.on) {
    case "always":
      return true;
    case "success":
      return outcome === "passed";
    case "failure":
      return outcome === "failed";
    case "score": {
      if (typeof score !== "number") return false;
      if (typeof when.lt === "number" && !(score < when.lt)) return false;
      if (typeof when.gte === "number" && !(score >= when.gte)) return false;
      return true;
    }
    default:
      return false;
  }
}

/**
 * All edges that fire for this outcome/score, in spec order. Score-conditioned
 * edges stay mutually exclusive: at most the FIRST matching score edge fires
 * (an lt/gte pair on one source routes to exactly one branch), while any number
 * of matching success/failure/always edges fan out in parallel.
 */
function matchingEdges(spec: FlowSpec, nodeId: string, outcome: "passed" | "failed", score?: number): FlowEdge[] {
  const matched: FlowEdge[] = [];
  let scoreEdgeTaken = false;
  for (const edge of spec.edges) {
    if (edge.from !== nodeId) continue;
    if (!edgeMatches(edge, outcome, score)) continue;
    if (edge.when.on === "score") {
      if (scoreEdgeTaken) continue;
      scoreEdgeTaken = true;
    }
    matched.push(edge);
  }
  return matched;
}

function attemptsFor(run: FlowRunState, nodeId: string): number {
  return run.history.filter((h) => h.nodeId === nodeId).length;
}

/** True when `toId` is reachable from `fromId` by following edges (terminals excluded). */
function canReach(spec: FlowSpec, fromId: string, toId: string): boolean {
  const seen = new Set<string>([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of spec.edges) {
      if (edge.from !== current || edge.to === "DONE" || edge.to === "FAIL") continue;
      if (edge.to === toId) return true;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
}

/**
 * An inbound edge is a LOOP-BACK when its source sits downstream of its target
 * (review → research in a revise loop). Loop-backs re-activate their target
 * directly and never count toward a join — a join waits only on its distinct
 * FORWARD inbound sources (the parallel branches feeding it).
 */
function isLoopBackEdge(spec: FlowSpec, edge: FlowEdge): boolean {
  return edge.to !== "DONE" && edge.to !== "FAIL" && canReach(spec, edge.to, edge.from);
}

/** Distinct forward (non-loop-back) source nodes with an inbound edge to `nodeId`. */
function forwardInboundSources(spec: FlowSpec, nodeId: string): string[] {
  return [...new Set(
    spec.edges
      .filter((e) => e.to === nodeId && !isLoopBackEdge(spec, e))
      .map((e) => e.from),
  )];
}

// Resolve which active node this result belongs to. An explicit nodeId wins; otherwise the single
// active node, or the first active node whose kind matches the result (linear flows and the
// approval API never need to name the node).
function resolveCompletedNodeId(spec: FlowSpec, run: FlowRunState, result: FlowNodeResult, requested?: string): string | null {
  if (requested) return run.activeNodeIds.includes(requested) ? requested : null;
  if (run.activeNodeIds.length === 1) return run.activeNodeIds[0] ?? null;
  const wantKind = result.kind === "approval" ? "approval" : "task";
  return run.activeNodeIds.find((id) => flowNodeById(spec, id)?.kind === wantKind) ?? run.activeNodeIds[0] ?? null;
}

// Apply the result of a completed node and return the next run state. Pure: returns a new object.
// `opts.nodeId` names which active node completed (required to be unambiguous when parallel
// branches are active); a result for a node that is not active is a no-op (stale completion).
export function applyNodeResult(
  spec: FlowSpec,
  run: FlowRunState,
  result: FlowNodeResult,
  opts: { now: number; nodeId?: string },
): FlowRunState {
  run = normalizeFlowRunState(run);
  if (run.status === "done" || run.status === "failed") return run;
  const completedNodeId = resolveCompletedNodeId(spec, run, result, opts.nodeId);
  if (opts.nodeId && !completedNodeId) return run;
  const node = flowNodeById(spec, completedNodeId);
  if (!node) {
    return { ...run, status: "failed", currentNodeId: null, activeNodeIds: [], pendingDispatchNodeIds: [], endedAt: opts.now, failureReason: "current node not found" };
  }

  const outcome: "passed" | "failed" = result.kind === "approval" ? (result.approved ? "passed" : "failed") : result.outcome;
  const score = result.kind === "task" ? result.score : undefined;
  const output = result.kind === "task" ? result.output : result.note;

  const attempt = attemptsFor(run, node.id) + 1;
  const history = [...run.history, { nodeId: node.id, kind: node.kind, attempt, outcome, score, output, at: opts.now }];
  const state = { ...run.state };
  if (typeof output === "string" && output.length) {
    state[`output.${node.id}`] = output;
    state.last = output;
  }
  // Branch outcomes/scores are shared state so join/synthesis nodes can read
  // every inbound branch's result, not only the last output.
  state[`outcome.${node.id}`] = outcome;
  if (typeof score === "number") state[`score.${node.id}`] = score;
  const stepCount = run.stepCount + 1;
  const maxSteps = spec.maxSteps ?? DEFAULT_MAX_STEPS;
  const base: FlowRunState = { ...run, history, state, stepCount };

  if (stepCount >= maxSteps) {
    return { ...base, status: "failed", currentNodeId: null, activeNodeIds: [], pendingDispatchNodeIds: [], endedAt: opts.now, failureReason: `exceeded maxSteps (${maxSteps})` };
  }

  // Node-local retry: re-run the same node before following a failure edge.
  if (outcome === "failed") {
    const maxAttempts = node.maxAttempts ?? 1;
    if (attempt < maxAttempts) {
      return {
        ...base,
        status: statusForActive(spec, base.activeNodeIds),
        currentNodeId: base.activeNodeIds[0] ?? null,
        pendingDispatchNodeIds: [node.id],
      };
    }
  }

  const activeNodeIds = base.activeNodeIds.filter((id) => id !== node.id);
  const matched = matchingEdges(spec, node.id, outcome, score);

  if (!matched.length) {
    if (activeNodeIds.length) {
      // This branch ends quietly; parallel branches keep running. The branch's
      // outcome stays visible in state["outcome.<nodeId>"] and history.
      return {
        ...base,
        activeNodeIds,
        currentNodeId: activeNodeIds[0] ?? null,
        status: statusForActive(spec, activeNodeIds),
        pendingDispatchNodeIds: [],
      };
    }
    // No matching edge and nothing else running: terminate on the node's own outcome.
    return {
      ...base,
      status: outcome === "passed" ? "done" : "failed",
      currentNodeId: null,
      activeNodeIds: [],
      pendingDispatchNodeIds: [],
      endedAt: opts.now,
      failureReason: outcome === "passed" ? undefined : `node "${node.id}" failed with no failure edge`,
    };
  }

  // A terminal edge ends the whole run, parallel branches included.
  const terminal = matched.find((edge) => edge.to === "DONE" || edge.to === "FAIL");
  if (terminal) {
    if (terminal.to === "DONE") {
      return { ...base, status: "done", currentNodeId: null, activeNodeIds: [], pendingDispatchNodeIds: [], firedEdges: [], endedAt: opts.now };
    }
    return { ...base, status: "failed", currentNodeId: null, activeNodeIds: [], pendingDispatchNodeIds: [], firedEdges: [], endedAt: opts.now, failureReason: `routed to FAIL from "${node.id}"` };
  }

  // Fire the matched edges, then activate every target whose join is satisfied.
  // A loop-back edge re-activates its target directly (the forward join was
  // already satisfied on the way in); a forward edge is recorded in the join
  // ledger and its target activates once ALL its distinct forward inbound
  // sources have fired, consuming those entries so the join re-arms for loops.
  const fired = new Set(base.firedEdges);
  const activated: string[] = [];
  const activate = (target: string) => {
    if (!activated.includes(target) && !activeNodeIds.includes(target)) activated.push(target);
  };
  for (const edge of matched) {
    if (isLoopBackEdge(spec, edge)) {
      activate(edge.to);
      continue;
    }
    fired.add(firedEdgeKey(edge.from, edge.to));
    const required = forwardInboundSources(spec, edge.to);
    if (!required.every((sourceId) => fired.has(firedEdgeKey(sourceId, edge.to)))) continue;
    for (const sourceId of required) fired.delete(firedEdgeKey(sourceId, edge.to));
    activate(edge.to);
  }
  const nextActive = [...activeNodeIds, ...activated];

  if (!nextActive.length) {
    // Every remaining target is a join still waiting on branches that can no
    // longer arrive (their sources ended without firing). Fail loudly instead of
    // stalling forever.
    const waiting = matched.map((edge) => `"${edge.to}"`).join(", ");
    return {
      ...base,
      status: "failed",
      currentNodeId: null,
      activeNodeIds: [],
      firedEdges: [...fired],
      pendingDispatchNodeIds: [],
      endedAt: opts.now,
      failureReason: `join ${waiting} is waiting on inbound branches that can no longer complete`,
    };
  }

  return {
    ...base,
    status: statusForActive(spec, nextActive),
    currentNodeId: nextActive[0] ?? null,
    activeNodeIds: nextActive,
    firedEdges: [...fired],
    pendingDispatchNodeIds: activated,
  };
}

// Render a node's prompt by substituting {{state.<key>}}, {{output.<nodeId>}}, and {{last}}.
export function renderNodePrompt(node: FlowNode, run: FlowRunState): string {
  const template = node.prompt ?? node.title;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, raw) => {
    const key = String(raw);
    if (key === "last") return String(run.state.last ?? "");
    if (key.startsWith("state.")) return String(run.state[key.slice(6)] ?? "");
    if (key.startsWith("output.")) return String(run.state[key] ?? "");
    return String(run.state[key] ?? "");
  });
}

export function isTerminal(run: FlowRunState): boolean {
  return run.status === "done" || run.status === "failed";
}

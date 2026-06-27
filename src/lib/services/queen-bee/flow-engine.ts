import type {
  FlowEdge,
  FlowNode,
  FlowNodeResult,
  FlowRunState,
  FlowSpec,
} from "@/lib/types/agent-flow";

// Pure flow engine: no I/O. Given a flow spec and the result of the current node, it computes the
// next state — following conditional edges, looping back (bounded by maxSteps and node maxAttempts),
// pausing for human approval, threading shared state, and terminating on DONE/FAIL. All scheduling
// and dispatch live in flow-runner.ts; this module is the deterministic, unit-testable core.

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

export function instantiateFlow(spec: FlowSpec, opts: { runId: string; now: number; state?: Record<string, unknown> }): FlowRunState {
  const startNode = flowNodeById(spec, spec.start);
  const awaitingHuman = startNode?.kind === "approval";
  return {
    flowId: spec.id,
    flowName: spec.name,
    runId: opts.runId,
    status: awaitingHuman ? "awaiting-human" : "running",
    currentNodeId: spec.start,
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

function attemptsFor(run: FlowRunState, nodeId: string): number {
  return run.history.filter((h) => h.nodeId === nodeId).length;
}

// Apply the result of the current node and return the next run state. Pure: returns a new object.
export function applyNodeResult(
  spec: FlowSpec,
  run: FlowRunState,
  result: FlowNodeResult,
  opts: { now: number },
): FlowRunState {
  if (run.status === "done" || run.status === "failed") return run;
  const node = flowNodeById(spec, run.currentNodeId);
  if (!node) return { ...run, status: "failed", currentNodeId: null, endedAt: opts.now, failureReason: "current node not found" };

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
  const stepCount = run.stepCount + 1;
  const maxSteps = spec.maxSteps ?? DEFAULT_MAX_STEPS;
  const base: FlowRunState = { ...run, history, state, stepCount };

  if (stepCount >= maxSteps) {
    return { ...base, status: "failed", currentNodeId: null, endedAt: opts.now, failureReason: `exceeded maxSteps (${maxSteps})` };
  }

  // Node-local retry: re-run the same node before following a failure edge.
  if (outcome === "failed") {
    const maxAttempts = node.maxAttempts ?? 1;
    if (attempt < maxAttempts) {
      return { ...base, status: node.kind === "approval" ? "awaiting-human" : "running", currentNodeId: node.id };
    }
  }

  const edge = spec.edges.find((e) => e.from === node.id && edgeMatches(e, outcome, score));
  if (!edge) {
    // No matching edge: terminate on the node's own outcome.
    return { ...base, status: outcome === "passed" ? "done" : "failed", currentNodeId: null, endedAt: opts.now, failureReason: outcome === "passed" ? undefined : `node "${node.id}" failed with no failure edge` };
  }
  if (edge.to === "DONE") return { ...base, status: "done", currentNodeId: null, endedAt: opts.now };
  if (edge.to === "FAIL") return { ...base, status: "failed", currentNodeId: null, endedAt: opts.now, failureReason: `routed to FAIL from "${node.id}"` };

  const nextNode = flowNodeById(spec, edge.to);
  return { ...base, status: nextNode?.kind === "approval" ? "awaiting-human" : "running", currentNodeId: edge.to };
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

import type { KanbanPriority } from "@/lib/types/kanban";

// Agent flows: a declarative multi-node topology (LangGraph-style graph + CrewAI-style crew) that
// the Queen Bee executes by reusing existing primitives — worker-class routing for assignment,
// eval results for edge conditions, receipts for shared state, and human gates for HITL. A flow is
// nodes (steps/agents) wired by conditional edges, with a shared state object threaded through.

export type FlowNodeKind = "task" | "approval";

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  title: string;
  /** Worker-class / role hint used for routing (task nodes). e.g. "research", "code", "legal". */
  workerClass?: string;
  /** Task body template; may reference {{state.<key>}}, {{output.<nodeId>}}, and {{last}}. */
  prompt?: string;
  /** Explicit skill hints passed to routing (defaults to [workerClass] when set). */
  skills?: string[];
  /** Node-local retry cap before a failure follows a failure edge. Default 1 (no retry). */
  maxAttempts?: number;
  /** For approval (HITL) nodes: the instruction shown to the human reviewer. */
  approvalPrompt?: string;
}

// Conditional edge — this is what makes the loop a graph: research → draft → (score < bar ? back to
// research : publish). Edges are evaluated in array order; the first match wins.
export type FlowEdgeCondition =
  | { on: "success" }
  | { on: "failure" }
  | { on: "always" }
  | { on: "score"; lt?: number; gte?: number; metric?: string };

export interface FlowEdge {
  from: string;
  /** Target node id, or the terminals "DONE" / "FAIL". */
  to: string;
  when: FlowEdgeCondition;
  label?: string;
}

export interface FlowSpec {
  id: string;
  name: string;
  description?: string;
  start: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Global step cap to bound loops/cycles. Default 50. */
  maxSteps?: number;
  priority?: KanbanPriority;
}

export type FlowRunStatus = "running" | "awaiting-human" | "done" | "failed";

export interface FlowStepRecord {
  nodeId: string;
  kind: FlowNodeKind;
  attempt: number;
  outcome: "passed" | "failed";
  score?: number;
  output?: string;
  at: number;
}

/** Current FlowRunState schema version. Persisted runs without it are the legacy
 * single-active-node shape and are migrated by `normalizeFlowRunState` on read
 * (then rewritten in the new shape on the next save). */
export const FLOW_RUN_STATE_VERSION = 2;

export interface FlowRunState {
  /** Absent on legacy (pre-parallel) persisted runs; see FLOW_RUN_STATE_VERSION. */
  version?: number;
  flowId: string;
  flowName: string;
  runId: string;
  status: FlowRunStatus;
  /**
   * Compatibility mirror of `activeNodeIds[0]` (null when terminal), kept so
   * legacy readers/UI that show "the" current node keep working. The engine
   * maintains it; treat `activeNodeIds` as the source of truth.
   */
  currentNodeId: string | null;
  /** All currently-active nodes. Parallel branches make this multi-element; linear flows stay single-element. */
  activeNodeIds: string[];
  /**
   * Inbound edges (encoded "from=>to") that fired but whose target has not yet
   * activated — the join ledger. A node with inbound edges from several distinct
   * sources becomes runnable only when every source has fired an edge to it; its
   * entries are then consumed so loops re-arm.
   */
  firedEdges: string[];
  /** Nodes activated by the latest transition that the runner has not yet dispatched. */
  pendingDispatchNodeIds: string[];
  /** Shared typed state: each node's output is written here and readable by later nodes. */
  state: Record<string, unknown>;
  history: FlowStepRecord[];
  stepCount: number;
  startedAt: number;
  endedAt?: number;
  failureReason?: string;
}

/** Result of running one node, fed back into the engine to choose the next edge. */
export type FlowNodeResult =
  | { kind: "task"; outcome: "passed" | "failed"; score?: number; output?: string }
  | { kind: "approval"; approved: boolean; note?: string };

// Normalized HivemindOS code-intelligence types.
//
// HivemindOS owns this shape. Providers (the optional codebase-memory-mcp
// binary, or the built-in repo-scan fallback) each normalize their own output
// INTO these types, so every product surface — context index, Hive actions,
// dashboard, MCP — speaks one vocabulary regardless of which engine answered.
//
// The node/edge kinds intentionally span two layers:
//   - Code Intelligence (File/Module/Class/Function/Method/Route/Resource):
//     produced by the upstream code-graph engine.
//   - System Intelligence (HiveAction/ConnectedApp + EXPOSES_MCP/CONTEXT_MATCHES
//     /FILE_CHANGES_WITH): produced by HivemindOS stitching the code graph to
//     what it already knows about the running hive. This is the "understands
//     your setup" layer that benefits non-programmers, not just builders.

export type CodeGraphNodeKind =
  | "Project"
  | "File"
  | "Module"
  | "Class"
  | "Function"
  | "Method"
  | "Route"
  | "Resource"
  | "HiveAction"
  | "ConnectedApp";

export type CodeGraphEdgeKind =
  | "DEFINES"
  | "IMPORTS"
  | "CALLS"
  | "HTTP_CALLS"
  | "HANDLES"
  | "EXPOSES_MCP"
  | "CONTEXT_MATCHES"
  | "FILE_CHANGES_WITH";

export type CodeIntelProviderId = "codebase-memory" | "fallback";

/** Health of an external provider binary. The fallback is always "available". */
export type CodeIntelProviderAvailability = "available" | "missing" | "unhealthy";

export type CodeIntelRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Stamped onto every result so a caller can tell where the data came from and
 * how much to trust it. `confidence` is 0..1: exact structural graph answers
 * score high, semantic/heuristic answers lower, fallback lowest.
 */
export type CodeIntelMeta = {
  project: string;
  repoPath: string;
  provider: CodeIntelProviderId;
  confidence: number;
  generatedAt: string;
};

export type CodeGraphNode = {
  id: string;
  kind: CodeGraphNodeKind;
  name: string;
  qualifiedName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  language?: string;
  signature?: string;
  exported?: boolean;
  /** For Route/ConnectedApp nodes. */
  route?: string;
  methods?: string[];
  inDegree?: number;
  outDegree?: number;
  /** Provider-specific extras kept as opaque data (untrusted external JSON). */
  extra?: Record<string, unknown>;
};

export type CodeGraphEdge = {
  kind: CodeGraphEdgeKind;
  from: string;
  to: string;
  weight?: number;
};

/** Resolved, workspace-validated repo identity shared by every provider call. */
export type CodeIntelRepoRef = {
  repoPath: string;
  project: string;
};

// ── Per-action result payloads (without meta; the service stamps meta) ──────

export type ProviderStatusInfo = {
  availability: CodeIntelProviderAvailability;
  version?: string;
  /** Provider believes this repo already has a persisted/queryable index. */
  indexed?: boolean;
  nodes?: number;
  edges?: number;
  detail?: string;
};

export type CodeIntelStatus = {
  provider: CodeIntelProviderId;
  activeProvider: CodeIntelProviderId;
  providers: Record<CodeIntelProviderId, ProviderStatusInfo>;
  /** True when the upstream engine is installed, healthy, and this repo indexed. */
  graphReady: boolean;
  capabilities: CodeIntelCapability[];
};

export type CodeIntelCapability =
  | "search-graph"
  | "trace-path"
  | "detect-changes"
  | "get-architecture"
  | "get-code-snippet"
  | "index-repository";

export type IndexRepositoryResult = {
  status: "indexed" | "degraded" | "error" | "noop";
  nodes?: number;
  edges?: number;
  detail?: string;
};

export type SearchGraphResult = {
  nodes: CodeGraphNode[];
  total: number;
  hasMore: boolean;
  /** Set when the upstream engine had no index and we answered from a live scan. */
  degraded?: boolean;
  hint?: string;
};

export type TracePathResult = {
  function: string;
  direction: "inbound" | "outbound" | "both";
  callers: CodeGraphNode[];
  callees: CodeGraphNode[];
  degraded?: boolean;
  hint?: string;
};

export type ArchitectureRoute = {
  method: string;
  path: string;
  handler?: string;
  surface: "next-api" | "hive-action" | "connected-app" | "worker";
  source?: string;
};

export type ArchitectureResult = {
  totalNodes?: number;
  totalEdges?: number;
  nodeLabels: Array<{ label: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  languages: Array<{ language: string; fileCount: number }>;
  /** Unified cross-service route map (§ cross-service linking). */
  routes: ArchitectureRoute[];
  entryPoints: Array<{ name: string; qualifiedName?: string; file?: string }>;
  hotspots: Array<{ name: string; qualifiedName?: string; fanIn?: number }>;
  degraded?: boolean;
  hint?: string;
};

export type CodeSnippetResult = {
  node: CodeGraphNode | null;
  source: string;
  callers: number;
  callees: number;
  callerNames?: string[];
  calleeNames?: string[];
  degraded?: boolean;
  hint?: string;
};

export type DetectChangesResult = {
  ref: string;
  touchedFiles: string[];
  affectedSymbols: CodeGraphNode[];
  affectedRoutes: ArchitectureRoute[];
  inboundCallers: CodeGraphNode[];
  outboundDependencies: CodeGraphNode[];
  testsLikelyRelevant: string[];
  risk: CodeIntelRiskLevel;
  riskReasons: string[];
  degraded?: boolean;
  hint?: string;
};

// ── Public envelope (payload + meta), what the service / API returns ────────

export type WithMeta<T> = T & { meta: CodeIntelMeta };

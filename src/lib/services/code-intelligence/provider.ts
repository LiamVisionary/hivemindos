// Code-intelligence provider interface + shared, provider-agnostic helpers.
//
// A provider answers normalized code-graph queries for one resolved repo. The
// service (service.ts) owns provider selection, workspace validation, and meta
// stamping; providers only translate their engine's output into our types.

import { homedir } from "@/lib/home-dir";
import { resolve, sep } from "path";
import type {
  ArchitectureResult,
  CodeIntelProviderId,
  CodeIntelRepoRef,
  DetectChangesResult,
  IndexRepositoryResult,
  ProviderStatusInfo,
  SearchGraphResult,
  CodeSnippetResult,
  TracePathResult,
} from "./types";

export type IndexRepositoryInput = CodeIntelRepoRef & {
  mode?: "full" | "moderate" | "fast";
  /** Write the shareable .codebase-memory/graph.db.zst artifact. Default false. */
  persistence?: boolean;
};

export type SearchGraphInput = CodeIntelRepoRef & {
  query?: string;
  namePattern?: string;
  label?: string;
  filePattern?: string;
  limit?: number;
  offset?: number;
};

export type TracePathInput = CodeIntelRepoRef & {
  functionName: string;
  direction?: "inbound" | "outbound" | "both";
  depth?: number;
};

export type DetectChangesInput = CodeIntelRepoRef & {
  baseRef?: string;
  since?: string;
  scope?: "files" | "symbols" | "impact";
  depth?: number;
};

export type ArchitectureInput = CodeIntelRepoRef & {
  path?: string;
  aspects?: string[];
};

export type CodeSnippetInput = CodeIntelRepoRef & {
  qualifiedName?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  includeNeighbors?: boolean;
};

export interface CodeIntelProvider {
  readonly id: CodeIntelProviderId;
  detectStatus(ref: CodeIntelRepoRef): Promise<ProviderStatusInfo>;
  indexRepository(input: IndexRepositoryInput): Promise<IndexRepositoryResult>;
  searchGraph(input: SearchGraphInput): Promise<SearchGraphResult>;
  tracePath(input: TracePathInput): Promise<TracePathResult>;
  detectChanges(input: DetectChangesInput): Promise<DetectChangesResult>;
  getArchitecture(input: ArchitectureInput): Promise<ArchitectureResult>;
  getCodeSnippet(input: CodeSnippetInput): Promise<CodeSnippetResult>;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Local cache/config root. Never browser storage; never the repo. */
export function codeIntelHome(): string {
  return resolve(homedir(), ".hivemindos", "code-intelligence");
}

/**
 * Replicate codebase-memory-mcp's cbm_project_name_from_path (fqn.c:322-383)
 * so we can address an indexed project by the exact name the engine derives
 * from the absolute repo path — every char outside [A-Za-z0-9._-] becomes "-",
 * runs of "-"/"." collapse, leading "-"/"." and trailing "-" are trimmed.
 * Keeping this in lockstep lets queries run without an extra list_projects call;
 * the codebase-memory provider still falls back to list_projects-by-root_path
 * if a query reports the project missing.
 */
export function deriveProjectName(absRepoPath: string): string {
  if (!absRepoPath) return "root";
  let slug = absRepoPath.replace(/[^A-Za-z0-9._-]/g, "-");
  slug = slug.replace(/-{2,}/g, "-").replace(/\.{2,}/g, ".");
  slug = slug.replace(/^[-.]+/, "").replace(/-+$/, "");
  return slug || "root";
}

/**
 * Default allowed workspace roots. Code-intelligence indexes the running
 * HivemindOS checkout by default; extra roots can be added via config so a
 * user can deliberately point it at another repo, but an arbitrary caller path
 * can never escape this allowlist (path-traversal guard below).
 */
export function defaultAllowedRoots(): string[] {
  return [resolve(process.cwd())];
}

/**
 * Validate that a requested repo path is inside an allowed root and return its
 * resolved absolute form. Mirrors the runtime-file-explorer resolveInsideRoot
 * guard (handles Windows backslashes + leading slashes) — bare startsWith is
 * insufficient. Throws on escape; treats provider/caller paths as untrusted.
 */
export function resolveRepoPathInsideRoots(
  requested: string | undefined,
  allowedRoots: string[] = defaultAllowedRoots(),
): string {
  const roots = allowedRoots.map((root) => resolve(root));
  if (!requested || !requested.trim()) return roots[0];
  const cleaned = requested.replaceAll("\\", "/").trim();
  const resolved = resolve(cleaned);
  const inside = roots.some(
    (root) => resolved === root || resolved.startsWith(`${root}${sep}`),
  );
  if (!inside) {
    throw new Error(
      "repoPath is outside the allowed code-intelligence workspace.",
    );
  }
  return resolved;
}

/** Build the canonical repo reference (resolved path + engine project name). */
export function repoRefFor(
  requested: string | undefined,
  allowedRoots?: string[],
): CodeIntelRepoRef {
  const repoPath = resolveRepoPathInsideRoots(requested, allowedRoots);
  return { repoPath, project: deriveProjectName(repoPath) };
}

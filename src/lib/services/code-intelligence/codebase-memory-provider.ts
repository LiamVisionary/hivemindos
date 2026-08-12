// Provider that shells out to the optional codebase-memory-mcp binary.
//
// Invocation (confirmed against the audited 0.10.2 binary's per-tool help):
//   <binary> cli <toolName> --args-file <mode-0600-json>
// Query tools receive `format=json`; the current engine emits compact column /
// row tables while older builds emitted object arrays, so normalization accepts
// both. Engine/tool errors use STDERR + non-zero exit. We never use a shell —
// execFile gets a fixed binary, argv, timeouts, and maxBuffer. All engine output
// remains untrusted and is defensively coerced before crossing this provider.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { homedir } from "@/lib/home-dir";
import { codeIntelHome } from "./provider";
import type {
  ArchitectureInput,
  CodeIntelProvider,
  CodeSnippetInput,
  DetectChangesInput,
  IndexRepositoryInput,
  SearchGraphInput,
  TracePathInput,
} from "./provider";
import type {
  ArchitectureResult,
  ArchitectureRoute,
  CodeGraphNode,
  CodeIntelRepoRef,
  CodeSnippetResult,
  DetectChangesResult,
  IndexRepositoryResult,
  ProviderStatusInfo,
  SearchGraphResult,
  TracePathResult,
} from "./types";

const execFileAsync = promisify(execFile);

const BINARY_NAME = process.platform === "win32" ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
const QUERY_TIMEOUT_MS = 20_000;
const INDEX_TIMEOUT_MS = 300_000;
// A cold 0.10.2 CLI starts a temporary local daemon before answering and takes
// ~8s on Apple Silicon; leave enough headroom for the status probe itself.
const STATUS_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const RESULT_NODE_CAP = 500;

class NotIndexedError extends Error {
  // Explicit field (not a TS parameter property) so Node's strip-only loader,
  // used by the .mjs contract tests, can import this module.
  readonly project: string;
  constructor(project: string) {
    super(`Project ${project} is not indexed by codebase-memory.`);
    this.name = "NotIndexedError";
    this.project = project;
  }
}

type ExecError = Error & { code?: number; stderr?: string; stdout?: string; killed?: boolean };

let cachedBinaryPath: string | null | undefined;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateBinaryPaths(): string[] {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(resolve(localAppData, "Programs", "codebase-memory-mcp", BINARY_NAME));
    }
  } else {
    candidates.push(resolve(homedir(), ".local", "bin", BINARY_NAME));
    candidates.push(`/opt/homebrew/bin/${BINARY_NAME}`);
    candidates.push(`/usr/local/bin/${BINARY_NAME}`);
  }
  return candidates;
}

/** Optional explicit binary path persisted by a deliberate setup step. */
async function configuredBinaryPath(): Promise<string | undefined> {
  const configPath = resolve(codeIntelHome(), "config.json");
  const raw = await readFile(configPath, "utf8").catch(() => "");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { binaryPath?: unknown };
    return typeof parsed.binaryPath === "string" && parsed.binaryPath.trim()
      ? resolve(parsed.binaryPath.trim())
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a trusted binary path: an explicitly-configured path, a known install
 * location that exists on disk, or the bare PATH name only if it answers
 * --version. We never download or auto-install — detection only.
 */
async function resolveBinaryPath(): Promise<string | null> {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  // Opt-out kill switch: a user can disable the external engine entirely, and
  // tests use it to force deterministic missing-provider behavior.
  if (process.env.CODE_INTEL_DISABLE_ENGINE === "1") {
    cachedBinaryPath = null;
    return cachedBinaryPath;
  }
  const envOverride = process.env.CODEBASE_MEMORY_MCP_BIN?.trim();
  if (envOverride && (await pathExists(resolve(envOverride)))) {
    cachedBinaryPath = resolve(envOverride);
    return cachedBinaryPath;
  }
  const configured = await configuredBinaryPath();
  if (configured && (await pathExists(configured))) {
    cachedBinaryPath = configured;
    return cachedBinaryPath;
  }
  for (const candidate of candidateBinaryPaths()) {
    if (await pathExists(candidate)) {
      cachedBinaryPath = candidate;
      return cachedBinaryPath;
    }
  }
  // Last resort: a PATH-resolvable binary, verified by a successful --version.
  try {
    await execFileAsync(BINARY_NAME, ["--version"], { timeout: STATUS_TIMEOUT_MS, maxBuffer: 64_000 });
    cachedBinaryPath = BINARY_NAME;
    return cachedBinaryPath;
  } catch {
    cachedBinaryPath = null;
    return cachedBinaryPath;
  }
}

/** Test seam + setup hook: forget the cached binary resolution. */
export function resetCodebaseMemoryBinaryCache(): void {
  cachedBinaryPath = undefined;
}

function coerceErrorText(stderr: string | undefined): string {
  const text = (stderr ?? "").trim();
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

/**
 * Run one engine tool. Resolves to the parsed stdout payload; throws
 * NotIndexedError when the engine reports the project is absent, or a plain
 * Error for any other engine failure.
 */
async function runTool(
  binary: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  repoRoot: string,
): Promise<unknown> {
  const cacheDir = resolve(codeIntelHome(), "codebase-memory-cache");
  const argsDir = resolve(codeIntelHome(), "tmp");
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await mkdir(argsDir, { recursive: true, mode: 0o700 });
  const argsPath = resolve(argsDir, `${toolName}-${process.pid}-${randomUUID()}.json`);
  await writeFile(argsPath, `${JSON.stringify(args)}\n`, { mode: 0o600 });
  try {
    const { stdout } = await execFileAsync(
      binary,
      ["cli", toolName, "--args-file", argsPath],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: "utf8",
        env: {
          ...process.env,
          CBM_CACHE_DIR: cacheDir,
          CBM_ALLOWED_ROOT: resolve(repoRoot),
          CBM_LOG_LEVEL: "error",
        },
      },
    );
    const text = stdout.trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`codebase-memory ${toolName} returned non-JSON output.`);
    }
  } catch (error) {
    const execError = error as ExecError;
    const stderr = coerceErrorText(execError.stderr);
    // Business errors (incl. project-not-found) arrive on stderr with exit 1.
    if (/not\s+found|not\s+indexed|no_project|no such project/i.test(stderr)) {
      throw new NotIndexedError(String(args.project ?? ""));
    }
    if (execError.killed) {
      throw new Error(`codebase-memory ${toolName} timed out.`);
    }
    throw new Error(stderr || (error instanceof Error ? error.message : `codebase-memory ${toolName} failed.`));
  } finally {
    await unlink(argsPath).catch(() => undefined);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function toNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isNodeKind(label: string | undefined): CodeGraphNode["kind"] {
  switch (label) {
    case "Project":
    case "File":
    case "Module":
    case "Class":
    case "Function":
    case "Method":
    case "Route":
    case "Resource":
      return label;
    default:
      return "Function";
  }
}

const KNOWN_NODE_KEYS = new Set([
  "name", "qualified_name", "qn", "label", "file_path", "file", "in_degree", "out_degree",
  "start_line", "end_line", "lines", "signature", "is_exported", "hop", "risk", "rank",
]);

function normalizeNode(raw: unknown, idx: number): CodeGraphNode {
  const record = asRecord(raw);
  const qualifiedName = toStr(record.qualified_name) ?? toStr(record.qn);
  const name = toStr(record.name) ?? qualifiedName?.split(".").at(-1) ?? `node_${idx}`;
  const [linesStart, linesEnd] = parseLines(toStr(record.lines));
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!KNOWN_NODE_KEYS.has(key)) rest[key] = value;
  }
  return {
    id: qualifiedName ?? `${toStr(record.label) ?? "node"}:${name}:${idx}`,
    kind: isNodeKind(toStr(record.label)),
    name,
    qualifiedName,
    filePath: toStr(record.file_path) ?? toStr(record.file),
    startLine: toNum(record.start_line) ?? linesStart,
    endLine: toNum(record.end_line) ?? linesEnd,
    signature: toStr(record.signature),
    exported: typeof record.is_exported === "boolean" ? record.is_exported : undefined,
    inDegree: toNum(record.in_degree),
    outDegree: toNum(record.out_degree),
    extra: Object.keys(rest).length ? rest : undefined,
  };
}

function parseLines(value: string | undefined): [number | undefined, number | undefined] {
  const match = value?.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return [undefined, undefined];
  return [Number(match[1]), Number(match[2] ?? match[1])];
}

/** Convert the engine's compact {cols,rows|groups} table into named records. */
function tableRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord);
  const table = asRecord(value);
  const cols = asArray(table.cols).map(String);
  if (!cols.length) return [];
  const direct = asArray(table.rows).map((row) => rowRecord(cols, row));
  const grouped = asArray(table.groups).flatMap((groupValue) => {
    const group = asRecord(groupValue);
    const prefix = toStr(group.qn_prefix);
    return asArray(group.rows).map((row) => {
      const record = rowRecord(cols, row);
      const name = toStr(record.name) ?? toStr(record.qn);
      if (prefix && name && !record.qn && !record.qualified_name) record.qualified_name = `${prefix}.${name}`;
      return record;
    });
  });
  return [...direct, ...grouped];
}

function rowRecord(cols: string[], value: unknown): Record<string, unknown> {
  const row = asArray(value);
  return Object.fromEntries(cols.map((col, index) => [col, row[index]]));
}

async function resolveProjectViaList(binary: string, repoPath: string): Promise<string | null> {
  const result = asRecord(await runTool(binary, "list_projects", {}, STATUS_TIMEOUT_MS, repoPath).catch(() => ({})));
  const target = resolve(repoPath);
  for (const entry of asArray(result.projects)) {
    const record = asRecord(entry);
    const root = toStr(record.root_path);
    if (root && resolve(root) === target) return toStr(record.name) ?? null;
  }
  return null;
}

export class CodebaseMemoryProvider implements CodeIntelProvider {
  readonly id = "codebase-memory" as const;

  async detectStatus(ref: CodeIntelRepoRef): Promise<ProviderStatusInfo> {
    const binary = await resolveBinaryPath();
    if (!binary) return { availability: "missing", indexed: false };
    let version: string | undefined;
    try {
      const { stdout } = await execFileAsync(binary, ["--version"], { timeout: STATUS_TIMEOUT_MS, maxBuffer: 64_000 });
      version = stdout.trim().replace(/^codebase-memory-mcp\s+/, "") || undefined;
    } catch {
      return { availability: "unhealthy", detail: "binary present but --version failed" };
    }
    // Probe whether THIS repo is already indexed (best-effort; never throws up).
    try {
      const status = asRecord(await runTool(binary, "index_status", { project: ref.project }, STATUS_TIMEOUT_MS, ref.repoPath));
      const indexed = toStr(status.status) === "ready" && (toNum(status.nodes) ?? 0) > 0;
      return { availability: "available", version, indexed, nodes: toNum(status.nodes), edges: toNum(status.edges) };
    } catch (error) {
      if (error instanceof NotIndexedError) return { availability: "available", version, indexed: false };
      const detail = error instanceof Error ? coerceErrorText(error.message) : "unknown engine response";
      return { availability: "available", version, indexed: false, detail: `indexed-state probe inconclusive: ${detail}` };
    }
  }

  private async withProject<T>(
    ref: CodeIntelRepoRef,
    run: (binary: string, project: string) => Promise<T>,
  ): Promise<T> {
    const binary = await resolveBinaryPath();
    if (!binary) throw new NotIndexedError(ref.project);
    try {
      return await run(binary, ref.project);
    } catch (error) {
      if (error instanceof NotIndexedError) {
        const resolved = await resolveProjectViaList(binary, ref.repoPath);
        if (resolved && resolved !== ref.project) return run(binary, resolved);
      }
      throw error;
    }
  }

  async indexRepository(input: IndexRepositoryInput): Promise<IndexRepositoryResult> {
    const binary = await resolveBinaryPath();
    if (!binary) throw new Error("codebase-memory binary is not available.");
    const result = asRecord(
      await runTool(
        binary,
        "index_repository",
        { repo_path: input.repoPath, mode: input.mode ?? "full", persistence: input.persistence === true },
        INDEX_TIMEOUT_MS,
        input.repoPath,
      ),
    );
    const status = toStr(result.status);
    return {
      status: status === "indexed" || status === "degraded" || status === "error" ? status : "indexed",
      nodes: toNum(result.nodes),
      edges: toNum(result.edges),
      detail: toStr(result.hint) ?? toStr(result.adr_hint),
    };
  }

  async searchGraph(input: SearchGraphInput): Promise<SearchGraphResult> {
    return this.withProject(input, async (binary, project) => {
      const args: Record<string, unknown> = { project, limit: Math.min(input.limit ?? 50, RESULT_NODE_CAP), format: "json" };
      if (input.namePattern) args.name_pattern = input.namePattern;
      if (input.label) args.label = input.label;
      if (input.filePattern) args.file_pattern = input.filePattern;
      if (input.offset) args.offset = input.offset;
      // Free text routes to the engine's BM25 path; a name pattern to regex.
      if (input.query && !input.namePattern) args.query = input.query;
      const result = asRecord(await runTool(binary, "search_graph", args, QUERY_TIMEOUT_MS, input.repoPath));
      const rawNodes = Array.isArray(result.results) ? asArray(result.results) : tableRecords(result);
      const nodes = rawNodes.slice(0, RESULT_NODE_CAP).map(normalizeNode);
      return {
        nodes,
        total: toNum(result.total) ?? nodes.length,
        hasMore: result.has_more === true,
        hint: toStr(result.hint),
      };
    });
  }

  async tracePath(input: TracePathInput): Promise<TracePathResult> {
    return this.withProject(input, async (binary, project) => {
      const direction = input.direction ?? "both";
      const result = asRecord(
        await runTool(
          binary,
          "trace_path",
          { project, function_name: input.functionName, direction, depth: input.depth ?? 5, risk_labels: true, format: "json" },
          QUERY_TIMEOUT_MS,
          input.repoPath,
        ),
      );
      return {
        function: toStr(result.function) ?? input.functionName,
        direction,
        callers: tableRecords(result.callers).slice(0, RESULT_NODE_CAP).map(normalizeNode),
        callees: tableRecords(result.callees).slice(0, RESULT_NODE_CAP).map(normalizeNode),
        hint: toStr(result.hint),
      };
    });
  }

  async getArchitecture(input: ArchitectureInput): Promise<ArchitectureResult> {
    return this.withProject(input, async (binary, project) => {
      const args: Record<string, unknown> = { project, format: "json" };
      if (input.path) args.path = input.path;
      if (input.aspects?.length) args.aspects = input.aspects;
      const result = asRecord(await runTool(binary, "get_architecture", args, QUERY_TIMEOUT_MS, input.repoPath));
      const routes: ArchitectureRoute[] = tableRecords(result.routes).map((raw) => {
        const record = asRecord(raw);
        return {
          method: toStr(record.method) ?? "ANY",
          path: toStr(record.path) ?? "",
          handler: toStr(record.handler),
          surface: "next-api" as const,
          source: "codebase-memory",
        };
      });
      return {
        totalNodes: toNum(result.total_nodes),
        totalEdges: toNum(result.total_edges),
        nodeLabels: tableRecords(result.node_labels).map((raw) => {
          const record = asRecord(raw);
          return { label: toStr(record.label) ?? "", count: toNum(record.count) ?? 0 };
        }),
        edgeTypes: tableRecords(result.edge_types).map((raw) => {
          const record = asRecord(raw);
          return { type: toStr(record.type) ?? "", count: toNum(record.count) ?? 0 };
        }),
        languages: tableRecords(result.languages).map((raw) => {
          const record = asRecord(raw);
          return { language: toStr(record.language) ?? "", fileCount: toNum(record.file_count) ?? toNum(record.files) ?? 0 };
        }),
        routes,
        entryPoints: tableRecords(result.entry_points).map((raw) => {
          const record = asRecord(raw);
          const qualifiedName = toStr(record.qualified_name) ?? toStr(record.qn);
          return { name: toStr(record.name) ?? qualifiedName?.split(".").at(-1) ?? "", qualifiedName, file: toStr(record.file) };
        }),
        hotspots: tableRecords(result.hotspots).map((raw) => {
          const record = asRecord(raw);
          return { name: toStr(record.name) ?? "", qualifiedName: toStr(record.qualified_name), fanIn: toNum(record.fan_in) };
        }),
      };
    });
  }

  async getCodeSnippet(input: CodeSnippetInput): Promise<CodeSnippetResult> {
    if (!input.qualifiedName) {
      throw new Error("codebase-memory get-code-snippet requires a qualifiedName.");
    }
    return this.withProject(input, async (binary, project) => {
      const result = asRecord(
        await runTool(
          binary,
          "get_code_snippet",
          { project, qualified_name: input.qualifiedName, include_neighbors: input.includeNeighbors === true, format: "json" },
          QUERY_TIMEOUT_MS,
          input.repoPath,
        ),
      );
      const node = toStr(result.qualified_name) ? normalizeNode(result, 0) : null;
      return {
        node,
        source: toStr(result.source) ?? "",
        callers: toNum(result.callers) ?? 0,
        callees: toNum(result.callees) ?? 0,
        callerNames: asArray(result.caller_names).map((value) => String(value)),
        calleeNames: asArray(result.callee_names).map((value) => String(value)),
      };
    });
  }

  async detectChanges(input: DetectChangesInput): Promise<DetectChangesResult> {
    return this.withProject(input, async (binary, project) => {
      const args: Record<string, unknown> = { project, scope: input.scope ?? "symbols", depth: input.depth ?? 2, format: "json" };
      if (input.since) args.since = input.since;
      else args.base_branch = input.baseRef ?? "main";
      const result = asRecord(await runTool(binary, "detect_changes", args, QUERY_TIMEOUT_MS, input.repoPath));
      const touchedFiles = asArray(result.changed_files).map((value) => String(value));
      const affectedSymbols: CodeGraphNode[] = asArray(result.impacted_symbols ?? result.impacted).map((raw, idx) => {
        const record = asRecord(raw);
        const qualifiedName = toStr(record.qualified_name) ?? toStr(record.qn);
        return {
          id: `${toStr(record.label) ?? "symbol"}:${toStr(record.name) ?? idx}`,
          kind: isNodeKind(toStr(record.label)),
          name: toStr(record.name) ?? qualifiedName?.split(".").at(-1) ?? `symbol_${idx}`,
          qualifiedName,
          filePath: toStr(record.file_path) ?? toStr(record.file),
        };
      });
      const affectedRoutes: ArchitectureRoute[] = touchedFiles
        // Engine returns repo-relative paths (git -C ROOT), so allow a start-anchored match too.
        .filter((file) => /(^|[\\/])src[\\/]app[\\/]api[\\/].+route\.ts$/.test(file))
        .map((file) => ({ method: "ANY", path: routeFromApiFile(file), handler: file, surface: "next-api" as const }));
      // inbound/outbound/tests/risk are enriched by the service uniformly.
      return {
        ref: input.since ?? input.baseRef ?? "main",
        touchedFiles,
        affectedSymbols,
        affectedRoutes,
        inboundCallers: [],
        outboundDependencies: [],
        testsLikelyRelevant: [],
        risk: "low",
        riskReasons: [],
        hint: toStr(result.hint),
      };
    });
  }
}

function routeFromApiFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)src\/app\/api\/(.+)\/route\.ts$/);
  if (!match) return normalized;
  return `/api/${match[1]}`.replace(/\[([^\]]+)\]/g, ":$1");
}

export { NotIndexedError };

// Built-in fallback provider: a bounded, live filesystem scan used when the
// codebase-memory engine is not installed. It is intentionally lighter than the
// real graph — it finds exported symbols and routes (so agents still beat raw
// file-walking for discovery) but cannot answer call-graph questions
// (trace-path) without the engine. Those degrade gracefully with a clear hint.
//
// Mirrors the existing context-index repo-scan style (walkFiles + skip dirs +
// export/method regexes) rather than introducing a new scanning mechanism.

import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
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

const SKIPPED_DIRS = new Set([".git", ".next", ".next-tauri", ".next-tauri-build", "node_modules", "out", "dist", "build", ".codebase-memory"]);
const SOURCE_ROOTS = ["src", "scripts", "workers", "cmd", "src-tauri/src"];
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".go", ".rs", ".py"]);
const MAX_SCAN_FILES = 2_000;
const ENGINE_HINT = "Install codebase-memory-mcp for call-graph, impact, and snippet intelligence; this is the built-in live-scan fallback.";

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".go": "Go",
  ".rs": "Rust",
  ".py": "Python",
};

const EXPORTED_FUNCTION_RE = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g;
const EXPORTED_CLASS_RE = /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g;
const EXPORTED_CONST_RE = /export\s+const\s+([A-Za-z0-9_]+)/g;
const METHOD_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

async function walkSource(root: string, output: string[] = [], cap = MAX_SCAN_FILES): Promise<string[]> {
  if (output.length >= cap) return output;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= cap) break;
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await walkSource(path, output, cap);
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name))) {
      output.push(path);
    }
  }
  return output;
}

async function sourceFiles(repoPath: string, cap = MAX_SCAN_FILES): Promise<string[]> {
  const files: string[] = [];
  for (const root of SOURCE_ROOTS) {
    if (files.length >= cap) break;
    await walkSource(join(repoPath, root), files, cap);
  }
  return files;
}

function relativeTo(repoPath: string, file: string): string {
  return file.startsWith(`${repoPath}${sep}`) ? file.slice(repoPath.length + 1).replaceAll(sep, "/") : file.replaceAll(sep, "/");
}

function languageOf(file: string): string | undefined {
  return LANGUAGE_BY_EXT[extname(file)];
}

function matchNames(source: string, re: RegExp): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(re)) names.push(match[1]);
  return names;
}

function routeFromApiFile(repoPath: string, file: string): string {
  const rel = relativeTo(repoPath, file);
  const match = rel.match(/^src\/app\/api\/(.+)\/route\.ts$/);
  if (!match) return `/${rel}`;
  return `/api/${match[1]}`.replace(/\[([^\]]+)\]/g, ":$1");
}

function symbolNode(name: string, kind: CodeGraphNode["kind"], file: string, repoPath: string): CodeGraphNode {
  const rel = relativeTo(repoPath, file);
  return {
    id: `${kind}:${rel}#${name}`,
    kind,
    name,
    qualifiedName: `${rel}:${name}`,
    filePath: file,
    language: languageOf(file),
    exported: true,
  };
}

export class FallbackProvider implements CodeIntelProvider {
  readonly id = "fallback" as const;

  async detectStatus(_ref: CodeIntelRepoRef): Promise<ProviderStatusInfo> {
    void _ref;
    return { availability: "available", indexed: false, detail: "built-in live repo scan (no persistent graph)" };
  }

  async indexRepository(_input: IndexRepositoryInput): Promise<IndexRepositoryResult> {
    void _input;
    return { status: "noop", detail: "Fallback provider scans live files on each query; nothing to persist." };
  }

  async searchGraph(input: SearchGraphInput): Promise<SearchGraphResult> {
    const files = await sourceFiles(input.repoPath);
    const query = input.query?.toLowerCase().trim();
    const namePattern = input.namePattern ? safeRegex(input.namePattern) : null;
    const wantLabel = input.label;
    const limit = Math.min(input.limit ?? 50, 500);
    const filePattern = input.filePattern ? input.filePattern.toLowerCase() : undefined;
    const nodes: CodeGraphNode[] = [];

    for (const file of files) {
      if (nodes.length >= limit) break;
      const rel = relativeTo(input.repoPath, file);
      if (filePattern && !rel.toLowerCase().includes(filePattern.replace(/[%*]/g, ""))) continue;
      const source = await readFile(file, "utf8").catch(() => "");
      if (!source) continue;
      const isRoute = /\/src\/app\/api\/.+\/route\.ts$/.test(file.replaceAll(sep, "/"));
      const candidates: CodeGraphNode[] = [];
      if (!wantLabel || wantLabel === "Function") {
        for (const name of matchNames(source, EXPORTED_FUNCTION_RE)) candidates.push(symbolNode(name, "Function", file, input.repoPath));
        for (const name of matchNames(source, EXPORTED_CONST_RE)) candidates.push(symbolNode(name, "Function", file, input.repoPath));
      }
      if (!wantLabel || wantLabel === "Class") {
        for (const name of matchNames(source, EXPORTED_CLASS_RE)) candidates.push(symbolNode(name, "Class", file, input.repoPath));
      }
      if (isRoute && (!wantLabel || wantLabel === "Route")) {
        const route = routeFromApiFile(input.repoPath, file);
        candidates.push({ id: `Route:${route}`, kind: "Route", name: route, route, methods: matchNames(source, METHOD_RE), filePath: file, language: languageOf(file) });
      }
      for (const node of candidates) {
        if (nodes.length >= limit) break;
        const haystack = `${node.name} ${node.qualifiedName ?? ""} ${node.route ?? ""}`.toLowerCase();
        if (query && !haystack.includes(query)) continue;
        if (namePattern && !namePattern.test(node.name)) continue;
        nodes.push(node);
      }
    }
    return { nodes, total: nodes.length, hasMore: nodes.length >= limit, degraded: true, hint: ENGINE_HINT };
  }

  async tracePath(input: TracePathInput): Promise<TracePathResult> {
    return {
      function: input.functionName,
      direction: input.direction ?? "both",
      callers: [],
      callees: [],
      degraded: true,
      hint: `Call-graph tracing needs the codebase-memory engine. ${ENGINE_HINT}`,
    };
  }

  async getArchitecture(input: ArchitectureInput): Promise<ArchitectureResult> {
    const files = await sourceFiles(input.repoPath);
    const languageCounts = new Map<string, number>();
    const routes: ArchitectureRoute[] = [];
    let functionCount = 0;
    let classCount = 0;

    for (const file of files) {
      const lang = languageOf(file) ?? "Other";
      languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
      const isRoute = /\/src\/app\/api\/.+\/route\.ts$/.test(file.replaceAll(sep, "/"));
      if (isRoute) {
        const source = await readFile(file, "utf8").catch(() => "");
        const methods = matchNames(source, METHOD_RE);
        const route = routeFromApiFile(input.repoPath, file);
        for (const method of methods.length ? methods : ["ANY"]) {
          routes.push({ method, path: route, handler: relativeTo(input.repoPath, file), surface: "next-api", source: "fallback-scan" });
        }
      }
    }
    // Cheap symbol totals from a bounded sample (avoid reading every file twice).
    for (const file of files.slice(0, 400)) {
      const source = await readFile(file, "utf8").catch(() => "");
      functionCount += matchNames(source, EXPORTED_FUNCTION_RE).length + matchNames(source, EXPORTED_CONST_RE).length;
      classCount += matchNames(source, EXPORTED_CLASS_RE).length;
    }

    return {
      totalNodes: files.length,
      nodeLabels: [
        { label: "File", count: files.length },
        { label: "Route", count: routes.length },
        { label: "Function", count: functionCount },
        { label: "Class", count: classCount },
      ],
      edgeTypes: [],
      languages: [...languageCounts.entries()].map(([language, fileCount]) => ({ language, fileCount })).sort((a, b) => b.fileCount - a.fileCount),
      routes,
      entryPoints: routes.slice(0, 25).map((route) => ({ name: `${route.method} ${route.path}`, file: route.handler })),
      hotspots: [],
      degraded: true,
      hint: ENGINE_HINT,
    };
  }

  async getCodeSnippet(input: CodeSnippetInput): Promise<CodeSnippetResult> {
    // Direct file+line slice when given; otherwise locate an exported symbol.
    if (input.filePath) {
      const abs = resolve(input.repoPath, input.filePath);
      if (!abs.startsWith(`${input.repoPath}${sep}`) && abs !== input.repoPath) {
        throw new Error("filePath is outside the repository.");
      }
      const source = await readFile(abs, "utf8").catch(() => "");
      const lines = source.split("\n");
      const start = Math.max(1, input.startLine ?? 1);
      const end = Math.min(lines.length, input.endLine ?? Math.min(lines.length, start + 40));
      return {
        node: { id: `File:${input.filePath}`, kind: "File", name: input.filePath, filePath: abs, startLine: start, endLine: end, language: languageOf(abs) },
        source: lines.slice(start - 1, end).join("\n"),
        callers: 0,
        callees: 0,
        degraded: true,
        hint: ENGINE_HINT,
      };
    }
    const name = (input.qualifiedName ?? "").split(/[:.#]/).pop() ?? "";
    if (!name) return { node: null, source: "", callers: 0, callees: 0, degraded: true, hint: "Provide qualifiedName or filePath." };
    const files = await sourceFiles(input.repoPath);
    const defRe = new RegExp(`export\\s+(?:async\\s+)?(?:function|class|const)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    for (const file of files) {
      const source = await readFile(file, "utf8").catch(() => "");
      const lines = source.split("\n");
      const idx = lines.findIndex((line) => defRe.test(line));
      if (idx < 0) continue;
      const end = Math.min(lines.length, idx + 1 + 40);
      return {
        node: symbolNode(name, "Function", file, input.repoPath),
        source: lines.slice(idx, end).join("\n"),
        callers: 0,
        callees: 0,
        degraded: true,
        hint: ENGINE_HINT,
      };
    }
    return { node: null, source: "", callers: 0, callees: 0, degraded: true, hint: `Symbol ${name} not found by live scan. ${ENGINE_HINT}` };
  }

  async detectChanges(input: DetectChangesInput): Promise<DetectChangesResult> {
    const base = input.since ?? input.baseRef ?? "main";
    const touchedFiles = await gitChangedFiles(input.repoPath, base);
    const affectedSymbols: CodeGraphNode[] = [];
    const affectedRoutes: ArchitectureRoute[] = [];
    const testsLikelyRelevant: string[] = [];

    for (const rel of touchedFiles) {
      const abs = join(input.repoPath, rel);
      const normalized = rel.replaceAll(sep, "/");
      if (/\.(test|spec)\./.test(normalized) || /(^|\/)tests?\//.test(normalized) || /scripts\/test-/.test(normalized)) {
        testsLikelyRelevant.push(rel);
      }
      if (/^src\/app\/api\/.+\/route\.ts$/.test(normalized)) {
        const source = await readFile(abs, "utf8").catch(() => "");
        affectedRoutes.push({ method: matchNames(source, METHOD_RE).join(",") || "ANY", path: routeFromApiFile(input.repoPath, abs), handler: rel, surface: "next-api", source: "fallback-scan" });
      }
      if (SCAN_EXTENSIONS.has(extname(rel)) && affectedSymbols.length < 200) {
        const source = await readFile(abs, "utf8").catch(() => "");
        for (const name of matchNames(source, EXPORTED_FUNCTION_RE)) affectedSymbols.push(symbolNode(name, "Function", abs, input.repoPath));
        for (const name of matchNames(source, EXPORTED_CLASS_RE)) affectedSymbols.push(symbolNode(name, "Class", abs, input.repoPath));
      }
    }
    return {
      ref: base,
      touchedFiles,
      affectedSymbols,
      affectedRoutes,
      inboundCallers: [],
      outboundDependencies: [],
      testsLikelyRelevant,
      risk: "low",
      riskReasons: [],
      degraded: true,
      hint: `Inbound caller / outbound dependency impact needs the codebase-memory engine. ${ENGINE_HINT}`,
    };
  }
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

async function gitChangedFiles(repoPath: string, base: string): Promise<string[]> {
  const isDir = await stat(repoPath).then((s) => s.isDirectory()).catch(() => false);
  if (!isDir) return [];
  const runs = [
    ["diff", "--name-only", `${base}...HEAD`],
    ["diff", "--name-only", "HEAD"],
    ["diff", "--name-only"],
  ];
  const files = new Set<string>();
  for (const argv of runs) {
    const out = await execFileAsync("git", ["-C", repoPath, ...argv], { timeout: 8_000, maxBuffer: 1_000_000, encoding: "utf8" })
      .then((result) => result.stdout)
      .catch(() => "");
    for (const line of out.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }
  return [...files];
}

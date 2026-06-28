#!/usr/bin/env node
// Contract test for the HivemindOS code-intelligence layer. Proves the four
// acceptance-criteria behaviors without the third-party binary installed:
//   1. provider helpers (project-name slug + workspace-escape guard),
//   2. missing-provider status degrades gracefully (active provider = fallback),
//   3. search/architecture/trace answer via the fallback (search beats raw walk;
//      trace degrades with a clear hint instead of throwing),
//   4. the new code intelligence tools appear in the context index,
//   5. the code_* Hive actions carry correct MCP metadata.
import assert from "node:assert/strict";
import { register } from "node:module";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

// Force the external engine missing so this is deterministic on any machine.
process.env.CODE_INTEL_DISABLE_ENGINE = "1";

const { codeIntelligenceService } = await import("../src/lib/services/code-intelligence/service.ts");
const { resetCodebaseMemoryBinaryCache } = await import("../src/lib/services/code-intelligence/codebase-memory-provider.ts");
const { deriveProjectName, resolveRepoPathInsideRoots, repoRefFor } = await import("../src/lib/services/code-intelligence/provider.ts");
const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");
const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

resetCodebaseMemoryBinaryCache();

// 1. Provider helpers ───────────────────────────────────────────────────────
assert.equal(deriveProjectName("/Users/liam/code/myrepo"), "Users-liam-code-myrepo", "slug must match the engine's fqn derivation");
assert.equal(deriveProjectName("/home/u/my project"), "home-u-my-project", "spaces collapse to a single dash");
assert.equal(deriveProjectName("///weird..//path--x/"), "weird.-path-x", "leading/trailing/collapse rules applied");
assert.throws(() => resolveRepoPathInsideRoots("/etc/passwd"), /outside the allowed/, "path-traversal must be rejected");
assert.ok(repoRefFor(undefined).repoPath.length > 0, "default repo ref resolves to the checkout");

// 2. Missing-provider status degrades gracefully ──────────────────────────────
const service = codeIntelligenceService();
const status = await service.status();
assert.equal(status.providers["codebase-memory"].availability, "missing", "engine reported missing");
assert.equal(status.providers.fallback.availability, "available", "fallback is always available");
assert.equal(status.graphReady, false, "graph not ready without an engine");
assert.equal(status.activeProvider, "fallback", "active provider falls back");
assert.equal(status.meta.provider, "fallback", "meta records the active provider");

// 3. Search / trace answer via the fallback ───────────────────────────────────
const search = await service.searchGraph(undefined, { query: "codeIntelligenceService", limit: 30 });
assert.equal(search.meta.provider, "fallback", "search answered by fallback");
assert.equal(search.degraded, true, "fallback search is flagged degraded");
assert.ok(search.nodes.length >= 1, "fallback finds at least one matching symbol (beats raw file walk)");

const trace = await service.tracePath(undefined, { functionName: "codeIntelligenceService" });
assert.equal(trace.degraded, true, "trace degrades without the engine");
assert.ok(trace.hint && /codebase-memory/i.test(trace.hint), "trace explains the engine is needed");

const arch = await service.getArchitecture(undefined, {});
assert.ok(arch.routes.some((route) => route.path === "/api/code-intelligence"), "architecture lists the code-intelligence route");

// 4. Context index surfaces the new tools ─────────────────────────────────────
const codeGraphQuery = await searchContextIndex({ query: "code graph", limit: 60, kinds: ["repo-architecture", "tool-schema", "code-route"] });
assert.ok(codeGraphQuery.items.some((item) => item.id === "code-arch:repo"), "q=code graph returns the repo-architecture map");

const toolSchemas = await searchContextIndex({ kinds: ["tool-schema"], limit: 400 });
for (const id of ["code.search-graph", "code.trace-path", "code.get-architecture", "code.get-snippet", "code.detect-changes", "code.index-repository"]) {
  assert.ok(toolSchemas.items.some((item) => item.id === `hive-action:${id}`), `${id} should be a context-index tool`);
}

// 5. MCP action metadata ──────────────────────────────────────────────────────
const mcpTools = new Map(listMcpHiveActions(listHiveActions()).map((tool) => [tool.name, tool]));
for (const name of ["code_search_graph", "code_trace_path", "code_get_architecture", "code_get_snippet", "code_detect_changes", "code_index_repository"]) {
  assert.ok(mcpTools.has(name), `${name} should be MCP-exposed`);
}
assert.equal(mcpTools.get("code_search_graph").annotations.readOnlyHint, true, "search is read-only");
assert.equal(mcpTools.get("code_index_repository").annotations.readOnlyHint, false, "index is not read-only");
assert.equal(mcpTools.get("code_index_repository").annotations.destructiveHint, true, "index writes, so destructiveHint is set");

// 6. Codebase-memory provider: real execFile path + JSON normalization ────────
// Validated against a stub binary that emulates `cli <tool> '<json>'` with the
// engine's documented output shapes — proves invocation + normalization without
// compiling the third-party C binary. (POSIX-only: relies on a shebang script.)
if (process.platform !== "win32") {
  const { CodebaseMemoryProvider } = await import("../src/lib/services/code-intelligence/codebase-memory-provider.ts");
  const ref = repoRefFor(undefined);
  const stubDir = mkdtempSync(join(tmpdir(), "cbm-stub-"));
  const stubPath = join(stubDir, "codebase-memory-mcp");
  const stub = `#!/usr/bin/env node
const argv = process.argv.slice(2).filter((a) => a !== "--json" && a !== "--progress");
if (argv[0] === "--version") { process.stdout.write("codebase-memory-mcp 9.9.9-stub\\n"); process.exit(0); }
if (argv[0] !== "cli") { process.stderr.write("bad usage\\n"); process.exit(1); }
const root = process.env.STUB_ROOT || "";
const payloads = {
  index_status: { project: "stub", nodes: 1200, edges: 4300, status: "ready", root_path: root, git: {} },
  list_projects: { projects: [{ name: "stub", root_path: root, nodes: 1200, edges: 4300, size_bytes: 1 }] },
  index_repository: { project: "stub", status: "indexed", nodes: 1200, edges: 4300 },
  search_graph: { total: 2, has_more: false, results: [
    { name: "HandleRequest", qualified_name: "main.HandleRequest", label: "Function", file_path: "/r/main.go", in_degree: 3, out_degree: 5, signature: "func()", is_exported: true },
    { name: "Server", qualified_name: "main.Server", label: "Class", file_path: "/r/server.go", in_degree: 0, out_degree: 2 } ] },
  trace_path: { function: "HandleRequest", direction: "both",
    callers: [{ name: "main", qualified_name: "main.main", hop: 1 }],
    callees: [{ name: "log", qualified_name: "log.Println", hop: 1, risk: "low" }] },
  get_architecture: { project: "stub", total_nodes: 1200, total_edges: 4300,
    node_labels: [{ label: "Function", count: 800 }], edge_types: [{ type: "CALLS", count: 4000 }],
    languages: [{ language: "Go", file_count: 40 }], routes: [{ method: "GET", path: "/health", handler: "HealthHandler" }],
    entry_points: [{ name: "main", qualified_name: "main.main", file: "/r/main.go" }],
    hotspots: [{ name: "log.Println", qualified_name: "log.Println", fan_in: 99 }] },
  get_code_snippet: { name: "HandleRequest", qualified_name: "main.HandleRequest", label: "Function",
    file_path: "/r/main.go", start_line: 10, end_line: 20, source: "func HandleRequest() {}", callers: 3, callees: 5 },
  detect_changes: { changed_files: ["src/app/api/wallet/route.ts", "src/lib/x.ts"], changed_count: 2,
    impacted_symbols: [{ name: "POST", label: "Function", file: "src/app/api/wallet/route.ts" }], depth: 2 } };
const out = payloads[argv[1]];
if (!out) { process.stderr.write("project not found\\n"); process.exit(1); }
process.stdout.write(JSON.stringify(out) + "\\n");
`;
  writeFileSync(stubPath, stub);
  chmodSync(stubPath, 0o755);

  delete process.env.CODE_INTEL_DISABLE_ENGINE;
  process.env.CODEBASE_MEMORY_MCP_BIN = stubPath;
  process.env.STUB_ROOT = ref.repoPath;
  resetCodebaseMemoryBinaryCache();

  const provider = new CodebaseMemoryProvider();

  const engineStatus = await provider.detectStatus(ref);
  assert.equal(engineStatus.availability, "available", "stub engine resolves as available");
  assert.equal(engineStatus.version, "9.9.9-stub", "version parsed from --version output");
  assert.equal(engineStatus.indexed, true, "ready+nodes>0 reads as indexed");

  const sg = await provider.searchGraph({ ...ref, query: "Handle" });
  assert.equal(sg.nodes.length, 2, "search results normalized");
  assert.equal(sg.nodes[0].name, "HandleRequest");
  assert.equal(sg.nodes[0].qualifiedName, "main.HandleRequest");
  assert.equal(sg.nodes[0].kind, "Function");
  assert.equal(sg.nodes[0].inDegree, 3);
  assert.equal(sg.nodes[0].signature, "func()");
  assert.equal(sg.nodes[0].exported, true);
  assert.equal(sg.nodes[1].kind, "Class");

  const tp = await provider.tracePath({ ...ref, functionName: "HandleRequest" });
  assert.equal(tp.callers.length, 1);
  assert.equal(tp.callees[0].name, "log");

  const ar = await provider.getArchitecture({ ...ref });
  assert.equal(ar.routes[0].path, "/health");
  assert.equal(ar.languages[0].language, "Go");
  assert.equal(ar.hotspots[0].fanIn, 99);

  const snippet = await provider.getCodeSnippet({ ...ref, qualifiedName: "main.HandleRequest" });
  assert.equal(snippet.callers, 3);
  assert.match(snippet.source, /HandleRequest/);

  const dc = await provider.detectChanges({ ...ref });
  assert.deepEqual(dc.touchedFiles, ["src/app/api/wallet/route.ts", "src/lib/x.ts"]);
  assert.equal(dc.affectedRoutes.length, 1, "repo-relative api route mapped to affectedRoutes");
  assert.equal(dc.affectedRoutes[0].path, "/api/wallet");

  // Restore the engine-disabled default for any later imports.
  process.env.CODE_INTEL_DISABLE_ENGINE = "1";
  delete process.env.CODEBASE_MEMORY_MCP_BIN;
  resetCodebaseMemoryBinaryCache();
}

console.log("code-intelligence contract tests passed.");

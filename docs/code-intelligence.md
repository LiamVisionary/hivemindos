# Code Intelligence

HivemindOS-owned code-graph + system-graph intelligence. Agents can search
symbols, trace call paths, inspect architecture, map diff impact, and discover
how the hive is wired — through the existing context index, Hive actions, and
MCP surfaces, not a third-party binary directly.

## Two layers

- **Code Intelligence (builders):** call graphs, diff impact, route tracing,
  architecture — sourced from the optional [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp)
  engine when installed.
- **System Intelligence (everyone):** the cross-service map of how routes, Hive
  actions, MCP tools, and connected fleet apps fit together — produced by
  HivemindOS stitching the code graph to what it already knows. This is the
  "HivemindOS understands your setup" layer and works without the engine.

## Architecture

```
context index ─┐
Hive actions  ─┤
dashboard     ─┼─▶ CodeIntelligenceService ─▶ provider ─┬─ CodebaseMemoryProvider (execFile the engine)
MCP (hivemind)─┘        (selection, workspace            └─ FallbackProvider (bounded live repo scan)
                        validation, meta, enrichment)
```

- `src/lib/services/code-intelligence/` — types, provider interface, the two
  providers, the service, and cross-service route linking.
- `src/app/api/code-intelligence/route.ts` — the single action-discriminated API.
- Local cache/config lives under `~/.hivemindos/code-intelligence/` — never
  browser storage, never the repo.

### Providers

The service prefers the **codebase-memory** engine when it is installed *and*
this repo is indexed; otherwise it answers from the built-in **fallback** live
scan and flags results `degraded` with a clear hint. The external provider is
optional and reported as `available | missing | unhealthy`. The engine is never
auto-installed or auto-trusted — only an explicitly-configured path, a known
install location, or a PATH binary that answers `--version` is used. Set
`CODE_INTEL_DISABLE_ENGINE=1` to disable the engine entirely.

The engine is invoked via a fixed argv (`<binary> cli <tool> --args-file <path>`,
`execFile`, never a shell). HivemindOS writes the per-call JSON argument file
with mode `0600`, removes it in `finally`, applies cold-daemon-aware timeouts and
a max-output cap, and treats the compact column/row JSON as untrusted before
normalizing it into HivemindOS types. `CBM_ALLOWED_ROOT` is overwritten with the
workspace-validated repository on every call, and `CBM_CACHE_DIR` is overwritten
with `~/.hivemindos/code-intelligence/codebase-memory-cache`; caller environment
variables cannot broaden either boundary.

## API — `POST /api/code-intelligence`

`{ action, ...params }`. All `repoPath`s default to the checkout and are
validated to be inside the allowed workspace.

| action | purpose |
| --- | --- |
| `status` | provider availability, version, indexed-state, capabilities |
| `index-repository` | build/refresh the persistent graph (engine only) |
| `search-graph` | find symbols/routes by name pattern or query |
| `trace-path` | inbound callers / outbound callees of a function |
| `detect-changes` | diff impact: touched files, affected symbols/routes, callers, deps, tests, risk |
| `get-architecture` | structural summary + cross-service route map |
| `get-code-snippet` | source for a symbol or file/line range |

## MCP / Hive actions

Six actions are exposed via `hivemind-mcp`: `code_search_graph`,
`code_trace_path`, `code_get_architecture`, `code_get_snippet`,
`code_detect_changes` (read-only) and `code_index_repository` (writes;
`destructiveHint`). They route to `/api/code-intelligence`.

## Context index

The context index gains three kinds — `code-symbol`, `code-route`,
`repo-architecture`. A compact builder emits one repo/system-map summary plus a
capped set of exported symbols (it does **not** flood the index with every
private symbol), with retrieval text that tells agents when to call the `code_*`
tools. `/api/context-index?q=code graph` surfaces them.

## Diff impact

`detect-changes` is built for code review / PR summaries / "what did I break?".
With the engine it enriches touched files with call-graph inbound callers and
outbound dependencies; risk (`low|medium|high|critical`) and likely-relevant
tests are computed uniformly. Critical paths (auth / wallet / credential /
signing) escalate risk regardless of provider.

## Security & non-goals

- HivemindOS does not intentionally send credentials to the graph. The engine
  respects `.gitignore`, and the repository `.cbmignore` adds defense-in-depth
  exclusions for `.env` variants, private-key/certificate containers, service
  account files, and `Operations/Secure`. Hard-coded secrets in otherwise
  indexable source are still the repository owner's responsibility.
- The engine artifact is **not** committed by default (`persistence: false`),
  and the managed graph cache stays outside the repository under
  `~/.hivemindos/code-intelligence/`.
- Respects `.gitignore` / `.cbmignore` (engine) and HivemindOS skipped dirs (fallback).
- Third-party graph DBs are not durable Shared Brain Memory.
- `rg` is augmented, not replaced — graph queries add depth when an index exists.

## Verification

`pnpm test:code-intelligence` proves status/search/context-index retrieval and
MCP action metadata with the engine forced missing (graceful degradation), then
uses a stub with the audited 0.10.2 response shapes to prove invocation,
normalization, cache isolation, and repository-root isolation.

`pnpm test:code-intelligence:real` is the opt-in local E2E. It exercises the
real Next route, service, configured binary, managed persistent graph, search,
call trace, snippet, architecture, diff impact, and `.env` exclusion. It writes
or refreshes the local graph; set `CODE_INTEL_E2E_SKIP_INDEX=1` to query an
already-built graph without re-indexing.

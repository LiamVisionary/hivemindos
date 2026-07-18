---
title: Whole Brain Services
description: Shared Brain Memory, Neo4j, QMD, GBrain, Syntho, Brain Graph, context index, and optional service layers.
---

# Brain Services

Brain services add retrieval, graphing, synthesis, and domain tools around the vault.

They should treat the vault like durable source material. Not cache. Not scratch space. Not a place to dump every half thought forever.

## Queen Bee Control Plane

The Queen Bee control plane is the vault-native coordination layer for one logical Queen Bee identity that may run from many machines. Its canonical folder is:

```text
Operations/Brain Services/Queen Bee/
```

That folder stores identity, routing policy, safety policy, compact current state, dedupe records, leases, node annotations, and completion receipts. It deliberately does **not** replace existing primitives:

- Tasks stay in `Operations/Work Board/kanban.json` and `/api/kanban`.
- Durable memories stay in `Memory/Distillations/Agent Memory/` and `/api/brain/memory`.
- Live machine capability comes from `/api/fleet/discover` and `/api/fleet/apps`.
- Cross-machine delegation uses `/api/handoff` and `.hivemindos-transfers/`.
- Human attention uses `Operations/Agent Notifications/`.

The runtime API is `/api/queen-bee`. `GET` initializes/returns the control-plane state. `POST` with a message computes an intent fingerprint, reads the shared project registry from `Operations/Code Projects/projects.json`, fetches fresh `/api/fleet/discover` data when the caller does not provide a `fleetSnapshot`, ranks online chat-capable agents across all machines by inferred worker class, machine/runtime fit, and matching project checkout freshness, writes dedupe/receipt JSONL records, and creates or reuses an idempotent Work Board card assigned to the selected best available agent plus target machine. If no matching fleet agent is online, the card stays assigned to `queen-bee` so a Queen Bee runtime can review/delegate it later.

For code work, Queen Bee uses the GitLawb/project registry as the project graph rather than assuming the machine that received the chat owns the latest code. Collector telemetry can expose `version.projects` or `version.projectCheckouts` entries for each registered local checkout. Each entry may include project id/name/slug, local path, branch, commit, latest remote commit, dirty state, remote URL, and GitLawb repo id/name. When a prompt names a registered project such as "Maps Agency," or refers to "this project" in the HivemindOS context, routing prefers the machine whose checkout matches the project, preserves a preferred machine or allowed-agent policy from the registry, boosts local dirty/unpushed work, boosts up-to-date checkouts, and penalizes behind checkouts. Route reasons should make this visible with evidence such as `GitLawb project registry matched ...`, `preferred project machine`, `project checkout has local changes`, `project checkout is up to date`, and `project branch ...`.

## Context Index

The context index is the lightweight retrieval surface for code, tools, runtime capabilities, docs, connected apps, connector manifests, artifacts, shared skills, and command delivery channels.

It helps agents find the right surface before they load huge files or schemas.

Primary source: `src/lib/services/context-index.ts`

Capability search can use context-index hits to select dashboard slash commands as delivery channels. For example, `/swarm-goal <build request>` is indexed as a dashboard/Queen Bee delivery path for build requests that should be rewritten, split across parallel agents, and recorded as Work Board tasks through `/api/queen-bee`.

Context Index entries can also carry scope and authorization metadata. This lets
agents retrieve capabilities through one surface while the app still enforces
principal claims, action risk, side effects, and connector policy below the
model. Connector entries expose credential key names and operation metadata only;
the credential values stay in shared env or the relevant backend.

## Shared Brain Memory

Shared Brain Memory is the vault-native remember, recall, and answer layer. Agents can use the dashboard API directly or run `hive-brain answer "<query>"` from any shell. The CLI discovers the running local API and falls back to local vault/index search, so raw or non-managed agents do not need to know the dashboard port. Setup also installs `hive-brain-hook` and registers it as a Claude Code `UserPromptSubmit` hook, so raw Claude prompts receive relevant shared-brain context before the model answers. By default, recall and answer are tiered: they check typed Agent Memory first, return the distilled layer when the top hit is strong, and otherwise augment with relevant markdown from the full shared vault. Use `scope: "agent-memory"` or `--scope agent-memory` when a caller needs the strict typed/proven memory layer only, or `scope: "full-vault"` / `--scope full-vault` to force broad vault recall.

Access paths:

| Caller | How memory is reached | Notes |
| --- | --- | --- |
| HivemindOS-managed chat runtimes | Runtime context injection plus `/api/brain/memory` | The app recalls before dispatching supported runtime turns. |
| Raw Codex, Hermes, Gemini, OpenClaw, Aeon, or shell agents | `hive-brain answer "<query>"` | The CLI tries the local API, then falls back to local vault/index search. |
| Raw Claude Code | `hive-brain-hook` registered as `UserPromptSubmit`, plus the same `hive-brain` CLI | The hook injects relevant context before Claude answers, including full-vault hits outside Agent Memory. |
| Durable memory writes | `/api/brain/memory`, `hive-brain remember ...`, or `hive-brain evolve ...` | Writes are typed notes in Agent Memory with optional GitLawb receipts; evolved writes preserve superseded history. |
| Operational events | `hive-brain record-operation ...` or API action `record-operation` | Writes a bounded local event journal, not durable Agent Memory; the CLI can write it even when the app API is offline. |
| Pattern proposals | `hive-brain mine-patterns` | Dry-run by default; `--enqueue` adds deduplicated proposals to Brain Review without applying them. |

The raw-agent rule is deliberate: agents should not need to know which port the dashboard is using, and they should still recall when the dashboard is not running.

Teach Hive requests are reviewed before they become durable memory. When a user
explicitly asks HivemindOS to remember, save, or teach the hive durable context,
the chat path creates a Brain Review proposal with conversation evidence. A
reviewer still approves and applies the proposal before it writes typed Agent
Memory.

It writes typed memory notes under:

```text
Memory/Distillations/Agent Memory/
```

It keeps the established private search-index mirror at:

```text
Operations/Brain Services/Agent Memory Index.jsonl
```

The index is a materialized retrieval view for typed Agent Memory inside the private vault. It includes memory content so typed recall can avoid reopening every Agent Memory markdown note on the hot path. Markdown notes remain the durable human-readable source. New writers publish a verified immutable generation first, update this JSONL compatibility mirror, and commit the current-generation pointer last. If an older client writes a newer compatibility mirror, readers honor it until the next rebuild.

Entity-linked recall has a small compatibility index at:

```text
Operations/Brain Services/Agent Memory Entity Index.jsonl
```

Each row links one typed Agent Memory record to a deterministic entity or alias extracted from wikilinks, tags, quoted phrases, acronyms, proper-name sequences, project/runtime/agent/machine fields, and known HivemindOS service names. It is generated in the same memory generation as the typed index, so a recall snapshot never mixes memory rows and entity rows from different writes. The entity index is a local retrieval aid, not a second source of truth.

Soft retrieval telemetry is appended at:

```text
Operations/Brain Services/Agent Memory Retrievals.jsonl
```

This log records memory ids, timestamps, retrieved/final-answer usage, and optional usage context. It gently reorders crowded result sets; it does not hide memories that have never been retrieved.

Routine completions, handoff receipts, retries, and other high-volume operational events use a separate bounded local journal:

```text
~/.hivemindos/brain/operational-events.jsonl
```

The journal rotates to one `.1` file at 8 MB. It stays out of the shared vault and typed-memory index, so repeated receipts cannot crowd durable recall or create false duplicate clusters. Existing domain stores such as Queen Bee and Work Board receipts remain their authoritative shared records. Legacy `action` Agent Memory notes are preserved as history but hidden from default recall and consolidation; callers can still request them explicitly with `type: "action"` or `includeOperational`.

Full-vault recall has its own generated lexical index at:

```text
Operations/Brain Services/Full Vault Search Index.jsonl
```

That index is inspired by QMD's useful non-embedding pieces: markdown collections, compact term-frequency records, and BM25-style lexical ranking before source notes are loaded. It maps normal vault folders to collections such as `memory`, `projects`, `synthesis`, `operations`, and `skills`, and supports lightweight query filters such as `collection:projects`, `path:Synthesis/`, quoted phrases, and `-excluded` terms. Rebuilds publish a checksummed immutable generation and then replace the JSONL compatibility mirror, so concurrent recalls never read a partially written index. It does not store embeddings or call a model.

### Durable writes, generations, and replay

Memory writers coordinate through a cross-process lock. Each multi-note change is staged beside its destination and recorded in a recovery journal before any staged file is promoted:

```text
Operations/Brain Services/Agent Memory Transactions.jsonl
```

The source notes are promoted first. Typed index, entity index, source-note hashes, record counts, schema metadata, and checksums are then published under:

```text
Operations/Brain Services/Index Generations/agent-memory/<generation-id>/
Operations/Brain Services/Index Generations/full-vault/<generation-id>/
```

The current pointer is replaced last. A crash after source promotion leaves a recoverable journal receipt; the next writer finishes any staged source files, rebuilds generated state from Markdown, and marks the transaction recovered. A corrupt current artifact fails checksum verification and readers try the verified parent generation, then scan older generations for the newest valid snapshot if more than one generation is damaged. Generation readers also fall back to legacy v1 full snapshots and the established JSONL paths, preserving older tools and manually managed vaults.

Generations are complete logical snapshots without storing every snapshot as another complete physical copy. A checkpoint stores each artifact in full or gzip form. Generations between checkpoints store a content-addressed text delta when that is materially smaller than the best complete representation; otherwise that artifact stays full or compressed. Every stored payload and reconstructed artifact has its own SHA-256 receipt, and every delta binds the exact parent generation and parent content hash.

History uses an explicit bounded retention policy:

| Index | Maximum retained generations | Checkpoint interval |
| --- | ---: | ---: |
| Typed Agent Memory | 256 | 32 |
| Full-vault lexical search | 32 | 4 |

After the new pointer commits, retention advances only to a verified checkpoint, so it never leaves a retained delta without its base. This can retain fewer than the maximum when the safe boundary is later than the raw count boundary. Pruning removes generated index history only; it never removes the authoritative Markdown memory notes. Each index kind writes `coverage.json` after its first pruning pass with the cumulative number and final id pruned. `list-generations`, `hive-brain generations`, and memory health expose the active policy, retained/invalid counts, whether history is still complete, and the first generation from which replay is complete. A requested generation older than that visible boundary is unavailable rather than silently substituted. If the coverage receipt is damaged—or missing while retained manifests prove an earlier parent was removed—its status becomes invalid or missing and further pruning pauses instead of guessing how much history was already removed. A damaged store can therefore temporarily exceed its configured maximum until integrity is restored.

Each durable memory, conversation mirror, compiled-knowledge page, generated full-vault row, and Brain Review proposal carries or derives a normalized SHA-256 content address. Typed memory blocks an exact active duplicate even when its title or memory key differs, unless a caller explicitly uses the existing duplicate override. Review proposals reuse an existing pending or approved proposal with the same kind and content hash.

Use API action `list-generations` or `hive-brain generations` to inspect retained history and replay coverage. `generationId` on recall, or `hive-brain replay "<query>" --generation <id>`, answers from that verified retained snapshot only. Replay evaluates recency and relative-time language at the generation timestamp and excludes present-day usage telemetry and embeddings, so later activity cannot silently rerank history. API action `compare-generations`, or `hive-brain compare`, reports which recalled memories were added, removed, or changed rank between two retained snapshots. This generation replay is stricter than date-based temporal recall: it represents what the generated Agent Memory view actually contained at that point.

Optional typed-memory embeddings remain a best-effort ranking signal. Every stored vector is bound to a configuration identity covering provider protocol, endpoint identity hash, model, requested dimensions, input limit, actual vector length, and source-content hash. Query-time scoring rejects mismatched or stale vectors instead of comparing truncated dimensions; a backfill produces new rows for the current identity.

### Portable brain capsules

A brain capsule is a single scoped file containing selected typed memories, optional compiled-knowledge domains, content hashes, provenance, checksums, and a small read-only lexical index. Export requires an explicit project or memory-id scope; it cannot silently package the entire vault. Capsules can have an expiry and can be encrypted with AES-256-GCM using a passphrase read from a named server environment variable. Plain capsule checksums detect corruption and inconsistent payload/index metadata, but they are not a sender signature: someone who can rewrite a plaintext capsule can also replace its checksums or expiry. Use encrypted capsules when recipients must detect tampering or trust the expiry, and exchange the passphrase separately.

Capsules open and search read-only by default. Import preview removes exact content-hash duplicates. Import proposal mode creates deduplicated Brain Review proposals; it never writes Agent Memory directly, and normal Brain Review approval and apply gates still control durable changes.

```bash
hive-brain capsule-export --project atlas --compiled-domain atlas
hive-brain capsule-export --memory-ids mem-... --passphrase-env HIVEMINDOS_CAPSULE_PASSPHRASE
hive-brain capsule-open --capsule ~/.hivemindos/brain/capsules/example.hivebrain
hive-brain capsule-search "launch decision" --capsule ~/.hivemindos/brain/capsules/example.hivebrain
hive-brain capsule-import --capsule ~/.hivemindos/brain/capsules/example.hivebrain --enqueue
```

When the tiered path augments with full-vault recall, it includes normal vault markdown from `Memory/`, `Projects/`, `Synthesis/`, `Ideas/`, `Operations/`, `Skills/`, templates, and shared context notes. It intentionally includes `Operations/Secure/` reference/status notes so agents can know which credential names exist or are set. Plaintext secret values still belong only in shared env or encrypted artifacts and must not be printed, copied, summarized, or saved as memory.

Optional GitLawb memory receipts are appended at:

```text
Operations/Brain Services/Agent Memory Proofs.jsonl
```

### OKF exchange bundles

HivemindOS can export the typed shared-brain layer as an Open Knowledge Format v0.1 exchange bundle without changing the native Obsidian vault. The exporter reads Agent Memory and conversation mirror notes, writes OKF concept documents with YAML frontmatter plus markdown bodies, generates `index.md` and `log.md`, then validates the result with the permissive OKF conformance rule: every non-reserved concept `.md` file must have parseable frontmatter and a non-empty `type`.

Access path:

```text
/api/brain/okf
```

Default export path:

```text
Operations/Brain Services/OKF Export/
```

Use `POST /api/brain/okf` with `action: "export"` and optional `include: "agent-memory" | "conversations" | "all"`, `vaultPath`, `outputPath`, and `clean`. Use `GET /api/brain/okf?bundlePath=...` or `POST` with `action: "validate"` to validate a bundle. This is an interoperability surface for outside OKF tools and agents; the canonical editable brain remains the normal HivemindOS vault.

### Conversation notes

Finished HivemindOS chat sessions are mirrored into the shared vault as one markdown note per session under:

```text
Memory/Conversations/<agent>/YYYY-MM-DD-<title>-<sessionId>.md
```

with an append-only index at:

```text
Operations/Brain Services/Conversations Index.jsonl
```

Each note carries `type: conversation` frontmatter (session, agent, runtime, chat storage key, timestamps, keywords), a summary block with a `[[Agent Name]]` wikilink, and the redacted transcript. Index readers dedupe by `sessionId`; the last entry wins. The writer runs best-effort on session finish when the shared vault is enabled, applies the security-proxy secret redaction (`redactSecretText`) to every message before it touches the vault, and skips automation/cron transcripts and sessions without an assistant reply. Because the notes live in the vault, "check our conversations about x" works through normal tiered/full-vault recall for every agent — managed runtimes, `hive-brain`, and the Claude prompt hook alike — with no per-agent changes.

### Search policy

All content searches over the vault and conversations use ripgrep (`rg`) first, fall back to plain `grep` when `rg` is unavailable, and only fall back to a full filesystem walk when neither binary works. Full-vault recall first tries the generated lexical index for ranked candidates, then falls back to `src/lib/services/search/ripgrep-search.ts` when the index is unavailable. The `hive-brain` CLI implements the same generated-index-first local fallback.

The API supports:

- `remember`: save a typed memory note.
- `record-operation`: append an operational event without writing durable memory.
- `remember-action`: compatibility alias for `record-operation`; responses include `durableMemoryWritten: false`.
- `mine-patterns`: inspect operational events and return review candidates; `enqueueProposals: true` adds deduplicated proposals to Brain Review.
- `evolve`: save a new active memory while marking older Agent Memory notes as `superseded`.
- `recall`: retrieve relevant shared-brain memories and vault notes by query, type, tags, project, optional `scope`, optional `temporalMode`, optional `asOf`, optional `includeOperational`, and optional usage tracking.
- `answer`: return a grounded memory context pack from the matching memories and vault notes.
- `rebuild-index`: scan existing markdown memory notes, publish a compact verified typed-memory generation, and refresh the generated full-vault lexical index unless `includeFullVault: false` is passed.
- `list-generations`: list retained verified and invalid typed-memory generations, identify the current pointer, and report retention policy and replay coverage.
- `compare-generations`: replay one query across two typed-memory generations and return added, removed, unchanged, and rank-changed evidence.
- `export-capsule`, `open-capsule`, and `search-capsule`: create or inspect a scoped, verified, read-only portable capsule.
- `preview-capsule-import` and `propose-capsule-import`: dedupe import candidates and optionally place them in Brain Review without direct memory writes.
- `record-usage`: append retrieved or final-answer usage telemetry for memory ids.
- `proof: true`: attach a GitLawb memory receipt for this write.
- `proof: "auto"`: attach receipts for durable memory types and high-confidence facts.

The CLI mirrors the same recall path for non-managed agents:

```bash
hive-brain answer "what does the user prefer here?"
hive-brain recall "BYOK Agent Calls" --scope full-vault --limit 5
hive-brain remember --type preference --title "Short title" --content "Durable memory body" --memory-key "preference/project/short-title"
hive-brain evolve --memory-id mem-... --content "Updated durable memory body"
hive-brain record-operation --title "Provider request" --content "Request timed out" --operation-key "provider/request" --failure-key "provider/timeout" --outcome failure --task-id task-123
hive-brain mine-patterns
hive-brain generations
hive-brain replay "what did we know about Atlas?" --generation <generation-id>
hive-brain compare "Atlas launch" --from-generation <generation-id>
```

Canonical heads and memory evolution keep agent memory from becoming a pile of contradictory notes. Every durable record carries a canonical `memoryKey`, derived from type, project, and title unless the caller supplies one. `remember` blocks a second active record with the same key and points the caller to the existing head. When a later reviewed fact, preference, instruction, or decision replaces an older one, callers use `action: "evolve"` with `memoryId` or `supersedes`. HivemindOS stages the new active note and all superseded-note updates as one journaled source transaction, then publishes one replacement memory/entity generation. Current recall returns the newest active canonical head by default, even for legacy records whose key is derived during indexing, and includes prior versions as `evolutionChain` evidence when relevant. `consolidate` reports an explicit-correction candidate when a newer active record says it corrects or replaces an older note but the two were never linked; this remains a reviewed `evolve` proposal and is never auto-applied.

Temporal intent is conservative. Phrases such as “used to,” “previously,” and “historical” request history; “as of <date>,” “before <date>,” and relative periods request an as-of cutoff. A bare date inside a memory title does not change current recall mode, the procedural word “before” does not imply history, explicit historical mode does not become an as-of filter, and a date-only “as of” includes the whole named day.

Pattern mining groups separate operational events by stable operation and failure keys, requires evidence across distinct task ids, rejects test/E2E noise, and distinguishes recurring failures, reusable workflows, and stable routines. Before the review bridge was enabled, the deterministic 47-event adversarial benchmark produced exactly the three labeled candidates with precision `1.00` and recall `1.00`; run `pnpm benchmark:agent-memory-pattern-mining` to reproduce it. This is a fixture benchmark, not proof of production precision, so broad autonomous enablement remains off. The default command is a dry run, and explicit `--enqueue` only creates Brain Review proposals for a human or authorized reviewer.

Typed Agent Memory ranking fuses exact/title/tag/content matches, query-term coverage, natural question intent, BM25-lite lexical scoring, entity/alias matches, confidence, temporal fit, recency, status, optional semantic similarity, normalized full-vault lexical evidence, and soft usage telemetry into `scoreDetails`. Direct questions that name a memory kind—such as an instruction, decision, preference, or artifact—receive a bounded type-intent preference rather than a hard filter. Generic status words such as “fixed,” “verified,” and “critical” are rejected as acronym entities, so they cannot overpower that intent. Answer mode also requires proportional term coverage for longer direct questions, which lets the system abstain instead of combining unrelated topic fragments.

The prompt hook is intentionally small and local:

```text
~/.local/bin/hive-brain-hook
~/.claude/settings.json -> hooks.UserPromptSubmit
```

It runs `hive-brain answer` for the submitted prompt, emits Claude's `additionalContext` JSON, and fails closed if recall is unavailable. It does not write memory on its own.

Memory records carry provenance fields for the writer and machine:

- Agent fields: `agentName`, `agentId`, `runtime`, `sessionId`.
- Memory shape fields: `entities`, `aliases`, `actorRole`, and `memoryOrigin`.
- Machine fields: `machineName`, `machineId`, `collectorUrl`.
- Tailnet fields: `tailnetId`, `tailnetName`, and `tailnetDnsName`. Raw Tailnet IPs should not be stored in shared memory notes.

GitLawb memory receipts store `contentHash`, `recordHash`, `previousProofHash`, actor DID when available, and sanitized agent/machine metadata. They do not store the memory body.

## Obsidian Native Brain Pack

The brain also ships with native Obsidian skills and views so humans can inspect the same shared memory structure agents use.

Setup auto-installs these shared skills into `Skills/`:

- `obsidian-markdown` for Obsidian Flavored Markdown.
- `obsidian-bases` for native `.base` files.
- `json-canvas` for native `.canvas` maps.
- `defuddle` for optional clean markdown extraction from web pages.

Fresh vault seeding also creates:

| File | Purpose |
| --- | --- |
| `Operations/Brain Services/Obsidian Native Brain Pack.md` | Service note explaining the installed native pack and policy. |
| `Operations/Brain Services/Agent Memory.base` | Native table/card views over typed Agent Memory notes. |
| `Operations/Brain Services/Project Brain.base` | Native views over project notes, decisions, and weekly reviews. |
| `Operations/Brain Services/Secure References.base` | Native views over safe credential reference/status notes, never plaintext secrets. |
| `Operations/Brain Services/Whole Brain.canvas` | Visual map of tiered recall, full-vault augmentation, GitLawb memory proofs, and human-facing Obsidian views. |

The pack is curated from [`kepano/obsidian-skills`](https://github.com/kepano/obsidian-skills). HivemindOS intentionally keeps the generic upstream `obsidian-cli` skill out of the default pack because local installs already use HivemindOS-specific CLI skills and vault safety rules.

### Local-First Memory Benchmarks

Shared Brain Memory is intentionally local-first. The default tiered path keeps common preference, decision, instruction, and durable fact recall on the typed Agent Memory hot path. That hot path reads a private JSONL retrieval view inside the vault, so agents avoid a network call and avoid rescanning typed memory notes after the first index build. When distilled memory is weak, full-vault recall broadens the search to thousands of markdown notes through the generated BM25-lite lexical index, then loads only ranked candidate source notes before answering. Markdown notes remain human-readable, private, and syncable through the user's chosen vault sync owner.

The current indexed scale fixture uses 200 exact, natural, sparse, and noisy queries at each corpus size with local embeddings disabled:

| Memory count | Recall p50 | Recall p95 | First cold recall | Sequential queries/s | Top-1 / Top-3 / MRR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.86ms | 2.76ms | 25.02ms | 506.98 | 1.0 / 1.0 / 1.0 |
| 500 | 9.08ms | 10.91ms | 30.63ms | 108.07 | 1.0 / 1.0 / 1.0 |
| 1500 | 27.16ms | 33.63ms | 78.71ms | 35.52 | 1.0 / 1.0 / 1.0 |

Run `pnpm benchmark:agent-memory-scale -- --calls 200` to reproduce this synthetic scale snapshot. A historical pre-index markdown-scan test measured p50 recall of 99.51ms at 100 memories, 293.49ms at 500 memories, 562.38ms at 1000 memories, and 784.03ms at 1500 memories. Treat those older numbers as architecture history rather than a same-run comparison with the current fixture.

On a large reference vault of 28,549 markdown files, the generated full-vault lexical index scanned 26,019 eligible notes, indexed 25,995 notes, built in about 9.2s, and produced a 70.6 MB JSONL index. A five-query old-vs-indexed latency benchmark improved from 2,285ms median old full-vault recall to 118ms median indexed recall, a 19.4x median speedup, with identical top-1 results for all five queries. The current quality benchmark separates routing-policy and control-plane questions and measures the real final recall runtime instead of only a mirrored scorer. Its deterministic nine-case fixture scored Top-1/Top-3/MRR `1.00/1.00/1.00` at the old, indexed, and runtime layers. On the live vault, eight project, operations, control-plane, skill, secure-reference, imported-source, and intake targets also scored `1.00/1.00/1.00`; median old/indexed/runtime latency was `745.04/48.42/300.33ms`, a 15.39x direct-index speedup. Run `pnpm benchmark:shared-brain-search` for the fixture or add `--vault <vault>` for a live vault.

The read-only 1,000-call live Agent Memory matrix covers exact and date-bearing titles, sparse titles, noisy and typo queries, natural type intent, type/project/tag filters, unsupported abstention, legacy operational isolation, and current/historical/as-of evolution chains. The current run scored generated retrieval Top-1/Top-3/MRR `0.90/0.98/0.94` at p50/p95 `12.27/16.28ms` and 86.38 sequential queries/s; exact automatic/current title recall was `1.00/1.00`, unsupported questions abstained `10/10`, operational routing passed `40/40`, and temporal recall reached Top-1/Top-3 `0.96/1.00`. Run `pnpm benchmark:agent-memory-live-recall -- --vault <vault> --calls 1000` to reproduce it. Sparse and typo Top-1 remain the main measured weakness, while Top-3 stays high.

The authenticated HTTP benchmark exercises the product API rather than calling the scorer directly. Across 400 measured requests after warmup, its entity, alias, current-head, historical, usage-signal, explicit-operational, default-operational-isolation, and abstention cases passed `8/8`; ranked cases passed Top-1 `6/6`; latency was `6.75ms` p50 and `12.12ms` p95 at 125.97 sequential requests/s. Run `pnpm benchmark:agent-memory-upgrade -- --base-url <dashboard-url> --iterations 50 --warmup 2` against a running dashboard.

Raw-agent smoke tests confirmed both layers:

- A typed fruit preference in `Memory/Distillations/Agent Memory/` was recalled by raw Claude and raw Hermes.
- A project note outside Agent Memory, `Projects/Agent Calls - BYOK vs HivemindOS Cloud.md`, was recalled with `recallScope: full-vault`, `memoryHitCount: 0`, and answered correctly by raw Claude and raw Hermes.

Measured positioning: HivemindOS gives agents typed, provenance-aware memory with network-free local retrieval, broad-vault fallback, explicit history, and review-gated learning. The public [Shared Brain Memory Benchmarks](../features/shared-brain-benchmarks.html) page collects the marketing-safe claims, sample sizes, and limitations. No competitor-latency comparison has been run yet.

Primary sources:

- `src/lib/services/obsidian/agent-memory.ts`
- `/api/brain/memory`
- `scripts/hive-brain`
- `scripts/hive-brain-hook`

## Compiled Knowledge

Compiled Knowledge is the HivemindOS-native version of the compiled-wiki pattern. It turns important source material, research findings, and conversation conclusions into durable Obsidian pages under:

```text
Synthesis/Compiled Knowledge/<domain>/
```

Each domain has immutable-ish `raw/` inputs plus a `wiki/` with `entities/`, `concepts/`, `summaries/`, `index.md`, and `log.md`. Writes go through one service chokepoint that performs atomic file writes, frontmatter injection, bare-slug wikilink normalization, page merge behavior, index updates, and append-only logging.

The runtime API is:

```text
/api/brain/knowledge
```

Supported actions include `compile`, `status`, `graph-overview`, `graph`, `search`, `get-node`, `get-backlinks`, `scan-health`, `fix-health`, `dismiss-health`, and `shared-contract`.

External agents can use the same surface through `hivemind-mcp` tools:

- `compile_brain_knowledge`
- `brain_search_knowledge`
- `brain_graph_overview`
- `brain_get_node`
- `brain_get_backlinks`
- `scan_brain_wiki_health`
- `fix_brain_wiki_issue`
- `shared_brain_contract`

The search tool ranks compiled wiki pages with title, slug, tag/frontmatter, path, and markdown body matches, using the same ripgrep-first content policy as broad shared-brain search. The graph tools expose nodes, edges, outgoing links, backlinks, hub counts, and orphan counts as structured data so agents can reason over the brain as a graph rather than only as search snippets.

### Compiled Retrieval Snapshot

On a synthetic 720-page compiled wiki with 1,440 wikilinks, the compiled-brain path keeps agent retrieval in the low double-digit millisecond range while returning structured graph-native results:

| Operation | Median latency | Response shape |
| --- | ---: | --- |
| Compiled wiki search | 67.18ms | Ranked entity/concept/summary hits with matched fields and compact snippets |
| Graph overview | 39.45ms | 720 nodes, 1,440 edges, top hubs, orphan counts |
| Node lookup | 31.71ms | One compiled page with body, outgoing links, and backlinks |
| Backlink lookup | 32.44ms | Direct backlink list for one compiled node |
| Health scan | 62.47ms | Broken links, orphans, duplicate slugs, missing backlinks |

These numbers come from the deterministic local benchmark command `pnpm benchmark:compiled-knowledge`. They are intended as a product performance snapshot, not a hosted-service SLA; real vault shape, disk speed, and sync state can change absolute timings.

### Human Collective Contract

For multiple-human shared brains, HivemindOS follows the Curator-style contribution shape: contributors write to their personal opted-in domains, then push contributions, synthesis rebuilds the shared output, and everyone pulls the `shared-*` mirror. Direct writes to a human collective mirror are refused when the caller selects `collaborationMode: "human-collective"`.

This does not make normal HivemindOS agent-to-agent collaboration stricter. Internal agents should use `collaborationMode: "agent-to-agent"` and may continue to use shared vault writes, handoffs, Kanban, and Shared Brain Memory under normal HivemindOS policy unless a domain is explicitly marked read-only.

Primary sources:

- `src/lib/services/obsidian/compiled-knowledge.ts`
- `src/lib/services/brain/shared-contribution-contract.ts`
- `/api/brain/knowledge`
- `scripts/hivemind-mcp`
- `packaged-skills/auto-install/hive-brain-compiled-wiki/SKILL.md`

## Brain Graph

The Brain Graph reads vault markdown and access logs. It shows note relationships and records what agents looked at, so later work has context instead of mystery.

Primary sources:

- `src/lib/services/obsidian/brain-graph.ts`
- `/api/obsidian/graph`
- `/api/obsidian/access`

## GBrain

GBrain is optional semantic retrieval and graph/MCP support for the vault. HivemindOS can install or connect it, import vault content, refresh embeddings, run dream cycles, and query it.

Service note:

```text
Operations/Brain Services/GBrain.md
```

Primary sources:

- `src/lib/services/brain/gbrain.ts`
- `/api/brain/gbrain/*`

## QMD

QMD is an optional local markdown search service for the shared vault. HivemindOS can install the `@tobilu/qmd` CLI, add the shared vault as a QMD collection, refresh the local SQLite/BM25 index, refresh vectors, and query BM25, vector, hybrid, or hybrid-reranked search from Brain Services.

QMD keeps generated search artifacts outside the vault in the user's local QMD cache. The vault receives only the managed service note.

Service note:

```text
Operations/Brain Services/QMD.md
```

Primary sources:

- `src/lib/services/brain/qmd.ts`
- `/api/brain/qmd/*`

## Neo4j

Neo4j is an optional derived graph service for the shared brain. Obsidian Agent Memory remains canonical. HivemindOS can connect to an existing Neo4j database using env-key names, sync derived nodes with `MERGE`, and run read-only Cypher queries from Brain Services.

Secrets are never stored in dashboard state, notes, docs, or logs. The config stores only key names:

```text
NEO4J_URI
NEO4J_USERNAME
NEO4J_PASSWORD
NEO4J_DATABASE
```

The derived graph can include `Memory`, `Entity`, `Tag`, `Project`, `Agent`, `Machine`, `Runtime`, and `CompiledKnowledgePage` nodes. Relationships include `MENTIONS`, `SUPERSEDES`, `IN_PROJECT`, `BY_AGENT`, `ON_MACHINE`, `BY_RUNTIME`, `HAS_TAG`, and `LINKS_TO`. Sync is idempotent and MERGE-only; it must not delete user-created Neo4j data. Any future cleanup should touch only nodes marked `source: "hivemindos-derived"` and only when explicitly requested.

Service note:

```text
Operations/Brain Services/Neo4j.md
```

Primary sources:

- `src/lib/services/brain/neo4j.ts`
- `/api/brain/neo4j/status`
- `/api/brain/neo4j/connect`
- `/api/brain/neo4j/sync`
- `/api/brain/neo4j/query`

## Syntho

Syntho compiles reviewed `Synthesis/` material. It is not the raw vault. Raw source MCP access stays denied unless the user explicitly changes the policy.

Service note:

```text
Operations/Brain Services/Syntho.md
```

Primary sources:

- `src/lib/services/brain/synto.ts`
- `/api/brain/synto/*`

## Trading Brain

Trading Brain is optional and domain specific. It can attach status and install notes to selected runtimes without changing the general vault routing.

Primary sources:

- `src/lib/services/brain/trading-brain.ts`
- `/api/brain/trading-brain/*`

## Service Note Rule

Service notes may identify:

- service status
- install mode
- CLI path or command name
- policy settings
- required credential key names
- repair guidance

They must not contain provider secrets, private keys, bearer tokens, Tailnet IPs, or exact private machine-only paths unless the note is explicitly an encrypted artifact reference.

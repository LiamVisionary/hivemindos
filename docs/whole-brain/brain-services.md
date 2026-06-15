---
title: Whole Brain Services
description: QMD, GBrain, Syntho, Brain Graph, context index, and optional service layers.
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

The context index is the lightweight retrieval surface for code, tools, runtime capabilities, docs, connected apps, and shared skills.

It helps agents find the right surface before they load huge files or schemas.

Primary source: `src/lib/services/context-index.ts`

## Shared Brain Memory

Shared Brain Memory is the vault-native remember, recall, and answer layer. Agents can use the dashboard API directly or run `hive-brain answer "<query>"` from any shell. The CLI discovers the running local API and falls back to local vault/index search, so raw or non-managed agents do not need to know the dashboard port. Setup also installs `hive-brain-hook` and registers it as a Claude Code `UserPromptSubmit` hook, so raw Claude prompts receive relevant shared-brain context before the model answers. By default, recall and answer are tiered: they check typed Agent Memory first, return the distilled layer when the top hit is strong, and otherwise augment with relevant markdown from the full shared vault. Use `scope: "agent-memory"` or `--scope agent-memory` when a caller needs the strict typed/proven memory layer only, or `scope: "full-vault"` / `--scope full-vault` to force broad vault recall.

Access paths:

| Caller | How memory is reached | Notes |
| --- | --- | --- |
| HivemindOS-managed chat runtimes | Runtime context injection plus `/api/brain/memory` | The app recalls before dispatching supported runtime turns. |
| Raw Codex, Hermes, Gemini, OpenClaw, Aeon, or shell agents | `hive-brain answer "<query>"` | The CLI tries the local API, then falls back to local vault/index search. |
| Raw Claude Code | `hive-brain-hook` registered as `UserPromptSubmit`, plus the same `hive-brain` CLI | The hook injects relevant context before Claude answers, including full-vault hits outside Agent Memory. |
| Durable memory writes | `/api/brain/memory`, `hive-brain remember ...`, or `hive-brain evolve ...` | Writes are typed notes in Agent Memory with optional GitLawb receipts; evolved writes preserve superseded history. |

The raw-agent rule is deliberate: agents should not need to know which port the dashboard is using, and they should still recall when the dashboard is not running.

It writes typed memory notes under:

```text
Memory/Distillations/Agent Memory/
```

It keeps a private append-only search index at:

```text
Operations/Brain Services/Agent Memory Index.jsonl
```

The index is a materialized retrieval view for typed Agent Memory inside the private vault. It includes memory content so typed recall can avoid reopening every Agent Memory markdown note on the hot path. Markdown notes remain the durable human-readable source, and typed recall falls back to markdown when the index is absent or older sparse entries cannot be used.

Full-vault recall has its own generated lexical index at:

```text
Operations/Brain Services/Full Vault Search Index.jsonl
```

That index is inspired by QMD's useful non-embedding pieces: markdown collections, compact term-frequency records, and BM25-style lexical ranking before source notes are loaded. It maps normal vault folders to collections such as `memory`, `projects`, `synthesis`, `operations`, and `skills`, and supports lightweight query filters such as `collection:projects`, `path:Synthesis/`, quoted phrases, and `-excluded` terms. It does not store embeddings or call a model.

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
- `evolve`: save a new active memory while marking older Agent Memory notes as `superseded`.
- `recall`: retrieve relevant shared-brain memories and vault notes by query, type, tags, project, and optional `scope`.
- `answer`: return a grounded memory context pack from the matching memories and vault notes.
- `rebuild-index`: scan existing markdown memory notes, append rich searchable entries to the private typed-memory index, and refresh the generated full-vault lexical index unless `includeFullVault: false` is passed.
- `proof: true`: attach a GitLawb memory receipt for this write.
- `proof: "auto"`: attach receipts for durable memory types and high-confidence facts.

The CLI mirrors the same recall path for non-managed agents:

```bash
hive-brain answer "what does the user prefer here?"
hive-brain recall "BYOK Agent Calls" --scope full-vault --limit 5
hive-brain remember --type preference --title "Short title" --content "Durable memory body"
hive-brain evolve --memory-id mem-... --content "Updated durable memory body"
```

Memory evolution keeps agent memory from becoming a pile of contradictory notes. A normal `remember` call is the fast System 1 capture path. When a later reviewed fact, preference, instruction, or decision replaces an older one, callers use `action: "evolve"` with `memoryId` or `supersedes`. HivemindOS writes a new active note with `cognitiveStage: "system2"`, records `supersedes`, `supersededBy`, `evolutionRootId`, `evolutionType`, and optional `evolutionReason`, then appends replacement rows to `Agent Memory Index.jsonl`. Recall and answer return the latest active chain head while including prior versions as `evolutionChain` evidence.

The prompt hook is intentionally small and local:

```text
~/.local/bin/hive-brain-hook
~/.claude/settings.json -> hooks.UserPromptSubmit
```

It runs `hive-brain answer` for the submitted prompt, emits Claude's `additionalContext` JSON, and fails closed if recall is unavailable. It does not write memory on its own.

Memory records carry provenance fields for the writer and machine:

- Agent fields: `agentName`, `agentId`, `runtime`, `sessionId`.
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

Benchmarks from the live local API route at `http://127.0.0.1:5022/api/brain/memory`:

| Memory count | Recall p50 | Recall p95 | First indexed recall p50 | Answer p50 | Top-1 / Top-3 / MRR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.69ms | 3.15ms | 2.72ms | 2.83ms | 1.0 / 1.0 / 1.0 |
| 500 | 4.37ms | 5.26ms | 4.68ms | 4.18ms | 1.0 / 1.0 / 1.0 |
| 1500 | 19.20ms | 31.33ms | 19.37ms | 21.04ms | 1.0 / 1.0 / 1.0 |

The pre-index typed-memory markdown scan path measured p50 recall of 99.51ms at 100 memories, 293.49ms at 500 memories, 562.38ms at 1000 memories, and 784.03ms at 1500 memories. The optimized typed Agent Memory index keeps retrieval in the single-digit millisecond range through 500 memories and around 20ms p50 at 1500 memories while preserving perfect synthetic relevance in the benchmark set.

On a large reference vault of 28,549 markdown files, the generated full-vault lexical index scanned 26,019 eligible notes, indexed 25,995 notes, built in about 9.2s, and produced a 70.6 MB JSONL index. A five-query old-vs-indexed latency benchmark improved from 2,285ms median old full-vault recall to 118ms median indexed recall, a 19.4x median speedup, with identical top-1 results for all five queries. A seven-query quality benchmark over named project, operations, skill, secure-reference, imported-source, and intake targets found no relevance regression: both old and indexed search hit Top-1 for six exact expected notes, both missed one ambiguous Bankr imported-source query, and cached indexed median latency was 27.75ms versus 4,506.20ms for the old `rg`-first baseline. Run `pnpm benchmark:shared-brain-search` for the deterministic fixture or `node scripts/benchmark-shared-brain-search-quality.mjs --vault <vault>` for a live vault.

Raw-agent smoke tests confirmed both layers:

- A typed fruit preference in `Memory/Distillations/Agent Memory/` was recalled by raw Claude and raw Hermes.
- A project note outside Agent Memory, `Projects/Agent Calls - BYOK vs HivemindOS Cloud.md`, was recalled with `recallScope: full-vault`, `memoryHitCount: 0`, and answered correctly by raw Claude and raw Hermes.

Marketing-safe positioning: HivemindOS agents get rich, typed, provenance-aware memory with network-free local retrieval at a fraction of the latency of network-bound memory stacks, and the same local-first design makes the memory 100% private by default.

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

---
title: "Brain, Vault, And Skills"
---

# Brain, Vault, And Skills

Brain and Vault is the shared memory layer.

It is built around a normal Obsidian markdown vault, not a proprietary database. That matters. The user can open the files, sync them with tools they already trust, and see what the agents are using as shared memory.

For the separated GitHub Pages guide, start with [Whole Brain](../whole-brain/). That section splits the brain into [Vault Map](../whole-brain/vault-map.html), [Brain Services](../whole-brain/brain-services.html), [Shared Skills](../whole-brain/shared-skills.html), [Shared Env](../whole-brain/shared-env.html), [Sync And Health](../whole-brain/sync-and-health.html), [Architecture Sync](../whole-brain/architecture-sync.html), and [Code Map](../whole-brain/code-map.html). For cross-machine movement, see [Hivemind Sync](hivemind-sync.html).

<figure class="imagePlate">
  <img src="../assets/img/diagrams/brain-services-vault.jpg" alt="Generated brain services and shared vault infographic showing ENV vault path, Obsidian Vault, Skills, GBrain, Syntho, Trading Brain, and Synthesis Folder.">
  <figcaption>The vault path anchors the shared brain. QMD, GBrain, Neo4j, Syntho, and Trading Brain stay optional service layers around it.</figcaption>
</figure>

## Vault

How it works:

- Vault path resolution is in `src/lib/services/obsidian/vault-path.ts`.
- The default vault path is `~/Documents/Obsidian/hivemindos-vault`.
- The app can use `NEXT_PUBLIC_OBSIDIAN_VAULT_PATH` or auto-detect common Obsidian locations.
- Hivemind Sync moves brain files through the selected vault sync owner: external provider, HivemindOS Syncthing, or manual rsync repair.
- Handoff transfers live in `.hivemindos-transfers/` and are routed with `hive-transfer`; agents should usually use `hive-handoff`, `/api/handoff`, `/handoff-task`, or the `hivemind-mcp` handoff tools so fuzzy machine matching and best-agent selection stay consistent with Fleet.

What the vault can do:

- Validate and open a configured Obsidian vault.
- Record note access events.
- Build a graph of notes and access history.
- Store Kanban board state, project registry metadata, notifications, scheduled runs, wallet records, shared skills, Queen Bee coordination state, and brain-service notes.
- Seed an AI ready vault contract, durable note templates, optional Obsidian CLI/plugin-pack status notes, Queen Bee control plane files, and disabled foundation workflows for common shared brain routines.

Seeded structure:

- `Operations/AI-Ready Vault Contract.md` explains the shared brain routing and write policy.
- `Operations/Secure/` stores encrypted backup artifacts and public key reference notes. Plaintext secrets do not belong in the vault.
- `Operations/Runtime Mirrors/` stores operational runtime mirrors such as the hidden AEON `.aeon` mirror.
- `Operations/Vault Migrations/` stores vault-doctor cleanup manifests and archived stale artifacts.
- `Templates/HivemindOS/` contains durable templates for daily briefings, weekly reviews, meetings, research sources, decisions, projects, book notes, distillations, and AI outputs.
- `Operations/Brain Services/Obsidian CLI.md` records detected CLI status when setup runs.
- `Operations/Brain Services/Obsidian Plugin Pack.md` lists optional manual Obsidian plugins for templates, tasks, Dataview, retrieval, calendar, Kanban, and Git.
- `Operations/Brain Services/Agent Memory Entity Index.jsonl` stores deterministic entity and alias links for typed memory.
- `Operations/Brain Services/Agent Memory Retrievals.jsonl` stores soft retrieval/final-answer telemetry for typed memory ranking.
- `Operations/Brain Services/Neo4j.md` tracks the optional derived Neo4j Brain Service while keeping connection values in env keys only.
- `Operations/Brain Services/Queen Bee/` stores the Queen Bee control plane: identity, routing/safety policy, current state, intent dedupe, leases, node annotations, and completion receipts. Tasks still live in the Work Board; durable memory still lives in Shared Brain Memory.
- `Operations/Brain Services/Obsidian Native Brain Pack.md` tracks the optional Bases/Tasks/Dataview/Templater/Calendar/Kanban/Git plugin setup and generated `.base`/canvas files.
- `Operations/Brain Services/Agent Memory.base`, `Project Brain.base`, `Secure References.base`, and `Whole Brain.canvas` give humans native Obsidian views over typed memory, project context, safe credential references, and the recall topology.
- `Operations/Automations/Foundation Workflows/` contains disabled workflow schedules for context synthesis, intake processing, meeting processing, research ingestion, vault health checks, decision review, argument building, book notes, feedback capture, project updates, weekly synthesis, connection finding, and distillation.
- `Operations/Code Projects/projects.json` stores Hivemind project records and optional GitLawb repo links. This is private coordination metadata. GitLawb proof records should not contain private keys, secrets, Tailnet IPs, or exact private vault paths.

## Brain Graph, QMD, GBrain, Neo4j, Syntho, And Trading Brain

How it works:

- Context index generation is in `src/lib/services/context-index.ts`.
- Brain graph generation is in `src/lib/services/obsidian/brain-graph.ts`.
- QMD actions are in `src/lib/services/brain/qmd.ts`.
- GBrain actions are in `src/lib/services/brain/gbrain.ts`.
- Neo4j actions are in `src/lib/services/brain/neo4j.ts`.
- Syntho actions are in `src/lib/services/brain/synto.ts`. The internal API slug and installed CLI command remain `synto`.
- Trading-brain install/status lives in `src/lib/services/brain/trading-brain.ts`.
- API routes live under `/api/context-index`, `/api/brain/qmd/*`, `/api/brain/gbrain/*`, `/api/brain/neo4j/*`, `/api/brain/synto/*`, `/api/brain/trading-brain/*`, and `/api/obsidian/graph`.

What the brain services can do:

- Build a lightweight context index over shared/runtime skills, tool-call surfaces, API routes, connected Tailnet apps, app endpoint catalogs, runtime capability definitions, docs, and workspace files.
- Retrieve the most relevant index records for a task before loading full files or schemas, including connected-app capability aliases such as image generation, simulation, graph, exports, monitoring, settings, and API docs.
- Save typed shared-brain memories through `/api/brain/memory` or the installed `hive-brain` CLI using `remember`, `remember-action`, `evolve`, `recall`, `answer`, `record-usage`, and `rebuild-index` actions. Raw/non-managed agents can run `hive-brain answer "<query>"`; it discovers the running API and falls back to local vault/index search. Setup also installs `hive-brain-hook` for Claude Code and registers it as a `UserPromptSubmit` hook so raw Claude prompts receive relevant shared-brain context before answering. Default `recall`/`answer` is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault. `scope: "agent-memory"` or `--scope agent-memory` narrows recall to the typed/proven memory layer, while `scope: "full-vault"` or `--scope full-vault` forces broad vault recall. Memory writes live under `Memory/Distillations/Agent Memory/`, the private append-only typed-memory index lives at `Operations/Brain Services/Agent Memory Index.jsonl`, entity/alias rows live at `Operations/Brain Services/Agent Memory Entity Index.jsonl`, soft retrieval telemetry lives at `Operations/Brain Services/Agent Memory Retrievals.jsonl`, the generated full-vault lexical index lives at `Operations/Brain Services/Full Vault Search Index.jsonl`, optional hash-only GitLawb memory receipts live at `Operations/Brain Services/Agent Memory Proofs.jsonl`, and provenance fields can identify the writing agent, runtime, machine id, Tailnet id/name, Tailnet DNS name, collector URL, actor role, memory origin, entities, and aliases.
- Export Agent Memory and conversation mirrors as an Open Knowledge Format v0.1 exchange bundle through `/api/brain/okf`. The native vault stays unchanged; the generated bundle defaults to `Operations/Brain Services/OKF Export/` and includes OKF concept files, `index.md`, `log.md`, and validation results.
- Compile durable source material and research findings into an entity/concept/summary wiki through `/api/brain/knowledge`. The generated pages live under `Synthesis/Compiled Knowledge/<domain>/`, use Obsidian wikilinks and YAML frontmatter, keep raw inputs beside the compiled wiki, and update `index.md` plus `log.md` through one atomic write service. Agents can search that compiled wiki with the `search` action or `brain_search_knowledge` MCP tool before falling back to broad full-vault recall for synthesized entity, concept, and summary knowledge.
- Query the compiled wiki as a graph through `/api/brain/knowledge` or `hivemind-mcp`: graph overview, node fetch, backlinks, health scan, safe health fix, and shared-brain contract lookup are exposed as structured tools for external agents.
- Follow a human collective shared-brain contract when requested: contributors write to personal opted-in domains, synthesis rebuilds the shared mirror, and direct writes to `shared-*` mirrors are blocked only for `human-collective` mode or explicit read-only domains. Normal agent-to-agent HivemindOS contributions keep using shared vault writes, handoffs, Kanban, and Shared Brain Memory under ordinary policy.
- Optionally ask GBrain for semantic retrieval alongside the lightweight index when a caller posts `semantic: true` to `/api/context-index`.
- Write a managed connected-app retrieval snapshot into `Operations/Brain Services/Connected Apps Context Index.md` and refresh GBrain import/embed when a caller posts `syncConnectedAppsToGbrain: true`.
- Build a graph from markdown notes and access logs.
- Show a Brain Services cockpit with service health summaries, primary actions, advanced settings, structured run output, and repair guidance when local prerequisites are missing.
- Install or connect QMD.
- Add the shared vault as a QMD collection, refresh the local SQLite/BM25 index, refresh vectors, and query BM25, vector, hybrid, or hybrid-reranked search.
- Record QMD's CLI path, collection, index name, search mode, vector refresh policy, and MCP command in the brain service note while keeping generated QMD cache/index files outside the vault.
- Install or connect GBrain.
- Import the vault into GBrain.
- Embed, dream, and query through configured GBrain commands.
- Connect an existing Neo4j graph as an optional derived Brain Service using env-key names only.
- Sync Agent Memory and compiled knowledge pages into Neo4j with MERGE-only nodes and relationships marked `source: "hivemindos-derived"`.
- Run read-only Cypher from the Brain Services cockpit while rejecting write clauses.
- Install or connect Syntho.
- Initialize the `Synthesis` folder as a Syntho vault.
- Run Syntho pipeline, maintain, compare, eval, doctor, query, and pack export commands.
- Record the Syntho MCP command and source access policy in the brain service note.
- Keep Syntho raw source MCP access denied by default unless the user explicitly changes the source access policy.
- Attach trading-brain status to selected runtimes where configured.
- Write service notes back into the vault.

### Shared Brain Memory Summary

HivemindOS gives every local agent a shared, private, Obsidian-native memory layer. Agents write durable memories as typed markdown notes, retrieve typed memories and regular vault notes through a local API, and keep a fast private JSONL index for the typed Agent Memory hot path so recall does not depend on an external vector database or hosted memory service.

What makes it different:

- Shared across agents: Claude, Codex, Hermes, Gemini, Aeon, OpenClaw, and any shell-capable runtime can write and recall from the same brain through the API or `hive-brain`.
- Typed by intent: instructions, facts, decisions, goals, commitments, preferences, relationships, context, events, learnings, observations, artifacts, and errors each keep their own route through memory.
- Action-aware: durable assistant and agent actions can be stored as first-class `action` memories when a handoff, Queen Bee task, setup action, or receipt matters later.
- Entity-linked: deterministic entity and alias extraction boosts queries like "Queen Bee" or "GitLawb" without moving canonical memory out of Obsidian.
- Evolution-aware: agents can use `action: "evolve"` or `hive-brain evolve` to replace stale durable memories without deleting them. The latest active note is recalled as current truth, while previous versions stay attached as an `evolutionChain` with `supersedes`, `supersededBy`, `evolutionType`, and `cognitiveStage` metadata.
- Temporal-aware: current recall prefers active chain heads, while "before," "used to," "as of," dated, or relative-time queries can include superseded history and as-of evidence.
- Provenance-aware: memories can carry `agentName`, `agentId`, `runtime`, `machineName`, `machineId`, `tailnetId`, `tailnetName`, `tailnetDnsName`, `collectorUrl`, `sessionId`, and `project`, so the team can tell exactly which agent on which machine wrote a note without storing raw Tailnet IPs.
- Proof-ready: optional GitLawb receipts hash the memory record, chain proof hashes, and store sanitized provenance without copying the memory body into the proof log.
- Local-first and private: the durable notes, search index, and receipts live in the user's vault. Retrieval is network-free unless the user separately enables a sync or brain service.
- Softly self-tuning: retrieval/final-answer telemetry can nudge useful memories upward in crowded result sets without hiding low-usage or new memories.
- Graph-optional: Neo4j can mirror derived nodes and relationships for graph queries, but Obsidian remains the canonical editable memory store.
- Full-vault aware when needed: tiered recall can augment from the user's `Memory`, `Projects`, `Synthesis`, `Ideas`, `Operations`, `Skills`, templates, shared context, and `Operations/Secure` reference/status notes without moving plaintext secrets into notes.
- Raw-agent ready: setup installs runtime instruction blocks plus `hive-brain`; Claude Code also gets a `hive-brain-hook` `UserPromptSubmit` hook so raw Claude prompts can recall full-vault context without being routed through the app.
- Import-friendly: `rebuild-index` scans existing markdown memories once and appends rich searchable entries, so first cold indexing is a one-time catch-up pass. New writes update the index incrementally.
- OKF-compatible at the edge: the app can export typed memories and conversation mirrors into a clean Open Knowledge Format bundle for outside agents or catalog tools while keeping HivemindOS' richer Obsidian structure as the source of truth.

### Compiled Brain Retrieval

Compiled Knowledge is the fast path for durable synthesized topics. Instead of repeatedly rereading the whole vault for a topic that has already been reviewed, agents can search the compiled wiki, fetch the exact node, follow backlinks, and inspect the graph shape.

Reference benchmark, synthetic 720-page compiled wiki:

| Retrieval surface | Median |
| --- | ---: |
| Search compiled knowledge | 67.18ms |
| Graph overview | 39.45ms |
| Node lookup | 31.71ms |
| Backlinks | 32.44ms |
| Health scan | 62.47ms |

The benchmark covers a compiled domain with 720 pages and 1,440 wikilinks. The search response returns ranked hits with matched fields and compact snippets; graph follow-up tools return the heavier node or backlink detail only when the agent asks for it.

Benchmarks from the live local API route:

| Memory count | Recall p50 | Recall p95 | First indexed recall p50 | Answer p50 | Top-1 / Top-3 / MRR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.69ms | 3.15ms | 2.72ms | 2.83ms | 1.0 / 1.0 / 1.0 |
| 500 | 4.37ms | 5.26ms | 4.68ms | 4.18ms | 1.0 / 1.0 / 1.0 |
| 1500 | 19.20ms | 31.33ms | 19.37ms | 21.04ms | 1.0 / 1.0 / 1.0 |

Those benchmark rows measure `scope: "agent-memory"`, the typed/proven memory hot path. On a large reference vault of 28,549 markdown files, forced full-vault recall now uses the generated lexical index first: 26,019 eligible notes produced 25,995 indexed notes in about 9.2s, with a 70.6 MB JSONL index. A five-query latency benchmark improved from 2,285ms median old full-vault recall to 118ms median indexed recall, a 19.4x median speedup, with identical top-1 results. A seven-query quality benchmark found no relevance regression: both old and indexed search hit Top-1 for six exact expected notes and both missed one ambiguous Bankr imported-source query; cached indexed median latency was 27.75ms versus 4,506.20ms for the old `rg`-first baseline. Run `pnpm benchmark:shared-brain-search` for the deterministic fixture or `node scripts/benchmark-shared-brain-search-quality.mjs --vault <vault>` for a live vault. Run `pnpm benchmark:agent-memory-evolution` to verify the deterministic evolution fixture: superseded memories stay out of current recall while the latest hit carries prior versions as chain evidence.

Before the private index hot path, markdown scanning measured recall p50 of 99.51ms at 100 memories, 293.49ms at 500, 562.38ms at 1000, and 784.03ms at 1500. The indexed path keeps rich memory retrieval in milliseconds while preserving perfect synthetic relevance in the benchmark set.

Marketing copy:

> HivemindOS agents share an incredibly rich, typed, provenance-aware memory that stays local to your vault. It delivers network-free recall in milliseconds, a fraction of the latency of network-bound memory stacks, while remaining 100% private by default.

### Syntho Model

Syntho is an optional reviewed-memory compiler for the `Synthesis` folder. It is not a replacement for the raw vault. HivemindOS tracks:

- CLI path and install mode.
- `synto.toml` and `.synto/state.db` initialization state.
- Counts for raw files, drafts, articles, sources, queries, synthesis notes, and exported pack files.
- MCP mode, MCP command, exposed tool names, and source access mode.
- Compare model, confidence threshold, and whether high-confidence changes can be auto-approved.

The dashboard writes these settings into `Operations/Brain Services/Syntho.md` and mirrors them into shared-vault config so other agents can see the intended policy.

## Shared Skills

How it works:

- Shared vault index: `Skills/README.md`.
- Shared skill files: `Skills/<slug>/SKILL.md`.
- Skill services live in `src/lib/services/obsidian/brain-skills.ts`.
- Runtime provider inventory is read locally and through collector skill endpoints.
- Auto-sync config is stored under `~/.hivemindos/skill-auto-sync.json`.

What shared skills can do:

- List installed runtime skills.
- Import runtime skills into the shared brain.
- Write new shared skills.
- Save Hive Fusion generated skills into the shared brain for later retrieval.
- Auto-install HivemindOS Hive skills such as `hive-assimilate`, `hive-pulse`, `hive-capability-search`, and the Hive Fusion skills from `packaged-skills/auto-install/`.
- Auto-install `hive-brain-compiled-wiki` so agents learn the compiled-brain API/MCP workflow, compiled-wiki search, graph reading, health repairs, and shared-brain contribution contract.
- Auto-install the Obsidian Native Brain Pack: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills`.
- Reconcile shared-vault skills with local runtime providers.
- Auto-import, auto-update, and optionally track removals per provider.
- Sync shared skills to Aeon.

See also: [Hive Fusion](hive-fusion.html), which explains how capability search turns prompts into shared-brain skills, and [Packaged Skills](../packaged-skills/), which documents the Hive vs third-party packaged skill catalog.

## Main Code Paths

- `src/lib/services/obsidian/vault-path.ts`
- `src/lib/services/obsidian/agent-memory.ts`
- `src/lib/services/obsidian/okf.ts`
- `src/lib/services/obsidian/compiled-knowledge.ts`
- `src/lib/services/brain/shared-contribution-contract.ts`
- `src/lib/services/context-index.ts`
- `src/lib/services/obsidian/brain-graph.ts`
- `src/lib/services/obsidian/brain-skills.ts`
- `src/lib/services/brain/gbrain.ts`
- `src/lib/services/brain/synto.ts`
- `src/lib/services/brain/trading-brain.ts`
- `src/lib/services/chat/shared-vault-context.ts`
- `src/app/api/obsidian/**`
- `src/app/api/context-index/route.ts`
- `src/app/api/brain/gbrain/**`
- `src/app/api/brain/synto/**`
- `src/app/api/brain/trading-brain/**`
- `src/app/api/brain/okf/route.ts`
- `src/app/api/brain/knowledge/route.ts`
- `scripts/hivemind-mcp`
- `src/features/dashboard/views/VaultPanel.tsx`
- `src/features/dashboard/hooks/use-miroshark-brain-controller.tsx`

See also: [Syncing And Tailscale Architecture](../architecture/syncing-and-tailscale.md).

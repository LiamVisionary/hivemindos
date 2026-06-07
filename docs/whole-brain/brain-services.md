---
title: Whole Brain Services
description: GBrain, Syntho, Brain Graph, context index, and optional service layers.
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

The runtime API is `/api/queen-bee`. `GET` initializes/returns the control-plane state. `POST` with a message computes an intent fingerprint, writes dedupe/receipt JSONL records, and creates or reuses an idempotent Work Board card so any Queen Bee runtime can claim it.

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
| Durable memory writes | `/api/brain/memory` or `hive-brain remember ...` | Writes are typed notes in Agent Memory with optional GitLawb receipts. |

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

When the tiered path augments with full-vault recall, it includes normal vault markdown from `Memory/`, `Projects/`, `Synthesis/`, `Ideas/`, `Operations/`, `Skills/`, templates, and shared context notes. It intentionally includes `Operations/Secure/` reference/status notes so agents can know which credential names exist or are set. Plaintext secret values still belong only in shared env or encrypted artifacts and must not be printed, copied, summarized, or saved as memory.

Optional GitLawb memory receipts are appended at:

```text
Operations/Brain Services/Agent Memory Proofs.jsonl
```

The API supports:

- `remember`: save a typed memory note.
- `recall`: retrieve relevant shared-brain memories and vault notes by query, type, tags, project, and optional `scope`.
- `answer`: return a grounded memory context pack from the matching memories and vault notes.
- `rebuild-index`: scan existing markdown memory notes and append rich searchable entries to the private index.
- `proof: true`: attach a GitLawb memory receipt for this write.
- `proof: "auto"`: attach receipts for durable memory types and high-confidence facts.

The CLI mirrors the same recall path for non-managed agents:

```bash
hive-brain answer "what does liam prefer here?"
hive-brain recall "BYOK Agent Calls" --scope full-vault --limit 5
hive-brain remember --type preference --title "Short title" --content "Durable memory body"
```

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

Shared Brain Memory is intentionally local-first. The default tiered path keeps common preference, decision, instruction, and durable fact recall on the typed Agent Memory hot path. That hot path reads a private JSONL retrieval view inside the vault, so agents avoid a network call and avoid rescanning typed memory notes after the first index build. When distilled memory is weak, full-vault recall broadens the search to thousands of markdown notes, pays a cold local disk scan, then reuses a short in-process vault record cache for follow-up calls. Markdown notes remain human-readable, private, and syncable through the user's chosen vault sync owner.

Benchmarks from the live local API route at `http://127.0.0.1:5022/api/brain/memory`:

| Memory count | Recall p50 | Recall p95 | First indexed recall p50 | Answer p50 | Top-1 / Top-3 / MRR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.69ms | 3.15ms | 2.72ms | 2.83ms | 1.0 / 1.0 / 1.0 |
| 500 | 4.37ms | 5.26ms | 4.68ms | 4.18ms | 1.0 / 1.0 / 1.0 |
| 1500 | 19.20ms | 31.33ms | 19.37ms | 21.04ms | 1.0 / 1.0 / 1.0 |

The pre-index typed-memory markdown scan path measured p50 recall of 99.51ms at 100 memories, 293.49ms at 500 memories, 562.38ms at 1000 memories, and 784.03ms at 1500 memories. The optimized typed Agent Memory index keeps retrieval in the single-digit millisecond range through 500 memories and around 20ms p50 at 1500 memories while preserving perfect synthetic relevance in the benchmark set.

On Liam's current 4,848-note vault, the forced full-vault recall scope has 2,685 eligible markdown notes after generated/runtime/archive exclusions. A live local route smoke test measured one cold full-vault answer at about 2.35s, then warm cached full-vault answers around 0.20s-0.25s for fruit preference recall and around 0.23s-0.35s for secure-reference/project recall, with one dev-server reload outlier at 3.05s. Under default tiered recall, strong distilled memories can return from the typed index without paying that full-vault scan.

Raw-agent smoke tests confirmed both layers:

- A typed fruit preference in `Memory/Distillations/Agent Memory/` was recalled by raw Claude and raw Hermes.
- A project note outside Agent Memory, `Projects/Agent Calls - BYOK vs HivemindOS Cloud.md`, was recalled with `recallScope: full-vault`, `memoryHitCount: 0`, and answered correctly by raw Claude and raw Hermes.

Marketing-safe positioning: HivemindOS agents get rich, typed, provenance-aware memory with network-free local retrieval at a fraction of the latency of network-bound memory stacks, and the same local-first design makes the memory 100% private by default.

Primary sources:

- `src/lib/services/obsidian/agent-memory.ts`
- `/api/brain/memory`
- `scripts/hive-brain`
- `scripts/hive-brain-hook`

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

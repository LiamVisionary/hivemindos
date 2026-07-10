---
title: Whole Brain Vault Map
description: Canonical shared Obsidian vault folders and routing rules.
---

# Vault Map

The vault map exists so the brain does not turn into random markdown soup.

Agents should write to these layers instead of making new root folders because a new folder feels convenient in the moment.

## Directory Structure

This is the shape a clean HivemindOS brain should roughly have:

```text
hivemindos-vault/
|-- AGENTS.md
|-- Shared Context.md
|-- .hivemindos-transfers/
|   `-- <handoff-transfer-id>/
|-- Intake/
|   |-- Requests/
|   `-- Sources/
|-- Memory/
|   |-- Book Notes/
|   |-- Conversations/
|   |   `-- <agent-name>/
|   |       `-- YYYY-MM-DD-<title>-<sessionId>.md
|   |-- Daily Briefings/
|   |-- Decision Journal/
|   |-- Distillations/
|   |   `-- Agent Memory/
|   |-- Imported Sources/
|   |-- Meetings/
|   `-- Weekly Reviews/
|-- Synthesis/
|   |-- raw/
|   |-- wiki/
|   |   |-- .drafts/
|   |   |-- queries/
|   |   |-- sources/
|   |   `-- synthesis/
|   `-- pack/
|-- Ideas/
|-- Projects/
|-- Operations/
|   |-- AI-Ready Vault Contract.md
|   |-- Agent Notifications/
|   |-- Automations/
|   |   |-- Foundation Workflows/
|   |   `-- Project Autopilot/
|   |-- Brain Services/
|   |   |-- Agent Memory.base
|   |   |-- Agent Memory Entity Index.jsonl
|   |   |-- Agent Memory Index.jsonl
|   |   |-- Agent Memory Retrievals.jsonl
|   |   |-- Full Vault Search Index.md
|   |   |-- Full Vault Search Index.jsonl
|   |   |-- GBrain.md
|   |   |-- Neo4j.md
|   |   |-- Obsidian CLI.md
|   |   |-- Obsidian Native Brain Pack.md
|   |   |-- Obsidian Plugin Pack.md
|   |   |-- Project Brain.base
|   |   |-- QMD.md
|   |   |-- Queen Bee/
|   |   |   |-- Identity.md
|   |   |   |-- Routing Policy.md
|   |   |   |-- Safety Policy.md
|   |   |   |-- intent-dedupe.jsonl
|   |   |   |-- leases.jsonl
|   |   |   `-- receipts.jsonl
|   |   |-- Secure References.base
|   |   |-- Whole Brain.canvas
|   |   `-- Syntho.md
|   |-- Code Projects/
|   |-- Runtime Mirrors/
|   |   `-- AEON/
|   |       `-- .aeon/
|   |-- Secure/
|   |-- Vault Migrations/
|   `-- Work Board/
|-- Skills/
|   |-- README.md
|   `-- <skill-slug>/
|       `-- SKILL.md
|-- Templates/
|   `-- HivemindOS/
`-- Archive/
    `-- Processed Requests/
```

The exact project, skill, and migration folders will vary. The top level shape should not.

## Folder Jobs

| Folder | Purpose |
| --- | --- |
| `Intake/` | Raw captures, requests, passive ingest, web clips, voice notes, and unsorted source material. |
| `.hivemindos-transfers/` | Vault-backed Hivemind Sync handoff envelopes for targeted files and artifacts. Do not store secrets here. |
| `Memory/` | Durable source of truth knowledge: daily briefings, weekly reviews, decisions, meetings, imported sources, book notes, distillations, and conversation mirrors. |
| `Memory/Conversations/` | Finished HivemindOS chat sessions mirrored as one redacted note per session, organized by agent name. Written on session finish when the shared vault is enabled. Used for cross-session topic recall by all agents. |
| `Synthesis/` | Generated drafts, connection reports, research summaries, reviewed analysis, Syntho wiki output, and agent-generated outputs. |
| `Ideas/` | The operator's original thinking, mental models, recurring questions, taste, and personal strategy. |
| `Projects/` | Active work, project-specific context, status deltas, plans, and decisions. |
| `Operations/` | HivemindOS operational state: automations, work board, notifications, runtime mirrors, secure encrypted backups, vault migrations, access logs, and brain service status. |
| `Operations/Brain Services/Queen Bee/` | Queen Bee coordination state for one logical assistant identity: policy, current state, dedupe, leases, node annotations, and receipts. |
| `Skills/` | Shared agent procedures. Read `Skills/README.md`, then `Skills/<slug>/SKILL.md`. |
| `Templates/HivemindOS/` | Durable note templates for AI ready metadata and consistent note shapes. |
| `Archive/` | Completed, inactive, processed, or deliberately preserved historical material. |

## Operations Subfolders

| Path | Owner |
| --- | --- |
| `Operations/Automations/` | Scheduler records and seeded foundation workflow schedules. |
| `Operations/Work Board/` | Kanban/work-board state. |
| `Operations/Agent Notifications/` | Shared notification notes and dashboard notification state. |
| `Operations/Brain Services/` | QMD, GBrain, Neo4j, Syntho, Trading Brain, Obsidian CLI, plugin-pack, context-index service notes, the private Agent Memory indexes, retrieval telemetry, and optional hash-only memory proof receipts. |
| `Operations/Secure/` | Encrypted backup artifacts, credential-name status notes, and public-key reference notes only. Searchable by shared-brain recall for set/missing context, but no plaintext secrets. |
| `Operations/Runtime Mirrors/` | Runtime-local mirrors that are operational state, such as the hidden AEON `.aeon` mirror. |
| `Operations/Vault Migrations/` | Cleanup manifests and archived duplicate/conflict artifacts. |

## Seeded Child Paths

Setup also seeds these child paths because agents and workflows expect them to exist:

- `Intake/Requests`
- `Intake/Sources`
- `Memory/Daily Briefings`
- `Memory/Weekly Reviews`
- `Memory/Imported Sources`
- `Memory/Conversations`
- `Memory/Distillations`
- `Memory/Distillations/Agent Memory`
- `Operations/Automations`
- `Operations/Work Board`
- `Operations/Agent Notifications`
- `Operations/Brain Services`
- `Operations/Brain Services/Agent Memory.base`
- `Operations/Brain Services/Agent Memory Entity Index.jsonl`
- `Operations/Brain Services/Agent Memory Retrievals.jsonl`
- `Operations/Brain Services/Full Vault Search Index.md`
- `Operations/Brain Services/Neo4j.md`
- `Operations/Brain Services/Project Brain.base`
- `Operations/Brain Services/Secure References.base`
- `Operations/Brain Services/Whole Brain.canvas`
- `Operations/Secure`
- `Operations/Runtime Mirrors`
- `Templates/HivemindOS`
- `Archive/Processed Requests`

## Memory Routing

Shared Brain Memory has two recall layers:

- Typed durable memories live in `Memory/Distillations/Agent Memory/`.
- The private hot-path index lives in `Operations/Brain Services/Agent Memory Index.jsonl`.
- Entity and alias links live in `Operations/Brain Services/Agent Memory Entity Index.jsonl`.
- Retrieval/final-answer telemetry lives in `Operations/Brain Services/Agent Memory Retrievals.jsonl` and only nudges ranking.
- High-volume run receipts and operational events do not live in the vault. They use the bounded local journal at `~/.hivemindos/brain/operational-events.jsonl`; reviewed outcomes can later be promoted through Brain Review.
- Durable Agent Memory records carry canonical `memoryKey` heads so current recall returns one active truth per key.
- Memory evolution is represented in note frontmatter with `supersedes`, `supersededBy`, `evolutionRootId`, `evolutionType`, `evolutionReason`, and `cognitiveStage`; newer active notes replace older superseded notes without deleting history.
- Current recall returns active chain heads by default. Intentional temporal queries such as “used to,” “previously,” “as of <date>,” “before <date>,” or relative time phrases can include superseded history and as-of chain heads. Bare dates in titles and procedural wording such as “validation before release” remain current recall.
- The default full-vault lexical search service is documented in `Operations/Brain Services/Full Vault Search Index.md`.
- The generated full-vault lexical index lives in `Operations/Brain Services/Full Vault Search Index.jsonl` and ranks regular markdown by collection, path, phrase, exclusion, and BM25-style term frequency before source notes are loaded. It is generated state and can be rebuilt from markdown notes.
- Optional hash-only GitLawb receipts live in `Operations/Brain Services/Agent Memory Proofs.jsonl`.
- Optional derived Neo4j status lives in `Operations/Brain Services/Neo4j.md`. Neo4j connection values stay in env keys only, and sync must not replace Obsidian as canonical memory.
- Broad recall can search regular markdown notes across the vault when the typed memory layer is weak or when callers force `--scope full-vault`.
- Conversation mirrors live in `Memory/Conversations/<agent>/` with a deduped index at `Operations/Brain Services/Conversations Index.jsonl`. They are included in full-vault recall, making cross-session queries like "check our conversations about x" work for every agent type without per-agent changes.
- Obsidian-native views live at `Operations/Brain Services/Agent Memory.base`, `Project Brain.base`, `Secure References.base`, and `Whole Brain.canvas` so humans can inspect memory, projects, credential status references, and recall topology in Obsidian.

Agents should use `/api/brain/memory` when they are app-routed and `hive-brain answer "<query>"` when they are raw/non-managed. Claude Code also gets a `hive-brain-hook` prompt hook during setup so raw Claude prompts can receive relevant shared-brain context automatically.

## Retired Roots

These paths should not be used as active root folders:

- `Notes/`
- `Inbox/`
- `Scheduled/`
- `agent-notifications/`
- `kanban/`
- `claw-code/`
- `foo-empty/`
- `.omni-sync-test/`
- root `pineapple-*.md`

`scripts/vault-doctor.mjs` detects these where practical and moves or archives them carefully.

## Setup Sources

The canonical folder list must be mirrored in:

- `setup.sh`
- `setup.ps1`
- `uninstall.sh`
- `uninstall.ps1`
- `scripts/seed-vault-foundation.mjs`
- `scripts/test-vault-structure-contract.mjs`
- `AGENTS.md`
- this `docs/whole-brain/` section

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
|   |-- Daily Briefings/
|   |-- Decision Journal/
|   |-- Distillations/
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
|   |   |-- GBrain.md
|   |   |-- Obsidian CLI.md
|   |   |-- Obsidian Plugin Pack.md
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
| `Memory/` | Durable source of truth knowledge: daily briefings, weekly reviews, decisions, meetings, imported sources, book notes, and distillations. |
| `Synthesis/` | Generated drafts, connection reports, research summaries, reviewed analysis, Syntho wiki output, and agent-generated outputs. |
| `Ideas/` | Liam's original thinking, mental models, recurring questions, taste, and personal strategy. |
| `Projects/` | Active work, project-specific context, status deltas, plans, and decisions. |
| `Operations/` | HivemindOS operational state: automations, work board, notifications, runtime mirrors, secure encrypted backups, vault migrations, access logs, and brain service status. |
| `Skills/` | Shared agent procedures. Read `Skills/README.md`, then `Skills/<slug>/SKILL.md`. |
| `Templates/HivemindOS/` | Durable note templates for AI ready metadata and consistent note shapes. |
| `Archive/` | Completed, inactive, processed, or deliberately preserved historical material. |

## Operations Subfolders

| Path | Owner |
| --- | --- |
| `Operations/Automations/` | Scheduler records and seeded foundation workflow schedules. |
| `Operations/Work Board/` | Kanban/work-board state. |
| `Operations/Agent Notifications/` | Shared notification notes and dashboard notification state. |
| `Operations/Brain Services/` | GBrain, Syntho, Trading Brain, Obsidian CLI, plugin-pack, and context-index service notes. |
| `Operations/Secure/` | Encrypted backup artifacts and public-key reference notes only. No plaintext secrets. |
| `Operations/Runtime Mirrors/` | Runtime-local mirrors that are operational state, such as the hidden AEON `.aeon` mirror. |
| `Operations/Vault Migrations/` | Cleanup manifests and archived duplicate/conflict artifacts. |

## Seeded Child Paths

Setup also seeds these child paths because agents and workflows expect them to exist:

- `Intake/Requests`
- `Intake/Sources`
- `Memory/Daily Briefings`
- `Memory/Weekly Reviews`
- `Memory/Imported Sources`
- `Memory/Distillations`
- `Operations/Automations`
- `Operations/Work Board`
- `Operations/Agent Notifications`
- `Operations/Brain Services`
- `Operations/Secure`
- `Operations/Runtime Mirrors`
- `Templates/HivemindOS`
- `Archive/Processed Requests`

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

---
title: Whole Brain Architecture Sync
description: How to keep brain docs, setup, tests, and agent instructions in sync.
---

# Architecture Sync

Any brain architecture change has to update every surface that teaches or initializes that architecture.

Otherwise the app says one thing, the docs say another thing, and the next agent confidently recreates the mess.

## What Counts

This rule applies to changes in:

- canonical vault folders
- generated vault files
- setup-created brain notes
- shared skills layout
- packaged auto-install skill defaults
- packaged skill catalog subdivisions, optional skill policy, and packaged skill docs
- slash-command names, aliases, scope, and reference docs
- Obsidian-native `.base` and `.canvas` generated views
- brain service defaults
- shared memory access paths, including API, CLI, runtime prompt injection, and hooks
- shared memory indexes, proof receipts, and full-vault fallback behavior
- runtime mirror placement
- vault doctor cleanup behavior
- agent-facing write policy
- docs that explain any of the above

## Required Update Set

When a brain architecture change lands, check and update:

| Surface | Why |
| --- | --- |
| `docs/whole-brain/` | GitHub Pages docs for users. |
| `docs/features/brain-vault-and-skills.md` | Feature-guide entry point. |
| `README.md` | Repository quick-start and operator overview. |
| `AGENTS.md` | Agent rules for future changes. |
| `setup.sh` and `setup.ps1` | Fresh install shell initializers. |
| `uninstall.sh` and `uninstall.ps1` | Conservative mirror of setup-created files/folders/keys/hooks. |
| `scripts/seed-vault-foundation.mjs` | Vault foundation seeder. |
| `scripts/seed-shared-skills.sh` | Runtime instruction seeder and shared-skill mirror. |
| `scripts/vault-doctor.mjs` | Cleanup and migration behavior. |
| `scripts/test-vault-structure-contract.mjs` | Static guard that catches drift. |
| `packaged-skills/auto-install/` | Product-shipped shared skills that setup copies into the vault. |
| `packaged-skills/README.md` and `docs/packaged-skills/` | Packaged skill catalog, Hive skill subdivision, third-party packaged skill subdivision, and install policy. |
| `docs/slash-commands.md` | User-facing reference for dashboard and runtime slash commands. |

For Shared Brain Memory specifically, the required set also includes:

- `/api/brain/memory`
- `src/lib/services/obsidian/agent-memory.ts`
- `src/lib/services/chat/shared-brain-memory-context.ts`
- `src/lib/services/chat/shared-vault-context.ts`
- `src/lib/services/context-index.ts`
- `scripts/hive-brain`
- `scripts/hive-brain-hook`
- `scripts/benchmark-agent-memory-evolution.mjs`
- `docs/whole-brain/brain-services.md`
- `docs/features/brain-vault-and-skills.md`

## Fresh Install Rule

If a folder or generated note should exist in a clean vault, it must be created by setup/foundation seeding. Documentation-only creation is not enough.

## Cleanup Rule

If setup creates something, uninstall must offer a matching conservative removal prompt. If the doctor migrates or archives something, it must write a manifest.

This includes runtime files and hooks. For example, when setup registers a Claude `UserPromptSubmit` hook, uninstall must remove only the HivemindOS-managed hook entry and leave unrelated Claude settings intact.

## Docs Rule

The whole brain docs are GitHub Pages docs.

Do not put durable brain architecture guidance only in chat, personal notes, or a private vault note. If agents need to know it, add it to `docs/whole-brain/` and link it from `AGENTS.md`.

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
- brain service defaults
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
| `uninstall.sh` and `uninstall.ps1` | Conservative mirror of setup-created files/folders/keys. |
| `scripts/seed-vault-foundation.mjs` | Vault foundation seeder. |
| `scripts/vault-doctor.mjs` | Cleanup and migration behavior. |
| `scripts/test-vault-structure-contract.mjs` | Static guard that catches drift. |

## Fresh Install Rule

If a folder or generated note should exist in a clean vault, it must be created by setup/foundation seeding. Documentation-only creation is not enough.

## Cleanup Rule

If setup creates something, uninstall must offer a matching conservative removal prompt. If the doctor migrates or archives something, it must write a manifest.

## Docs Rule

The whole brain docs are GitHub Pages docs.

Do not put durable brain architecture guidance only in chat, personal notes, or a private vault note. If agents need to know it, add it to `docs/whole-brain/` and link it from `AGENTS.md`.

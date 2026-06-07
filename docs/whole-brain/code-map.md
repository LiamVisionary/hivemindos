---
title: Whole Brain Code Map
description: Source files and API routes that own HivemindOS brain behavior.
---

# Code Map

Use this page to find the source of a brain behavior before editing docs or defaults.

Basically: do not change the docs from memory if the code is sitting right here.

## Defaults And Setup

- `src/lib/types/agent-runtime.ts`
- `setup.sh`
- `setup.ps1`
- `uninstall.sh`
- `uninstall.ps1`
- `scripts/seed-vault-foundation.mjs`
- `scripts/test-vault-structure-contract.mjs`

## Vault Access And Graph

- `src/lib/services/obsidian/vault-path.ts`
- `src/lib/services/obsidian/brain-graph.ts`
- `src/lib/services/chat/shared-vault-context.ts`
- `src/app/api/obsidian/status/route.ts`
- `src/app/api/obsidian/graph/route.ts`
- `src/app/api/obsidian/access/route.ts`
- `src/app/api/obsidian/note/route.ts`
- `src/app/api/obsidian/open/route.ts`

## Shared Skills

- `packaged-skills/auto-install/obsidian-markdown/SKILL.md`
- `packaged-skills/auto-install/obsidian-bases/SKILL.md`
- `packaged-skills/auto-install/json-canvas/SKILL.md`
- `packaged-skills/auto-install/defuddle/SKILL.md`
- `src/lib/services/obsidian/brain-skills.ts`
- `src/app/api/obsidian/skills/route.ts`
- `src/app/api/obsidian/skills/reconcile/route.ts`
- `src/app/api/obsidian/skills/auto-sync/route.ts`
- `src/app/api/skills/catalog/route.ts`
- `src/app/api/skills/recommend/route.ts`
- `src/app/api/skills/packs/route.ts`
- `scripts/seed-shared-skills.sh`

## Brain Services

- `src/lib/services/context-index.ts`
- `src/lib/services/queen-bee/control-plane.ts`
- `src/lib/services/obsidian/agent-memory.ts`
- `src/lib/services/brain/gbrain.ts`
- `src/lib/services/brain/synto.ts`
- `src/lib/services/brain/trading-brain.ts`
- `src/app/api/context-index/route.ts`
- `src/app/api/queen-bee/route.ts`
- `src/app/api/brain/memory/route.ts`
- `scripts/hive-brain`
- `scripts/hive-brain-hook`
- `scripts/seed-vault-foundation.mjs`
- `src/app/api/brain/gbrain/**`
- `src/app/api/brain/synto/**`
- `src/app/api/brain/trading-brain/**`

## Agent Profiles And Runtime Mirrors

- `src/lib/services/obsidian/agent-profiles.ts`
- `src/lib/services/runtime-adapters/aeon-obsidian-sync.ts`
- `src/app/api/obsidian/agents/route.ts`
- `src/app/api/runtimes/aeon/obsidian-sync/route.ts`
- `docs/runtimes/aeon/github-actions-brain-access.md`

## Health And Cleanup

- `scripts/vault-doctor.mjs`
- `scripts/e2e-real-fleet.mjs`
- `src/lib/services/wallet/wallet-vault-backup.ts`
- `src-tauri/src/env.rs`
- `scripts/hive-env-add`

## Hivemind Sync

- `scripts/hive-transfer.mjs`
- `scripts/hive-transfer`
- `src/app/api/env/route.ts`
- `scripts/agent-telemetry-collector.mjs`
- `src/lib/services/obsidian/tailnet-vault-sync.ts`
- `src/app/api/obsidian/sync/route.ts`

## Shared Env

- `scripts/hive-env-add`
- `scripts/hive-env-remove`
- `scripts/hive-env-delete`
- `scripts/hive-env-check`
- `scripts/hive-env-run`
- `src/app/api/env/route.ts`
- `scripts/agent-telemetry-collector.mjs`
- `src/features/dashboard/views/UtilityPanels.tsx`
- `src/lib/services/runtime-integrations.ts`
- `src/lib/services/runtime-adapters/aeon.ts`

## Dashboard Surface

- `src/features/dashboard/views/VaultPanel.tsx`
- `src/features/dashboard/hooks/use-miroshark-brain-controller.tsx`
- `src/features/dashboard/hooks/use-fleet-notifications-controller.tsx`
- `src/features/dashboard/views/KanbanPanel.tsx`

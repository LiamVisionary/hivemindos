# Env, Files, Notifications, And Maintenance

These utility features keep the local-first control room usable over time: shared env sync, constrained file access, event notifications, memory telemetry, and repair checks.

## Env

How it works:

- App route: `/api/env`.
- Helper CLIs: `hive-env-add`, `hive-env-check`, `hive-env-run`.
- Canonical shared env: `~/.hivemindos/.env`.
- Optional encrypted backup: `hive.env.gpg` in the selected notes folder when GPG is configured.
- Remote env sync uses collector `/env` and Tailscale/Link reachability.
- Linked AEON GitHub repos are tracked in `~/.hivemindos/aeon-env-sync-repos.json`.
- AEON GitHub secret sync state lives in `~/.hivemindos/aeon-env-sync-state.json` and stores fingerprints only, not secret values.

Capabilities:

- Add, update, import, reveal, and promote env values.
- Keep shared env separate from runtime-specific compatibility stores.
- Sync selected values to trusted machines.
- Automatically sync changed shared env values to managed private AEON repos as GitHub Actions secrets.
- Skip public AEON repos and remove HivemindOS-managed synced secrets when a managed repo becomes public.
- Restore encrypted backups when configured.
- Verify presence without printing values through `hive-env-check`.

## Runtime Files

How it works:

- API route: `/api/runtime-files`.
- Root discovery: `src/lib/services/runtime-file-explorer.ts`.
- Roots are derived from configured agents, shared vault config, and the current workspace.

Capabilities:

- List safe root folders.
- Browse directories.
- Open file content.
- Save writable files in approved roots.

## Notifications

How it works:

- Obsidian-backed notification service: `src/lib/services/obsidian/agent-notifications.ts`.
- Dashboard API: `/api/notifications`.
- Notification grouping and display helpers live in `src/features/notifications`.

Capabilities:

- Group notifications by source and actor.
- Mark one or all notifications read.
- Update notification settings.
- Surface stuck work, runtime issues, auth failures, and handoff problems.

## Memory And Maintenance

How it works:

- Memory telemetry service: `src/lib/services/runtime-memory-telemetry.ts`.
- Maintenance service: `src/lib/services/runtime-maintenance.ts`.
- Routes: `/api/memory-telemetry` and `/api/maintenance`.
- Memory samples are appended under `~/.hivemindos/telemetry/memory-samples.jsonl`.

Capabilities:

- Track dashboard RSS, heap, external memory, process growth, and leak suspects.
- Show V8 heap limit usage, old-space/code-space/large-object-space composition, native buffers, malloced memory, native contexts, and detached contexts.
- Separate current Next.js memory from the wider dashboard process tree, helper processes, and largest nearby system processes.
- Flag suspects such as fast RSS growth, V8 heap pressure, old-space dominance, and RSS growth that outpaces JavaScript heap growth.
- Report maintenance checks.
- Check pnpm, the shared vault path, `~/.hivemindos`, and Hermes background prerequisites.
- Run targeted repair actions exposed by the maintenance service, including local state creation, pnpm enablement guidance, vault folder creation, and Hermes background repair hooks.

## Main Code Paths

- `src/app/api/env/route.ts`
- `scripts/hive-env-add`
- `scripts/hive-env-check`
- `scripts/hive-env-run`
- `src/app/api/runtime-files/route.ts`
- `src/lib/services/runtime-file-explorer.ts`
- `src/lib/services/obsidian/agent-notifications.ts`
- `src/lib/services/runtime-memory-telemetry.ts`
- `src/lib/services/runtime-maintenance.ts`
- `src/features/dashboard/views/UtilityPanels.tsx`
- `src/features/notifications/**`

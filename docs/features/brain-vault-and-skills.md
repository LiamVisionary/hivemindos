# Brain, Vault, And Skills

Brain/Vault is the shared memory and coordination layer. It is built around a normal Obsidian markdown vault, not a proprietary database.

## Vault

How it works:

- Vault path resolution is in `src/lib/services/obsidian/vault-path.ts`.
- The default vault path is `~/Documents/Obsidian/hivemindos-vault`.
- The app can use `NEXT_PUBLIC_OBSIDIAN_VAULT_PATH` or auto-detect common Obsidian locations.
- Sync ownership is external provider, HivemindOS Syncthing, or manual rsync repair.

Capabilities:

- Validate and open a configured Obsidian vault.
- Record note access events.
- Build a graph of notes and access history.
- Store Kanban board state, notifications, scheduled runs, wallet records, shared skills, and brain-service notes.
- Seed an AI-ready vault contract, durable note templates, optional Obsidian CLI/plugin-pack status notes, and disabled foundation workflows for common shared-brain routines.

Seeded structure:

- `Operations/AI-Ready Vault Contract.md` explains the shared brain routing and write policy.
- `Templates/HivemindOS/` contains durable templates for daily briefings, weekly reviews, meetings, research sources, decisions, projects, book notes, distillations, and AI outputs.
- `Operations/Brain Services/Obsidian CLI.md` records detected CLI status when setup runs.
- `Operations/Brain Services/Obsidian Plugin Pack.md` lists optional manual Obsidian plugins for templates, tasks, Dataview, retrieval, calendar, Kanban, and Git.
- `Operations/Automations/Foundation Workflows/` contains disabled workflow schedules for context synthesis, intake processing, meeting processing, research ingestion, vault health checks, decision review, argument building, book notes, feedback-loop capture, project updates, weekly synthesis, connection finding, and distillation.

## Brain Graph, GBrain, Synto, And Trading Brain

How it works:

- Brain graph generation is in `src/lib/services/obsidian/brain-graph.ts`.
- GBrain actions are in `src/lib/services/brain/gbrain.ts`.
- Synto actions are in `src/lib/services/brain/synto.ts`.
- Trading-brain install/status lives in `src/lib/services/brain/trading-brain.ts`.
- API routes live under `/api/brain/gbrain/*`, `/api/brain/synto/*`, `/api/brain/trading-brain/*`, and `/api/obsidian/graph`.

Capabilities:

- Build a graph from markdown notes and access logs.
- Show a Brain Services cockpit with service health summaries, primary actions, advanced settings, structured run output, and repair guidance when local prerequisites are missing.
- Install or connect GBrain.
- Import the vault into GBrain.
- Embed, dream, and query through configured GBrain commands.
- Install or connect Synto.
- Initialize the `Synthesis` folder as a Synto vault.
- Run Synto pipeline, maintain, compare, eval, doctor, query, and pack export commands.
- Record the Synto MCP command and source-access policy in the brain-service note.
- Keep Synto raw-source MCP access denied by default unless the user explicitly changes the source-access policy.
- Attach trading-brain status to selected runtimes where configured.
- Write service notes back into the vault.

### Synto Model

Synto is treated as an optional reviewed-memory compiler for the `Synthesis` folder, not as a replacement for the raw vault. HivemindOS tracks:

- CLI path and install mode.
- `synto.toml` and `.synto/state.db` initialization state.
- Counts for raw files, drafts, articles, sources, queries, synthesis notes, and exported pack files.
- MCP mode, MCP command, exposed tool names, and source-access mode.
- Compare model, confidence threshold, and whether high-confidence changes can be auto-approved.

The dashboard writes these settings into `Operations/Brain Services/Synto.md` and mirrors them into shared-vault config so other agents can see the intended policy.

## Shared Skills

How it works:

- Shared vault index: `Skills/README.md`.
- Shared skill files: `Skills/<slug>/SKILL.md`.
- Skill services live in `src/lib/services/obsidian/brain-skills.ts`.
- Runtime provider inventory is read locally and through collector skill endpoints.
- Auto-sync config is stored under `~/.hivemindos/skill-auto-sync.json`.

Capabilities:

- List installed runtime skills.
- Import runtime skills into the shared brain.
- Write new shared skills.
- Reconcile shared-vault skills with local runtime providers.
- Auto-import, auto-update, and optionally track removals per provider.
- Sync shared skills to Aeon.

## Main Code Paths

- `src/lib/services/obsidian/vault-path.ts`
- `src/lib/services/obsidian/brain-graph.ts`
- `src/lib/services/obsidian/brain-skills.ts`
- `src/lib/services/brain/gbrain.ts`
- `src/lib/services/brain/synto.ts`
- `src/lib/services/brain/trading-brain.ts`
- `src/lib/services/chat/shared-vault-context.ts`
- `src/app/api/obsidian/**`
- `src/app/api/brain/gbrain/**`
- `src/app/api/brain/synto/**`
- `src/app/api/brain/trading-brain/**`
- `src/features/dashboard/views/VaultPanel.tsx`
- `src/features/dashboard/hooks/use-miroshark-brain-controller.tsx`

See also: [Syncing And Tailscale Architecture](../architecture/syncing-and-tailscale.md).

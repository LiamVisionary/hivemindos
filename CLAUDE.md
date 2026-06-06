# HivemindOS Claude Instructions

- Read `AGENTS.md` first. It is the source of truth for this repository.
- For user preferences, decisions, instructions, goals, commitments, artifacts, lessons, credential status, or project context, use the shared HivemindOS brain before answering from generic memory.
- Preferred recall path: run `hive-brain answer "<query>"` before relying on prior context. It discovers the running HivemindOS app API at `/api/brain/memory` and falls back to local vault/index search if the app is unavailable.
- Raw Claude Code is also wired through the setup-installed `hive-brain-hook` `UserPromptSubmit` hook, which injects relevant shared-brain context before answering. Still run `hive-brain` manually when you need an explicit hit list, forced scope, or durable write.
- Default recall is tiered: it checks typed Agent Memory first, returns it when the distilled hit is strong, and otherwise augments with relevant markdown from the full shared vault. Use `--scope agent-memory` for typed/proven memory only, or `--scope full-vault` to force broad vault recall.
- Fallback recall path when the API is unavailable: read the shared vault directly at `/Users/liam/Documents/Obsidian/hivemindos-vault`, starting with `AGENTS.md`, `Shared Context.md`, `Projects/`, `Memory/`, `Synthesis/`, `Ideas/`, `Operations/`, and `Skills/`; use `Operations/Brain Services/Agent Memory Index.jsonl` and `Memory/Distillations/Agent Memory/` for strict typed Agent Memory.
- The shared vault's `AGENTS.md` lives at `/Users/liam/Documents/Obsidian/hivemindos-vault/AGENTS.md`; read it before durable vault edits.
- `Operations/Secure/` reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set; do not read, print, summarize, copy, or save plaintext secret values. Do not store raw Tailnet IPs or secrets in shared memory notes or proof receipts.

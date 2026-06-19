# Project Rules

## Changelog Discipline

- Before committing any feature, bug fix, setup change, or user-visible behavior change, update `CHANGELOG.md`.
- Every changelog entry must include:
  - local timestamp with timezone
  - short title
  - status: `Uncommitted`, `Committed`, or `Pushed`
  - files or areas changed
  - verification performed
  - intended commit-message summary
- Write the changelog entry while the work is still uncommitted, then update its status after commit/push.
- Before creating a commit, consult the newest relevant changelog entries and use them to write a specific commit message.
- Documentation-only housekeeping may use a concise changelog entry, but should still record the status and commit-message summary.
- Write feature updates and notable bug fixes in user-facing release-note language, not only technical implementation notes, so they can be reused for app releases.
- When building and committing a Tauri desktop update for release, summarize the relevant unreleased changelog entries as concise bullet points and include those bullets in the release notes/body.
- After a Tauri release is tagged or published, do not silently wipe changelog history. Move the released entries into `CHANGELOG_ARCHIVE.md` under the release version/date, or into a clearly labeled released section if an archive is not yet in use, then reset `CHANGELOG.md` to its header plus a fresh unreleased/staging section for new work.

## Safety

- NEVER run `git checkout`, `git restore`, `git reset --hard`, `git clean`, stash-without-pop, or any other git command that can discard uncommitted working-tree changes without EXPLICIT permission from Liam for that exact command. This working tree is shared by many concurrent agent sessions; a bulk revert destroys other sessions' uncommitted work (this happened on 2026-06-12). To undo your own changes, revert only the specific files you yourself edited, or do risky codemods in a disposable `git worktree`.
- Do not commit local secrets, private Tailnet IPs, personal vault contents, or machine-specific data.
- Keep collectors private to Tailscale unless the user explicitly asks for another exposure model.
- Prefer read-only fleet inspection by default. Remote mutation/update endpoints need explicit design and safety review.

## Docs Scope

- `docs/` is public product documentation for HivemindOS users. Never write personal or this-installation content there: no "on this machine" state, no named fleet machines or hostnames, no local workspace/run details, no personal names, paths, or session history.
- Describe features generically — what the product does on any install — with placeholder examples (`<repo>`, `<host>`) instead of real local values.
- Personal and operational state belongs elsewhere: Shared Brain Memory / the Obsidian vault for durable facts and setup records, `CHANGELOG.md` for what was changed and how it was verified, and the control room for machine runbooks.
- Before committing a doc, re-read it as a stranger installing the product: anything they could not reproduce or should not know is in the wrong file.

## Landing Page & Release Assets

- The public download/landing site is a **separate Next.js repo**; this repo's `src/app/page.tsx` is the dashboard root, not the landing page. The landing page links to version-independent `https://github.com/LiamVisionary/hivemindos/releases/latest/download/<asset>` URLs, so a new Latest release is served automatically.
- The release workflow's stable asset filenames are a **contract** with the landing page and the auto-updater. Do not rename a release asset without updating the workflow's "Collect bundle assets" step, `scripts/build-updater-manifest.mjs`, and the landing repo's download cards together. See [`LANDING_PAGE.md`](LANDING_PAGE.md).

## Persistence And Cross-Surface State

- Do not rely on browser-only storage such as `localStorage`, `sessionStorage`, IndexedDB, or webview cache for durable HivemindOS data. The app must work consistently across Tauri builds, the local dev build, and ordinary browsers.
- For user settings, UI state that should survive restarts, learned metrics, timing history, or other durable app state, prefer the shared dashboard state service (`/api/dashboard/state`, `src/lib/services/dashboard-state.ts`, and `src/lib/services/dashboard-state-client.ts`) or a focused server-side store under `~/.hivemindos/`.
- Use browser-only storage only for disposable, per-tab affordances where losing the value is harmless, and document that choice in the code when it is not obvious.
- For knowledge that agents should reason about, store compact structured operational data in the app store first, then publish summaries or durable facts to Shared Brain Memory or Obsidian. Do not spam the shared brain with high-volume raw telemetry samples.

## Code Style Guide

Agents are senior software engineers in this codebase and must follow these rules strictly.

### Core Principles

- Correctness first: prefer clear, reliable code over cleverness.
- Keep logic DRY. If the same logic appears twice, extract it into a well-named helper or shared module.
- Preserve single responsibility: each file, module, and function should do one thing well.
- Build small, composable units instead of large, multi-purpose functions or modules.

### Code Organization

- Keep files small and focused. If a file starts to feel multi-purpose, split it along feature or domain boundaries.
- Group code by feature or domain rather than by technical layer when practical.
- Avoid "god utils". Utility modules should be narrowly scoped and named for their domain.
- Prefer explicit exports and a minimal public surface area.

### Capability Matrices First

- When behavior varies by a typed family such as runtime, agent kind, wallet provider, payment rail, model provider, machine target, integration provider, or setup mode, look for an existing capability/default/feature matrix before adding branching logic.
- If no matrix exists and the new behavior is likely to recur for multiple members of the same family, create or extend a typed matrix instead of scattering `if`/`switch` checks through UI, API, and service code.
- Keep provider-specific rendering, validation, copy, actions, and defaults driven by the matrix where practical, with small local branches only for genuinely unique workflows.
- Expose new user-facing powers as capabilities first and provider implementations second. The user's natural request should map to an intent such as private transfer, paid API call, image generation, model routing, app deployment, or message delivery; the app/agent should then select the configured provider from the capability matrix or hive capability search. Do not require users to know or say provider names such as a wallet rail, model host, runtime, or integration unless the provider choice materially matters or the user asks for it.
- Whenever adding a new capability, update the relevant discovery surfaces so agents can find it from natural language: capability/default matrices, `/api/context-index` retrieval text or tool schemas, runtime prompt context, shared skills when durable workflow knowledge is needed, and any setup/status checks that prove availability. Capability-search evidence should identify the selected implementation, required credentials by key name only, side-effect gates, and fallback options.

### Readability And Style

- Prefer descriptive names over abbreviations.
- Keep functions short. If a function needs comments to explain what it is doing, refactor it.
- Avoid deep nesting; use early returns and guard clauses.
- Keep side effects isolated. I/O, network calls, storage, timers, and randomness should stay at the edges; pure logic should remain pure.

### Types And Interfaces

- Use TypeScript types to model domain data clearly.
- Avoid `any`. If a value is not yet known, use `unknown` plus runtime narrowing.
- Prefer small, specific types over broad "everything" types.
- Validate external data at boundaries, including API responses, localStorage, user input, files, and environment variables.

### Error Handling

- Fail loudly in development and gracefully in production.
- Add actionable error messages that explain what failed, why, and the relevant context.
- Do not swallow errors silently. Handle them intentionally or rethrow with context.

### Testing And Maintainability

- Write code that is easy to test with dependency injection, pure functions, and clear boundaries.
- If adding logic that can break, add or adjust focused tests, unit tests where practical.
- Avoid time-based flakiness; isolate randomness and current time behind helpers.

### Performance And Complexity

- Prefer the simplest solution that is fast enough.
- Avoid unnecessary renders, recomputation, and repeated expensive work.
- Memoize only when there is a clear need, and keep the result readable.
- Before changing performance-sensitive paths, read `OPTIMIZATIONS.md` and reuse or update the recorded decisions as relevant.
- When adding, removing, or materially changing an optimization, cache, timeout, debounce, polling rule, lazy load, expensive-work deferral, or prompt-size reduction, record it in `OPTIMIZATIONS.md` with the bottleneck, files changed, verification, tradeoffs, and revisit conditions.

### Documentation

- Prefer self-documenting code.
- Add comments for why, not what.

### Security And Privacy

- Treat user data as sensitive by default.
- Never log secrets, tokens, or PII.
- Sanitize or escape where relevant, including HTML, URLs, shell commands, and database queries.

### File Size Limit

- Code files must never exceed 1500 lines. If they do, refactor into smaller, more focused modules.
- Before pushing, run `node scripts/check-file-sizes.mjs` or `pnpm check-sizes` to check the repository.
- If an existing oversized legacy file must be touched, prefer extracting code from it instead of adding to it.

## Dev Server Ownership

- Port `5020` is Liam's managed HivemindOS dev server. Do not kill, restart, replace, or take over the process on port `5020` unless Liam explicitly asks for that exact action.
- If an agent needs to run a dev server for testing, use another free port such as `5021` or higher, and make it clear which URL was started.
- Do not run commands such as `pkill node`, `kill $(lsof -ti :5020)`, or broad process cleanup that could stop Liam's managed dev server.

## Setup / Uninstall Mirror

- Any install prompt, package, service, generated file, shell profile edit, agent instruction edit, shared-skill mirror, or optional third-party app added to `setup.sh` or `setup.ps1` must have a matching one-by-one removal prompt in `uninstall.sh` and `uninstall.ps1`.
- Any change to the shared Obsidian brain's structure, canonical folders, generated vault files, or agent-facing vault instructions must be mirrored in the app's vault initializer paths in the same commit. Check and update the shell setup scripts (`setup.sh`, `setup.ps1`, and matching uninstall surfaces when relevant), `scripts/seed-vault-foundation.mjs`, and the Tauri/desktop first-run setup flow so a fresh install creates the same structure agents expect.
- Any change to whole brain architecture must also update the GitHub Pages docs in `docs/whole-brain/` and the static guard in `scripts/test-vault-structure-contract.mjs` in the same commit. The docs are the user facing source of truth for vault routing, brain services, shared skills, sync health, and architecture sync rules.
- The uninstall prompt should name the same thing the install prompt created and should be conservative by default for destructive or third-party removals.
- If setup starts or registers a service, uninstall must offer to stop and unregister that exact service label/unit.
- If setup writes a managed block into an agent/runtime file, uninstall must remove only that managed block and preserve surrounding user-authored content.
- When adding or changing setup behavior, update this mirror surface in the same commit so install and uninstall stay 1:1.

## UI Text

- Do not silently truncate user-facing text with ellipses, line clamps, `text-overflow`, or forced no-wrap styling.
- Text may be collapsed only when the compact surface genuinely needs it, such as a long chat/history/body preview, and the UI must provide an obvious expand/collapse affordance.
- Prefer wrapping, taller rows/cards, or responsive layout adjustments over hiding content.
- Do not use free-text inputs for configuration values, filesystem paths, model IDs, runtime/provider settings, or similar structured choices in the primary UI. Prefer dropdowns, pickers, segmented controls, buttons, browse flows, or discovered options. If arbitrary text is genuinely required, put it inside a clearly labeled expandable Advanced section and keep the default path input-free.

## Directory Browsing

- When adding any UI that browses for a directory, reuse the existing machine-aware browsing flow instead of building a new picker.
- The default helper is `chooseDirectoryForMachine` from the dashboard controller surface. It intentionally opens the native local folder picker for This Mac and the in-app Hivemind Link directory browser for remote machines.
- If a feature must show the in-app directory browser directly, use `loadMachineDirectories` with a `KanbanMachineTarget`; do not call `/api/machines/directories` ad hoc from feature UI.
- Machine targets must preserve the distinction between local and remote collectors: This Mac may use the loopback/local collector URL, but remote machines must pass their direct Tailnet collector URL, usually `http://<machine.ip>:8787`, not a local Hivemind Link proxy URL. A loopback collector URL makes the shared helper treat the target as local.
- Machine picker values must be unique by at least machine key plus collector URL. Do not key only by display name or machine key when local and remote machines can both appear in the same control.

## Shared Skills

- Whole brain GitHub Pages docs live under `docs/whole-brain/`. Start at `docs/whole-brain/index.md` for the current brain map, and keep that section synchronized with `AGENTS.md`, setup initializers, the vault doctor, and `scripts/test-vault-structure-contract.mjs`.
- Canonical vault routing is documented in `docs/whole-brain/vault-map.md`: `Intake/`, `Memory/`, `Synthesis/`, `Ideas/`, `Projects/`, `Operations/`, `Skills/`, `Templates/HivemindOS/`, and `Archive/`.
- Brain service docs live in `docs/whole-brain/brain-services.md`. Shared skill docs live in `docs/whole-brain/shared-skills.md`. Hivemind Sync, vault doctor, secure backup, and migration behavior live in `docs/whole-brain/sync-and-health.md` and `docs/features/hivemind-sync.md`.
- Packaged skill docs live under `docs/packaged-skills/`, split into HivemindOS-owned Hive skills and third-party packaged skills. Optional packages may be flat or grouped by category, such as `packaged-skills/optional/design/<source>/<skill>/` for UI Skills imports. Any packaged skill addition, removal, rename, source move, auto-install/optional policy change, or provider import behavior change must update `packaged-skills/README.md`, `docs/packaged-skills/`, `docs/whole-brain/shared-skills.md` when the shared brain is affected, and `scripts/test-vault-structure-contract.mjs` when the surface is required for setup/docs consistency.
- Slash-command docs live in `docs/slash-commands.md`. Any change to dashboard, Hermes, gateway, CLI-only, or dynamic skill slash command names, aliases, arguments, scope, or behavior must update that page in the same change.
- Shared Brain Memory writes durable typed memories to `Memory/Distillations/Agent Memory/` with its private typed-memory index at `Operations/Brain Services/Agent Memory Index.jsonl`, entity link index at `Operations/Brain Services/Agent Memory Entity Index.jsonl`, retrieval telemetry at `Operations/Brain Services/Agent Memory Retrievals.jsonl`, generated full-vault lexical index at `Operations/Brain Services/Full Vault Search Index.jsonl`, and optional hash-only GitLawb receipts at `Operations/Brain Services/Agent Memory Proofs.jsonl`. Use `remember-action` for durable assistant/agent-confirmed actions and `record-usage` for retrieval/final-answer telemetry. When a reviewed memory replaces an older one, use `/api/brain/memory` action `evolve` or `hive-brain evolve` so the new active note records `supersedes`/`supersededBy`/`evolutionRootId` history instead of deleting or silently overwriting context.
- Finished chat sessions are mirrored into the shared vault as conversation notes at `Memory/Conversations/<agent>/` with an append-only index at `Operations/Brain Services/Conversations Index.jsonl` (readers dedupe by `sessionId`, last entry wins). Notes are written on session finish when the shared vault is enabled, pass through the security-proxy secret redaction (`redactSecretText`) before touching the vault, and skip automation/cron transcripts. This makes "check our conversations about x" work through normal shared-brain recall for every agent.
- Strict search policy: all content searches over the vault, conversations, chats, and recall paths must use the generated full-vault lexical index first when available, then ripgrep (`rg`), then plain `grep`, and only fall back to a full fs walk when neither binary works. Server code uses `src/lib/services/obsidian/full-vault-search-index.ts` and `src/lib/services/search/ripgrep-search.ts`; the `hive-brain` CLI implements the same chain. Agents doing ad hoc content searches should follow the same rule.
- The Queen Bee control plane lives at `Operations/Brain Services/Queen Bee/` and `/api/queen-bee`. Use it for one logical coordinator identity, routing/safety policy, dedupe, leases, and receipts; keep normal tasks in `Operations/Work Board/` and durable facts in Shared Brain Memory.
- Agents should use `hive-brain answer "<query>"` or `/api/brain/memory` for shared-brain recall and durable shared memories. Raw/non-managed agents should prefer the `hive-brain` CLI because it discovers the running API and falls back to local vault/index search. Setup also installs `hive-brain-hook` as a Claude Code `UserPromptSubmit` hook when Claude is targeted, so raw Claude prompts receive relevant shared-brain context automatically. Default recall/answer is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault. Load the `hive-brain-memory` skill when recalling, writing, correcting, or evolving typed Shared Brain Memory. Use `--scope agent-memory` or `scope: "agent-memory"` for typed/proven memory only; use `--scope full-vault` or `scope: "full-vault"` to force broad vault recall. Recall before relying on prior preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context; remember only durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, or reusable context, and evolve reviewed replacements instead of overwriting stale memory.
- For synthesized entity/concept/summary knowledge under `Synthesis/Compiled Knowledge/<domain>/`, load the `hive-brain-compiled-wiki` skill and prefer `brain_search_knowledge` or `/api/brain/knowledge` action `search` before broad full-vault recall. Use `hive-brain answer` first for typed preferences, decisions, instructions, commitments, and project context.
- Shared memory writes must include available provenance fields (`agentName`, `agentId`, `runtime`, `machineName`, `machineId`, `tailnetId`, `tailnetName`, `tailnetDnsName`, `collectorUrl`, `sessionId`, and `project`) and should use `proof: "auto"` unless explicit proof is requested. Do not store raw Tailnet IPs or secrets in memory notes.
- Shared handoffs should use `hive-handoff`, `/api/handoff`, `/handoff-task`, or `hivemind-mcp` instead of raw transfer IDs when possible. These surfaces fuzzy-match connected HivemindOS machines, use Fleet's best-agent assignment, create Obsidian/Syncthing `hive-transfer` payloads for files, and start the remote agent when a task is present. If a task handoff lacks the task, ask what the receiving agent should do; plain file handoff can proceed without a task.
- Shared env docs live in `docs/whole-brain/shared-env.md`. Shared secrets belong in `~/.hivemindos/.env` through `hive-env-add`, not in Obsidian notes or project files. `Operations/Secure/` reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set; they must not contain plaintext secret values. Use `hive-env-remove KEY` or `hive-env-delete KEY` to remove a shared key, and use `hive-env-check KEY` to verify presence without printing values.
- The shared skill shelf lives at `Skills/` inside the configured shared notes vault/folder.
- Current HivemindOS shared vault: `/Users/liam/Documents/Obsidian/hivemindos-vault`.
- Current HivemindOS shared skill index: `/Users/liam/Documents/Obsidian/hivemindos-vault/Skills/README.md`.
- Treat the shared shelf as the primary skill source: read `Skills/README.md` for the index, then read the relevant `Skills/<slug>/SKILL.md` before using a shared skill. Runtime-local skill folders are supplemental overlays for local/runtime-specific skills.
- Setup seeds `karpathy-guidelines` from `multica-ai/andrej-karpathy-skills`, HivemindOS Hive skills such as `hive-assimilate`, `hive-brain-memory`, and `hive-brain-compiled-wiki`, and the Obsidian Native Brain Pack (`obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills`) into the shared shelf. Setup projects that shared shelf into common local runtime skill folders for Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon as HivemindOS-managed cache folders while preserving unmanaged runtime-local skills on slug collision.
- Obsidian-native human views live in `Operations/Brain Services/Agent Memory.base`, `Project Brain.base`, `Secure References.base`, and `Whole Brain.canvas`.
- Encrypted backup artifacts belong in `Operations/Secure/`. Operational runtime mirrors such as the hidden AEON `.aeon` mirror belong in `Operations/Runtime Mirrors/`. Cleanup manifests belong in `Operations/Vault Migrations/`.

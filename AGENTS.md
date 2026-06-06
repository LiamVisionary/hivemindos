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

## Safety

- Do not commit local secrets, private Tailnet IPs, personal vault contents, or machine-specific data.
- Keep collectors private to Tailscale unless the user explicitly asks for another exposure model.
- Prefer read-only fleet inspection by default. Remote mutation/update endpoints need explicit design and safety review.

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
- Shared Brain Memory writes durable typed memories to `Memory/Distillations/Agent Memory/` with its private index at `Operations/Brain Services/Agent Memory Index.jsonl` and optional hash-only GitLawb receipts at `Operations/Brain Services/Agent Memory Proofs.jsonl`.
- Agents should use `hive-brain answer "<query>"` or `/api/brain/memory` for shared-brain recall and durable shared memories. Raw/non-managed agents should prefer the `hive-brain` CLI because it discovers the running API and falls back to local vault/index search. Setup also installs `hive-brain-hook` as a Claude Code `UserPromptSubmit` hook when Claude is targeted, so raw Claude prompts receive relevant shared-brain context automatically. Default recall/answer is tiered: check typed Agent Memory first, return it when the distilled hit is strong, and otherwise augment with relevant markdown from the full shared vault. Use `--scope agent-memory` or `scope: "agent-memory"` for typed/proven memory only; use `--scope full-vault` or `scope: "full-vault"` to force broad vault recall. Recall before relying on prior preferences, decisions, instructions, goals, commitments, artifacts, lessons, or project context; remember only durable reviewed facts, decisions, preferences, goals, instructions, commitments, artifacts, errors, learnings, or reusable context.
- Shared memory writes must include available provenance fields (`agentName`, `agentId`, `runtime`, `machineName`, `machineId`, `tailnetId`, `tailnetName`, `tailnetDnsName`, `collectorUrl`, `sessionId`, and `project`) and should use `proof: "auto"` unless explicit proof is requested. Do not store raw Tailnet IPs or secrets in memory notes.
- Shared env docs live in `docs/whole-brain/shared-env.md`. Shared secrets belong in `~/.hivemindos/.env` through `hive-env-add`, not in Obsidian notes or project files. `Operations/Secure/` reference/status notes are searchable during full-vault recall so agents can know which credential names exist or are set; they must not contain plaintext secret values. Use `hive-env-remove KEY` or `hive-env-delete KEY` to remove a shared key, and use `hive-env-check KEY` to verify presence without printing values.
- The shared skill shelf lives at `Skills/` inside the configured shared notes vault/folder.
- Current HivemindOS shared vault: `/Users/liam/Documents/Obsidian/hivemindos-vault`.
- Current HivemindOS shared skill index: `/Users/liam/Documents/Obsidian/hivemindos-vault/Skills/README.md`.
- Read `Skills/README.md` for the index, then read the relevant `Skills/<slug>/SKILL.md` before using a shared skill.
- Setup seeds `karpathy-guidelines` from `multica-ai/andrej-karpathy-skills` plus the Obsidian Native Brain Pack (`obsidian-markdown`, `obsidian-bases`, `json-canvas`, and optional `defuddle`, curated from `kepano/obsidian-skills`) into the shared shelf, and can mirror/import skills through common local runtime skill folders for Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon.
- Obsidian-native human views live in `Operations/Brain Services/Agent Memory.base`, `Project Brain.base`, `Secure References.base`, and `Whole Brain.canvas`.
- Encrypted backup artifacts belong in `Operations/Secure/`. Operational runtime mirrors such as the hidden AEON `.aeon` mirror belong in `Operations/Runtime Mirrors/`. Cleanup manifests belong in `Operations/Vault Migrations/`.

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

- The shared skill shelf lives at `Skills/` inside the configured shared notes vault/folder.
- Current HivemindOS shared vault: `/Users/liam/Documents/Obsidian/hivemindos-vault`.
- Current HivemindOS shared skill index: `/Users/liam/Documents/Obsidian/hivemindos-vault/Skills/README.md`.
- Read `Skills/README.md` for the index, then read the relevant `Skills/<slug>/SKILL.md` before using a shared skill.
- Setup seeds `karpathy-guidelines` from `multica-ai/andrej-karpathy-skills` into the shared shelf and can mirror/import skills through common local runtime skill folders for Codex, Claude, Hermes, Gemini, OpenClaw, and Aeon.

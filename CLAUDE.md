# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read This First

- **`AGENTS.md` is the source of truth for this repository.** Read it before non-trivial work. It carries the load-bearing rules this file only summarizes: Changelog Discipline, the git-safety rule, the Code Style Guide, Canonical Helpers, the open-source/commercial trust boundary, Dev Server Ownership, and the Setup/Uninstall mirror.
- This is HivemindOS: a local-first Next.js dashboard (packaged as a Tauri desktop app) for running and coordinating a fleet of AI agents across Tailscale-connected machines, backed by a shared Obsidian "brain."

## Shared Brain Recall (do this before relying on prior context)

- For user preferences, decisions, instructions, goals, commitments, artifacts, lessons, credential status, or project context, use the shared HivemindOS brain before answering from generic memory.
- Preferred path: run `hive-brain answer "<query>"`. It discovers the running app API at `/api/brain/memory` and falls back to local vault/index search if the app is down.
- Raw Claude Code is also wired through the setup-installed `hive-brain-hook` `UserPromptSubmit` hook, which injects relevant shared-brain context automatically. Still run `hive-brain` manually for an explicit hit list, forced scope, or a durable write.
- Recall is tiered: it checks typed Agent Memory first and augments with the full shared vault. Use `--scope agent-memory` for typed/proven memory only, or `--scope full-vault` to force broad vault recall.
- Fallback when the API is unavailable: read the shared vault directly at `/Users/liam/Documents/Obsidian/hivemindos-vault`, starting with its `AGENTS.md`, then `Shared Context.md`, `Projects/`, `Memory/`, `Synthesis/`, `Ideas/`, `Operations/`, `Skills/`. Read the vault's `AGENTS.md` before any durable vault edit.
- `Operations/Secure/` reference/status notes are searchable so agents can learn which credential names exist or are set. Never read, print, summarize, copy, or save plaintext secret values, and never store raw Tailnet IPs or secrets in memory notes or proof receipts.

## Commands

Package manager is **pnpm 8.6.12**. The hermetic test suites import `src/*.ts` directly and rely on Node's native TS type-stripping, so they need **Node ≥ 22.6** (CI pins Node 24). Release/Tauri builds pin Node 20 — do not cross the pins.

```bash
pnpm install
pnpm test          # THE gate: typecheck + static guards + size ratchet + all fast hermetic suites (scripts/test-gate.mjs). This is what CI runs and what "run the tests" means.
pnpm typecheck     # tsc --noEmit
pnpm lint          # eslint
pnpm check-sizes   # file-size ratchet — no code file may exceed 1500 lines (also inside `pnpm test`)
```

Running a single suite: each `test:*` script in `package.json` maps to a `scripts/test-*.mjs` file, e.g. `pnpm test:kanban:shards` or `node scripts/test-company-issues.mjs`. Only the hermetic subset is in the `pnpm test` gate; suites needing a live app/collector/fleet/network (`test:e2e:*`, `test:api-auth`, `test:mcp-email:real`, `test:fleet-local`, etc.) are excluded on purpose and run standalone. See the membership rules at the top of `scripts/test-gate.mjs`.

Dev servers (read **AGENTS.md → Dev Server Ownership** before starting one):

```bash
pnpm dev:ui        # opens the running dev server in your browser, or starts a Tauri-free Next dev on a free port — use this for UI work
pnpm dev           # Next dev server (Turbopack) on port 5020 by default
pnpm tauri:dev     # native Tauri shell — recompiles Rust; reserve for native-specific testing. Auto-attaches to a running dev server on 5021
```

- **Port `5020` is Liam's managed dev server. Do not kill, restart, or take it over.** Reuse a running server (one Next dev serves all tabs/windows/sessions via HMR); if you need your own, use `5021`+. Never run `pkill node` or `kill $(lsof -ti :5020)`.
- Prefer the **browser** over the Tauri window for UI iteration — on macOS Tauri is stuck on the slow WKWebView.

## Architecture

Next.js 16 app (`src/`), App Router, packaged into a Tauri v2 desktop app (`src-tauri/`).

- **`src/app/`** — routes. `src/app/api/` holds ~270 `route.ts` endpoints; the dashboard root is `src/app/page.tsx` (NOT the public landing page — that is a separate repo).
- **`src/proxy.ts`** — the API auth gate. Next 16 with a `src/` layout loads middleware ONLY from `src/proxy.ts`; a root `middleware.ts` is silently ignored. Every `/api` route is gated here except the allowlisted self-authenticating prefixes (x402 seller endpoints, phone image loaders, etc.).
- **`src/instrumentation.ts`** — server boot hooks. Must NOT import app modules (its whole import graph gets webpack-bundled and `node:`-scheme imports break boot); it reads env via `getBuiltinModule` and triggers work by POSTing to its own API routes.
- **`src/features/`** — feature domains (dashboard, fleet, kanban, chat, queen-voice, integrations, notifications, swarm, scheduler). **`src/components/`** — shared/presentational components. **`src/lib/`** — services, config, types, native bridge, db, stores.
- **`src-tauri/src/*.rs`** — native command bridges (`dashboard_state.rs`, `kanban.rs`, `brain.rs`, `fleet.rs`, `env.rs`, `memory.rs`, ...). The released desktop app can run in a static mode with no `/api` server, so dual-surface state flows through native invoke bridges.
- Collectors run on each fleet machine over Tailscale (default port `8787`); the Go `linkd` binary (`hivemind-linkd`) provides Hivemind Link and remote shell (`POST /api/fleet/shell`).

### Canonical helpers — use these, don't reinvent (see AGENTS.md → Canonical Helpers)

- API routes return the shared envelope from `src/lib/utils/api-response.ts` (`okJson`/`errorJson`/`upstreamErrorJson`). Don't hand-roll `{ ok, error }`.
- Dual-surface (Tauri native + browser) calls go through `nativeOrFetch` in `src/lib/native/bridge.ts`.
- **Durable UI state** goes through the dashboard state service (`/api/dashboard/state`, `src/lib/services/dashboard-state.ts`) or `useRememberedDashboardValue` — **never** `localStorage`/`sessionStorage`/IndexedDB (enforced by `guard:browser-durable-state`).
- Env flags read `process.env` through `src/lib/config/env.ts` (`optionalEnv`/`requiredEnv`/`booleanEnv`/`numberEnv`); credentials live in the shared hive env service.
- The dashboard view registry is `DASHBOARD_ROUTE_CATALOG_BY_ID` in `src/features/dashboard/dashboard-navigation.ts` — never add a parallel view map.
- Fleet machine/OS predicates are single-sourced in `src/features/fleet/fleet-identity.ts`.
- Crypto rails live in `CRYPTO_PROVIDER_MATRIX` (`src/lib/services/crypto-capability-router.ts`); payment-provider features in `AGENT_PAYMENT_PROVIDER_FEATURES` (`src/lib/config/agent-payments.ts`). Add matrix fields, not scattered conditionals.
- **Capability matrices first**: when behavior varies by a typed family (runtime, wallet provider, payment rail, model provider, integration provider, machine target), extend the matrix instead of scattering `if`/`switch`.
- Any server→own-`/api` fetch must send `internalApiAuthHeaders()` (`@/lib/utils/internal-api-auth`), or it 401s at the proxy gate.

## Non-obvious rules that will bite you

- **Git safety (hard rule):** NEVER run `git checkout -- <path>`, `git restore`, `git reset --hard`, `git clean`, or stash-without-pop without explicit permission for that exact command. This working tree is shared by many concurrent agent sessions; a bulk revert destroys their uncommitted work. Stage only files you changed; leave concurrent work alone.
- **Changelog Discipline:** before committing any feature, fix, setup, or user-visible change, add a `CHANGELOG.md` entry (local timestamp+tz, title, status Uncommitted/Committed/Pushed, files/areas, verification, intended commit message). Write it while still uncommitted, update status after commit/push.
- **File-size limit:** no code file may exceed 1500 lines. Extract from oversized legacy files rather than adding to them.
- **Performance:** read `PERFORMANCE_GOTCHAS.md` (curated symptom→cause→diagnosis, dev-only) before chasing mysterious slowness, and `OPTIMIZATIONS.md` before touching perf-sensitive paths; record new optimizations/gotchas there.
- **Commercial trust boundary:** treat the client as hostile for revenue/entitlement. Official revenue recipients, quotas, credits, and pricing must be enforced by HivemindOS-controlled infrastructure — never by local env, local config, URL params, or client JSON. Authoritative service source stays out of this MIT repo's `workers/` tree. Guarded by `guard:commercial-trust-boundary`.
- **Setup/uninstall mirror:** anything `setup.sh`/`setup.ps1` installs must have a matching one-by-one removal in `uninstall.sh`/`uninstall.ps1`, in the same commit.
- **`docs/`** is public product documentation — no machine names, hostnames, local paths, personal state, or implementation jargon. Personal/operational state belongs in the shared brain or `CHANGELOG.md`.
- **UI text:** don't silently truncate user-facing text (ellipses/clamps/no-wrap) without an obvious expand affordance. Don't use free-text inputs for structured config (paths, model IDs, provider settings) — use pickers, or a labeled Advanced section.
- **Loading states (see AGENTS.md → Loading States):** NEVER render a static loading indicator — a bare `Loading…` / `Saving…` / lone `…` with no motion is banned everywhere. Always use an animated loader: a shape-matched **skeleton** for regions, an indeterminate **loading bar** for progress waits, or an inline **spinner** for button/inline busy states (swap a button's icon for the spinner, keep the word). Reuse the canonical primitives `Spinner`/`Skeleton`/`SkeletonText`/`LoadingBar` from `src/features/dashboard/views/zero-human-companies/primitives.tsx` (CSS `.zhc-spinner`/`.zhc-skel`/`.zhc-progress` in that folder's `theme.css`); don't hand-roll a one-off. Wrap region skeletons in `role="status"` + `aria-label` and respect `prefers-reduced-motion`.
- **Content search order:** full-vault lexical index → `rg` → `grep` → fs walk (never start with a full fs walk).

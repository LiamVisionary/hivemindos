# Changelog

This file records user-visible changes before they are committed. New work should
be added here first, then marked `Committed` or `Pushed` after the git action.

## Unreleased

- No pending entries.

## 2026-06-13 10:52:28 +0700 - Fix Stuck Dashboard Loading Screen And Add Issue Reporting

- Status: Pushed
- Areas changed: dashboard hydration loader (`src/lib/services/dashboard-state-client.ts`, `src/features/dashboard/DashboardApp.tsx`), new client issue reporter (`src/lib/utils/issue-reporter.ts`), new Cloudflare Worker (`workers/issues/`)
- Summary: Fixes the bug where a fresh install could sit forever on a loading screen ("Scanning fleet discovery" on the desktop, "Opening Agent Chat" on mobile). Both screens gate on dashboard hydration, which only completed after the local-state snapshot loaded — and that loader retried `/api/dashboard/state` indefinitely with no give-up, so any persistent backend failure left the app on an endless spinner. The retry is preserved (it protects stored chat history from an empty-boot overwrite), but after ~10s of failure the app now shows a recoverable "Still connecting to HivemindOS…" screen with a Reload button that clears itself the moment the service answers. Broken boots are also reported (anonymized: failure kind, HTTP status, app version, coarse UA, random per-install id — never user content, paths, secrets, or IPs) to a new `hivemindos-issues` Cloudflare Worker + D1, so a stuck install is visible centrally without asking the user to open devtools.
- Verification: `tsc`/`eslint` clean on all changed files; `pnpm test:dashboard-state-snapshot` green (no-data-loss semantics preserved); issues Worker deployed and round-trip verified live (POST accepted, token-gated read works, unauthorized → 401). The loading screen itself is Tauri-only and needs a desktop build for a live look.
- Intended commit message: `Fix dashboard loading-screen hang; add anonymized issue reporting`

## 2026-06-13 02:12:01 +0700 - Simplify First-Run Setup And Add Post-Setup Guided Tour

- Status: Pushed
- Areas changed: native setup wizard (`src/features/native/NativeFirstRunOnboarding.tsx`), guided tour (`src/features/dashboard/GuidedDashboardTour.tsx`, `src/lib/native/guided-tour.ts`), dashboard mount (`src/features/dashboard/DashboardApp.tsx`)
- Summary: The first-run wizard is rewritten for non-technical users: a plain two-choice install question ("Just this Mac" vs "This Mac + my other devices", Recommended badge) with the Tailscale mode demoted to an advanced row; one combined agent toggle list instead of separate skills/memory pickers; a one-sentence run step with the backup command behind a disclosure; per-step headers. Copy is platform-aware (Mac/PC/computer from `native_setup_status.platform`); Windows skips the mode/agents steps that `setup.ps1` ignores and gets a two-screen flow; the macOS-only phone-pairing step is replaced with a finish panel elsewhere. The wizard now ends with "Show me around", which launches a six-stop spotlight tour over the real nav (Fleet, Brain, Work, Wallets, More, Chat) that finishes in an open chat with the first chat-capable agent preselected.
- Verification: `tsc`/`eslint` clean; Playwright E2E against the live dev server unlocked the dashboard, fired the tour event, asserted all six stops advance with correct titles, and confirmed the finish lands on "Talking with AdaptiveAgent". The wizard surface itself is Tauri-only and needs a desktop build for a live look.
- Intended commit message: `Simplify first-run setup, add post-setup guided tour, Venice/UsePod wallet flows`

## 2026-06-13 01:14:27 +0700 - Add Replicable Setup E2E Matrix Harness Command

- Status: Pushed
- Areas changed: test harness list (`package.json`), new runner script (`scripts/test-setup-e2e-matrix.mjs`)
- Summary: The cross-platform setup E2E matrix (`.github/workflows/setup-e2e-matrix.yml`: setup.sh on ubuntu/macos, setup.ps1 on windows incl. PowerShell 5.1 entry, strict `next build --webpack` on windows) is now a first-class repeatable harness. `pnpm test:e2e:setup-matrix` dispatches the workflow on `main` via `gh workflow run`, locates the run it started, and watches it to a pass/fail exit code like any local test. Supports `--ref <branch>` and `--no-watch` (dispatch and print the run URL without blocking). Expect ~50-90 minutes; the Windows production-build job alone takes 45+ minutes on the 2-core runner.
- Verification: `node --check scripts/test-setup-e2e-matrix.mjs`; `gh workflow view setup-e2e-matrix.yml` confirms the workflow is registered and dispatchable (18 prior runs, latest fully green: 27419483805).
- Intended commit message: `Add on-demand runner for the setup E2E matrix`

## 2026-06-13 00:35:45 +0700 - Clean Up Desktop Release Download Names (updater artifacts)

- Status: Pushed
- Areas changed: Tauri release workflow (`.github/workflows/tauri-cross-platform-release.yml`), updater manifest builder (`scripts/build-updater-manifest.mjs`), release-mode guard (`scripts/test-tauri-release-mode.mjs`)
- Summary: Completes the canonical-asset-name cleanup already on main (`736856a9`) with the updater pieces: the release workflow collects updater-only artifacts (`.app.tar.gz`/`.sig` for macOS, `.exe.sig`/`.AppImage.sig`) under `HivemindOS-updater-*` names, and `scripts/build-updater-manifest.mjs` assembles the updater manifest from them.
- Verification: Pending a release-workflow run.
- Intended commit message: `Clean up desktop release asset names`

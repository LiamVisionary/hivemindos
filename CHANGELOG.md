# Changelog

This file records user-visible changes before they are committed. New work should
be added here first, then marked `Committed` or `Pushed` after the git action.

## Unreleased

## 2026-06-13 02:16:44 +07 +0700 - Prepare v0.2.3 Desktop Release Build

- Status: Pushed
- Areas changed: app version metadata (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`), release workflow dispatch
- Summary: HivemindOS desktop is prepared for the `v0.2.3` patch release so new downloads include the simplified first-run setup flow, post-setup guided tour, Venice/UsePod wallet flows, setup E2E matrix harness, and updater asset cleanup from the latest pushed `main`.
- Release-note bullets:
  - Simplified first-run setup for non-technical users with plain install choices, clearer agent toggles, and platform-aware copy.
  - Added a post-setup guided dashboard tour that walks through Fleet, Brain, Work, Wallets, More, and Chat.
  - Added guided Venice and UsePod wallet flows.
  - Added the repeatable setup E2E matrix harness for macOS, Linux, and Windows.
  - Cleaned up updater artifacts so desktop downloads and updater files keep canonical names.
- Verification performed:
  - `node scripts/bump-app-version.mjs --set 0.2.3`
  - Package, Tauri config, Cargo manifest, and the `hivemindos-desktop` Cargo lock package entry all validated as `0.2.3`.
  - `git ls-remote --tags origin refs/tags/v0.2.3` returned no tag.
  - `gh release view v0.2.3 --repo LiamVisionary/hivemindos` returned no release.
  - `git diff --check -- CHANGELOG.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`
- Intended commit-message summary:
  - `Prepare v0.2.3 release build`

The release workflow will build macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64 assets from `main`, then publish `v0.2.3` only after every platform build succeeds.

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

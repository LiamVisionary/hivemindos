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

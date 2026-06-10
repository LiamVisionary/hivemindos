# Optimizations

This file records performance and latency optimizations that future agents should
reuse before re-debugging the same paths. Keep entries concrete: what was slow,
what changed, which files own the behavior, how it was verified, and what to
watch next.

This complements `CHANGELOG.md`. The changelog is release-facing; this file is
the engineering memory for optimization decisions and performance traps.

## Rules For New Entries

- Add an entry whenever you add, remove, or materially change a performance optimization, cache, timeout, debounce, polling rule, lazy load, prompt-size reduction, or expensive-work deferral.
- Record the measured bottleneck or failure mode, not just the code change.
- Include exact files or areas changed.
- Include verification commands and live timing evidence when available.
- Note tradeoffs, cache freshness, fallback behavior, and when the optimization should be revisited.
- If an optimization affects prompt injection or agent context, state what context is preserved and what is skipped, cached, compacted, or deferred.

## 2026-06-10 15:05 WITA - Retry Empty Boot Snapshots Instead Of Booting Empty

- Problem: `loadDashboardStateSnapshot()` resolved to `{}` (and cached it) whenever the dashboard-state GET failed — including the routine case of a Tauri proxy 503 while the Next dev server restarted on its memory threshold. Hydration then seeded in-memory state from the empty snapshot, and the next debounced persist overwrote the server's stored values. This was the mechanism that wiped the saved chat history from ~5.5MB down to a couple of threads (orphaned `dashboard-state.json.*.tmp` files in `~/.hivemindos/` mark repeated mid-write kills; a Jun 9 22:56 tmp already held only 1 thread). The earlier save-retry/stash work covered failed saves but not this failed-load-then-overwrite path.
- Change: The loader now distinguishes outages from answers. Network failures and 5xx responses retry with backoff (`1s, 2s, 3s, 5s`, then every 5s) and block hydration until the server actually answers — hydration awaits the promise, so no DashboardApp change was needed. Definitive non-5xx JSON answers (auth denied, empty store) resolve immediately and are never cached, so a later reload re-checks instead of reusing the empty result. Only successful snapshots are cached.
- Preserved behavior: Successful loads are identical (single GET, cached for the session). The pending-chat-saves stash merge still runs after hydration. Unauthenticated browsers still get an empty read-only view instead of a retry loop.
- Tradeoff: If the local state API is genuinely down, the dashboard stays on its loading state instead of booting empty. That is intentional — booting empty was silently destructive, and the app cannot function without its local API anyway.
- Files: `src/lib/services/dashboard-state-client.ts`, `scripts/test-dashboard-state-snapshot.mjs` (new), `package.json`.
- Verification: `pnpm test:dashboard-state-snapshot` passed: two simulated network failures retried then returned real values with recorded backoff delays; a 503 retried; a 401 resolved empty in one attempt and was not cached.
- Watch next: If the dashboard ever needs an offline boot mode, gate persistence on a "snapshot confirmed" flag instead of resolving empty — never let defaults overwrite stored state. Related: deleting an agent records suppression tombstones via `suppressionKeysForRemovedAgent`, which now skips keys that a surviving saved profile resolves to, so deleting a stale duplicate cannot hide the kept agent (`pnpm test:fleet-agent-suppression` covers it).

## 2026-06-10 12:10 WITA - Conversation Notes Session-End Sync

- Problem: HivemindOS chat sessions were only stored in `~/.hivemindos/chat-runtime-sessions/` and the dashboard-state blob. Agents had no cross-session topic index, so "check our conversations about x" had no data surface to search.
- Change: `finishRuntimeChatSession` in `runtime-session-store.ts` now fires a best-effort `syncConversationNoteForSession(session)` after writing the session file. New `src/lib/services/obsidian/conversation-notes.ts` writes one redacted markdown note per session to `Memory/Conversations/<agent>/YYYY-MM-DD-<title>-<sessionId>.md` in the shared vault and appends a deduplicated entry to `Operations/Brain Services/Conversations Index.jsonl`. Every message passes through `redactSecretText()` (from `agent-security-proxy.ts`) before the vault write. Automation/cron transcripts and sessions with no assistant reply are skipped. The write is non-blocking (fire-and-forget, `void .catch(() => {})`), so chat responses are not delayed. Cross-session topic recall now works through normal tiered/full-vault recall for every agent type: managed runtimes, `hive-brain` CLI, and the Claude prompt hook.
- Preserved behavior: Chat routing, session storage, and dashboard-state persistence are unaffected. The vault note is a mirror copy only. If the vault path is not configured or the write fails, the chat session and dashboard state are unchanged.
- Files: `src/lib/services/obsidian/conversation-notes.ts` (new), `src/lib/utils/automation-transcript.ts` (new), `src/lib/services/chat/runtime-session-store.ts`, `src/app/api/chat/agent-runtime/route.ts`, `src/lib/services/agent-security-proxy.ts` (added exported `redactSecretText`).
- Verification: E2E verified via real API call to `/api/chat/agent-runtime` against the running dev server; vault note written to correct path and Conversations Index JSONL entry appended. `hive-brain answer "conversations"` returned the note.
- Watch next: No archival or compaction policy exists yet. If the vault fills with many short sessions, add a minimum message-count or minimum assistant-text-length guard, or an archival job that moves old notes to `Archive/`.

## 2026-06-10 12:05 WITA - Ripgrep-First Vault Recall Shortlist

- Problem: Every shared-brain recall query scanned all eligible markdown files on the vault before scoring — 2,685 files after exclusions on Liam's current vault. Warm full-vault recall was ~0.20–0.35s; cold was ~2.35s. Both would grow linearly with vault size.
- Change: New `src/lib/services/search/ripgrep-search.ts` exports `listFilesMatchingTerms(options)`: tries `rg -li --no-messages` first, falls back to `grep -rli`, returns `null` when neither binary works. New `candidateVaultFiles(root, query?)` in `agent-memory.ts` passes the shortlisted file list to the existing scoring path instead of `walkVaultMarkdown()`; a `null` result (no binary) falls back to the full walk. The `hive-brain` CLI implements the same chain via `spawnSync` for its local fallback. `searchTermsFromQuery()` extracts 2–3 weighted terms from the query string.
- Preserved behavior: Scoring, confidence weighting, `shouldSkipVaultPath` filtering, and automation transcript guards are all unchanged — rg/grep only shortlist candidate files. When neither binary is available the behavior is identical to pre-change. The typed Agent Memory index hot path is unaffected.
- Files: `src/lib/services/search/ripgrep-search.ts` (new), `src/lib/services/obsidian/agent-memory.ts`, `scripts/hive-brain`.
- Verification: E2E smoke via live `POST /api/brain/memory` with `action: "answer"` returned correct results. `~/.local/bin/hive-brain answer` confirmed working with ripgrep-first path.
- Watch next: The shortlist only covers notes with literal term matches. Notes relevant by metadata or structure but not by keyword can be missed. If recall quality drops, check GBrain semantic retrieval as the gap-filler, or broaden term extraction with simple synonyms.

## 2026-06-10 11:50 WITA - Dashboard-State 503 Retry + Pending-Save Stash

- Problem: When the Next.js dev server hit its memory threshold and restarted mid-save, the Tauri dev proxy returned `503 DEV_PROXY_UNAVAILABLE`. The dashboard-state chat-messages save silently dropped with no retry, so chats were unrecoverable after a page reload. Live incident: a BankrAgent conversation was lost because the second message triggered a dev server restart and the subsequent save was the 503.
- Change: Added `SAVE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000]` retry schedule in `dashboard-state-client.ts` with per-key `saveRetryTimers` and `saveRetryAttempts` maps. `saveDashboardStateValue` and `saveDashboardStateValues` call `scheduleSaveRetry` on failure. Added `PENDING_CHAT_SAVES_STORAGE_KEY` localStorage helpers in `dashboard-storage.ts`: `readPendingChatSaves`, `writePendingChatSaves`, `clearPendingChatSaves`, and `diffChatMessagesForPendingSave`. `DashboardApp.tsx` stashes only the changed-chats delta (not the full 5.5 MB blob) to localStorage on save failure, merges pending saves with server state on hydration via `mergePendingChatMessages` (last-activity-timestamp wins), and clears the stash on confirmed save.
- Preserved behavior: Successful saves still clear the stash. Server state remains authoritative on full hydration; the stash only fills 503 gaps. Existing `fetch(..., { keepalive: true })` behavior on single-key saves is retained. AEON agent delete flow and non-chat state keys are unaffected.
- Files: `src/lib/services/dashboard-state-client.ts`, `src/features/dashboard/dashboard-storage.ts`, `src/features/dashboard/DashboardApp.tsx`.
- Verification: Root cause confirmed via telemetry cross-reference: `agent_runtime.request.received` present but no route event after it; `chat.runtime.poll.failed` 503 payload visible in `~/.hivemindos/telemetry/events.jsonl`. BankrAgent chat recovered from runtime session JSON. Pending-save stash validated via code review and TypeScript build.
- Watch next: If all 3 retry attempts fail (e.g. extended dev server outage), the stash holds the last delta indefinitely until the next successful save — harmless for transient 503s but could hold stale deltas after a longer outage. If the memory threshold is bumped and 503s stop occurring, the stash-on-failure path becomes dead code but has no cost.

## 2026-06-10 10:37 WITA - Optimistic Fleet Agent Deletes

- Problem: Deleting a non-AEON agent from the Fleet graph waited for the collector `/agents` delete bridge before updating local dashboard state. A slow or unreachable collector made the tooltip action feel stuck even though the dashboard could safely hide the agent immediately.
- Change: The dashboard now records the suppression tombstone from the delete action itself, removes cached discovery/snapshot state, immediately persists the updated saved-profile roster, updates the selected agent, and clears messages before starting runtime-source cleanup in the background. Suppression is authoritative for both discovered agents and saved/configured profiles, and runs through `filterSuppressedAgents` before Fleet source merging and snapshot builds. Single-key dashboard-state saves use `fetch(..., { keepalive: true })`, and dashboard boot no longer treats an empty in-memory suppression set as an instruction to erase durable tombstones.
- Preserved behavior: AEON destructive deletes still wait for the explicit local/GitHub delete flow and progress reporting. Managed runtime agents still attempt source cleanup through `/api/agents/runtime`; failures are surfaced through the maintenance message instead of rolling back the optimistic UI removal.
- Files: `src/features/dashboard/hooks/use-wallet-files-controller.tsx`, `src/features/dashboard/DashboardApp.tsx`, `src/features/dashboard/hooks/use-dashboard-derived-state.tsx`, `src/features/fleet/fleet-identity.ts`, `src/lib/services/dashboard-state-client.ts`, `scripts/test-fleet-agent-suppression.mjs`.
- Verification: `pnpm test:fleet-agent-suppression` passed; focused ESLint and TypeScript filtering passed for the dashboard delete flow; `git diff --check` passed for touched files.
- Watch next: If users need stronger source-delete assurance for managed OpenClaw/Hermes agents, add a visible pending/failed cleanup state instead of blocking the remove click.

## 2026-06-10 01:27 WITA - Fail Empty Runtime Streams Explicitly

- Problem: Hermes could return a valid `text/event-stream` that only contained status comments and an error payload, with no assistant text. The chat route then marked the session completed, and runtime-session recovery treated the synthetic empty assistant process shell as a real reply, so the thinking indicator disappeared with no visible answer.
- Change: Generic runtime streams now remember runtime error payloads and, when the stream ends with no text and no workspace summary, emit a `chat.error`, append an assistant-visible `Error: ...` message to the session, and finish the session as failed. Chat recovery no longer counts an empty assistant shell as a real assistant reply.
- Preserved behavior: Streams with actual text still complete normally. Streams that produce workspace changes but no text can still summarize the workspace change. Process/status comments remain visible in the process panel.
- Files: `src/app/api/chat/agent-runtime/route.ts`, `src/features/dashboard/DashboardApp.tsx`.
- Verification: Live HermesSovereign smoke against `http://127.0.0.1:5021/api/chat/agent-runtime` reproduced the empty Hermes API stream and now emitted a visible `chat.error` followed by `[DONE]` instead of silently completing with no assistant text. Focused lint passed with existing dashboard warnings only; focused TypeScript filtering returned no touched-file diagnostics.
- Watch next: If a runtime intentionally produces only tool/status events, it should send a final assistant summary or a structured tool result that the chat route can render, not just comments.

## 2026-06-10 00:40 WITA - Split Chat Open From The Full Dashboard Bundle

- Problem: Opening `/?view=chat` was blocked by the same root page bundle as every dashboard view. Live probes before the split showed `/?view=chat` timing out past 10s on the Next backend and `/_next/static/chunks/app/page.js` at about 18 MB, taking 9.4s to serve in dev.
- Change: `DashboardNativeFrame` now lazy-loads `DashboardApp`, so the root app page chunk can render without statically importing the entire dashboard. The ultra-early fallback uses the shared Hive route loader instead of a one-off dashboard spinner. `DashboardApp` also lazy-loads view/modal-only surfaces that were not needed for ordinary Chat open: Agents, Agent Settings, Skill Browser, Notifications, and the phone FAB.
- Preserved behavior: All dashboard views still route through `DashboardApp`; agent settings, skill browser, notifications, and phone controls load when opened or when their owning view is active.
- Tradeoff: The dashboard parent chunk is still large in dev because it owns shared state/controllers for every view. This change cuts the root page stall and removes obvious non-chat UI from the parent, but a deeper route-owned controller split is still the next step if cold Chat opens need to get under a tighter SLA.
- Files: `src/app/DashboardNativeFrame.tsx`, `src/features/dashboard/DashboardHiveLoader.tsx`, `src/features/dashboard/dashboard-display-helpers.tsx`, `src/features/dashboard/DashboardApp.tsx`.
- Verification: After rebuild, backend `/?view=chat` returned HTTP 200 instead of timing out; `app/page.js` dropped from about 18 MB to 335 KB. The dashboard parent chunk dropped from about 17 MB to 8.2 MB after moving modal/view-only surfaces behind dynamic imports. In-app browser on `http://127.0.0.1:5021/?view=chat` reached DOM in 286 ms and visible chat transcript in 1.63s on warm retest. Focused ESLint passed with existing dashboard warnings only, and `git diff --check` passed for touched files.
- Watch next: Do not reintroduce static `DashboardApp`, Agent Settings, Skill Browser, Agents, Notifications, or phone FAB imports into the root page path. Keep the early lazy fallback on the shared Hive loader instead of a one-off spinner. For further gains, split Chat into its own route-owned frame or extract non-chat controllers from `DashboardApp`.

## 2026-06-10 00:24 WITA - Skip Chat Session Polling Without A Session

- Problem: The chat view could poll `/api/chat/agent-session` even when the selected chat leaf had no runtime session id, no active stream, and no fresh active-run record. Telemetry showed repeated `sessionId: null` polls returning 404 `session not found`, sometimes after 13-54s, while the visible chat only contained a normal cached `hi` transcript.
- Change: Runtime-session recovery now exits before polling when there is no concrete session to recover and no fresh active run. The per-poll loop repeats the same guard so stale intervals do not keep issuing doomed 404s. Generic webview fetch failures from the chat send path now explain that the local chat runtime route/proxy was unreachable instead of rendering bare `Load failed`.
- Preserved behavior: Active streams, fresh active runs, explicit runtime-session leaves, and known session ids still use the recovery poller. Cached transcripts remain visible; this only skips invalid recovery requests that cannot produce a session.
- Files: `src/features/dashboard/DashboardApp.tsx`, `src/features/dashboard/hooks/use-status-chat-input-controller.tsx`.
- Verification: Telemetry around 2026-06-10 00:18-00:22 WITA showed repeated `chat.runtime.poll.start` and `chat.agent_session.request` events with `sessionId: null`, followed by 404 `session not found` and `chat.runtime.poll.failed` after 13-54s. Focused ESLint for the touched dashboard files passed with existing warnings only; focused TypeScript filtering returned no touched-file diagnostics; `git diff --check` passed for the touched files.
- Watch next: If runtime-session recovery misses a genuinely active run, check whether the send path is recording `chatRuntimeSessionIdsByKey` or active-run state before loosening this guard.

## 2026-06-09 23:25 WITA - Always Run Bounded Hive Capability Search

- Problem: The chat path could appear to skip Hive capability search when the fast preflight timed out before telemetry returned. That was especially bad for first-message local generation prompts, because the model could fall back to generic advice or a prompt blueprint instead of seeing capability-routing context.
- Change: Every non-empty user prompt attempts capability search under the existing 900ms preflight budget. Chat capability search passes `includeRuntimeProviders: false`, so the context index uses the cached shared-skill fast inventory instead of scanning all provider runtime skill folders before the first model token. Timeout or failure now produces an explicit runtime process event and injects fallback context that tells the model not to invent tool calls, app names, local image-generation execution, or success receipts.
- Preserved behavior: Empty requests still fail fast before chat dispatch, low-latency voice mode can still skip shared-brain memory and runtime image probing, and successful capability searches still inject ranked shared skill hits, connected-app observations, runtime image capability hints when available, API routes, tool schemas, runtime definitions, and query telemetry.
- Tradeoff: A prompt such as `hi` now pays the bounded capability-search attempt instead of skipping it. The SLA stays sub-second, and slow discovery degrades to fallback context instead of delaying the model start.
- Files: `src/lib/services/chat/task-retrieval-context.ts`, `src/lib/services/context-index.ts`, `src/app/api/chat/agent-runtime/route.ts`.
- Verification: Live `/api/context-index` smoke on `http://127.0.0.1:5021` for `q=image generation`, `providers=0`, `apps=0`, chat capability kinds, and `limit=8` improved from 4.794s before the fast shared-skill inventory patch to 0.435s on the next first run and 0.009s hot.
- Watch next: If all prompts feel slower, optimize `searchContextIndex` and connected-app caches rather than reintroducing prompt-based skips. The invariant is: normal chat turns should always attempt Hive capability search and surface timeout/failure truthfully.

## 2026-06-09 23:20 WITA - Long Image Generation Dev Proxy Timeout

- Problem: The Tauri/Next dev proxy could still return `HivemindOS dev server is warming up` for slow chat-adjacent generation APIs, especially `/api/chat/image-generation`, hiding whether the backend timed out, restarted, or was blocked behind compilation.
- Change: `/api/chat/image-generation` now gets a 4 minute proxy budget. API proxy fallbacks return structured JSON with the exact path, timeout, and `DEV_PROXY_TIMEOUT` or `DEV_PROXY_UNAVAILABLE` instead of the generic warmup string.
- Preserved behavior: HTML navigations still receive the loading shell, and the dev-ready probe keeps its tiny `warming` response. Normal APIs still use the default 60s budget unless they opt into a longer route-specific timeout.
- Files: `scripts/tauri-next-dev.mjs`.
- Verification: Focused syntax/lint checks were run for the Tauri dev proxy.
- Watch next: If more long-running generation categories are added under `/api/chat/`, give them explicit budgets and avoid generic text fallbacks that look like model/runtime errors.

## 2026-06-09 23:06 WITA - Remove Zero-Query Capability Search Events

- Problem: The runtime process panel displayed a `Hive capability search` event with `0 retrieval hits; 0 queries; connected apps unavailable`, which made optimized-away retrieval look like a failed search.
- Change: The zero-query event was removed, then superseded by the 23:25 WITA optimization: normal non-empty chat prompts now attempt a bounded capability search and show either retrieval telemetry or explicit timeout/failure.
- Preserved behavior: Internal route telemetry still records timeout/failure details; injected/task prompts continue to show capability-search process output when retrieval runs.
- Files: `src/app/api/chat/agent-runtime/route.ts`.
- Verification: Focused ESLint and TypeScript checks were run for the chat runtime route.
- Watch next: Do not reintroduce 0-query process events. If a search does not complete, show a timeout/failure event instead.

## 2026-06-09 22:51 WITA - Bound Obsidian Discovery Lookups

- Problem: Obsidian-backed dashboard lookups could trigger broad filesystem scans during ordinary refreshes. Shared-skill discovery previously walked about 1,180 `SKILL.md` files, and provider discovery found 476 provider skills before caching.
- Change: Recent-directory suggestions, skill inventory reads, remote skill provider discovery, and runtime chat-session fallback now use bounded lookup paths, cached summaries, short provider budgets, and newest-relevant session candidates instead of broad vault/session walks.
- Preserved behavior: Full Obsidian data can still load through explicit or mutating flows; normal dashboard refreshes use fast summaries and bounded candidates.
- Files: `src/lib/services/obsidian/recent-directories.ts`, `src/app/api/obsidian/recent-directories/route.ts`, `src/app/api/obsidian/skills/route.ts`, `src/lib/services/fleet/remote-skill-providers.ts`, `src/features/dashboard/hooks/use-dashboard-polling-effects.tsx`, `src/app/api/chat/agent-runtime/route.ts`.
- Verification: Focused ESLint passed with existing hook warnings. Focused TypeScript diagnostic filtering returned no touched-file diagnostics. Standalone benchmarking showed provider root discovery around 1.0s before caching and bounded runtime chat-session fallback around 259ms.
- Watch next: Do not reintroduce recursive vault or runtime-session scans into normal dashboard load. Keep broad discovery behind explicit refresh, setup, or mutating actions.

## 2026-06-09 22:48 WITA - Warm Bee Lottie For Chat

- Problem: The first chat thinking indicator could pay the cold asset fetch/parse path for the Honey bee Lottie animation.
- Change: App startup preloads the bee animation with a tiny client preloader, and the shared Lottie player keeps a single in-memory `ArrayBuffer` cache per source, so repeated bee animations can load from warmed data.
- Preserved behavior: Visual animation remains the same; this only removes repeated/cold loading work.
- Files: `src/components/ui/lottie-asset-cache.ts`, `src/components/ui/lottie-asset-preloader.tsx`, `src/components/ui/lottie-player.tsx`, `src/app/layout.tsx`.
- Verification: Focused ESLint passed for the touched files. Focused TypeScript diagnostic filtering returned no touched-file diagnostics. `git diff --check` passed for the touched files, changelog, and assimilation logs. Browser smoke on the existing 5022 dev server loaded the chat route with the Honey bee preload link present, and `curl -I` returned HTTP 200 for the `.lottie` asset.
- Watch next: If startup becomes asset-heavy, keep preloads limited to assets that actually appear during common first interactions.

## 2026-06-09 22:40 WITA - Load Dashboard Fleet From Cache First

- Problem: The Agents/Fleet dashboard could fire heavy background routes on load: `/api/fleet/discover`, `/api/fleet/snapshot`, `/api/syncthing/status`, and `/api/miroshark/status`. Some probes took 3-30s and could make the dashboard feel blocked or unreliable.
- Change: The dashboard paints persisted fleet machines and activity snapshots first, then refreshes expensive fleet discovery, snapshots, Syncthing health, app version, hosted apps, and MiroShark status after the UI is usable. Passive fleet discovery uses `stale=1` stale-while-revalidate; snapshot polling is request-keyed single-flight and scoped to Agents/Chat; Syncthing status has server-side cache and in-flight dedupe.
- Add-agent behavior: New agents appear immediately in local dashboard state and on their machine row, then run a targeted one-agent `/api/fleet/snapshot` refresh instead of requiring full fleet rediscovery.
- Preserved behavior: Manual refresh and setup flows can still force fresh probes. Passive loads may briefly show last-known data while the background refresh updates the UI.
- Files: `src/features/dashboard/DashboardApp.tsx`, `src/features/dashboard/hooks/use-agent-controller.tsx`, `src/app/api/fleet/discover/route.ts`, `src/app/api/syncthing/status/route.ts`.
- Verification: Focused ESLint passed with existing warnings only. `git diff --check` passed. Assimilation manifest verified. Live smoke on existing `http://127.0.0.1:5021` returned fleet discovery HTTP 200 with 5-6 machines; Syncthing second cached read returned in 22ms; in-app browser rendered the Agents/Fleet dashboard with no console errors after dev-server settling.
- Watch next: The server-side fleet route can still take seconds when no process cache is hot or while background refresh is active. The user-facing win depends on persisted dashboard-state hydration, so keep `hivemindos.discoveredMachines.v1` and `hivemindos.fleetSnapshots.v1` write-through intact.

## 2026-06-09 22:42 WITA - Fast Injected Chat Context

- Problem: Injected chat scenarios were slow because capability search could block on live connected-app discovery and repeatedly rebuild the same lightweight context index. The full shared-vault prompt also injected a long operating manual into local model chats.
- Change: Connected-app capability lookup now uses stale-while-revalidate caching with a 250ms cold budget. The context index caches connected-app scoped capability builds by app signature. The shared-vault contract is compressed into a dense operational summary.
- Preserved context: Capability hits, connected app/app endpoint hints, runtime image-generation routing, shared-vault paths, memory/Kanban/Queen Bee/notification rules, and safety constraints remain available.
- Avoided behavior: Non-tool local models are told to treat injected hits as retrieved context and answer directly instead of emitting fake tool-call markup.
- Files: `src/lib/services/chat/task-retrieval-context.ts`, `src/lib/services/context-index.ts`, `src/lib/services/chat/shared-vault-context.ts`, `src/app/api/chat/agent-runtime/route.ts`.
- Verification: Focused ESLint passed with existing dashboard warnings only. Focused TypeScript filtering returned no touched-file diagnostics. `git diff --check` passed.
- Watch next: If agents need real tool execution from OpenAI-compatible local models, add an explicit tool bridge instead of prompting models to invent calls.

## 2026-06-09 22:36 WITA - Prioritize Active Chat Over Dashboard Polling

- Problem: User-visible chat stalls were mostly Next.js/dev-server contention, not LM Studio. A stalled route showed 64s total with about 60s in Next.js and 4.1s in app/model code while background routes were running.
- Change: Non-chat dashboard polling pauses while an active chat stream is in flight. This reduces competition from Fleet snapshots/apps/discovery, app version checks, MiroShark status, notifications, recent directories, Kanban refreshes, and related dashboard maintenance.
- Preserved behavior: Polling resumes after chat finishes; this only protects the critical chat path.
- Files: `src/features/dashboard/DashboardApp.tsx`, `src/features/dashboard/hooks/use-dashboard-polling-effects.tsx`.
- Verification: Server logs showed LM Studio idle with `queued: 0` during stalls; focused ESLint/TypeScript checks passed with existing dashboard warnings only.
- Watch next: If dashboard state saves still flood during chat, add a separate debounce or chat-aware pause for dashboard persistence.

## 2026-06-09 22:23 WITA - Bounded Chat Capability Preflight

- Problem: Capability search, runtime capability probing, and shared-brain recall could hold up model dispatch before the first token.
- Change: Chat preflight is best-effort with sub-second budgets. Runtime capability probing, capability search, and memory recall now report timeout/failure telemetry instead of blocking indefinitely.
- Preserved context: When fast enough, capability search and shared-brain memory are still injected. On timeout, chat proceeds with safe fallback context.
- Files: `src/app/api/chat/agent-runtime/route.ts`, `src/lib/services/chat/task-retrieval-context.ts`, `src/lib/services/context-index.ts`.
- Verification: Raw LM Studio `hi` returned in about 1.9s. A normal hot Hivemind route smoke previously hit about 3.2s before later dev-server contention was identified.
- Watch next: Treat direct API smokes as app-path checks only; compare with browser/UI timing and server log splits before declaring latency fixed.

## 2026-06-09 22:14 WITA - Fast Recent Directory Loading

- Problem: Recent folder suggestions could hit a 60s dev proxy timeout because the API recursively walked the whole Obsidian vault looking for Kanban boards.
- Change: Recent directory discovery reads saved recents, configured Work Board files, and known legacy project Kanban files directly. The dashboard passes the configured Kanban folder to the API.
- Files: `src/lib/services/obsidian/recent-directories.ts`, `src/app/api/obsidian/recent-directories/route.ts`, `src/features/dashboard/hooks/use-miroshark-brain-controller.tsx`.
- Verification: Focused lint/type checks passed for touched files. Hot recent-directory response improved to sub-second after dev recompilation settled.
- Watch next: Keep directory discovery bounded. Do not reintroduce unbounded vault walks for picker suggestions.

## 2026-06-09 22:09 WITA - Stop Parallel Chat Session Polling

- Problem: The UI polled runtime sessions every five seconds while the primary streaming chat request was already active, creating confusing late process updates and extra request pressure.
- Change: Normal chat relies on the runtime SSE stream. Runtime-session reads are reserved for recovery after a real stream stall.
- Files: `src/features/dashboard/hooks/use-status-chat-input-controller.tsx`.
- Verification: Focused ESLint/TypeScript filtering passed with existing hook warnings only.
- Watch next: If process events disappear during a real stream, debug the SSE event flow before restoring interval polling.

## 2026-06-09 22:09 WITA - Long Chat Dev Proxy Timeout

- Problem: The Tauri/Next dev proxy returned `HivemindOS dev server is warming up` at the generic 60s API timeout even while a local model request was still alive.
- Change: `/api/chat/agent-runtime` now gets an 11 minute proxy budget matching long-running local model chats.
- Files: `scripts/tauri-next-dev.mjs`.
- Verification: `node --check scripts/tauri-next-dev.mjs` passed.
- Watch next: This does not make slow requests faster; it prevents a false dev-proxy failure while the real request is still running.

## 2026-06-09 21:54 WITA - Start LM Studio Server For Local Chat

- Problem: LM Studio could show a model loaded while its OpenAI-compatible server was off, causing local chat fetches to fail at `127.0.0.1:1234`.
- Change: For local LM Studio-backed OpenAI-compatible profiles, HivemindOS starts `lms server start --port <port> --bind 127.0.0.1` after a connection failure, then retries the same chat request.
- Files: `src/app/api/chat/agent-runtime/route.ts`.
- Verification: Live route smoke started the LM Studio server, brought `/v1/models` online with `swarm-sovereign-26b`, and streamed a successful response.
- Watch next: Keep this limited to local LM Studio profiles. Remote loopback routing should go through the collector proxy.

## 2026-06-09 21:36 WITA - Trust LM Studio Loaded Models In Fleet Status

- Problem: Fleet marked LM Studio agents failed when `/v1/models` was down, even though Agent Settings and LM Studio Remote showed the target model loaded.
- Change: Fleet snapshot health checks now prefer the LM Studio inventory source used by Agent Settings before falling back to the classic OpenAI-compatible `/v1/models` probe.
- Files: `src/app/api/fleet/snapshot/route.ts`.
- Verification: Direct fleet snapshot POST returned `runtimeReachable: true` for SwarmSovereign with the loaded-model summary.
- Watch next: Status and chat dispatch are distinct. Loaded model status does not guarantee the OpenAI-compatible server is listening.

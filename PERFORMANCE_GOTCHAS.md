# Performance Gotchas

Internal, dev-only reference. **Not user-facing** — do not publish under `docs/`.

This file is the "these will bite you" quick-reference: a curated list of
performance traps in HivemindOS, written **symptom → why it fools you → root
cause → fix → how to diagnose it again**. It exists so a trap that took days to
find the first time takes minutes the next time.

Relationship to the other perf docs:

- **This file** — durable, curated traps and their diagnosis recipes. Read it
  *first* when something is mysteriously slow. Entries are kept current, not
  chronological; update an entry in place when you learn more.
- **`OPTIMIZATIONS.md`** — the chronological engineering log of specific
  optimization *changes* (bottleneck, files, verification, tradeoffs). Every
  perf change still gets an entry there.
- **`CHANGELOG.md`** — release-facing record of what shipped.

When you fix a new class of perf bug, add a gotcha here *and* an `OPTIMIZATIONS.md`
entry for the specific change.

---

## G1 — Tauri desktop feels laggy in `tauri dev`, but the browser and packaged build are fast

**This is the one that cost the most time. Read this before re-debugging desktop lag.**

### Symptom

- Every interaction in the `pnpm tauri:dev` window (opening a modal, switching
  views, opening a route) has a visible delay between click and response.
- The **exact same dashboard** loaded in Chrome at `localhost:5021` is fast.
- The **packaged/release** desktop build is fast.
- Only dev-mode × the native WKWebView window is slow.
- A Safari Web Inspector Timeline of the real WKWebView shows low script/layout
  (~8% / ~6%) and a large amount of "unaccounted" frame time; frames of
  130–200ms (≈5–7fps) with occasional 4–8 second stalls.

### Why it fools you (dead-ends that look right but aren't)

Every one of these was chased and **disproven on-device** — don't repeat them:

- **"It's machine contention"** (too many dev servers / swap / `fseventsd`).
  Reducing load helped nothing. The built app on the same loaded box is fast.
- **"It's window transparency forcing a non-opaque compositing layer."** The
  strongest source-confirmed theory (`wry` sets `drawsBackground=NO` when the
  window is transparent). Made the window fully opaque, rebuilt, verified in the
  binary — **no change.**
- **"It's CSS paint effects"** (`backdrop-filter`, `box-shadow`, `filter`).
  Force-disabled all of them on-device — no change.
- **"It's React re-renders / missing memo."** A Chromium/Playwright longtask
  profile of the same dev URL showed ~0ms main-thread block per interaction
  (modals 0ms, kanban 88ms peak). The JS is not the problem.
- **"WKWebView just composites slowly and there's no fix."** Wrong read of the
  Timeline. The "unaccounted frame time" was **not WebKit painting** — it was the
  UI process's main thread *blocked*, and WKWebView can neither composite nor
  handle input while that thread is busy.

### Root cause

`wry` delivers **synchronous Tauri command invokes on the UI-process main
thread**, and serializes their responses there too. The call chain (visible in a
`sample` of the app):

```
WebKit startURLSchemeTask → tauri ipc::protocol::get → run_invoke_handler
    → <your #[tauri::command] fn> → serde_json serialize response   ← all on main thread
```

The dashboard persists a "remembered UI value" via the `dashboard_state_write`
command on essentially every interaction (and on every fleet-snapshot poll).
That command was reading, parsing, cloning, and rewriting a **33.5 MB**
`~/.hivemindos/dashboard-state.json`, then serializing the *entire store again*
as an IPC response the caller never reads — in an `opt-level=0` **debug** binary.

`sample` of the pre-fix app during a light 10s probe: **904 of 7,476 main-thread
samples were inside `serde_json`.** WKWebView input events and layer-tree commits
queue behind that same thread → the 130–200ms frames and multi-second stalls.

Two independent reasons it only reproduced in dev × WKWebView:

- **Browser is a separate process.** In Chrome, `dashboard-state` uses the HTTP
  route in a different process, so it never blocks the render thread.
- **Release hides the cost.** The packaged build compiles at `opt-level=3`, so
  the same serialization is fast enough not to stall a frame.

And the 33 MB store was itself a **data leak**: `hivemindos.fleetSnapshots.v1`
had accumulated **2,822 never-evicted ephemeral per-PID hermes agents** (30.6 MB),
because the fleet-snapshot merge only ever adds entries.

### The fix (three parts)

1. **Stop the store from growing unbounded.**
   `compactFleetSnapshotsForPersist` in
   `src/features/dashboard/dashboard-storage.ts` caps the *persisted* fleet
   snapshots to the 128 most-recently-checked agents (the in-session map stays
   complete). Store self-healed on the first persist: **33.5 MB → 1.7 MB**.
2. **Get the work off the main thread.**
   `dashboard_state_read` / `dashboard_state_write` in
   `src-tauri/src/dashboard_state.rs` are now `async` (they run on the tokio
   runtime, not the UI thread), and the write response no longer echoes the whole
   store — the only caller reads just `ok`.
3. **Don't ship a slow debug binary.**
   `src-tauri/Cargo.toml` adds `[profile.dev.package."*"] opt-level = 2` so dev
   builds optimize dependencies (serde_json / tauri / wry) while the app crate
   stays unoptimized for fast iteration.

Post-fix `sample`: **0 `serde_json`/`dashboard_state` frames on the main thread**;
those frames now appear on `tokio-rt-worker` threads.

### Diagnosis recipe (do this FIRST next time desktop is laggy)

1. Find the running app PID:
   `ps aux | grep "debug/HivemindOS.app/Contents/MacOS/HivemindOS"`
   (the real app is the high-RSS one, not the tiny `dev-disclaim-launch` wrapper).
2. `sample <pid> 10 -file /tmp/app.txt` **while you interact** with the window.
3. Open the file, find the `com.apple.main-thread` block, and look at what it's
   *doing* rather than waiting in. If you see `serde_json`, your own Rust code,
   or `tauri::ipc` frames on the **main thread**, an invoke handler is blocking
   the UI. A healthy main thread is parked in kernel waits (`mach_msg2_trap`,
   `__psynch_cvwait`, `kevent`).
4. Check the sizes of anything an invoke touches:
   `ls -la ~/.hivemindos/dashboard-state.json` and, if large, break down the keys
   (each write rewrites the **whole** store, so one fat key taxes every save).

### General rules this taught us

- **Keep `#[tauri::command]` handlers tiny, or make them `async`.** `wry`
  delivers sync commands on the UI-process main thread; anything expensive there
  stalls WKWebView input and compositing. `async` moves it to the tokio runtime.
- **Never echo large state back in an invoke response.** The response is
  serialized on the main thread too. Return the minimum the caller reads.
- **Any unbounded value in the `dashboard-state` KV is a whole-app tax**, because
  every write reads+rewrites the entire store. Cap what you persist; keep the
  full data in memory if you need it.
- **For "dev-only, WKWebView-only" slowness, `sample` the app process before
  theorizing about paint, transparency, or React.** WKWebView stalls when the UI
  process main thread is busy — the profile points straight at the culprit.
- **`opt-level=0` debug binaries can make a real hot path 10–50× slower.** If a
  cost only shows up in `tauri dev` and vanishes in release, suspect
  debug-unoptimized dependencies before concluding the architecture is at fault.

### The same trap in a small setup app

The standalone HivemindOS Link window hit this class of failure in July 2026.
Its JavaScript requested `native_setup_status` every 1.8 seconds, while that
synchronous Tauri command scanned runtime paths, probed the collector port
range, and read Link status with socket timeouts. Setup continued in a hidden
child process, but overlapping UI-thread invokes made Windows report the window
as “Not Responding.” The durable fix is two-sided: make the native command
`async` and move its blocking checks through `spawn_blocking`, then keep the
frontend poll single-flight so slow probes cannot queue. A spinner or longer
poll interval alone only hides the same blocked-main-thread bug.

On Windows, validate the service launch context separately from task
registration success. Embedded Tailscale starts far enough to create state and
logs under an S4U task, then exits because the non-interactive token cannot read
the user's policy store. Register Link with `LogonType Interactive` and start
that registered task immediately; launching a replacement child from a
headless setup process recreates the same denial even though the task itself is
configured correctly.

### Where it's written up

- `OPTIMIZATIONS.md` — the change entry (files, verification, tradeoffs).
- `CHANGELOG.md` — the release-facing entry.
- Fixed 2026-07-16.

## G2 - A cached agent request can still be slow, and the selected-model label can be false

### Symptom

An agent or Queen Bee takes 10-40 seconds, may never call the requested tool, and the UI says a specific provider/model is selected. Adding a cache key does not obviously fix it.

### What to measure before tuning

1. Record the upstream `model` field, not the configured label. A runtime bridge may accept `model` in its body but still use machine-wide config internally.
2. Count model iterations and aggregate prompt tokens. One 33K-token prompt sent three times is a 100K-token turn even if each individual request is cached well.
3. Separate first byte, first visible content, prompt/input tokens, cached input tokens, output tokens, and reasoning tokens. Prompt caching only reduces repeated prefix ingestion; it does not remove tool round trips or generated reasoning.
4. Confirm the requested tool actually ran. A slow planning response that merely says it will fetch something is not tool latency.

### HivemindOS case

The July 2026 latest-X failure had all four traps: Hermes ignored the request-level xAI provider/model override, a random first system marker forced a new session/cache prefix, the agent made several huge model turns, and one 11.3-second response never called X at all. The fix was to route xAI OAuth directly, remove the random prefix, preserve upstream model/cache telemetry, and bypass inference for the deterministic signed-in timeline read.

### Cache-read interpretation

- A cache write is not a cache read and still processes the full prefix.
- Provider cache publication may be asynchronous; an immediate second request can miss while a later one hits.
- Static instructions/tools belong first; volatile retrieval, screen state, history tails, and the latest user message belong afterward.
- A high cache percentage can coexist with visible latency. In the fixed Queen voice path, 98.0% of input tokens were cached, but Grok 4.5 still generated 214-449 hidden reasoning tokens and took 2.38-4.09 seconds.
- For deterministic authenticated reads, the fastest safe model call is no model call. Use the exact API/account credential and return the verified resource.

### Current evidence surfaces

- Queen typed terminal frames expose `servedModel` and provider `usage`.
- `queen_chat.turn` telemetry records served model and cached prompt tokens.
- `queen_voice.inference` telemetry records requested/served model, input/cached/output/reasoning tokens, and provider elapsed time.
- `scripts/benchmark-xai-oauth-queen-cache.mjs` gives repeatable salted-miss, cache-write, and cache-read measurements without printing credentials.
- Fixed 2026-07-10.

## G3 - A tab can look like one load while serializing several unrelated products

### Symptom

The Trade nav highlights and its header appears, but the route stays on a skeleton
for 10-25 seconds before the default Crypto desk becomes usable. Individual API
routes look merely slow rather than catastrophic when timed alone.

### Why it fools you

- The HTML/dashboard shell is fast; the delay begins after the lazy client panel mounts.
- `Promise.all` can appear in the code while the overall pipeline is still serial:
  balance/capabilities → crypto market → stock readiness/portfolio → stock history/movers → activity.
- A wallet-picker refresh looks independent, but refreshing every wallet at mount
  competes with and duplicates the acting-wallet read that owns the visible screen.
- The default Crypto UI and the hidden Stocks segment shared one `loading` flag, so
  valid crypto data remained invisible until unrelated Alpaca work finished.

### Root cause and fix

Treat the selected/default product surface as the critical path. On Trade, publish
the acting wallet's persisted token snapshot with current market rows first, keep
the live acting-wallet RPC scan visibly syncing, and defer Stock/activity work with
separate loading flags. Do not refresh non-acting picker wallets during route entry;
refresh a wallet when it becomes the acting wallet. When that live refresh succeeds,
write the new snapshot back to the personal-wallet ledger after painting it; otherwise
every later stale-while-revalidate mount starts from the same stale value. Warm the
Trade chunk during dashboard idle time so dev compilation does not land on the first click.

### Diagnosis recipe

1. Time shell visibility and first usable content separately through the real nav click.
2. Count mount-time requests by resource/entity, not only by endpoint; duplicate
   calls to the same balance route can hide a fan-out across many wallets.
3. Write the await graph in waves. Anything needed only by a hidden segment must
   not gate the default segment.
4. Time the slow leaves with authenticated read-only probes, then retest the UI.
   For the July 2026 case: acting balance 4.19s, crypto market 1.00s, readiness
   0.84s, stock movers 1.30s, but the combined UI baseline was 19.5-24.4s.
5. Guard the scheduling contract. `scripts/test-trade-route-performance.mjs`
   prevents the all-wallet fan-out and monolithic loading gate from returning.

### Fixed evidence

The real repeat Chat → Trade path improved from 19.5s to usable content to
3.12-4.43s (77-84% faster). The saved holdings render first with `Syncing…`; the authoritative
live holdings and deferred Stock/activity data replace them afterward. Fixed
2026-07-10.

## G4 - Parallel retrieval queries can duplicate the corpus, not just the ranking

### Symptom

The runtime reports `capability search timed out after 2500ms before returning retrieval telemetry` on a multi-intent prompt, while the same search is fast after the first turn. Raising the timeout reduces false alarms but does not remove the cold-work spike.

### Why it fools you

The query fan-out uses `Promise.all`, and the filesystem source cache coalesces cold source builds. That makes the code look parallel and cached. But if each query calls the top-level search API, every branch can still repeat the per-request half: app preferences, shared-env connection checks, Hive action/connector/runtime creation, connected-app endpoint expansion, artifact discovery, authorization, and index assembly.

### Root cause and fix

Separate corpus construction from ranking. Build and authorize one complete point-in-time `ContextIndex`, then score the full-task and intent-specific queries independently against that snapshot. Preserve per-query limits, labels, priority boosts, deduplication, and downstream agent reranking. Do not optimize by dropping capability kinds or reducing the shared skill/app inventory.

### Diagnosis recipe

1. Count targeted queries from task retrieval telemetry.
2. Benchmark a realistic connected-app inventory, not an empty `apps=0` index.
3. Record corpus totals before and after; identical totals prove the latency win did not strip capabilities.
4. Compare fresh processes because Next dev recompiles/restarts reset in-memory source caches.
5. If one-corpus batching is still slow, time source groups independently (`tool-schema`/`connector` reads are often dominated by shared-env process startup) before adding another timeout increase.

### Fixed evidence

The exact reported three-query workload over 1,237 indexed items improved from a fresh-process median of 577.5 ms to 296.1 ms, while retaining all 559 skills, 104 tool schemas, 349 API routes, 33 apps, 149 app endpoints, 17 connectors, 16 artifacts, and 10 runtimes. Fixed 2026-07-12.

## G5 - A typed chat FAB can silently enter the voice and fleet-permission pipelines

### Symptom

A simple local Brain question takes 20-40 seconds, shows no partial text, and finally asks for authorization even though the user is already on the Brain route and the requested data is local and read-only.

### Why it fools you

- The visible composer is typed, but an open voice overlay can change which backend route receives the message.
- The voice request can omit the page's `screenContext`, so the server no longer knows the prompt came from Brain.
- A generic capability tool name sounds able to read Brain data, yet its executor may enter the full fleet-agent runtime and correctly apply a remote `sharedBrain: ask` policy.
- Sequential provider fallbacks hide the routing flaw: a 20-second primary timeout plus a 16-second fallback looks like model slowness, while the eventual permission copy looks intentional.

### Root cause and fix

Trace the UI event through the actual route, tool set, executor, and permission matrix. Typed text must stay on the typed, context-preserving model/tool loop; voice activation may add speech after the reply but must not swap inference routes. Local Brain reads should expose neutral evidence through a dedicated model-callable tool. The configured Queen model chooses the tool and authors the answer; the evidence service must not manufacture final prose. Keep fleet authorization for actual remote access instead of weakening the policy to compensate for a misrouted local request.

For access-history questions, let `read_hivemind_context` retrieve the complete access log, rank recorded paths, verify current note existence, and return that as evidence. A request to read the user's own local Brain is itself authorization for that read; only a tool-reported remote, mutating, or consequential operation may ask again. If the model chooses the broad capability tool for a read-only local Brain question, route that tool execution to the same local evidence source and continue the model loop instead of entering the fleet runtime.

### Diagnosis recipe

1. Locate the click/send handler and record the exact API path selected under every UI mode flag.
2. Confirm `screenContext` survives the selected request body.
3. List the tools actually offered by that provider path and trace each executor; do not infer behavior from tool names.
4. Read turn telemetry by stage: route receipt, first visible token, each provider attempt, fallback, tool call, and final response.
5. Reproduce through the same visible FAB, then probe the dedicated read API and spoken endpoint separately.
6. Prove the first configured-model round calls `read_hivemind_context`, prove the access API returns evidence without an `answer`, and prove the following configured-model round writes the visible response.

### Fixed evidence

The reported turn took 37.672 seconds, with no visible text until 37.548 seconds, a 20.003-second xAI timeout, and a 16.284-second OpenRouter fallback. After separating typed routing and grounding the configured model with a local evidence tool, the final real Brain FAB took about 7.1 seconds. The configured `grok-4.5 · xai-oauth` first round called `read_hivemind_context` in 1.263 seconds, the evidence-only local API took 79 ms, and the configured-model prose round took 1.534 seconds. The visible answer was model-authored, correct, and contained no permission request. The fleet `sharedBrain: ask` policy remains unchanged for genuine remote access. Fixed 2026-07-15.

## G6 - Hermes looks busy for minutes, then the whole answer appears at once

### Symptom

Adaptive chat shows capability search and periodic “still working” keepalives, but no model text or tool updates. When Hermes exits, the complete answer appears in one batch. Relaying stdout directly may instead expose `review diff` frames as assistant messages.

### Why it fools you

- A healthy SSE connection and keepalives prove only that the HTTP route is alive; they do not prove model deltas are reaching it.
- `hermes chat -Q` sounds like “quiet decorations,” but Hermes's quiet single-query path explicitly sets `stream_delta_callback = None` and prints the final response once.
- A scoped Hermes profile can omit `display.streaming`, even when the global profile enables it.
- Normal CLI stdout is not an assistant channel: it mixes banners, status, terminal boxes, inline diffs, and final prose.

### Root cause and fix

Do not choose between raw stdout streaming and exit-only buffering. Launch scoped Hermes through the HivemindOS stream bridge, which enables Hermes's native model callback, disables inline diffs, preserves Markdown, and emits prefixed JSON lines for assistant deltas, response boundaries, and safe tool lifecycle names. The collector must ignore every unmarked stdout line and reconcile the active final segment with Hermes `state.db` only at exit. When a later model response follows tools, reset the earlier draft into process history before streaming the final segment.

### Diagnosis recipe

1. Confirm whether the collector chose gateway or scoped CLI (`X-Hermes-Stream-Source`).
2. Inspect the exact CLI invocation. If it includes `-Q`, native model streaming is disabled regardless of the profile's display config.
3. Compare first SSE byte, first assistant delta, first tool event, and process exit time. Keepalives are a separate measurement.
4. Run the hermetic collector regression; it deliberately delays segments and prints a fake diff so timing and output separation are both observable.
5. Run a live short model marker and a forced safe tool call through the collector. Require multiple deltas or an early tool event before completion, not merely a correct final DB message.

### Fixed evidence

The live Adaptive profile emitted `STREAM_BRIDGE_OK` in three deltas. The running collector emitted `COLLECTOR_STREAM_OK` in three deltas; a real terminal-tool turn emitted `generating`, `started`, and `completed` before the final `TOOL_STREAM_OK`. The hermetic entry-path regression proves interim text precedes the delayed final segment and unmarked diff/noisy stdout never enters chat. Fixed 2026-07-18.

## G7 - A fast queue poll can become continuous durable-state churn

### Symptom

An idle background queue appears cheap in CPU profiles, but its runtime JSON and rotated backups receive writes every few seconds. Disk activity grows with queue/history size, and a far-future scheduled item still produces provider authentication traffic long before it can run.

### Why it fools you

- The poll body does “nothing” functionally, but entering a generic read-modify-write helper still commits the unchanged array.
- Updating a heartbeat looks like a tiny write, while the store atomically serializes and rotates the complete durable overlay.
- A final readiness check is correctly fail-closed, but calling it before every provider probe can perform expensive next-awake-time searches even when only a boolean is needed.
- Unit tests usually assert that nothing posted; they do not assert that the file or provider call count stayed unchanged.

### Root cause and fix

Split read-only preflight from mutation. Mutate only when a stale delivery actually exists, coalesce non-consequential durable heartbeats, and keep post/recovery/error writes immediate. Apply schedule, cancel-window, auto-opt-in, and awake-hours gates before live provider probes. Let the engine request boolean readiness without calculating the next awake instant; keep the detailed calculation for surfaces that display it.

### Diagnosis recipe

1. Snapshot the runtime file bytes and backup mtimes, run an idle tick, and compare them.
2. Count provider probe calls for a post scheduled well in the future and for one outside awake hours.
3. Distinguish the in-memory wake interval from the durable heartbeat interval; cancellation responsiveness depends on the former, not continuous disk writes.
4. Re-run the stale-`posting` crash-recovery test to ensure write suppression did not suppress consequential recovery.

### Fixed evidence

The Socials regression schedules future work, proves zero early connection probes and sends, then runs a second sub-minute idle tick and verifies `socials-runtime.json` is byte-for-byte unchanged. The worker still wakes every five seconds, persists idle liveness at most once per minute, and immediately writes every delivery, recovery, and error transition. Fixed 2026-07-20.

For producers attached to the same loop, gate on a small durable next-run receipt before loading queues, shared credentials, source webpages/files, or models. Persist bounded failure backoff and capacity deferral. In development, version the `globalThis` runner itself: Next HMR retains old loop closures, and an old writer can otherwise keep serializing a stale store schema after new code loads. The Socials drafter now retires mismatched runner versions and reconstructs a missing drafting receipt from queue-item provenance, preventing duplicate packs after HMR. Fixed 2026-07-20.

## G8 - Social search is marked supported, but the drafting queue never contains comments

### Symptom

The Socials account shows `search: supported`, `reply: limited`, and a healthy drafting worker. Standalone suggestions appear, but hours of ticks produce no reply or quote suggestions and there is no source post to review.

### Why it fools you

- A capability matrix can accurately describe what the provider or installed tools can do without proving that the autonomous producer actually invokes that capability.
- An `x-account` context source can look like live discovery even when the drafting context deliberately treats it as an identity cue and performs no read.
- The selected voice may name reviewed engagement targets in `MEMORY.md`, but a single total character budget can be exhausted by earlier `SKILL`, `SOUL`, `STYLE`, and example files before memory is loaded.
- A hot-reloaded development runner can retain the old producer closure after the source and durable schema have changed.

### Root cause and fix

Trace the actual producer call chain from delivery tick or button through policy selection, context load, search execution, ranking, model drafting, queue validation, and rendered target preview. Capability labels are not executable adapters. Give live discovery a concrete read-only backend, keep its request and candidate set bounded, store exact public target provenance, deduplicate by target and kind across all queue history, and force replies/quotes through per-item review even if standalone posts use auto mode. Budget layered voice files fairly so reviewed memory targets remain present, and bump both the durable overlay and retained runner schema when the producer contract changes.

### Diagnosis recipe

1. Inspect the generated queue records. If they have only `kind: post`, the producer never reached engagement generation.
2. Call the local X backend's status and one search through the same process entry path the app uses; a UI capability badge is not evidence of authentication.
3. Inspect the final bounded drafting context and confirm `MEMORY.md` plus its engagement-target line survived.
4. Run a forced engagement-only cycle and require source-linked `replyTo` or `quoteOf` records, not just model prose.
5. Verify the browser renders the full target and an exact `x.com/<author>/status/<id>` link, then verify no item has an approval record until the reviewer acts.

### Fixed evidence

The focused regression starts red with no discovery module, then proves explicit context targets precede voice-memory targets; self, stale, reposted, previously seen, and duplicate posts are rejected; Luna receives bounded live candidates; and two replies plus one quote retain exact target snapshots. Store/service tests prove target tampering fails closed, repeated targets are suppressed across queue history, editing cannot silently retarget copy, and auto-mode accounts still receive engagement as unapproved suggestions. Fixed 2026-07-20.

## G9 - A broken optional desktop integration can leave a blank window at startup

### Symptom

The macOS window opens but remains entirely white. The embedded dashboard server
is healthy and returns HTTP 200, yet the WebView never paints the application.
Tailscale can simultaneously show `Connecting`, and repeated
`tailscale status --json` processes remain alive indefinitely.

### Why it fools you

- A healthy embedded HTTP server makes the blank window look like a frontend
  hydration or routing failure.
- The Tailscale CLI normally returns quickly, so an unbounded fallback looks
  harmless in code review.
- macOS can report the Tailscale system extension as activated and enabled while
  its Network Extension session is still wedged in `Connecting`.
- Multiple macOS Tailscale variants can coexist: the connected VPN service can
  belong to one bundle while `/usr/local/bin/tailscale` launches another. A
  generic “some Tailscale service exists” check can then reopen the wrong app
  and trigger macOS's “Add VPN Configurations” prompt.
- KeepAlive helpers can recreate the symptom after the desktop closes. The
  HiveDrop watcher, collector identity/mDNS, Fleet watchdog, app discovery,
  bridge repair, and env replication all count as startup-adjacent automatic
  work and must share the same optional-integration policy.
- A synchronous Tauri invoke runs on the UI-process main thread. Waiting for an
  optional integration there blocks WKWebView input, compositing, and first
  paint even though the server and React bundle are healthy.

### Root cause and fix

Trace the launch path through `DashboardApp` → native dashboard bootstrap /
Tailscale device refresh → Rust status lookup. On macOS, use the bounded local
API first and never fall through to a generic GUI-bundled Tailscale CLI when the
local service is unhealthy. The App Store variant does not expose the
standalone LocalAPI files, so it has one narrow exception: require `scutil` to
report the exact `io.tailscale.ipn.macos` VPN profile as already connected,
resolve that bundle inside `/Applications` without executing it, and invoke
only its exact CLI path. Every CLI call has a hard deadline and terminates its
process group so wrapper scripts cannot leave descendants behind. Make native
startup, discovery, and pairing invokes async and move blocking status work
away from the UI thread. Treat failure as degraded optional functionality:
continue locally and render a persistent, actionable “Tailscale needs
attention” message. Generic automatic CLI work remains disabled by default on
macOS across both the app and persistent background services; the explicit
`HIVEMIND_TAILSCALE_CLI_FALLBACK=1` opt-in is for diagnosis or a known-safe
single installation. Resolve executable paths with filesystem checks, never a
`tailscale version` probe.

### Diagnosis recipe

1. Confirm the embedded dashboard URL returns HTTP 200 while the window is
   blank.
2. Sample the app process. If the main thread is inside
   `WebURLSchemeHandlerCocoa`, `wry`, Tauri IPC, or project Rust, follow the
   active invoke rather than debugging React paint.
3. Run `scutil --nc status "Tailscale"` and inspect connect/disconnect counters.
   `Connecting` with no successful connection confirms the VPN session is not
   ready, even if `systemextensionsctl list` says the extension is enabled.
4. Inspect Tailscale CLI children and sample one. A process waiting on
   NetworkExtension/XPC is evidence that the status fallback cannot be trusted
   to return promptly.
5. Use `scutil --nc list` to identify duplicate bundle IDs or separately named
   Tailscale VPN services. Match the executable's variant, not only the display
   name.
6. Inspect persistent HivemindOS LaunchAgents and their child processes. A
   KeepAlive `tailscale file get --wait` or periodic status/SSH probe can reopen
   the permission dialog after a force quit.
7. Verify the repaired app paints, remains usable locally, shows the attention
   banner, and creates no new unbounded status processes.

### Fixed evidence

The focused Rust regression forces a wrapper and descendant process past a
50 ms deadline, verifies the call returns in under one second, and confirms the
descendant never writes its delayed marker. A separate health regression proves
an unavailable Tailnet is explicitly marked as requiring attention. The
frontend regression proves that condition becomes actionable copy stating that
HivemindOS is continuing locally. Taildrop and shared-policy regressions prove
that neither a missing VPN profile nor a configured-but-different macOS variant
launches Tailscale automatically. Live LaunchAgent verification confirmed the
guarded pause and zero Tailscale children; the permission dialog remained
absent. Fixed 2026-07-27.

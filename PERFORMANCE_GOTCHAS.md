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

### Where it's written up

- `OPTIMIZATIONS.md` — the change entry (files, verification, tradeoffs).
- `CHANGELOG.md` — the release-facing entry.
- Fixed 2026-07-04.

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

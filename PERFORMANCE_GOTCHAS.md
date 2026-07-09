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

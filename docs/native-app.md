# Native App

HivemindOS has a Phase 1 Tauri desktop target that runs the existing Next.js dashboard in a native window without taking over Liam's managed port `5020`.

## Phase 1

Run the native development shell:

```bash
pnpm tauri:dev
```

This starts the shared Next.js app on `http://127.0.0.1:5021` and opens it in a Tauri window. The normal browser dashboard still uses:

```bash
pnpm dev
```

which defaults to `http://localhost:5020`.

## Phase 2

Build the packaged native app:

```bash
pnpm tauri:build
```

Phase 2 keeps the browser and native app on the same Next.js codebase. Before Tauri packages the app, `pnpm tauri:prepare` builds a standalone Next.js server into `src-tauri/resources/hivemindos-next` and copies the active local Node.js runtime into `src-tauri/resources/hivemindos-node`. In release builds the Rust shell starts that bundled server on an ephemeral `127.0.0.1` port, then navigates the native window to it.

The generated `src-tauri/resources` contents are ignored by git and are rebuilt for each package. Keep new feature code shared by putting platform differences behind small adapters instead of forking browser and desktop views.

The standalone Next build is bounded by `TAURI_NEXT_BUILD_TIMEOUT_SECONDS` and defaults to 1800 seconds. Generated resources are scrubbed so local `.env*` files are not bundled into the desktop app.

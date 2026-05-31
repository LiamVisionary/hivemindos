# Native App

HivemindOS has a Tauri desktop target that runs the existing Next.js dashboard in a native window without taking over Liam's managed port `5020`.

<figure class="imagePlate">
  <img src="assets/img/diagrams/aeon-native-desktop.jpg" alt="Generated AEON and native desktop infographic showing Tauri, Local Files, AEON Repo, GitHub Actions, Deliverables, and Shared Vault.">
  <figcaption>The native shell keeps local file actions on This Mac while AEON repositories, GitHub Actions, deliverables, and the shared vault stay connected through the same dashboard.</figcaption>
</figure>

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

## Native Bridge

The desktop shell exposes a narrow command surface for operations that should be native on This Mac:

| Command | Frontend helper | Purpose |
|---|---|---|
| `desktop_status` | `getNativeAppVersion` | Read build commit, branch, dirty flag, runtime phase, native host, and native server port |
| `list_local_directories` | `listNativeLocalDirectories` | Browse local directories without routing through the collector |
| `create_local_folder` | `createNativeLocalFolder` | Create a local child folder after validating and cleaning the requested name |
| `display_local_path` | `displayNativeLocalPath` | Normalize local paths for display |

The browser path remains fully supported. Frontend code calls native helpers only when Tauri is detected and the target collector URL is local. Remote machines still use Hivemind Link or collector directory APIs so local native privileges are never confused with remote access.

Current consumers include AEON workspace clone/link flows, chat folder creation, scheduler folder browsing, Kanban linked directories, and shared machine-aware directory picking.

## Safety Notes

- Port `5020` remains reserved for the managed browser dashboard.
- Phase 1 development uses `5021`.
- Phase 2 packaged builds use an ephemeral localhost port.
- Generated resources are rebuilt, ignored, and scrubbed of local `.env*` files.
- Native filesystem helpers are intentionally directory-scoped and local-only; remote browsing stays behind collector APIs.

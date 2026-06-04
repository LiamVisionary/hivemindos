# Native App

HivemindOS has a Tauri desktop target.

It runs the same Next.js dashboard in a native window without taking over Liam's managed port `5020`. The goal is not to fork the product. The goal is to give This Mac better local file and setup access while keeping the browser app fully supported.

<figure class="imagePlate">
  <img src="assets/img/diagrams/aeon-native-desktop.jpg" alt="Generated AEON and native desktop infographic showing Tauri, Local Files, AEON Repo, GitHub Actions, Deliverables, and Shared Vault.">
  <figcaption>The native shell keeps local file actions on This Mac. AEON repositories, GitHub Actions, deliverables, and the shared vault still run through the same dashboard.</figcaption>
</figure>

## Phase 1

Run the native development shell:

```bash
pnpm tauri:dev
```

This starts the shared Next.js app behind the Tauri loading proxy on `http://127.0.0.1:5021` and opens it in a Tauri window. The proxy chooses an isolated internal Next.js backend port starting at `5121`, so stale backend processes do not corrupt a fresh dev run. The normal browser dashboard still uses:

```bash
pnpm dev
```

which defaults to `http://localhost:5020`.

## Phase 2

Build the packaged native app:

```bash
pnpm tauri:build
```

Phase 2 keeps the browser and native app on the same Next.js codebase. The browser version still serves the full Next app and API routes through `pnpm dev` / `pnpm build`.

## Phase 3

Packaged native builds now default to a static Tauri UI:

```bash
pnpm tauri:prepare
```

The prepare step exports the shared dashboard React app into `src-tauri/static`, prunes bulky browser-only icon/source assets, keeps Lottie animation assets, and does not bundle the standalone Next server or a Node.js runtime. In release builds, the Rust shell loads the static webview directly and reports `phase-3-static` from `desktop_status`.

Opening the packaged app does not auto-run `setup.sh` or `install.sh`. The first-run setup wizard checks local capabilities from native code, asks the user how to install the hive, detects agent runtimes, lets skills and memory imports be selected independently, then opens an explicit Terminal command only after the user approves it. That terminal setup path runs `setup.sh --interactive ...`, so it can prompt for GitLawb Code Proof CLI and DID preparation. It does not silently start a full GitLawb node or install Docker/Postgres.

For debugging only, the old embedded Next server package can still be generated:

```bash
HIVEMINDOS_TAURI_EMBEDDED_NEXT=1 pnpm tauri:prepare
```

That fallback builds a standalone Next.js server into `src-tauri/resources/hivemindos-next` and copies the active local Node.js runtime into `src-tauri/resources/hivemindos-node`. In release builds the Rust shell detects those resources, starts the bundled server on an ephemeral `127.0.0.1` port, then navigates the native window to it.

The generated `src-tauri/resources` contents are ignored by git and rebuilt for each package. Keep new feature code shared by putting platform differences behind small adapters instead of forking browser and desktop views.

The static and embedded builds are bounded by `TAURI_NEXT_BUILD_TIMEOUT_SECONDS` and default to 1800 seconds. Static export hides `src/app/api` only during the export so API routes remain available for the browser app and embedded fallback.

## Native Bridge

The desktop shell exposes a narrow command surface for operations that should be native on This Mac:

| Command | Frontend helper | Purpose |
|---|---|---|
| `desktop_status` | `getNativeAppVersion` | Read build commit, branch, dirty flag, runtime phase, native host, and native server port |
| `list_local_directories` | `listNativeLocalDirectories` | Browse local directories without routing through the collector |
| `create_local_folder` | `createNativeLocalFolder` | Create a local child folder after validating and cleaning the requested name |
| `display_local_path` | `displayNativeLocalPath` | Normalize local paths for display |
| `native_setup_status` | `readNativeSetupStatus` | Detect setup prerequisites and local agent runtimes for the first-run wizard |
| `native_setup_run` | `runNativeSetup` | Open a user-approved Terminal command that runs `setup.sh` with selected wizard options |

The wizard delegates Code Proof preparation to `setup.sh`: macOS/Linux users can accept the GitLawb CLI and DID prompts in the opened terminal, while full local node hosting remains a later Integrations/project-linking action.

The browser path remains fully supported. Frontend code calls native helpers only when Tauri is detected and the target collector URL is local. Remote machines still use Hivemind Link or collector directory APIs, so local native privileges are never confused with remote access.

Current consumers include AEON workspace clone/link flows, chat folder creation, scheduler folder browsing, Kanban linked directories, and shared machine-aware directory picking.

## Safety Notes

- Port `5020` remains reserved for the managed browser dashboard.
- Phase 1 development uses `5021`.
- Phase 3 packaged builds load static UI directly.
- Embedded fallback packaged builds use an ephemeral localhost port.
- Generated resources are rebuilt, ignored, and scrubbed of local `.env*` files.
- Native filesystem helpers are intentionally directory scoped and local. Remote browsing stays behind collector APIs.

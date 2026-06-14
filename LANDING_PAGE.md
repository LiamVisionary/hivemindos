# Landing Page & Release-Asset Contract

The public marketing/landing site (the "Download HivemindOS" page) is a **separate
Next.js repo**, not this one. This note records how it consumes this repo's GitHub
releases so a change here doesn't silently break downloads. (This repo's own
`src/app/page.tsx` is the dashboard root — static-native vs embedded switch — not
the landing page.)

## How the downloads work

- The landing page's download cards link to **version-independent "latest" URLs**:
  `https://github.com/LiamVisionary/hivemindos/releases/latest/download/<ASSET>`
  GitHub's `/releases/latest/` redirect resolves to the newest **non-prerelease**
  release, so publishing a new Latest release is picked up automatically — no
  per-release link edits.
- In the landing repo the base URL is defined once (`src/app/page.tsx`, ~line 10)
  and reused for every card.
- Header/footer "Download" links are `#download` in-page anchors. The
  "release notes" button points at `/releases/latest` (the page, **not**
  `/download/`), which is correct for notes.

## The contract: stable asset filenames — DO NOT rename

The landing page hard-codes these exact filenames. They are produced by the
**"Collect bundle assets"** step in
[`.github/workflows/tauri-cross-platform-release.yml`](.github/workflows/tauri-cross-platform-release.yml)
(which renames Tauri's *versioned* bundle outputs to stable, version-free names)
and are also consumed by [`scripts/build-updater-manifest.mjs`](scripts/build-updater-manifest.mjs)
for the auto-updater. **Renaming any of these breaks the landing-page download
buttons AND the updater:**

| Platform | Installer asset(s) |
| --- | --- |
| macOS Apple Silicon | `HivemindOS-macos-apple-silicon.dmg` |
| macOS Intel | `HivemindOS-macos-intel.dmg` |
| Windows | `HivemindOS-windows-x64-setup.exe`, `HivemindOS-windows-x64.msi` |
| Linux | `HivemindOS-linux-x64.AppImage`, `HivemindOS-linux-x64.deb`, `HivemindOS-linux-x64.rpm` |

Updater bundles + signatures (consumed by the updater, not the landing page):
`HivemindOS-updater-macos-apple-silicon.app.tar.gz(.sig)`,
`HivemindOS-updater-macos-intel.app.tar.gz(.sig)`,
`HivemindOS-windows-x64-setup.exe.sig`, `HivemindOS-linux-x64.AppImage.sig`,
and `latest.json`.

## Auto-update channel

The desktop updater endpoint is `releases/latest/download/latest.json`
(`src-tauri/tauri.conf.json` → `plugins.updater.endpoints`). A **normal**
(non-prerelease) release auto-updates every existing install; a **pre-release**
is downloadable but does **not** move the updater (GitHub's `/latest/` excludes
pre-releases). Pick the channel deliberately when publishing — `gh release create`
without `--prerelease` makes it Latest and triggers fleet-wide auto-update.

## When you add, rename, or drop a platform/asset

Change all three in the same commit, or downloads/updates break:
1. the workflow's **Collect bundle assets** step (stable name),
2. `scripts/build-updater-manifest.mjs` (`PLATFORM_ASSETS`),
3. the landing repo's download-card list.

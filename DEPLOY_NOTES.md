# Deploy Notes

## HivemindOS Desktop Release v0.1.39

- App repo pushed to `main` at `41d40d7e`.
- Website repo pushed to `main` at `726d00f`.
- Final release: <https://github.com/LiamVisionary/hivemindos/releases/tag/v0.1.39>
- The full `v0.1.39` Tauri release run succeeded across all four jobs:
  - macOS Apple Silicon
  - macOS Intel
  - Windows x64
  - Linux x64

## Stable Download Aliases

The release includes these stable asset names for website links:

- `HivemindOS-macos-aarch64.dmg`
- `HivemindOS-macos-x64.dmg`
- `HivemindOS-windows-x64-setup.exe`
- `HivemindOS-windows-x64.msi`
- `HivemindOS-linux-x64.AppImage`
- `HivemindOS-linux-x64.deb`
- `HivemindOS-linux-x64.rpm`

All seven `https://github.com/LiamVisionary/hivemindos/releases/latest/download/<asset>` URLs were verified with HTTP `200`.

## Website Download Links

The website download buttons now use GitHub `releases/latest/download/...` URLs instead of a hard-coded version tag. Future desktop releases should not require redeploying the website just to update download links, as long as the release workflow continues uploading the same stable alias names.

## What Went Wrong During Release

macOS took most of the time because the failures appeared late in successive release runs:

- The embedded Node runtime needed Developer ID signing, timestamping, and hardened runtime options before notarization.
- The embedded Next build exceeded the previous 30-minute macOS watchdog, so macOS release jobs now get a one-hour timeout.
- The Apple signing certificate needed to be imported before Tauri's `beforeBuildCommand`, because embedded Node signing happens during `pnpm tauri:prepare`, before the bundler's later signing phase.

The final fix imports the Apple Developer ID certificate into a temporary keychain before `pnpm tauri:build`.

## Caveat

After `v0.1.39` was tagged and released, three local Queen Bee voice files were still modified in the app worktree:

- `src/app/api/queen-bee/voice/route.ts`
- `src/features/queen-voice/use-queen-bee-realtime.ts`
- `src/lib/services/queen-bee/voice-turn.ts`

Those edits looked incomplete and were intentionally left uncommitted and unreleased.

## Versioning Follow-Up

After `v0.1.39`, the checked-in app metadata was moved to `0.2.0` so local/dev/native builds do not keep reporting the old `0.1.23` floor.

Release tags should now be created only by a successful desktop release workflow. Failed build attempts should not consume versions or publish a partial Latest release. The cross-platform release workflow builds every platform first, downloads the artifacts into a final publish job, and only then creates the `vX.Y.Z` tag plus GitHub Release.

# Native Desktop Rules

These rules apply under `src-tauri/` in addition to the repository root instructions.

## Deep-Link Return Contract

- Browser-mediated desktop flows return through a registered app deep link, never a protected dashboard URL.
- Production builds claim only `hivemindos://`; development builds claim only `hivemindos-dev://`. Keep `Info.plist`, Tauri production/dev configs, signing, and LaunchServices registration aligned.
- Native handlers allowlist scheme, host, path, and bounded query fields; foreground the main window; navigate only to the exact originating view; and emit a typed feature-return event when needed.
- Never accept an arbitrary client route/URL or put access tokens, client secrets, bearer credentials, or sensitive material in the app link.
- Verify the unauthenticated callback page, generated dev and production bundle metadata, and a real OS-level focus return. When cold start is possible, verify it or persist a one-shot native handoff until the frontend listener starts.

## Releases And Safety

- Stable bundle/update asset names are external contracts. Read `LANDING_PAGE.md` before changing bundle names or updater metadata.
- Reserve Tauri runs for native behavior. Use the browser for normal dashboard iteration as described in `scripts/AGENTS.md`.
- Do not expose collectors publicly or bundle secrets, official commercial authority, personal machine data, or private Tailnet addresses.

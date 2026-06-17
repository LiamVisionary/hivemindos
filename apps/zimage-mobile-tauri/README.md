# Zimage Mobile Tauri

Native macOS shell for the private Z-Image Tailnet app.

## Target

- App URL: `https://liams-macbook-pro-1.tail629894.ts.net:8789/`
- Root page exposes both Z-Image Studio (`/app/`) and ComfyUI Mobile (`/mobile/`).
- The remote page is not granted Tauri API permissions.

## Commands

```bash
cd apps/zimage-mobile-tauri
pnpm install
pnpm dev
pnpm build
```

The macOS app bundle is emitted under `src-tauri/target/release/bundle/macos/`.
The DMG is emitted under `src-tauri/target/release/bundle/dmg/`.

#!/usr/bin/env node
// Entrypoint for `pnpm tauri:dev`.
//
// Runs `tauri dev`, but routes the cargo build through scripts/dev-codesign-runner.sh
// (Tauri's --runner hook). That shim re-signs the dev binary with the release app's
// Developer ID identity so the dev and production apps share ONE macOS/TCC identity —
// folder permission grants (Downloads/Desktop/Documents) then carry across both, and
// agent file writes behave identically in dev and prod. See the shim for the full why.
//
// A relative --runner path would resolve against cargo's cwd (src-tauri), so we pass an
// absolute path here to keep it unambiguous and machine-independent.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'scripts', 'dev-codesign-runner.sh');
const tauriBin = join(root, 'node_modules', '.bin', 'tauri');

// Dev-only: run the window OPAQUE. tauri.conf.json sets transparent:true (for the
// packaged app), which forces WKWebView onto the slower alpha-compositing path;
// the UI paints an opaque background (#090b10) and uses no desktop see-through, so
// dev gains nothing from it. We overlay `transparent:false` via `--config` here so
// ONLY `pnpm tauri:dev` is affected — the committed config and every packaged
// build keep their current transparency. Set HIVEMINDOS_DEV_TRANSPARENT=1 to keep
// the transparent window in dev (e.g. to reproduce a transparency-specific bug).
const overlayArgs = [];
if (process.env.HIVEMINDOS_DEV_TRANSPARENT !== '1') {
  try {
    const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    const windows = (conf.app?.windows ?? []).map((window) => ({ ...window, transparent: false }));
    if (windows.length > 0) {
      overlayArgs.push('--config', JSON.stringify({ app: { windows } }));
    }
  } catch {
    // If the config can't be read/parsed, fall back to the committed transparency.
  }
}

const child = spawn(tauriBin, ['dev', '--runner', runner, ...overlayArgs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

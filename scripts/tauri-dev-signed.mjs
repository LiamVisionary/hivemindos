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
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = join(root, 'scripts', 'dev-codesign-runner.sh');
const tauriBin = join(root, 'node_modules', '.bin', 'tauri');

const child = spawn(tauriBin, ['dev', '--runner', runner, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

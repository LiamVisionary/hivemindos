#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const guardScript = path.join(repoRoot, "scripts/guard-browser-durable-state.mjs");

async function write(root, file, body) {
  const fullPath = path.join(root, file);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, body, "utf8");
}

function runGuard(root, extra = []) {
  return spawnSync("node", [guardScript, "--root", root, ...extra], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const tmp = await mkdtemp(path.join(tmpdir(), "browser-durable-state-"));

try {
  const badRoot = path.join(tmp, "bad");
  await write(
    badRoot,
    "src/features/dashboard/bad.ts",
    `export function saveDurableTheme(theme) {
  window.localStorage.setItem("hivemindos.theme", theme);
}
`,
  );
  const bad = runGuard(badRoot);
  assert.notEqual(bad.status, 0, "new browser storage use should fail");
  assert.match(bad.stderr, /bad\.ts:2/);

  const allowedRoot = path.join(tmp, "allowed");
  await write(
    allowedRoot,
    "src/features/dashboard/allowed.ts",
    `export function stashDraft(text) {
  // guard:allow-browser-storage - disposable per-tab draft
  window.sessionStorage.setItem("draft", text);
}
`,
  );
  const allowed = runGuard(allowedRoot);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

  const badAllowRoot = path.join(tmp, "bad-allow");
  await write(
    badAllowRoot,
    "src/features/dashboard/bad-allow.ts",
    `export function stashDraft(text) {
  // guard:allow-browser-storage
  window.sessionStorage.setItem("draft", text);
}
`,
  );
  const badAllow = runGuard(badAllowRoot);
  assert.notEqual(badAllow.status, 0, "allow pragma without reason should fail");
  assert.match(badAllow.stderr, /must include a short reason/);

  const baselineRoot = path.join(tmp, "baseline");
  await write(
    baselineRoot,
    "src/features/dashboard/legacy.ts",
    `export function legacy(value) {
  window.localStorage.setItem("legacy", value);
}
`,
  );
  await write(
    baselineRoot,
    "allowed.json",
    JSON.stringify({
      version: 1,
      entries: [
        {
          file: "src/features/dashboard/legacy.ts",
          line: "window.localStorage.setItem(\"legacy\", value);",
        },
      ],
    }),
  );
  const baseline = runGuard(baselineRoot, ["--baseline", "allowed.json"]);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  console.log("Browser durable-state guard tests passed.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

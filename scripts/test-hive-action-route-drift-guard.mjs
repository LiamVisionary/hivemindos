#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const guardScript = path.join(repoRoot, "scripts/guard-hive-action-route-drift.mjs");

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

const tmp = await mkdtemp(path.join(tmpdir(), "hive-action-route-guard-"));

try {
  const missingActionRoot = path.join(tmp, "missing-action");
  await write(
    missingActionRoot,
    "src/app/api/example/create/route.ts",
    `export async function POST(request) {
  const body = await request.json();
  if (body.action === "create") return Response.json({ ok: true });
  return Response.json({ ok: false }, { status: 400 });
}
`,
  );
  const missing = runGuard(missingActionRoot);
  assert.notEqual(missing.status, 0, "unregistered action-like route should fail");
  assert.match(missing.stderr, /example\/create\/route\.ts/);

  const registeredRoot = path.join(tmp, "registered");
  await write(
    registeredRoot,
    "src/app/api/example/create/route.ts",
    `export async function POST(request) {
  const body = await request.json();
  return Response.json({ ok: body.action === "create" });
}
`,
  );
  await write(
    registeredRoot,
    "src/lib/services/hive-actions/index.ts",
    `export function listHiveActions() {
  return [{ id: "example.create", contextIndex: { route: "/api/example/create" } }];
}
`,
  );
  const registered = runGuard(registeredRoot);
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);

  const allowRoot = path.join(tmp, "allow");
  await write(
    allowRoot,
    "src/app/api/example/update/route.ts",
    `// guard:allow-hive-action-route - fixture keeps this REST-only
export async function POST(request) {
  const body = await request.json();
  return Response.json({ ok: body.action === "update" });
}
`,
  );
  const allowed = runGuard(allowRoot);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

  const badAllowRoot = path.join(tmp, "bad-allow");
  await write(
    badAllowRoot,
    "src/app/api/example/update/route.ts",
    `// guard:allow-hive-action-route
export async function POST(request) {
  const body = await request.json();
  return Response.json({ ok: body.action === "update" });
}
`,
  );
  const badAllow = runGuard(badAllowRoot);
  assert.notEqual(badAllow.status, 0, "allow pragma without reason should fail");
  assert.match(badAllow.stderr, /must include a short reason/);

  const ignoredRoot = path.join(tmp, "ignored");
  await write(
    ignoredRoot,
    "src/app/api/oauth/callback/route.ts",
    `export async function POST() {
  return Response.json({ ok: true });
}
`,
  );
  const ignored = runGuard(ignoredRoot);
  assert.equal(ignored.status, 0, ignored.stderr || ignored.stdout);

  const baselineRoot = path.join(tmp, "baseline");
  await write(
    baselineRoot,
    "src/app/api/example/delete/route.ts",
    `export async function DELETE(request) {
  const body = await request.json();
  return Response.json({ ok: body.action === "delete" });
}
`,
  );
  await write(
    baselineRoot,
    "allowed.json",
    JSON.stringify({ version: 1, routes: ["src/app/api/example/delete/route.ts"] }),
  );
  const baseline = runGuard(baselineRoot, ["--baseline", "allowed.json"]);
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);

  console.log("Hive action route drift guard tests passed.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const guardScript = path.join(repoRoot, "scripts/guard-commercial-trust-boundary.mjs");

async function write(root, file, body) {
  const fullPath = path.join(root, file);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, body, "utf8");
}

function runGuard(root) {
  return spawnSync("node", [guardScript, "--root", root], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

const tmp = await mkdtemp(path.join(tmpdir(), "commercial-boundary-"));

try {
  const payToRoot = path.join(tmp, "payto");
  await write(
    payToRoot,
    "src/app/api/official-paid-agent/route.ts",
    `export async function POST(request) {
  const body = await request.json();
  const payTo = body.payTo;
  return Response.json({ ok: true, payTo });
}
`,
  );
  const payTo = runGuard(payToRoot);
  assert.notEqual(payTo.status, 0, "client payTo authority should fail");
  assert.match(payTo.stderr, /client-payto-authority/);

  const entitlementRoot = path.join(tmp, "entitlement");
  await write(
    entitlementRoot,
    "src/app/api/managed-cloud/route.ts",
    `export async function POST(request) {
  const body = await request.json();
  if (body.entitled) grantAccess();
  return Response.json({ ok: true });
}
function grantAccess() {}
`,
  );
  const entitlement = runGuard(entitlementRoot);
  assert.notEqual(entitlement.status, 0, "client entitlement authority should fail");
  assert.match(entitlement.stderr, /client-entitlement-authority/);

  const browserRoot = path.join(tmp, "browser");
  await write(
    browserRoot,
    "src/app/api/managed-credits/route.ts",
    `export async function POST() {
  const managedHoney = localStorage.getItem("managedHoney");
  return Response.json({ ok: true, managedHoney });
}
`,
  );
  const browser = runGuard(browserRoot);
  assert.notEqual(browser.status, 0, "browser commercial authority should fail");
  assert.match(browser.stderr, /browser-commercial-authority/);

  const selfHostedRoot = path.join(tmp, "self-hosted");
  await write(
    selfHostedRoot,
    "workers/paid-agent-gateway/src/index.ts",
    `const SELLER_MODE = "HIVEMINDOS_PAID_AGENT_SELLER_MODE";
export function normalize(raw, env) {
  if (env[SELLER_MODE] !== "self-hosted") throw new Error("self-hosted only");
  return { payTo: raw.payTo || env.HIVEMINDOS_PAID_AGENT_PAY_TO };
}
`,
  );
  const selfHosted = runGuard(selfHostedRoot);
  assert.equal(selfHosted.status, 0, selfHosted.stderr || selfHosted.stdout);

  const allowedRoot = path.join(tmp, "allowed");
  await write(
    allowedRoot,
    "src/app/api/local-demo/route.ts",
    `// guard:allow-commercial-trust-boundary - fake local demo fixture
export async function POST(request) {
  const body = await request.json();
  const payTo = body.payTo;
  return Response.json({ ok: true, payTo });
}
`,
  );
  const allowed = runGuard(allowedRoot);
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

  console.log("Commercial trust-boundary guard tests passed.");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

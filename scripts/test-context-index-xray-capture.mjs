#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-context-index-xray-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = join(tempHome, "missing-vault");

try {
  const route = await import("../src/app/api/context-index/route.ts");
  const xray = await import("../src/lib/services/context-xray.ts");
  const { NextRequest } = await import("next/server");

  const response = await route.POST(new NextRequest("http://127.0.0.1/api/context-index", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "wallet payment confirmation",
      kinds: ["api-route", "tool-schema"],
      limit: 4,
      includeRuntimeProviders: false,
      includeConnectedApps: false,
      contextXray: true,
      runId: "run-context-index-route",
      threadId: "thread-context-index-route",
      model: "codex:test",
    }),
  }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.items.length > 0, "context-index should return matching items");
  assert.ok(body.contextXray?.id, "context-index should return an X-Ray receipt");
  assert.equal(body.contextXray.sourceCount, body.items.length);

  const listed = await xray.listContextXrayManifests({ runId: "run-context-index-route" });
  assert.equal(listed.manifests.length, 1);
  assert.equal(listed.manifests[0].id, body.contextXray.id);
  assert.equal(listed.manifests[0].sources.length, body.items.length);
  assert.ok(listed.manifests[0].sources.some((source) => source.route || source.path));

  console.log("Context index X-Ray capture tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

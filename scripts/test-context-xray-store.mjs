#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-context-xray-"));
const authSecret = "x".repeat(40);
const deviceToken = "context-xray-device-token-123";
process.env.HOME = tempHome;
process.env.HIVEMINDOS_DASHBOARD_AUTH_SECRET = authSecret;
process.env.HIVEMINDOS_DASHBOARD_DEVICE_TOKEN = deviceToken;

try {
  const service = await import("../src/lib/services/context-xray.ts");
  const route = await import("../src/app/api/context-xray/route.ts");
  const { NextRequest } = await import("next/server");

  const empty = await service.listContextXrayManifests();
  assert.deepEqual(empty.manifests, []);

  const created = await service.createContextXrayManifest({
    runId: "run-1",
    threadId: "thread-1",
    model: "gpt-5",
    sources: [
      {
        id: "memory-1",
        kind: "memory",
        title: "Agent memory with api_key=sk-123456789012345678901234",
        path: "Memory/Distillations/Agent Memory/context/example.md",
        tokenEstimate: 42,
        status: "pinned",
        reason: "Selected because Bearer abcdefghijklmnopqrstuvwxyz123456 was mentioned in retrieved text.",
        snippet: "Never persist token=supersecret123 in manifest snippets.",
      },
      {
        id: "route-1",
        kind: "api-route",
        title: "Context index route",
        route: "/api/context-index",
        status: "active",
        reason: "Tool schema matched the current user request.",
      },
    ],
  });

  assert.equal(created.runId, "run-1");
  assert.equal(created.totalEstimatedTokens >= 43, true);
  assert.equal(created.sources[0].title.includes("sk-123456789012345678901234"), false);
  assert.equal(created.sources[0].reason?.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(created.sources[0].snippet?.includes("supersecret123"), false);
  assert.ok(created.redactedLabels?.length);
  assert.ok(created.sources[1].tokenEstimate > 0);

  const fromContextIndex = await service.createContextXrayManifestFromContextIndex({
    runId: "run-context-index",
    threadId: "thread-context-index",
    model: "codex:test",
    query: "wallet payment",
    items: [
      {
        id: "api-route:wallet-send",
        kind: "api-route",
        title: "Wallet send route",
        summary: "Send route with token=anothersecret123456.",
        tags: ["wallet", "payment"],
        route: "/api/wallet/send",
        methods: ["POST"],
        load: { type: "api", target: "/api/wallet/send" },
        score: 72,
      },
      {
        id: "skill:review",
        kind: "skill",
        title: "Review skill",
        summary: "Review proposals before durable memory writes.",
        tags: ["review"],
        path: "Skills/review/SKILL.md",
        load: { type: "file", target: "Skills/review/SKILL.md" },
      },
    ],
  });
  assert.equal(fromContextIndex.runId, "run-context-index");
  assert.equal(fromContextIndex.sources[0].kind, "api-route");
  assert.equal(fromContextIndex.sources[0].route, "/api/wallet/send");
  assert.equal(fromContextIndex.sources[0].reason?.includes("score 72"), true);
  assert.equal(fromContextIndex.sources[0].snippet?.includes("anothersecret123456"), false);
  assert.equal(fromContextIndex.sources[1].kind, "skill");
  assert.ok(fromContextIndex.sources.every((source) => source.lifecycle?.availableAt && source.lifecycle?.retrievedAt));

  const capabilityManifest = await service.createContextXrayManifest({
    runId: "run-capability",
    sources: [{ id: "hive-action:apps.build", kind: "tool", title: "App builder", status: "active" }],
  });
  await service.recordContextXrayCapabilityUse({
    runId: "run-capability",
    rawArguments: { surface: "hive_action", capabilityId: "apps.build" },
    invoked: false,
    ok: false,
    target: "approval required",
  });
  assert.equal((await service.getContextXrayManifest(capabilityManifest.id)).sources[0].lifecycle?.invokedAt, undefined);
  await service.recordContextXrayCapabilityUse({
    runId: "run-capability",
    rawArguments: { surface: "hive_action", capabilityId: "apps.build" },
    invoked: true,
    ok: true,
    target: "apps.build",
  });
  assert.ok((await service.getContextXrayManifest(capabilityManifest.id)).sources[0].lifecycle?.invokedAt);

  const fetched = await service.getContextXrayManifest(created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.sources.length, 2);

  const filtered = await service.listContextXrayManifests({ runId: "run-1", limit: 1 });
  assert.equal(filtered.manifests.length, 1);
  assert.equal(filtered.manifests[0].id, created.id);

  await appendFile(join(tempHome, ".hivemindos", "context-xray.jsonl"), "not-json\n", "utf8");
  const afterBadLine = await service.listContextXrayManifests({ limit: 10 });
  assert.equal(afterBadLine.manifests.some((manifest) => manifest.id === created.id), true);

  const rawStore = await readFile(join(tempHome, ".hivemindos", "context-xray.jsonl"), "utf8");
  assert.equal(rawStore.includes("sk-123456789012345678901234"), false);
  assert.equal(rawStore.includes("supersecret123"), false);

  const unauthorized = await route.GET(new NextRequest("http://127.0.0.1/api/context-xray"));
  assert.equal(unauthorized.status, 401);

  const apiCreate = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/context-xray", {
    action: "create",
    runId: "run-2",
    sources: [
      {
        kind: "skill",
        title: "hivemindos-feature-development",
        status: "active",
        tokenEstimate: 12,
        reason: "Feature-development skill guided the change.",
      },
    ],
  }));
  assert.equal(apiCreate.status, 200);
  const apiCreateBody = await apiCreate.json();
  assert.equal(apiCreateBody.ok, true);
  assert.equal(apiCreateBody.manifest.runId, "run-2");

  const apiEvidence = await route.POST(jsonRequest(NextRequest, "http://127.0.0.1/api/context-xray", {
    action: "record-evidence",
    runId: "run-2",
    sourceId: apiCreateBody.manifest.sources[0].id,
    stage: "relevant",
    evidence: "The accepted outcome cites this skill's review gate.",
  }));
  assert.equal(apiEvidence.status, 200);

  const apiGet = await route.GET(authedRequest(NextRequest, `http://127.0.0.1/api/context-xray?id=${apiCreateBody.manifest.id}`));
  assert.equal(apiGet.status, 200);
  const apiGetBody = await apiGet.json();
  assert.equal(apiGetBody.manifest.id, apiCreateBody.manifest.id);
  assert.ok(apiGetBody.manifest.sources[0].lifecycle.relevantAt);
  assert.match(apiGetBody.manifest.sources[0].lifecycle.evidence.join(" "), /accepted outcome/i);

  const apiList = await route.GET(authedRequest(NextRequest, "http://127.0.0.1/api/context-xray?limit=10"));
  assert.equal(apiList.status, 200);
  const apiListBody = await apiList.json();
  assert.equal(apiListBody.manifests.length >= 2, true);

  console.log("Context X-Ray store and API tests passed.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

function authedRequest(NextRequest, url, init = {}) {
  return new NextRequest(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "x-hivemindos-device-token": deviceToken,
    },
  });
}

function jsonRequest(NextRequest, url, body) {
  return authedRequest(NextRequest, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

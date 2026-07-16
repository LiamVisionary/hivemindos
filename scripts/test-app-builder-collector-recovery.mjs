#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
  collectorSupportsAppBuilderContract,
  requestAppBuilderWithCollectorRecovery,
} = await import("../src/lib/services/app-builder/collector-recovery.ts");

assert.equal(collectorSupportsAppBuilderContract("1.2.0", "1.2.0"), true);
assert.equal(collectorSupportsAppBuilderContract("1.3.0", "1.2.0"), true);
assert.equal(collectorSupportsAppBuilderContract("1.1.9", "1.2.0"), false);
assert.equal(collectorSupportsAppBuilderContract(undefined, "1.2.0"), false);

const calls = [];
const responses = [
  new Response(JSON.stringify({
    ok: false,
    code: APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
    error: "The linked collector needs an App Builder update.",
  }), { status: 409, headers: { "content-type": "application/json" } }),
  new Response(JSON.stringify({ ok: true, verified: true, method: "collector-request" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
  new Response(JSON.stringify({ ok: true, project: { id: "local_flappy", status: "running" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }),
];
const statuses = [];
const result = await requestAppBuilderWithCollectorRecovery({
  appBuilderBody: {
    action: "adopt",
    backend: "local",
    collectorUrl: "http://ubuntu.tailnet:8787",
    directory: "/workspace/flappy-bird",
  },
  machine: {
    collectorUrl: "http://ubuntu.tailnet:8787",
    dnsName: "ubuntu.tailnet",
    name: "Ubuntu",
    appDir: "/workspace/hivemind-os",
  },
  fetchImpl: async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return responses.shift();
  },
  onRecoveryStatus: (status) => statuses.push(status),
});

assert.equal(result.project.id, "local_flappy");
assert.deepEqual(calls.map((call) => call.url), [
  "/api/app-builder",
  "/api/fleet/update",
  "/api/app-builder",
]);
assert.equal(calls[1].body.requiredCapabilities.appBuilderContractVersion, "1.2.0");
assert.equal(calls[1].body.collectorUrl, "http://ubuntu.tailnet:8787");
assert.deepEqual(statuses, ["updating", "retrying"]);

await assert.rejects(
  requestAppBuilderWithCollectorRecovery({
    appBuilderBody: { action: "status" },
    machine: {},
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      code: APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
      error: "still old",
    }), { status: 409, headers: { "content-type": "application/json" } }),
  }),
  /linked collector URL/i,
  "recovery must not attempt an update without an exact linked collector",
);

let genericCalls = 0;
await assert.rejects(
  requestAppBuilderWithCollectorRecovery({
    appBuilderBody: { action: "start" },
    machine: { collectorUrl: "http://ubuntu.tailnet:8787" },
    fetchImpl: async () => {
      genericCalls += 1;
      return new Response(JSON.stringify({ ok: false, error: "project is invalid" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  }),
  /project is invalid/,
);
assert.equal(genericCalls, 1, "ordinary app errors must not trigger collector updates");

let loopCalls = 0;
await assert.rejects(
  requestAppBuilderWithCollectorRecovery({
    appBuilderBody: { action: "adopt" },
    machine: { collectorUrl: "http://ubuntu.tailnet:8787" },
    fetchImpl: async (url) => {
      loopCalls += 1;
      if (url === "/api/fleet/update") {
        return new Response(JSON.stringify({ ok: true, verified: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        ok: false,
        code: APP_BUILDER_COLLECTOR_UPDATE_REQUIRED,
        error: "collector still old",
      }), { status: 409, headers: { "content-type": "application/json" } });
    },
  }),
  /collector still old/,
);
assert.equal(loopCalls, 3, "recovery retries the app request exactly once");

console.log("app-builder collector recovery: all assertions passed");

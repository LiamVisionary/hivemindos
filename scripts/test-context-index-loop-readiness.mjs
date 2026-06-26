#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

const result = await searchContextIndex({
  query: "audit loop readiness and export LOOP.md STATE.md budget run log pattern registry from Work Board",
  kinds: ["tool-schema"],
  limit: 8,
});

const loopReadiness = result.items.find((item) => item.id === "tool-schema:loop-engineering-readiness");
assert.ok(loopReadiness, "Expected context-index search to return the loop readiness capability.");
assert.equal(loopReadiness.route, "/api/loops");
assert.deepEqual(loopReadiness.methods, ["GET", "POST"]);
assert.match(loopReadiness.retrievalText ?? "", /artifacts=true/);
assert.match(loopReadiness.retrievalText ?? "", /node scripts\/hive-loop audit --json/);
assert.match(loopReadiness.retrievalText ?? "", /L3 means unattended-capable/);

console.log("Context index loop-readiness capability retrieval passed.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

const result = await searchContextIndex({
  query: "build this with parallel agents and dedicated /goal through Queen Bee",
  kinds: ["tool-schema"],
  limit: 8,
});

const swarmGoal = result.items.find((item) => item.id === "tool-schema:dashboard-swarm-goal");
assert.ok(swarmGoal, "Expected context-index search to return the dashboard /swarm-goal capability.");
assert.equal(swarmGoal.route, "/api/queen-bee");
assert.deepEqual(swarmGoal.methods, ["POST"]);
assert.match(swarmGoal.retrievalText ?? "", /\/swarm-goal <build request>/);
assert.match(swarmGoal.retrievalText ?? "", /mode act, priority high, and skills planner\/code\/qa/);

console.log("Context index /swarm-goal capability retrieval passed.");

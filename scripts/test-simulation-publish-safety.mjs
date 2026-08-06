#!/usr/bin/env node
import assert from "node:assert/strict";

import { simulationPublishBlocker } from "../src/components/simulation/publish-readiness.ts";

const run = {
  id: "publish-safety",
  template: "x-thread",
  state: "ready",
  title: "Safe publish",
  started: "now",
  rounds: 1,
  currentRound: 1,
  agents: 1,
  news: 0,
  posts: 1,
  trades: 0,
  tags: ["x"],
  summary: "A provider-confirmed publish fixture.",
};
const thread = { display: "Hive", handle: "hivemindos", tweets: [{ text: "Ready", stats: { reply: 0, retweet: 0, like: 0 } }] };

assert.equal(simulationPublishBlocker(run, thread, true), null, "a ready non-empty thread with a publisher is publishable");
assert.equal(simulationPublishBlocker(run, { ...thread, tweets: [] }, true), "No X posts were generated for this run.");
assert.equal(simulationPublishBlocker({ ...run, agents: 0 }, thread, true), "No author bee produced this thread.");
assert.equal(simulationPublishBlocker({ ...run, state: "live" }, thread, true), "Wait for the simulation to finish before publishing.");
assert.equal(simulationPublishBlocker({ ...run, state: "failed" }, thread, true), "This simulation failed and cannot be published.");
assert.equal(simulationPublishBlocker(run, thread, false), "Publishing is not connected for this simulation.");

console.log("simulation publish safety tests passed");

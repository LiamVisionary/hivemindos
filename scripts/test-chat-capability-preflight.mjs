#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const taskRetrievalModule = await import("../src/lib/services/chat/task-retrieval-context.ts");
const { requiresCapabilityRouting, shouldRunTaskRetrieval } = taskRetrievalModule;
const contextIndexModule = await import("../src/lib/services/context-index.ts");
const routeSource = await readFile(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8");
const taskRetrievalSource = await readFile(new URL("../src/lib/services/chat/task-retrieval-context.ts", import.meta.url), "utf8");

assert.equal(
  requiresCapabilityRouting("create a website about how bees are awesome"),
  true,
  "website/app builds need the larger capability-routing preflight budget",
);
assert.equal(shouldRunTaskRetrieval("hello, how are you?"), false, "ordinary conversation must not load the capability corpus");
assert.equal(shouldRunTaskRetrieval("thanks, that makes sense"), false, "short acknowledgements must not load the capability corpus");
assert.equal(shouldRunTaskRetrieval("review src/app/api/chat/agent-runtime/route.ts and run its focused test"), true, "repository work must retrieve task context");
assert.equal(shouldRunTaskRetrieval("search the latest agent harness research and cite sources"), true, "fresh research must retrieve browser and research capabilities");
assert.equal(shouldRunTaskRetrieval("send 5 USDC privately"), true, "consequential capability requests must retrieve their policy and provider evidence");
assert.match(
  routeSource,
  /CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS = (?:1_[5-9]\d{2}|[2-9]_?\d{3,})/,
  "the cold default capability search budget must be at least 1.5 seconds",
);

assert.equal(
  typeof contextIndexModule.searchContextIndexBatch,
  "function",
  "multi-query capability retrieval must build one corpus and rank every query against it",
);
assert.match(
  taskRetrievalSource,
  /searchContextIndexBatch\(/,
  "chat capability retrieval must use the one-corpus batch search path",
);

const searchOptions = {
  includeRuntimeProviders: false,
  kinds: ["runtime", "tool-schema"],
};
const queries = [
  { query: "video generation connected app", limit: 5 },
  { query: "agent workflow routing", limit: 7 },
  { query: "x twitter social post", limit: 4 },
];
const sequential = await Promise.all(queries.map((entry) => contextIndexModule.searchContextIndex({
  ...searchOptions,
  ...entry,
})));
const batched = await contextIndexModule.searchContextIndexBatch(searchOptions, queries);
assert.deepEqual(
  batched.map((result) => result.items.map((item) => item.id)),
  sequential.map((result) => result.items.map((item) => item.id)),
  "batch search must preserve every query's existing ranked capability results",
);
assert.deepEqual(
  batched.map((result) => result.totals),
  sequential.map((result) => result.totals),
  "batch search must preserve the full capability corpus totals",
);

console.log("chat capability preflight tests passed");

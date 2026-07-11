#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { requiresCapabilityRouting } = await import("../src/lib/services/chat/task-retrieval-context.ts");
const routeSource = await readFile(new URL("../src/app/api/chat/agent-runtime/route.ts", import.meta.url), "utf8");

assert.equal(
  requiresCapabilityRouting("create a website about how bees are awesome"),
  true,
  "website/app builds need the larger capability-routing preflight budget",
);
assert.match(
  routeSource,
  /CHAT_PREFLIGHT_CAPABILITY_SEARCH_TIMEOUT_MS = (?:1_[5-9]\d{2}|[2-9]_?\d{3,})/,
  "the cold default capability search budget must be at least 1.5 seconds",
);

console.log("chat capability preflight tests passed");

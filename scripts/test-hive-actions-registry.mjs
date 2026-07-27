#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { z } = await import("zod");
const {
  defineHiveAction,
  toMcpTool,
  toContextIndexItem,
} = await import("../src/lib/services/hive-actions/index.ts");

assert.equal(typeof defineHiveAction, "function", "defineHiveAction should export a function");

assert.throws(
  () =>
    defineHiveAction({
      id: "wallet.send",
      title: "Send",
      description: "Send funds",
      schema: z.object({}),
      sideEffects: ["wallet"],
      risk: "critical",
      tags: ["wallet"],
    }),
  /confirmation metadata/,
  "wallet/payment actions must declare confirmation metadata",
);

assert.throws(
  () =>
    defineHiveAction({
      id: "bad.readonly",
      title: "Bad read-only",
      description: "Bad read-only action",
      schema: z.object({}),
      sideEffects: ["write"],
      risk: "medium",
      readOnly: true,
      tags: ["bad"],
    }),
  /cannot be readOnly/,
  "readOnly actions cannot carry mutating side effects",
);

const action = defineHiveAction({
  id: "demo.action",
  title: "Demo action",
  description: "A demo action for registry tests.",
  schema: z.object({
    name: z.string().describe("Name to echo."),
  }),
  sideEffects: ["read"],
  risk: "low",
  readOnly: true,
  tags: ["demo", "test"],
  aliases: ["demo_action"],
  mcp: { expose: true, compact: true, toolName: "demo_action" },
  contextIndex: {
    summary: "Demo summary.",
    retrievalText: "Use this demo action in tests.",
    route: "/api/demo",
    methods: ["POST"],
  },
});

assert.equal(action.id, "demo.action");

const tool = toMcpTool(action);
assert.equal(tool.name, "demo_action");
assert.equal(tool.annotations.readOnlyHint, true);
assert.equal(tool.annotations.destructiveHint, false);
assert.deepEqual(tool.annotations["hivemindos/sideEffects"], ["read"]);
assert.equal(tool.inputSchema.type, "object");

const item = toContextIndexItem(action);
assert.equal(item.id, "hive-action:demo.action");
assert.equal(item.kind, "tool-schema");
assert.equal(item.route, "/api/demo");
assert.deepEqual(item.methods, ["POST"]);
assert.match(item.retrievalText ?? "", /demo action/i);
assert.ok(item.aliases?.includes("demo_action"), "context item should include MCP alias");

console.log("Hive action registry tests passed.");

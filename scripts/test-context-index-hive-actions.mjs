#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { searchContextIndex } = await import("../src/lib/services/context-index.ts");

const result = await searchContextIndex({
  query: "wallet payment rail readiness x402 bankr veil usepod without spending",
  kinds: ["tool-schema"],
  limit: 12,
});

const crypto = result.items.find((item) => item.id === "hive-action:crypto.capabilities");
assert.ok(crypto, "Expected context-index search to return crypto capability Hive action.");
assert.equal(crypto.route, "/api/crypto/capabilities");
assert.match(crypto.retrievalText ?? "", /before any wallet, payment, x402/i);
assert.ok(crypto.aliases?.includes("crypto_capabilities"), "MCP alias should be indexed");

const brainResult = await searchContextIndex({
  query: "search compiled knowledge wiki node graph",
  kinds: ["tool-schema"],
  limit: 12,
});
assert.ok(
  brainResult.items.some((item) => item.id === "hive-action:brain.search-knowledge"),
  "Expected compiled brain search Hive action in context index.",
);

console.log("Context index Hive action retrieval passed.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { searchContextIndex } = await import("../src/lib/services/context-index.ts");
const { localAdminPrincipal } = await import("../src/lib/types/principal.ts");

const admin = localAdminPrincipal("local-user", "session");
const result = await searchContextIndex({
  query: "github connector connection status credential keys",
  kinds: ["connector"],
  principal: admin,
  limit: 20,
});
const github = result.items.find((item) => item.id === "connector:github");
assert.ok(github, "Expected GitHub connector manifest in Context Index.");
assert.equal(github.kind, "connector");
assert.equal(github.authorization?.risk, "low");
assert.ok(github.retrievalText?.includes("Credential keys by name only"));

const scopedOut = await searchContextIndex({
  query: "github connector",
  kinds: ["connector"],
  principal: {
    principalId: "limited",
    displayName: "Limited",
    kind: "local-user",
    source: "session",
    workspaceId: "default",
    claims: [],
  },
  limit: 20,
});
assert.equal(scopedOut.items.some((item) => item.id === "connector:github"), false);

console.log("Scoped Context Index connector tests passed.");

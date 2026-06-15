#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { fusionSkillTestHooks } = await import("../src/lib/services/fusion/fusion-skill.ts");
const { capabilityFromItem, fusedCapabilities, prioritizeCapabilities, relatedQueries } = fusionSkillTestHooks;

function item(id, kind, title, summary, score = 10) {
  return {
    id,
    kind,
    title,
    summary,
    tags: [],
    load: { type: "none" },
    score,
  };
}

const candidates = [
  item("skill:base-news-x-post", "skill", "base-news-x-post", "Search X for the latest Base chain news, draft an X post, generate an accompanying image, and deliver the package.", 300),
  item("connected-app:z-image", "connected-app", "Z-Image Studio", "Next.js control surface for Z-Image and ComfyUI image generation. Machine: This Mac.", 120),
  item("skill:liam-x-post-writing", "skill", "liam-x-post-writing", "Draft and improve X posts in Liam's voice without publishing.", 90),
  item("tool:xurl", "tool-schema", "xurl CLI", "Authenticated X/Twitter CLI for search, reads, posting, replies, DMs, media upload, and raw X API requests.", 80),
  item("app-endpoint:miroshark-simulate", "app-endpoint", "MiroShark Backend GET /api/simulate", "Simulation endpoint for unrelated app status.", 70),
  item("skill:base-news-broadcast-skill", "skill", "Base News Broadcast Skill", "A reusable Hive skill generated from this request: Turn the latest Base news into an X post.", 60),
];

function select(prompt) {
  const prioritized = prioritizeCapabilities(candidates, prompt);
  const capabilities = prioritized.map((candidate, index) => capabilityFromItem(candidate, index, false));
  return fusedCapabilities(capabilities, prompt);
}

{
  const selected = select("generates an image for me and drafts an x post to go with it");
  const ids = selected.map((capability) => capability.id);
  const usedIds = selected.filter((capability) => capability.used).map((capability) => capability.id);
  assert.ok(ids.includes("connected-app:z-image"), "keeps image generation candidates");
  assert.ok(ids.includes("skill:liam-x-post-writing"), "keeps X writing candidates");
  assert.ok(usedIds.includes("connected-app:z-image"), "fuses image generation");
  assert.ok(usedIds.includes("skill:liam-x-post-writing"), "fuses X writing");
  assert.ok(!ids.includes("skill:base-news-x-post"), "does not surface Base news for a generic X post");
  assert.ok(!ids.includes("skill:base-news-broadcast-skill"), "does not surface generated Base news skill for a generic X post");
  assert.ok(!ids.includes("app-endpoint:miroshark-simulate"), "does not fill recognized intents with unrelated endpoints");
}

{
  const selected = select("turn the latest Base news into an X post with a matching image");
  const ids = selected.map((capability) => capability.id);
  assert.ok(ids.includes("skill:base-news-x-post"), "allows Base news when the prompt asks for Base/news");
}

{
  const queries = relatedQueries("make a skill that renames files");
  assert.ok(!queries.some((query) => query.includes("agent worker runtime")), "plain skill creation does not add generic runtime fan-out");
}

{
  const queries = relatedQueries("draft an X post for my generated image");
  assert.ok(!queries.some((query) => query.includes("latest news")), "generic X post query does not request news");
}

console.log("fusion skill selection tests passed");

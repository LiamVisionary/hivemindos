#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const view = readFileSync("src/components/socials/SocialsView.tsx", "utf8");
const workspace = readFileSync("src/components/socials/SocialQueueWorkspace.tsx", "utf8");
const draftingCard = readFileSync("src/components/socials/DraftingAutomationCard.tsx", "utf8");
const engagementCard = readFileSync("src/components/socials/EngagementDiscoveryCard.tsx", "utf8");
const draftingGenerator = readFileSync("src/lib/services/socials/social-draft-generator.ts", "utf8");
const draftingModel = readFileSync("src/lib/services/socials/social-draft-model.ts", "utf8");
const engagementGenerator = readFileSync("src/lib/services/socials/social-engagement-generator.ts", "utf8");
const discovery = readFileSync("src/lib/services/socials/social-x-discovery.ts", "utf8");
const route = readFileSync("src/app/api/socials/queue/route.ts", "utf8");
const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
const catalog = readFileSync("src/lib/services/hive-actions/catalog.ts", "utf8");

assert.doesNotMatch(view, /No queue engine running yet|lands in Phase 2|arrive in the next phases/);
assert.match(view, /SocialQueueWorkspace/);
for (const action of ["create", "update", "schedule", "send-now", "cancel", "retry", "pause-engine", "resume-engine", "generate-drafts", "generate-engagement", "refresh-analytics"]) {
  assert.match(route, new RegExp(`case ["']${action}["']`), `queue route exposes ${action}`);
}
for (const feature of ["Send now", "Schedule", "History", "Analytics", "Refresh analytics", "Enable auto mode", "Agent drafting", "Generate full pack", "Comment finder", "Find replies now", "Open target", "Process queue"]) {
  assert.match(`${view}\n${workspace}\n${draftingCard}\n${engagementCard}`, new RegExp(feature), `Socials UI exposes ${feature}`);
}
assert.match(workspace, /metered hosted X API reads/);
assert.match(workspace, /Publish this reply/);
assert.match(workspace, /This is not a reply or comment/);
assert.match(workspace, /Post reply/);
assert.match(workspace, /Post standalone quote/);
assert.match(engagementCard, /Standalone quote posts.*optional/);
assert.match(engagementCard, /not replies or comments/);
assert.match(engagementCard, /It never likes, replies, quotes, or publishes by itself/);
assert.match(engagementGenerator, /human review/);
assert.match(discovery, /execFile/, "X discovery uses argument-safe process execution");
assert.doesNotMatch(discovery, /\bexec\(/, "X discovery never interpolates a shell command");
assert.match(instrumentation, /\[social-queue\] auto-started/);
assert.match(readFileSync("src/lib/services/socials/social-queue-engine.ts", "utf8"), /SOCIAL_QUEUE_RUNNER_SCHEMA/);
assert.match(draftingGenerator, /resolveSocialDraftModel/, "standalone drafting uses the shared Socials model resolver");
assert.match(draftingModel, /SOCIAL_DRAFT_FALLBACK_MODEL = ["']gpt-5\.6-luna["']/, "Socials uses Liam's preferred Luna model by default");
assert.match(catalog, /socialQueueSuggestionAction/);
assert.match(catalog, /socialQueueAccountPolicyAction/);

const { socialQueueSuggestionAction, socialQueueAccountPolicyAction } = await import("../src/lib/services/hive-actions/social-queue-action.ts");
assert.equal(socialQueueSuggestionAction.mcp?.toolName, "social_queue_suggestion");
assert.equal(socialQueueSuggestionAction.confirmation, undefined, "review-only suggestions need no publish approval");
assert.equal(socialQueueAccountPolicyAction.confirmation?.token, "CONFIRM_SOCIAL_AUTO_QUEUE");
assert.ok(socialQueueAccountPolicyAction.sideEffects.includes("public-message"));
assert.ok(socialQueueAccountPolicyAction.sideEffects.includes("payment"));

console.log("social queue surface tests passed");

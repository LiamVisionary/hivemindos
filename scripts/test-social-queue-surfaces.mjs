#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const view = readFileSync("src/components/socials/SocialsView.tsx", "utf8");
const workspace = readFileSync("src/components/socials/SocialQueueWorkspace.tsx", "utf8");
const draftingCard = readFileSync("src/components/socials/DraftingAutomationCard.tsx", "utf8");
const contextSourcesCard = readFileSync("src/components/socials/ContextSourcesCard.tsx", "utf8");
const engagementCard = readFileSync("src/components/socials/EngagementDiscoveryCard.tsx", "utf8");
const scheduleBoard = readFileSync("src/components/socials/SocialScheduleBoard.tsx", "utf8");
const analyticsDashboard = readFileSync("src/components/socials/SocialAnalyticsDashboard.tsx", "utf8");
const settingsWorkspace = readFileSync("src/components/socials/SocialSettingsWorkspace.tsx", "utf8");
const connectModal = readFileSync("src/components/socials/ConnectAccountModal.tsx", "utf8");
const xSessionCard = readFileSync("src/components/socials/XSessionCard.tsx", "utf8");
const socialsPanel = readFileSync("src/features/dashboard/views/socials/SocialsPanel.tsx", "utf8");
const socialsContext = readFileSync("src/components/socials/socials-context.tsx", "utf8");
const dashboardApp = readFileSync("src/features/dashboard/DashboardApp.tsx", "utf8");
const accountsRoute = readFileSync("src/app/api/socials/accounts/route.ts", "utf8");
const draftingGenerator = readFileSync("src/lib/services/socials/social-draft-generator.ts", "utf8");
const draftingModel = readFileSync("src/lib/services/socials/social-draft-model.ts", "utf8");
const engagementGenerator = readFileSync("src/lib/services/socials/social-engagement-generator.ts", "utf8");
const discovery = readFileSync("src/lib/services/socials/social-x-discovery.ts", "utf8");
const engagementDelivery = readFileSync("src/lib/services/socials/social-x-engagement-delivery.ts", "utf8");
const route = readFileSync("src/app/api/socials/queue/route.ts", "utf8");
const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
const catalog = readFileSync("src/lib/services/hive-actions/catalog.ts", "utf8");

assert.doesNotMatch(view, /No queue engine running yet|lands in Phase 2|arrive in the next phases/);
assert.match(view, /SocialQueueWorkspace/);
const redesignedSurfaces = [view, workspace, scheduleBoard, analyticsDashboard, settingsWorkspace, connectModal, draftingCard, engagementCard].join("\n");
for (const action of ["create", "update", "schedule", "send-now", "cancel", "retry", "pause-engine", "resume-engine", "generate-drafts", "generate-engagement", "refresh-analytics"]) {
  assert.match(route, new RegExp(`case ["']${action}["']`), `queue route exposes ${action}`);
}
for (const feature of ["Post now", "Schedule", "Scheduled", "Analytics", "Refresh analytics", "Auto (opt in)", "Agent drafting", "Generate full pack", "Comment finder", "Find replies now", "Open target", "Process queue"]) {
  assert.ok(redesignedSurfaces.includes(feature), `Socials UI exposes ${feature}`);
}
for (const feature of ["All accounts", "Review queue", "Approve &amp; schedule", "Pick a time", "Voice & context", "Connect account step"]) {
  assert.ok(redesignedSurfaces.includes(feature), `redesigned Socials UI exposes ${feature}`);
}
assert.match(scheduleBoard, /draggable/, "scheduled posts can be dragged to another day");
assert.match(analyticsDashboard, /metered hosted X API reads/);
assert.match(workspace, /Publish this reply/);
assert.match(workspace, /This is not a reply or comment/);
assert.match(workspace, /reply: "Replies"/, "review filters use the correct Replies label");
assert.match(workspace, /canDeliver.*account\?\.probe\.ok/, "publishing controls require a live connection probe");
assert.match(workspace, /You can still save a draft/, "failed connections preserve the safe draft path");
assert.match(route, /Reconnect @\$\{account\.handle\} before publishing/, "send-now fails before approval when the connection probe fails");
assert.match(connectModal, /event\.key === "Escape"/, "connect modal closes from Escape");
assert.match(connectModal, /focusableSelector/, "connect modal contains keyboard focus");
assert.match(engagementCard, /Standalone quote posts.*optional/);
assert.match(engagementCard, /not replies or comments/);
assert.match(engagementCard, /It never likes, replies, quotes, or publishes by itself/);
assert.match(settingsWorkspace, /XSessionCard/, "the selected X account exposes its Agent Reach session settings");
assert.match(xSessionCard, /Agent Reach X session/);
assert.match(xSessionCard, /SharedHiveEnvCredentialInput/, "X cookies use the existing secret-safe Shared Hive Env control");
assert.match(xSessionCard, /Per-account credentials/);
assert.match(xSessionCard, /Machine default/);
assert.match(xSessionCard, /SOCIAL_X_.*_AUTH_TOKEN|suggestedSocialXSessionEnvKeys/);
assert.match(socialsContext, /setXSessionBinding/);
assert.match(socialsPanel, /action: ["']set-x-session["']/);
assert.match(socialsPanel, /setQueueCounts/, "queue actions keep per-account review badges current");
assert.match(
  dashboardApp,
  /import\("@\/features\/dashboard\/views\/trade\/TradePanel"\),\s*\n\s*\(\) => import\("@\/features\/dashboard\/views\/socials\/SocialsPanel"\)/,
  "Socials lazy chunk warms immediately after Trade during dashboard idle time",
);
assert.match(accountsRoute, /case ["']set-x-session["']/);
assert.match(accountsRoute, /hiveEnvPresence/, "the server checks configured key names without returning cookie values");
assert.match(accountsRoute, /withSocialXSessionBinding/);
assert.match(accountsRoute, /invalidateXDiscoveryStatus/);
assert.match(accountsRoute, /getXDiscoveryStatusForAccount/, "the server verifies the selected cookies belong to the connected handle before persisting them");
assert.match(accountsRoute, /queueCounts/, "account chips receive real review-queue counts");
assert.match(engagementGenerator, /human review/);
assert.match(discovery, /execFile/, "X discovery uses argument-safe process execution");
assert.doesNotMatch(discovery, /\bexec\(/, "X discovery never interpolates a shell command");
assert.match(
  discovery,
  /input\.runTwitterImpl \?\? await createAccountTwitterCliRun\(input\.account\)/,
  "live discovery resolves the selected account's Agent Reach session before any X read",
);
assert.match(
  engagementDelivery,
  /input\.runTwitterImpl \?\? await createAccountTwitterCliRun\(input\.account\)/,
  "reply and quote delivery use the same selected-account Agent Reach session",
);
assert.match(instrumentation, /\[social-queue\] auto-started/);
assert.match(readFileSync("src/lib/services/socials/social-queue-engine.ts", "utf8"), /SOCIAL_QUEUE_RUNNER_SCHEMA/);
assert.match(draftingGenerator, /resolveSocialDraftModel/, "standalone drafting uses the shared Socials model resolver");
assert.match(draftingModel, /SOCIAL_DRAFT_FALLBACK_MODEL = ["']gpt-5\.6-luna["']/, "Socials uses Liam's preferred Luna model by default");
assert.match(draftingCard, /socialAccountHasStandaloneGroundingSource/);
assert.match(draftingCard, /Add context first/);
assert.match(draftingCard, /runtime\?\.lastError && standaloneReady/, "a stale generation failure cannot obscure the missing-context setup state");
assert.match(contextSourcesCard, /X account references guide Comment finder but do not import post history/);
assert.match(catalog, /socialQueueSuggestionAction/);
assert.match(catalog, /socialQueueAccountPolicyAction/);

const { socialQueueSuggestionAction, socialQueueAccountPolicyAction } = await import("../src/lib/services/hive-actions/social-queue-action.ts");
assert.equal(socialQueueSuggestionAction.mcp?.toolName, "social_queue_suggestion");
assert.equal(socialQueueSuggestionAction.confirmation, undefined, "review-only suggestions need no publish approval");
assert.equal(socialQueueAccountPolicyAction.confirmation?.token, "CONFIRM_SOCIAL_AUTO_QUEUE");
assert.ok(socialQueueAccountPolicyAction.sideEffects.includes("public-message"));
assert.ok(socialQueueAccountPolicyAction.sideEffects.includes("payment"));

console.log("social queue surface tests passed");

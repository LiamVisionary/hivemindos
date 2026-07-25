#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  buildCapabilityApprovalPlan,
  capabilityApprovalContinuationPrompt,
  normalizeCapabilityApprovalPlan,
  requiresCapabilityApproval,
} = await import("../src/lib/services/chat/capability-approval.ts");
const { CAPABILITY_APPROVAL_CONTINUATION_MARKER, capabilityPlanRequiresReview } = await import("../src/lib/types/capability-approval.ts");
const { compactChatMessagesForStorage, parseStoredChatMessages } = await import("../src/features/dashboard/dashboard-storage.ts");

const ready = (id, title, summary = `${title} is ready`) => ({
  id,
  kind: "skill",
  title,
  summary,
  tags: ["fixture"],
  load: { type: "file", target: `/fixture/${id}` },
  score: 80,
});
const setup = (id, title) => ({
  ...ready(`skill:packaged:optional:${id}`, title, `${title} must be installed`),
  score: 92,
});

const search = async (_options, queries) => queries.map(({ query }) => {
  if (query.includes("image generation")) return { items: [setup("image-studio", "Image Studio")], totals: {} };
  if (query.includes("deploy deployment")) return { items: [ready("skill:shared:cloudflare", "Cloudflare")], totals: {} };
  if (query.includes("frontend design")) return { items: [ready("skill:shared:frontend-design", "Frontend Design")], totals: {} };
  return { items: [ready("skill:shared:hivemindos-feature-development", "hivemindos-feature-development")], totals: {} };
});

const plan = await buildCapabilityApprovalPlan({
  task: "Build a landing page with a generated hero image and deploy it",
  agentId: "queen-bee",
  agentName: "Queen Bee",
  chatStorageKey: "queen-bee::launch",
  chatLeaf: "launch",
  vaultPath: "/fixture/vault",
  origin: "http://localhost:5021",
  connectedApps: [],
  search,
  now: 1_700_000_000_000,
});

assert.equal(plan.status, "pending");
assert.equal(plan.reviewMode, "ask", "multi-capability builds still require review");
assert.equal(capabilityPlanRequiresReview(plan), true);
assert.ok(plan.items.length >= 4, "multi-part build maps to multiple capability families");
const image = plan.items.find((item) => item.intent === "image-generation");
assert.equal(image?.decision, "approve-setup", "missing capability setup defaults to approve");
assert.equal(image?.candidates[0].availability, "setup-required");
const deploy = plan.items.find((item) => item.intent === "deployment");
assert.equal(deploy?.decision, "use", "installed capability is selected without another approval toggle");
const appWorkspace = plan.items.find((item) => item.intent === "app-builder");
assert.equal(appWorkspace?.candidates[0]?.id, "hive-action:apps.build", "standalone app requests always use the built-in durable App Builder workspace");
assert.equal(appWorkspace?.candidates[0]?.locator, "/api/app-builder");

const appBuilderContextItems = [
  {
    id: "hive-action:apps.build",
    kind: "tool-schema",
    title: "Create app workspace",
    summary: "Build and run a durable app project.",
    tags: ["app-builder", "capability"],
    aliases: ["apps.build", "app_builder"],
    route: "/api/app-builder",
    load: { type: "api", target: "/api/app-builder" },
    score: 220,
  },
  {
    id: "api:/api/app-builder",
    kind: "api-route",
    title: "/api/app-builder",
    summary: "GET, POST endpoint for /api/app-builder.",
    tags: ["api", "app-builder"],
    route: "/api/app-builder",
    load: { type: "file", target: "/fixture/src/app/api/app-builder/route.ts" },
    score: 180,
  },
];

const flappyPlan = await buildCapabilityApprovalPlan({
  task: "build me a flappy bird clone in html and css",
  agentId: "hermes",
  chatStorageKey: "hermes::flappy",
  origin: "http://localhost:5021",
  connectedApps: [],
  search: async (_options, queries) => queries.map(() => ({ items: appBuilderContextItems, totals: {} })),
  now: 1_700_000_000_050,
});
assert.deepEqual(flappyPlan.items.map((item) => item.intent), ["app-builder"], "a standalone game uses one coherent App workspace capability instead of a repo-development workflow");
assert.equal(flappyPlan.items[0]?.selectedCapabilityId, "hive-action:apps.build");
assert.equal(flappyPlan.items[0]?.candidates[0]?.name, "Create app workspace", "the App Builder label cannot imply that the HivemindOS product itself will be modified");
assert.deepEqual(flappyPlan.items[0]?.candidates.map((candidate) => candidate.id), ["hive-action:apps.build"], "the raw App Builder API route is not presented as a second capability");
assert.equal(flappyPlan.reviewMode, "automatic", "one ready unambiguous capability continues without asking for approval");

// Regression (2026-07-24): in a real vault, discovery surfaces alternates next
// to the built-in workspace. The built-in selection IS the plain "build me X"
// request — alternates are steering options and must not force a review stop.
const flappyWithAlternatesPlan = await buildCapabilityApprovalPlan({
  task: "build a flappy bird clone but instead of birds use bees",
  agentId: "hermes",
  chatStorageKey: "hermes::flappy-bees",
  origin: "http://localhost:5021",
  connectedApps: [],
  search: async (_options, queries) => queries.map(() => ({
    items: [
      ...appBuilderContextItems,
      {
        id: "mcp:website-builder-suite",
        kind: "mcp-tool",
        title: "Website builder suite",
        summary: "Third-party site generator integration.",
        tags: ["app-builder", "website"],
        route: "/api/mcp/website-builder",
        load: { type: "api", target: "/api/mcp/website-builder" },
        score: 200,
      },
    ],
    totals: {},
  })),
  now: 1_700_000_000_060,
});
assert.equal(flappyWithAlternatesPlan.items[0]?.selectedCapabilityId, "hive-action:apps.build", "the built-in workspace stays selected ahead of discovered alternates");
assert.ok((flappyWithAlternatesPlan.items[0]?.candidates.length ?? 0) > 1, "the regression fixture must actually surface an alternate candidate");
assert.equal(flappyWithAlternatesPlan.reviewMode, "automatic", "discovered alternates must not turn a plain app build into an approval stop");
assert.equal(capabilityPlanRequiresReview(flappyPlan), false);
const flappyContinuation = capabilityApprovalContinuationPrompt(flappyPlan);
assert.doesNotMatch(flappyContinuation, /hivemindos-feature-development/i, "a standalone game continuation cannot load the HivemindOS repo-development skill");
assert.doesNotMatch(flappyContinuation, /the user approved/i, "an automatic capability selection cannot claim the user approved it");
assert.match(flappyContinuation, /selected this ready capability automatically/i, "the automatic continuation explains why no review was needed");
assert.match(flappyContinuation, /invoke_hive_capability/, "the App Builder continuation names the capability tool actually exposed by this chat runtime");
assert.doesNotMatch(flappyContinuation, /Use the app_builder tool/, "the App Builder continuation cannot direct the model to an unavailable direct tool");

const { capabilityAppProjectContext, prepareCapabilityAppProject } = await import("../src/lib/services/chat/capability-app-project-client.ts");
const preparedAppProject = await prepareCapabilityAppProject({
  plan: flappyPlan,
  baseDirectory: "/fixture/workspace",
  machine: { key: "local", name: "This Mac" },
  request: async (body) => ({
    ok: true,
    project: {
      id: "project-e2e",
      name: body.name,
      directory: body.directory,
      templateId: body.templateId,
      status: "stopped",
      dependenciesReady: false,
      createdAt: 1_700_000_000_050,
      updatedAt: 1_700_000_000_050,
    },
  }),
});
assert.equal(preparedAppProject?.artifact.projectId, "project-e2e", "automatic selection prepares the same durable App Builder artifact as manual approval");
assert.match(preparedAppProject?.artifact.directory ?? "", /scratchpad\/a-flappy-bird-clone-in-html-and-css-/);
const preparedAppProjectContext = capabilityAppProjectContext(preparedAppProject?.artifact);
assert.match(preparedAppProjectContext, /Assigned App Builder project:/);
assert.match(preparedAppProjectContext, /invoke_hive_capability/, "assigned projects name the executable capability wrapper");
assert.match(preparedAppProjectContext, /action=\"files_write\"/, "assigned projects tell the agent to use App Builder file writes");
assert.match(preparedAppProjectContext, /index\.html, styles\.css, and script\.js/, "static projects identify their existing root files");
assert.match(preparedAppProjectContext, /Do not run pnpm or npm/i, "static projects do not invent a package build pipeline");
const restoredInterruptedAutomaticPlan = parseStoredChatMessages({
  "hivemindos.chatMessages.v1": JSON.stringify(compactChatMessagesForStorage({
    "hermes::flappy": [{ role: "assistant", content: "", capabilityApproval: flappyPlan }],
  })),
});
assert.equal(
  restoredInterruptedAutomaticPlan["hermes::flappy"][0].capabilityApproval?.reviewMode,
  "ask",
  "an interrupted automatic continuation recovers as a visible review card after reload",
);

const redesigned = {
  ...plan,
  items: plan.items.map((item) => item.intent === "image-generation"
    ? { ...item, decision: "remove" }
    : item.intent === "interface-design"
      ? { ...item, instructions: "Look through GitHub for a better accessible implementation." }
      : item),
};
const continuation = capabilityApprovalContinuationPrompt(redesigned);
assert.match(continuation, /Remove the Image generation step entirely/);
assert.match(continuation, /Look through GitHub for a better accessible implementation/);
assert.match(continuation, /existing spend, secret, deploy, and destructive-action gates still apply/);

assert.equal(requiresCapabilityApproval("Build a dashboard"), true);
assert.equal(requiresCapabilityApproval(`Build a dashboard\n${CAPABILITY_APPROVAL_CONTINUATION_MARKER}`), false, "approved continuation cannot loop back into preflight");
assert.equal(requiresCapabilityApproval("What is a dashboard?"), false);
assert.equal(requiresCapabilityApproval("Refactor this sentence for clarity"), false, "non-software refactoring does not trigger a build approval");
const nonBuildGenerationPlan = await buildCapabilityApprovalPlan({
  task: "Generate a short poem for the launch",
  agentId: "queen-bee",
  chatStorageKey: "queen-bee::generic-build",
  origin: "http://localhost:5021",
  connectedApps: [],
  search: async (_options, queries) => queries.map(() => ({ items: [ready("skill:shared:general-builder", "General Builder")], totals: {} })),
  now: 1_700_000_000_100,
});
assert.equal(requiresCapabilityApproval("Generate a short poem for the launch"), false, "content-only generation does not masquerade as a software build");
assert.equal(nonBuildGenerationPlan.items.length, 0, "content-only generation has no capability approval families");
assert.equal(normalizeCapabilityApprovalPlan({ version: 1 }), null, "invalid client payload is rejected at the API boundary");
assert.equal(normalizeCapabilityApprovalPlan(plan)?.id, plan.id);

const compacted = compactChatMessagesForStorage({
  "queen-bee::launch": [{ role: "assistant", content: "", capabilityApproval: plan }],
});
assert.equal(compacted["queen-bee::launch"][0].capabilityApproval?.id, plan.id, "contentless capability cards remain durable");
const restored = parseStoredChatMessages({
  "hivemindos.chatMessages.v1": JSON.stringify(compacted),
});
assert.equal(restored["queen-bee::launch"][0].capabilityApproval?.items.length, plan.items.length, "capability choices survive dashboard-state hydration");

const intentPlan = async (task, searchOverride = async (_options, queries) => queries.map(() => ({ items: [], totals: {} }))) => buildCapabilityApprovalPlan({
  task,
  agentId: "queen-bee",
  agentName: "Queen Bee",
  chatStorageKey: `queen-bee::${task}`,
  origin: "http://localhost:5021",
  connectedApps: [],
  search: searchOverride,
  now: 1_700_000_001_000,
});

const intentPlanInDirectory = async (task, workingDirectory, searchOverride) => buildCapabilityApprovalPlan({
  task,
  agentId: "queen-bee",
  agentName: "Queen Bee",
  chatStorageKey: `queen-bee::${task}`,
  origin: "http://localhost:5021",
  connectedApps: [],
  workingDirectory,
  search: searchOverride,
  now: 1_700_000_001_001,
});

const expectedPromptMappings = [
  ["Build a polished landing page with a generated hero image and deploy it", ["app-builder", "interface-design", "image-generation", "deployment"]],
  ["Generate a product hero image", ["image-generation"]],
  ["Create a short launch video", ["video-generation"]],
  ["Build Stripe checkout for the app", ["implementation", "payments"]],
  ["Build a wallet dashboard for USDC payments", ["app-builder", "interface-design", "payments"]],
  ["Build a Slack notification integration", ["implementation", "communications"]],
  ["Fix the login bug in the web app", ["implementation", "interface-design"]],
  ["Build a browser scraper that fills forms", ["implementation", "browser-automation"]],
  ["Build an automation that emails a report weekly", ["implementation", "communications", "scheduling"]],
  ["Build an MCP server for our internal API", ["implementation", "mcp-development"]],
  ["Build an Excel dashboard from this CSV", ["data-work"]],
  ["Build a Power BI dashboard", ["data-work"]],
  ["Create a PowerPoint presentation for the launch", ["presentation"]],
  ["Create a PDF brochure", ["document"]],
  ["Generate a narrated podcast audio episode", ["audio-generation"]],
  ["Create a 3D avatar", ["three-dimensional"]],
  ["Create an architecture diagram", ["diagramming"]],
  ["Download a YouTube video with yt-dlp", ["media-download"]],
  ["Transcribe this interview locally with Whisper", ["transcription"]],
  ["Connect Plausible website analytics", ["analytics"]],
  ["Set up AppFlowy for our project boards", ["knowledge-workspace"]],
  ["Install n8n workflow automation", ["implementation", "workflow-automation"]],
  ["Connect Cal.com for booking links", ["scheduling"]],
  ["Map this codebase with Graphify", ["code-mapping"]],
  ["Install TradingAgents to debate market strategies", ["trading-research"]],
  ["Install Ghost as a Substack alternative", ["publishing-platform"]],
  ["Install Medusa as our commerce backend", ["implementation", "commerce-platform"]],
  ["Connect our Shopify store", ["commerce-platform"]],
  ["Generate a social image and publish an X post", ["image-generation", "communications"]],
  ["Build an iOS app with push notifications", ["implementation", "communications"]],
  ["Research the latest AI news and publish an X post", ["research", "communications"]],
  ["Set up a local TTS service", ["implementation", "audio-generation"]],
  ["Build an API that emails the team a status report every day", ["implementation", "communications", "scheduling"]],
  ["Implement Stripe checkout", ["implementation", "payments"]],
  ["Prototype a React component", ["implementation", "interface-design"]],
  ["Write a Python CLI tool", ["implementation"]],
  ["Create a logo for the launch", ["image-generation"]],
  ["Create a logo for the app", ["image-generation"]],
  ["Create an app icon", ["image-generation"]],
  ["Design a mobile app interface", ["implementation", "interface-design"]],
  ["Make a Chrome extension that scrapes pages", ["implementation", "browser-automation"]],
  ["Build and deploy a dashboard that researches the latest news, analyzes a CSV, generates an image and video, emails Slack, charges a USDC payment, and schedules daily updates", ["app-builder", "research", "interface-design", "image-generation", "video-generation", "deployment", "communications", "data-work", "payments", "scheduling"]],
];

for (const [task, expectedIntents] of expectedPromptMappings) {
  assert.equal(requiresCapabilityApproval(task), true, `build request requires approval: ${task}`);
  const mapped = await intentPlan(task);
  assert.deepEqual(mapped.items.map((item) => item.intent), expectedIntents, `maps exact capability families: ${task}`);
}

for (const task of [
  "Explain how image generation works",
  "What is deployment?",
  "What is my wallet balance?",
  "Review this report and tell me what it says",
  "Create a plan for learning TypeScript",
  "Make this paragraph clearer",
  "Research whether Rust is memory safe",
  "Write an email to the team",
  "Draft an X post",
  "Fix the grammar in this sentence",
  "Refactor this sentence for clarity",
  "Design a dinner menu",
  "Generate three startup ideas",
  "Explain how to build a dashboard",
  "How do I implement Stripe checkout?",
  "Create a deployment plan",
  "Build a research plan for AI news",
]) {
  assert.equal(requiresCapabilityApproval(task), false, `non-build request bypasses capability approval: ${task}`);
}

const capabilityHit = ({ id, title, summary, score, kind = "skill" }) => ({
  id,
  kind,
  title,
  summary,
  tags: [],
  load: { type: "file", target: `/fixture/${id}` },
  score,
});

const implementationCandidates = [
  capabilityHit({ id: "skill:shared:hivemindos-feature-development", title: "hivemindos-feature-development", summary: "Implement HivemindOS repository features safely and verify the result.", score: 500 }),
  capabilityHit({ id: "skill:shared:test-driven-development", title: "test-driven-development", summary: "Implement software with a general test-first workflow.", score: 40 }),
];
const implementationSearch = async (_options, queries) => queries.map(() => ({ items: implementationCandidates, totals: {} }));

for (const task of [
  "Write a Python CLI tool",
  "Implement Stripe checkout",
  "Fix the login bug in the web app",
  "Build a React component for my app",
  "Write a CLI that calls the HivemindOS API",
]) {
  const mapped = await intentPlan(task, implementationSearch);
  const selected = mapped.items.find((item) => item.intent === "implementation")?.candidates[0];
  assert.equal(selected?.id, "skill:shared:test-driven-development", `generic implementation cannot select a HivemindOS-repo-only skill: ${task}`);
}

for (const task of [
  "Fix the HivemindOS dashboard navigation bug",
  "Add a capability approval feature to the HivemindOS app",
  "Refactor the HivemindOS repository chat runtime",
  "Implement a new Fleet view in HivemindOS",
]) {
  const mapped = await intentPlan(task, implementationSearch);
  const selected = mapped.items.find((item) => item.intent === "implementation")?.candidates[0];
  assert.equal(selected?.id, "skill:shared:hivemindos-feature-development", `explicit HivemindOS product work keeps the repo workflow: ${task}`);
  assert.equal(mapped.items.some((item) => item.intent === "app-builder"), false, `HivemindOS product work cannot create a standalone App workspace: ${task}`);
}

const attachedRepoPlan = await intentPlanInDirectory(
  "Fix the login bug in the web app",
  "/workspace/hivemind-os",
  implementationSearch,
);
assert.equal(attachedRepoPlan.items.find((item) => item.intent === "implementation")?.candidates[0]?.id, "skill:shared:hivemindos-feature-development", "an attached HivemindOS checkout provides explicit repository context");

const appWorkspaceCases = [
  ["Build a Flappy Bird clone", true],
  ["Create a small website", true],
  ["Make a landing page", true],
  ["Develop a web app", true],
  ["Prototype an analytics dashboard", true],
  ["Code a canvas game", true],
  ["Build a feature-rich web app", true],
  ["Build a productivity tool web app", true],
  ["Build an AI image generation web app", true],
  ["Build an Excel import web app", true],
  ["Create a photo editing website", true],
  ["Build an automation monitoring dashboard", true],
  ["Build Stripe checkout for the app", false],
  ["Build a React component for my app", false],
  ["Build the app's Stripe checkout", false],
  ["Build a dashboard component", false],
  ["Create a logo for the app", false],
  ["Create an app icon", false],
  ["Build an Excel dashboard", false],
  ["Build a Power BI dashboard", false],
  ["Build an iOS app", false],
  ["Build an Android application", false],
  ["Develop a React Native mobile app", false],
  ["Create a Notion page", false],
  ["Create a game design document", false],
  ["Build a Chrome extension for a web app", false],
  ["Build a Flappy Bird clone with HivemindOS App Builder", true],
  ["Build a clone of the HivemindOS app", true],
  ["Create a website about the HivemindOS app", true],
];
for (const [task, expected] of appWorkspaceCases) {
  const mapped = await intentPlan(task, implementationSearch);
  assert.equal(mapped.items.some((item) => item.intent === "app-builder"), expected, `App workspace primary-output routing: ${task}`);
  if (expected) assert.equal(mapped.items.some((item) => item.intent === "implementation"), false, `App workspace subsumes generic implementation: ${task}`);
}

const mixedStandaloneAndRepoPlan = await intentPlan("Build a game and add a feature to HivemindOS", implementationSearch);
assert.deepEqual(mixedStandaloneAndRepoPlan.items.map((item) => item.intent), ["implementation", "app-builder"], "a standalone app and a separate repository change retain both capability families");
assert.equal(mixedStandaloneAndRepoPlan.items.find((item) => item.intent === "implementation")?.candidates[0]?.id, "skill:shared:hivemindos-feature-development", "the independent repository clause keeps its repository workflow");

const duplicateFrontendPlan = await intentPlan("Build a frontend interface", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "tool-schema:dashboard-swarm-goal", kind: "tool-schema", title: "Dashboard /swarm-goal command", summary: "Delegates broad build goals to the Work Board.", score: 200 }),
    capabilityHit({ id: "skill:packaged:optional:frontend-design", title: "frontend-design", summary: "Installable frontend design workflow.", score: 137 }),
    capabilityHit({ id: "skill:shared:frontend-design", title: "frontend-design", summary: "Installed frontend design workflow.", score: 67 }),
  ],
  totals: {},
})));
const frontendIntent = duplicateFrontendPlan.items.find((item) => item.intent === "interface-design");
assert.equal(frontendIntent?.candidates[0]?.id, "skill:shared:frontend-design", "installed equivalent outranks packaged setup duplicate and generic coordinator");
assert.equal(frontendIntent?.candidates[0]?.availability, "ready");
assert.equal(frontendIntent?.candidates.filter((candidate) => candidate.name === "frontend-design").length, 1, "equivalent capabilities are deduplicated");

const adversarialCandidates = [
  capabilityHit({ id: "tool-schema:dashboard-swarm-goal", kind: "tool-schema", title: "Dashboard /swarm-goal command", summary: "Delegates broad build goals to the Work Board.", score: 240 }),
  capabilityHit({ id: "tool-schema:crypto-router", kind: "tool-schema", title: "crypto capability router", summary: "Routes USDC, wallet, and x402 transactions.", score: 205 }),
  capabilityHit({ id: "app:media-studio", kind: "connected-app", title: "Media Studio", summary: "Generate images and videos.", score: 167 }),
  capabilityHit({ id: "tool-schema:miroshark-graph", kind: "tool-schema", title: "MiroShark graph-task endpoint", summary: "Build simulation graphs.", score: 180 }),
  capabilityHit({ id: "skill:shared:kill-my-thesis", title: "kill-my-thesis", summary: "Adversarial investment thesis review.", score: 111 }),
  capabilityHit({ id: "skill:shared:comfyui-image-generation", title: "comfyui-image-generation", summary: "Installed ComfyUI image generation workflow.", score: 100 }),
  capabilityHit({ id: "skill:packaged:optional:stripe-payment-integration", title: "stripe-payment-integration", summary: "Installable Stripe Checkout and billing workflow.", score: 102 }),
  capabilityHit({ id: "skill:shared:spreadsheets", title: "Spreadsheets", summary: "Installed Excel, CSV, charts, and workbook workflow.", score: 45 }),
  capabilityHit({ id: "skill:shared:storm-research", title: "storm-research", summary: "Research current topics from multiple sources.", score: 80 }),
  capabilityHit({ id: "tool-schema:x-api-mcp", kind: "tool-schema", title: "X API MCP", summary: "Research and publish X social posts.", score: 78 }),
  capabilityHit({ id: "skill:packaged:optional:customer-email-draft-threads", title: "customer-email-draft-threads", summary: "Draft customer emails through an automation workflow.", score: 195 }),
  capabilityHit({ id: "external-agent-provider:n8n", kind: "runtime", title: "n8n", summary: "Recurring workflow automation service with schedules and integrations.", score: 45 }),
  capabilityHit({ id: "tool-schema:loop-engineering-readiness", kind: "tool-schema", title: "Loop engineering readiness", summary: "Check whether engineering loops and automation tests are ready.", score: 400 }),
];
const adversarialSearch = async (_options, queries) => queries.map(() => ({ items: adversarialCandidates, totals: {} }));

const implementationPlan = await intentPlan("Write a Python CLI tool", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "skill:shared:codebase-inspection", title: "codebase-inspection", summary: "Inspect codebases with pygount for LOC, languages, and ratios.", score: 155 }),
    capabilityHit({ id: "skill:shared:test-driven-development", title: "test-driven-development", summary: "Implement software with a general test-first workflow.", score: 50 }),
  ],
  totals: {},
})));
assert.equal(implementationPlan.items.find((item) => item.intent === "implementation")?.candidates[0]?.id, "skill:shared:test-driven-development", "generic build requests select an implementation workflow instead of a code-metrics inspector");

const comfyPlan = await intentPlan("Install and use ComfyUI to generate an image", adversarialSearch);
assert.equal(comfyPlan.items.find((item) => item.intent === "image-generation")?.candidates[0]?.id, "skill:shared:comfyui-image-generation", "explicit provider request wins over a higher-scoring generic media app");

const stripePlan = await intentPlan("Build Stripe checkout for card billing", adversarialSearch);
assert.equal(stripePlan.items.find((item) => item.intent === "payments")?.candidates[0]?.id, "skill:packaged:optional:stripe-payment-integration", "Stripe task selects Stripe rather than crypto routing");

const spreadsheetPlan = await intentPlan("Build an Excel spreadsheet dashboard from a CSV", adversarialSearch);
assert.equal(spreadsheetPlan.items.find((item) => item.intent === "data-work")?.candidates[0]?.id, "skill:shared:spreadsheets", "spreadsheet task selects spreadsheet capability rather than graph simulation");

const researchPlan = await intentPlan("Research the latest AI news", adversarialSearch);
assert.equal(researchPlan.items.find((item) => item.intent === "research")?.candidates[0]?.id, "skill:shared:storm-research", "general current research does not select investment-thesis review");

const socialPlan = await intentPlan("Generate an image and publish an X post", adversarialSearch);
assert.equal(socialPlan.items.find((item) => item.intent === "communications")?.candidates[0]?.id, "tool-schema:x-api-mcp", "social delivery intent is not contaminated by image-generation candidates");

const schedulePlan = await intentPlan("Build an automation that emails a report weekly", adversarialSearch);
assert.equal(schedulePlan.items.find((item) => item.intent === "scheduling")?.candidates[0]?.id, "external-agent-provider:n8n", "a recurring task selects a scheduler instead of a high-scoring email-draft recipe");
assert.equal(schedulePlan.items.find((item) => item.intent === "scheduling")?.candidates[0]?.availability, "setup-required", "a catalog-only external provider is not mislabeled as installed");

const connectedSchedulerPlan = await intentPlan("Build an automation that emails a report weekly", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "external-agent-provider:n8n", kind: "tool-schema", title: "n8n", summary: "Installable workflow scheduler.", score: 180 }),
    capabilityHit({ id: "connected-app:n8n", kind: "connected-app", title: "n8n", summary: "Connected workflow scheduler available now.", score: 35 }),
  ],
  totals: {},
})));
const connectedScheduler = connectedSchedulerPlan.items.find((item) => item.intent === "scheduling")?.candidates[0];
assert.equal(connectedScheduler?.id, "connected-app:n8n", "a discovered connected provider outranks its catalog-only setup entry");
assert.equal(connectedScheduler?.availability, "ready");

const builtInSchedulerPlan = await intentPlan("Build an automation that emails a report weekly", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "skill:packaged:optional:daily-briefing-trailer", title: "daily-briefing-trailer", summary: "Turn calendar emails into a daily cinematic briefing video automation.", score: 64 }),
    capabilityHit({ id: "skill:shared:local-gbp-posts-calendar", title: "local-gbp-posts-calendar", summary: "Build a Google Business Profile social posting calendar.", score: 500 }),
    capabilityHit({ id: "external-agent-provider:n8n", kind: "tool-schema", title: "n8n", summary: "Installable workflow automation scheduler.", score: 61 }),
    capabilityHit({ id: "api:/api/scheduler/cron-write", kind: "api-route", title: "/api/scheduler/cron-write", summary: "Ready scheduler cron endpoint.", score: 57 }),
  ],
  totals: {},
})));
assert.equal(builtInSchedulerPlan.items.find((item) => item.intent === "scheduling")?.candidates[0]?.id, "api:/api/scheduler/cron-write", "an installed scheduler identity outranks an incidental calendar mention in an unrelated media workflow");

const cadenceVsBookingPlan = await intentPlan("Build an automation that emails a report weekly", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "github-capability:calcom", kind: "tool-schema", title: "Cal.com", summary: "Scheduling and booking links through Cal.com.", score: 900 }),
    capabilityHit({ id: "hive-action:beeline.calendar-create", kind: "tool-schema", title: "Create Beeline calendar event", summary: "Create a family calendar event.", score: 800 }),
    capabilityHit({ id: "hive-action:beeline.calendar-list", kind: "tool-schema", title: "Read Beeline calendar", summary: "Read a family calendar.", score: 850 }),
    capabilityHit({ id: "api:/api/scheduler/cron-write", kind: "api-route", title: "/api/scheduler/cron-write", summary: "Ready recurring scheduler cron endpoint.", score: 20 }),
  ],
  totals: {},
})));
assert.equal(cadenceVsBookingPlan.items.find((item) => item.intent === "scheduling")?.candidates[0]?.id, "api:/api/scheduler/cron-write", "recurring automation uses a cron scheduler instead of an unrelated booking or calendar-event provider");

const explicitSchedulerPlan = await intentPlan("Install n8n and schedule a daily report", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "external-agent-provider:n8n", kind: "tool-schema", title: "n8n", summary: "Installable workflow automation scheduler.", score: 45 }),
    capabilityHit({ id: "api:/api/scheduler/cron-write", kind: "api-route", title: "/api/scheduler/cron-write", summary: "Ready scheduler cron endpoint.", score: 120 }),
  ],
  totals: {},
})));
assert.equal(explicitSchedulerPlan.items.find((item) => item.intent === "scheduling")?.candidates[0]?.id, "external-agent-provider:n8n", "an explicitly requested provider survives clause isolation and outranks a generic ready alternative");

const cloudflareDeploymentPlan = await intentPlan("Deploy the web app to Cloudflare", async (_options, queries) => queries.map(() => ({
  items: [
    capabilityHit({ id: "api:/api/cloudflare/agentic-inbox", kind: "api-route", title: "/api/cloudflare/agentic-inbox", summary: "GET and POST endpoint.", score: 500 }),
    capabilityHit({ id: "skill:shared:cloudflare-email-service", title: "cloudflare-email-service", summary: "Send and route transactional email with Cloudflare.", score: 600 }),
    capabilityHit({ id: "skill:shared:cloudflare-management", title: "cloudflare-management", summary: "Deploy and manage Cloudflare Workers and Pages.", score: 45 }),
  ],
  totals: {},
})));
assert.equal(cloudflareDeploymentPlan.items.find((item) => item.intent === "deployment")?.candidates[0]?.id, "skill:shared:cloudflare-management", "Cloudflare deployment rejects unrelated inbox and email-service capabilities");

const isolatedQueries = [];
await intentPlan("Generate an image and publish an X post", async (_options, queries) => {
  isolatedQueries.push(...queries.map((entry) => entry.query));
  return queries.map(() => ({ items: [], totals: {} }));
});
const communicationsQuery = isolatedQueries.find((query) => query.startsWith("email messaging"));
assert.ok(communicationsQuery, "communications query is present");
assert.doesNotMatch(communicationsQuery, /generate an image/i, "one intent's task excerpt does not pollute another intent's search");

let mergeRuntimeHydratedChatMessages;
try {
  ({ mergeRuntimeHydratedChatMessages } = await import("../src/lib/services/chat/runtime-session-message-merge.ts"));
} catch {
  mergeRuntimeHydratedChatMessages = null;
}
assert.equal(typeof mergeRuntimeHydratedChatMessages, "function", "runtime chat hydration exposes a tested durable-message merge");
const pendingCardMessage = { role: "assistant", content: "Drafted capabilities", createdAt: 300, capabilityApproval: plan };
const pendingRequestMessage = { role: "user", content: plan.task, createdAt: 299, attachments: [{ name: "brief.pdf", type: "application/pdf", path: "/fixture/brief.pdf" }] };
const hydratedTranscript = [
  { role: "user", content: "/model", createdAt: 100, sourceSessionId: "session-1" },
  { role: "assistant", content: "Current model", createdAt: 200, sourceSessionId: "session-1" },
];
const mergedHydration = mergeRuntimeHydratedChatMessages([...hydratedTranscript, pendingRequestMessage, pendingCardMessage], hydratedTranscript);
assert.equal(mergedHydration.length, 4, "runtime hydration preserves the local request and its capability card");
assert.equal(mergedHydration[2]?.content, plan.task);
assert.equal(mergedHydration[2]?.attachments?.[0]?.name, "brief.pdf", "runtime hydration preserves the request attachments needed by the approved continuation");
assert.equal(mergedHydration[3]?.capabilityApproval?.id, plan.id);
assert.equal(mergeRuntimeHydratedChatMessages(mergedHydration, hydratedTranscript).length, 4, "repeated hydration does not duplicate the request or card");

// Hydrated runtime transcripts carry no appArtifact; the merge must restamp the
// thread's latest local artifact so Chat Preview keeps its app binding
// (regression: adaptive multi-step hydration wiped the artifact and the preview
// pane reported "no runnable app" for a successfully built project).
const localArtifact = { protocol: "hivemindos.chat-app/v1", projectId: "local_artifact_1", name: "a flappy bird clone", directory: "/tmp/a-flappy-bird-clone", templateId: "static" };
const artifactLocalMessages = [
  { role: "user", content: "create a flappy bird clone", createdAt: 100 },
  { role: "assistant", content: "", createdAt: 101, appArtifact: localArtifact },
];
const artifactHydratedTranscript = [
  { role: "user", content: "create a flappy bird clone", createdAt: 100, sourceSessionId: "session-2" },
  { role: "assistant", content: "I'll build it.", createdAt: 102, sourceSessionId: "session-2" },
  { role: "assistant", content: "Done.", createdAt: 103, sourceSessionId: "session-2" },
];
const artifactMerged = mergeRuntimeHydratedChatMessages(artifactLocalMessages, artifactHydratedTranscript);
assert.equal(artifactMerged.length, 3, "artifact-bearing local messages are still replaced by the runtime transcript");
assert.equal(artifactMerged[2]?.appArtifact?.projectId, "local_artifact_1", "hydration restamps the latest local appArtifact onto the newest hydrated assistant message");
assert.equal(artifactMerged[1]?.appArtifact, undefined, "only the newest hydrated assistant message carries the restamped artifact");
const hydratedArtifact = { ...localArtifact, projectId: "local_artifact_2" };
const artifactAuthoritativeMerge = mergeRuntimeHydratedChatMessages(artifactLocalMessages, [
  ...artifactHydratedTranscript.slice(0, 2),
  { ...artifactHydratedTranscript[2], appArtifact: hydratedArtifact },
]);
assert.equal(artifactAuthoritativeMerge[2]?.appArtifact?.projectId, "local_artifact_2", "a hydrated appArtifact stays authoritative over the local one");
assert.equal(
  mergeRuntimeHydratedChatMessages([artifactLocalMessages[0]], artifactHydratedTranscript).some((message) => message.appArtifact),
  false,
  "hydration does not invent an appArtifact when the thread never had one",
);
const artifactWithCardMerge = mergeRuntimeHydratedChatMessages(
  [...artifactLocalMessages, pendingRequestMessage, pendingCardMessage],
  artifactHydratedTranscript,
);
assert.equal(artifactWithCardMerge.some((message) => message.appArtifact?.projectId === "local_artifact_1"), true, "artifact restamping also survives merges that preserve local approval exchanges");

const controllerSource = await readFile(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8");
const capabilityRouteSource = await readFile(new URL("../src/app/api/chat/capability-approval/route.ts", import.meta.url), "utf8");
const appBuilderActionSource = await readFile(new URL("../src/lib/services/hive-actions/app-builder.ts", import.meta.url), "utf8");
const chatTreeControllerSource = await readFile(new URL("../src/features/dashboard/hooks/use-chat-tree-controller.tsx", import.meta.url), "utf8");
const exchangePanelSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8");
const threadSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url), "utf8");
const approvalCardSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/CapabilityApprovalCard.tsx", import.meta.url), "utf8");
const approvalCardStyles = await readFile(new URL("../src/features/dashboard/views/chat/exchange/capability-approval-card.module.css", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("../src/features/dashboard/views/chat/exchange/ChatSidebar.tsx", import.meta.url), "utf8");
const dispatchSource = await readFile(new URL("../src/features/dashboard/dashboard-light-helpers.tsx", import.meta.url), "utf8");
const capabilitySearchSkillSource = await readFile(new URL("../packaged-skills/auto-install/hive-capability-search/SKILL.md", import.meta.url), "utf8");
const companyPolicySource = await readFile(new URL("../src/lib/services/company-approval-policies.ts", import.meta.url), "utf8");
const companyPolicyPanelSource = await readFile(new URL("../src/features/dashboard/views/zero-human-companies/ApprovalPoliciesPanel.tsx", import.meta.url), "utf8");
assert.match(controllerSource, /\/api\/chat\/capability-approval/, "chat route drafts the plan before runtime dispatch");
const publishOutgoingUserMessageIndex = controllerSource.indexOf("publishOutgoingUserMessage();");
const capabilityPreflightFetchIndex = controllerSource.indexOf('fetch("/api/chat/capability-approval"');
assert.ok(publishOutgoingUserMessageIndex >= 0, "chat submission publishes the outgoing message immediately");
assert.ok(
  capabilityPreflightFetchIndex >= 0 && publishOutgoingUserMessageIndex < capabilityPreflightFetchIndex,
  "chat publishes and clears the outgoing message before awaiting capability planning",
);
assert.match(controllerSource, /startCapabilityPreflightUi\([\s\S]+Checking capabilities/, "slow capability planning has a visible preflight state");
assert.equal(
  (controllerSource.match(/appendMessage\(selectedAgent\.id, outgoingUserMessage, selectedStorageKey\)/g) ?? []).length,
  1,
  "the optimistic user message is appended exactly once across capability and runtime branches",
);
assert.match(controllerSource, /workingDirectory:\s*selectedChatDirectoryPath/, "chat preflight sends the attached project directory as repository context");
assert.match(controllerSource, /!capabilityData\.required[\s\S]+prepareCapabilityAppProject[\s\S]+runChatMessage/, "the send controller continues an automatic plan without relying on a rendered approval card");
// A failed automatic preparation must read as an error with the standard retry
// affordance — an approval card cannot fix a broken machine, and clicking
// Continue on one just re-runs the same failure.
assert.match(controllerSource, /Error: Could not prepare the app workspace/, "a failed automatic preparation surfaces the real error");
assert.doesNotMatch(controllerSource, /capabilityApproval: reviewPlan/, "a failed automatic preparation must not downgrade into an approval card");
const clientSource = await readFile(new URL("../src/lib/services/chat/capability-app-project-client.ts", import.meta.url), "utf8");
assert.match(clientSource, /requestAppBuilderWithCollectorRecovery/, "workspace preparation must self-heal a collector that is behind the app-builder contract");

// The continuation prompt is plumbing: the thread must display only the words
// the person actually typed, and the app card only once the app has run.
const helpersSource = await readFile(new URL("../src/features/dashboard/views/chat/chat-panel-helpers.ts", import.meta.url), "utf8");
assert.match(helpersSource, /compactCapabilityContinuation/, "the display path must compact capability continuations");
assert.match(helpersSource, /Original task:\\s\*\(\.\+\)/, "the compacted display must recover the person's original task text");
assert.match(threadSource, /rawAppArtifact\.status === "running" \|\| rawAppArtifact\.port/, "the Open app card must wait for an app that has actually run");

// The sidebar is a display path too: thread titles, previews, and search text
// built from a runtime-task leaf must show the person's words, never the raw
// continuation prompt (live repro 2026-07-25: an AdaptiveAgent hermes-state
// leaf titled itself with the full plumbing prompt).
const { compactCapabilityContinuation } = await import("../src/features/dashboard/chat-transcript-helpers.ts");
const sidebarContinuation = capabilityApprovalContinuationPrompt({
  version: 1,
  reviewMode: "automatic",
  id: "plan-sidebar-title",
  task: "Make me a flappy bird game",
  agentId: "agent-a",
  agentName: "Agent A",
  chatStorageKey: "agent-a::task-a",
  chatLeaf: "task-a",
  status: "approved",
  items: [],
  createdAt: 0,
});
assert.equal(compactCapabilityContinuation(sidebarContinuation), "Make me a flappy bird game", "compaction recovers the person's original task from a full continuation");
assert.equal(compactCapabilityContinuation("Make me a flappy bird game"), "Make me a flappy bird game", "ordinary user text passes through compaction unchanged");
assert.equal(
  compactCapabilityContinuation(sidebarContinuation.slice(0, 160)).startsWith(CAPABILITY_APPROVAL_CONTINUATION_MARKER),
  false,
  "even a pre-truncated continuation (its Original task line cut off) never surfaces the marker",
);
assert.match(chatTreeControllerSource, /compactCapabilityContinuation\(content\)/, "sidebar message previews/titles/search compact capability continuations");
assert.match(chatTreeControllerSource, /compactCapabilityContinuation\(task\.title/, "runtime-task sidebar rows compact capability continuations in the title");
assert.match(chatTreeControllerSource, /compactCapabilityContinuation\(task\.lastMessage/, "runtime-task sidebar rows compact capability continuations in the subtitle");
const snapshotRouteSource = await readFile(new URL("../src/app/api/fleet/snapshot/route.ts", import.meta.url), "utf8");
assert.match(snapshotRouteSource, /compactCapabilityContinuation\(session\.title \|\| latestUser\?\.content/, "the fleet snapshot compacts hermes-state titles BEFORE the 160-char truncation so the original task line survives");
assert.match(capabilityRouteSource, /workingDirectory:\s*typeof body\.workingDirectory/, "the capability API forwards bounded repository context to the ranker");
assert.match(capabilityRouteSource, /required:\s*capabilityPlanRequiresReview\(plan\)/, "the API distinguishes an automatic single choice from a plan that needs review");
assert.match(appBuilderActionSource, /title:\s*"Create app workspace"/, "the stable apps.build action uses an unambiguous user-facing name");
assert.doesNotMatch(appBuilderActionSource, /title:\s*"Build HivemindOS app"/, "the action title cannot imply that a standalone project edits HivemindOS");
assert.match(chatTreeControllerSource, /mergeRuntimeHydratedChatMessages\(existing, hydratedMessages\)/, "runtime hydration preserves local capability cards instead of replacing the thread wholesale");
assert.match(controllerSource, /attachments:\s*options\.attachments\s*\?\?\s*\[\]/, "approved continuation can resend the original build attachments");
assert.match(exchangePanelSource, /attachments:\s*approvalRequestAttachments/, "capability submission forwards the request attachments to the runtime continuation");
assert.match(controllerSource, /if\s*\(\s*!capabilityResponse\?\.ok\s*\|\|\s*!capabilityData\?\.ok\s*\)/, "a failed capability preflight cannot silently dispatch an unapproved build");
assert.match(threadSource, /CapabilityApprovalCard/, "chat renders the structured approval card");
assert.doesNotMatch(threadSource, /AutomaticCapabilityPlanRunner/, "automatic continuation is not coupled to rendering a hidden approval card");
assert.match(approvalCardSource, /<details className=\{styles\.advanced\}/, "rare capability controls are collapsed by default");
assert.match(approvalCardSource, /<summary[\s\S]+Advanced[\s\S]+Change tools or add instructions/, "the advanced disclosure explains its purpose in plain language");
assert.match(approvalCardSource, /<details[\s\S]+Choose an alternative[\s\S]+Use another GitHub repository[\s\S]+Instructions for this capability/, "alternatives and manual inputs live inside Advanced");
assert.doesNotMatch(approvalCardSource, />\s*Browse\s*</, "the default card has no competing Browse action");
assert.match(approvalCardSource, />\s*Continue\s*</, "the primary action uses a short concrete label");
assert.doesNotMatch(approvalCardSource, /I’ve drafted the capability list/, "the footer does not repeat what the card already communicates");
assert.match(approvalCardStyles, /\.advanced\s*\{/, "the compact disclosure has a dedicated visual treatment");
assert.match(sidebarSource, /Capability approval waiting/, "chat history marks pending capability approvals");
assert.match(dispatchSource, /Capability approval mode: AUTOMATIC/, "Work Board autonomy defaults to automatic capability setup");
assert.match(dispatchSource, /Capability approval mode: ASK FIRST/, "Work Board task can opt into capability approval");
assert.match(capabilitySearchSkillSource, /Codex, Claude Code, terminals[\s\S]+natural-language list/, "non-dynamic agent surfaces receive the natural-language capability policy");
assert.match(capabilitySearchSkillSource, /I've drafted the capability list\. Is this okay, and may I continue\?/, "natural-language approval ends with one explicit continuation question");
assert.match(companyPolicySource, /id:\s*"capability-setup"[\s\S]+mode:\s*"off"/, "Zero Human Companies keep capability decisions automatic by default");
assert.match(companyPolicyPanelSource, /policy\.id === "capability-setup"[\s\S]+\["off", "ask"\]/, "company UI exposes the automatic or ask-first capability policy");

console.log("PASS test-capability-approval");

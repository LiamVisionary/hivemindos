#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildCapabilityApprovalPlan } = await import("../src/lib/services/chat/capability-approval.ts");
const { DEFAULT_SHARED_VAULT } = await import("../src/lib/types/agent-runtime.ts");

const origin = process.env.HIVEMINDOS_TEST_ORIGIN || "http://127.0.0.1:5021";
const cases = [
  { task: "Build a frontend interface", intent: "implementation", name: /engineering|test.driven|frontend.design/i, reject: /hivemindos.feature.development|swarm.goal|work board/i },
  { task: "Build a frontend interface", intent: "interface-design", name: /frontend|interface|ui|ux|landing/i, ready: true },
  { task: "Prototype a React component", intent: "implementation", name: /engineering|test.driven|frontend.design|react|vercel/i, reject: /hivemindos.feature.development/i },
  { task: "Prototype a React component", intent: "interface-design", name: /frontend|interface|ui|ux|react|component/i },
  { task: "Create a logo for the launch", intent: "image-generation", name: /image|media studio|comfyui|generative/i },
  { task: "Generate a product hero image", intent: "image-generation", name: /image|media studio|comfyui|generative/i },
  { task: "Create a short launch video", intent: "video-generation", name: /video|media studio|seedance|higgsfield|hyperframes|animation/i },
  { task: "Build Stripe checkout for card billing", intent: "payments", name: /stripe|checkout|billing|payment funnel/i },
  { task: "Implement Stripe checkout", intent: "implementation", name: /engineering|test.driven|frontend.design/i, reject: /hivemindos.feature.development/i },
  { task: "Build a wallet dashboard for USDC payments", intent: "payments", name: /wallet|crypto|usdc|stablecoin|bankr|payment/i },
  { task: "Build a Slack notification integration", intent: "communications", name: /slack|messag|notification|delivery/i },
  { task: "Build a browser scraper that fills forms", intent: "browser-automation", name: /browser|chrome|computer use|scrap|playwright|selenium/i },
  { task: "Build an automation that emails a report weekly", intent: "scheduling", name: /schedul|automation|cron|aeon|n8n/i, reject: /cal\.com|calendar|email.draft|engineering readiness|gbp|posts.calendar|briefing.trailer|inspiration/i },
  { task: "Install n8n and schedule a daily report", intent: "scheduling", name: /n8n/i },
  { task: "Build an MCP server for our internal API", intent: "mcp-development", name: /mcp|model context protocol/i },
  { task: "Build an Excel dashboard from this CSV", intent: "data-work", name: /spreadsheet|excel|sheets|workbook|csv/i, ready: true },
  { task: "Create a PowerPoint presentation for the launch", intent: "presentation", name: /powerpoint|presentation|slides?/i, ready: true },
  { task: "Create a PDF brochure", intent: "document", name: /document|pdf|word|brochure/i, reject: /ingestion|extract|ocr/i },
  { task: "Generate a narrated podcast audio episode", intent: "audio-generation", name: /tts|audio|voice|podcast|speech|music/i },
  { task: "Create a 3D avatar", intent: "three-dimensional", name: /3d|mesh|vrm|glb|gltf|model|avatar/i },
  { task: "Create an architecture diagram", intent: "diagramming", name: /architecture|diagram|excalidraw|mermaid/i, ready: true },
  { task: "Research the latest AI news and publish an X post", intent: "research", name: /research|browser|search|storm|source|news/i, reject: /kill-my-thesis|investment thesis|quant research/i },
  { task: "Research the latest AI news and publish an X post", intent: "communications", name: /x api|xurl|twitter|social|post/i, reject: /miroshark|simulation|posthog/i },
  { task: "Deploy the web app to Cloudflare", intent: "deployment", name: /cloudflare|vercel|deploy|hosting|pages|publishing/i, reject: /agentic.inbox|email.agent|email.service|email.routing/i },
  { task: "Build a landing page and deploy it to Cloudflare", intent: "app-builder", name: /create app workspace/i, ready: true },
  { task: "Build a landing page and deploy it to Cloudflare", intent: "deployment", name: /cloudflare.management|workers|pages|wrangler|deploy|hosting/i, reject: /agentic.inbox|email.agent|email.service|email.routing/i },
  { task: "Install and use ComfyUI to generate an image", intent: "image-generation", name: /comfyui/i, ready: true },
  { task: "Build a Flappy Bird clone", intent: "app-builder", name: /create app workspace/i, ready: true, rejectIntent: "implementation" },
  { task: "Fix the HivemindOS dashboard navigation", intent: "implementation", name: /hivemindos.feature.development/i, ready: true, rejectIntent: "app-builder" },
  { task: "Write a CLI that calls the HivemindOS API", intent: "implementation", name: /engineering|test.driven|frontend.design/i, reject: /hivemindos.feature.development/i },
  { task: "Create a logo for the app", intent: "image-generation", name: /image|media studio|comfyui|generative/i, rejectIntents: ["implementation", "app-builder"] },
  { task: "Build a Power BI dashboard", intent: "data-work", name: /spreadsheet|excel|power bi|tableau|sheets|workbook|csv/i, rejectIntents: ["implementation", "interface-design", "app-builder"] },
  { task: "Build an iOS app", intent: "implementation", name: /engineering|test.driven|frontend.design|react|vercel/i, rejectIntents: ["app-builder"] },
];

const failures = [];
const rows = [];
for (const [index, testCase] of cases.entries()) {
  const plan = await buildCapabilityApprovalPlan({
    task: testCase.task,
    agentId: "capability-live-eval",
    agentName: "Capability Live Eval",
    chatStorageKey: `capability-live-eval::${index}`,
    vaultPath: DEFAULT_SHARED_VAULT.vaultPath,
    origin,
    now: 1_700_000_100_000 + index,
  });
  const item = plan.items.find((candidate) => candidate.intent === testCase.intent);
  const selected = item?.candidates.find((candidate) => candidate.id === item.selectedCapabilityId) ?? item?.candidates[0];
  rows.push({ task: testCase.task, intent: testCase.intent, selected: selected?.name ?? "missing", availability: selected?.availability ?? "missing" });
  const rejectedIntents = [...(testCase.rejectIntents ?? []), ...(testCase.rejectIntent ? [testCase.rejectIntent] : [])];
  for (const rejectedIntent of rejectedIntents) {
    if (plan.items.some((candidate) => candidate.intent === rejectedIntent)) failures.push(`${testCase.intent}: unexpectedly included ${rejectedIntent}`);
  }
  if (!item || !selected) failures.push(`${testCase.intent}: missing for "${testCase.task}"`);
  else {
    if (!testCase.name.test(selected.name)) failures.push(`${testCase.intent}: selected unrelated ${selected.name}`);
    if (testCase.reject?.test(selected.name)) failures.push(`${testCase.intent}: selected rejected ${selected.name}`);
    if (testCase.ready && selected.availability !== "ready") failures.push(`${testCase.intent}: ${selected.name} is incorrectly ${selected.availability}`);
    const normalizedNames = item.candidates.map((candidate) => candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
    if (new Set(normalizedNames).size !== normalizedNames.length) failures.push(`${testCase.intent}: duplicate equivalent candidates`);
  }
}

console.table(rows);
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`PASS eval-capability-approval-live (${cases.length} live mappings)`);

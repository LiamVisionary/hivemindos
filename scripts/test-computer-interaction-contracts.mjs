#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { parseBeePilotPlan } = await import("../src/features/dashboard/bee-pilot/bee-pilot-actions.ts");
const {
  computerInteractionToolDefinition,
  providerToolContractCapabilities,
} = await import("../src/lib/services/computer-interaction/tool-contract.ts");

assert.deepEqual(
  parseBeePilotPlan('{"reply":"Opening wallets.","steps":[{"action":"navigate","params":{"view":"wallet"}}]}'),
  { reply: "Opening wallets.", steps: [{ action: "navigate", params: { view: "wallet" } }] },
);
assert.equal(
  parseBeePilotPlan('Here is the plan: {"reply":"Opening wallets.","steps":[]}'),
  null,
  "Bee Pilot should reject prose-wrapped pseudo-JSON instead of extracting a substring",
);
assert.equal(
  parseBeePilotPlan('{"reply":"Clicking.","steps":[{"action":"navigate","params":{"view":"wallet","unexpected":"x"}}]}'),
  null,
  "Bee Pilot should reject undeclared parameters",
);
assert.equal(
  parseBeePilotPlan('{"reply":"Creating.","steps":[{"action":"create-wallet","params":{}}]}'),
  null,
  "Bee Pilot should enforce action-specific required parameters",
);

assert.deepEqual(providerToolContractCapabilities("anthropic"), {
  strict: true,
  inputExamples: true,
  cacheControl: true,
  deferLoading: true,
});
assert.deepEqual(providerToolContractCapabilities("openrouter"), {
  strict: false,
  inputExamples: false,
  cacheControl: false,
  deferLoading: false,
});

const anthropicTool = computerInteractionToolDefinition("anthropic");
assert.equal(anthropicTool.strict, true);
assert.deepEqual(anthropicTool.cache_control, { type: "ephemeral" });
assert.equal(anthropicTool.defer_loading, true);
assert.ok(Array.isArray(anthropicTool.input_examples));
assert.equal(anthropicTool.input_schema.additionalProperties, false);
assert.equal(anthropicTool.input_schema.properties.action.enum.includes("get"), true);
assert.equal(anthropicTool.input_schema.properties.interactionAction.anyOf[0].additionalProperties, false);
assert.equal(anthropicTool.input_schema.properties.interactionAction.anyOf[0].properties.params.additionalProperties, false);
assert.equal(
  anthropicTool.input_schema.properties.interactionAction.anyOf[0].properties.params.required.length,
  Object.keys(anthropicTool.input_schema.properties.interactionAction.anyOf[0].properties.params.properties).length,
  "strict nested action parameters should require every declared nullable field",
);

const openAiTool = computerInteractionToolDefinition("openai");
assert.equal(openAiTool.type, "function");
assert.equal(openAiTool.function.strict, true);
assert.equal(openAiTool.function.parameters.additionalProperties, false);
assert.equal("cache_control" in openAiTool, false);

const openRouterTool = computerInteractionToolDefinition("openrouter");
assert.equal(openRouterTool.type, "function");
assert.equal("strict" in openRouterTool.function, false, "OpenRouter strict mode stays provider/model gated");

const pageAgent = await readFile(new URL("../src/features/page-agent/PageAgentPanel.tsx", import.meta.url), "utf8");
assert.match(pageAgent, /interactiveBlacklist/);
assert.match(pageAgent, /transformPageContent/);
assert.match(pageAgent, /prompt-injection/i);
assert.match(pageAgent, /onBeforeTask/);
assert.match(pageAgent, /onAfterStep/);
assert.match(pageAgent, /onAfterTask/);
assert.match(pageAgent, /It was not executed; do not retry it\./, "a declined consequence should terminate cleanly instead of throwing a retryable tool error");
assert.match(pageAgent, /ok: !humanDeclined/, "a declined Page Agent consequence must not be receipted as a successful action");
assert.match(pageAgent, /if \(humanDeclined\) void pageAgent\.stop\(\)/, "a declined consequence must stop the active Page Agent loop without lifecycle-hook deadlock");

const route = await readFile(new URL("../src/app/api/computer-interaction/route.ts", import.meta.url), "utf8");
assert.match(route, /okJson/);
assert.match(route, /errorJson/);
assert.match(route, /awaiting-approval/);
assert.match(route, /omitNullToolFields/);

const browserUseRunner = await readFile(new URL("../src/lib/services/browser-use-runner.ts", import.meta.url), "utf8");
assert.match(browserUseRunner, /action === "current-url"[^\n]+"eval", "location\.href"/);
assert.match(browserUseRunner, /window\.location\.replace\('about:blank'\)/);
assert.match(browserUseRunner, /action === "close"[^\n]+"close"\]/);
assert.doesNotMatch(browserUseRunner, /action === "close"[^\n]+--all/, "closing one governed run must not close unrelated Browser Use sessions");

const beePilotExecutor = await readFile(new URL("../src/features/dashboard/bee-pilot/use-bee-pilot.tsx", import.meta.url), "utf8");
assert.match(beePilotExecutor, /ready to send this message/);
assert.match(beePilotExecutor, /ready to create a wallet/);
assert.match(beePilotExecutor, /ready to delegate/);

const eventsRoute = await readFile(new URL("../src/app/api/computer-interaction/events/route.ts", import.meta.url), "utf8");
assert.match(eventsRoute, /text\/event-stream/);
assert.match(eventsRoute, /Last-Event-ID/);

const action = await readFile(new URL("../src/lib/services/hive-actions/computer-interaction.ts", import.meta.url), "utf8");
assert.match(action, /computer\.interaction/);
assert.match(action, /\/api\/computer-interaction/);

console.log("computer interaction surface contracts passed");

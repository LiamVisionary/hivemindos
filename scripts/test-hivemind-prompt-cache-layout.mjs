import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

async function source(path) {
  return readFile(join(root, path), "utf8");
}

function assertIncludes(sourceText, needle, label) {
  assert.ok(sourceText.includes(needle), `${label} should include ${needle}`);
}

function assertBefore(sourceText, earlier, later, label) {
  const earlierIndex = sourceText.indexOf(earlier);
  const laterIndex = sourceText.indexOf(later);
  assert.notEqual(earlierIndex, -1, `${label} missing earlier marker: ${earlier}`);
  assert.notEqual(laterIndex, -1, `${label} missing later marker: ${later}`);
  assert.ok(earlierIndex < laterIndex, `${label} should place ${earlier} before ${later}`);
}

const [
  promptSource,
  messageSource,
  runtimeSource,
  cacheHintSource,
] = await Promise.all([
  source("src/lib/services/chat/hivemind-system-prompt.ts"),
  source("src/app/api/chat/agent-runtime/messages.ts"),
  source("src/app/api/chat/agent-runtime/stream-openai-compatible.ts"),
  source("src/lib/services/chat/inference-cache-hints.ts"),
]);

assertIncludes(promptSource, "stableContext: string;", "prompt envelope stable tier");
assertIncludes(promptSource, "volatileContext: string;", "prompt envelope volatile tier");
assertIncludes(promptSource, "buildHivemindStableDynamicContext", "stable dynamic context builder");
assertIncludes(promptSource, "buildHivemindVolatileContext", "volatile context builder");
assertIncludes(promptSource, "cache_control: { type: \"ephemeral\" }", "explicit stable cache-control block");

const stableBuilder = promptSource.slice(
  promptSource.indexOf("export function buildHivemindStableDynamicContext"),
  promptSource.indexOf("export function buildHivemindVolatileContext"),
);
assertBefore(stableBuilder, "buildAgentProfileContext(input.profile)", "buildWalletToolContext(input.wallet)", "stable context order");
assertBefore(stableBuilder, "buildAgentModeContext(input.agentMode)", "buildWalletToolContext(input.wallet)", "mode before wallet order");

const volatileBuilder = promptSource.slice(
  promptSource.indexOf("export function buildHivemindVolatileContext"),
  promptSource.indexOf("export function buildHivemindDynamicContext"),
);
assertIncludes(volatileBuilder, "input.extraDynamicContext", "volatile adaptive context");
assertIncludes(volatileBuilder, "input.vaultContext", "volatile vault context");
assertIncludes(volatileBuilder, "input.sharedBrainMemoryContext", "volatile memory context");
assertIncludes(volatileBuilder, "input.taskRetrievalContext", "volatile capability context");
assertIncludes(volatileBuilder, "sessionMetadataContext(input)", "volatile session metadata");

const envelopeBuilder = promptSource.slice(
  promptSource.indexOf("export function buildHivemindPromptEnvelope"),
  promptSource.indexOf("export function prependHivemindSystemMessage"),
);
assertBefore(envelopeBuilder, "const stableContext", "const systemContext", "envelope stable context assembly");
assertIncludes(envelopeBuilder, "[stableContext, volatileContext]", "system context keeps volatile context after stable context");

assertIncludes(messageSource, "cache_control?: { type: string };", "message text part cache-control metadata");
assertIncludes(runtimeSource, "openAICompatibleMessageCacheControlSupported", "runtime explicit cache-control gate");
assertIncludes(runtimeSource, "cacheControl: openAICompatibleMessageCacheControlSupported", "runtime passes explicit cache-control option");
assertIncludes(cacheHintSource, "model.startsWith(\"anthropic/\")", "OpenRouter Anthropic cache-control support");
assertIncludes(cacheHintSource, "model.startsWith(\"qwen/\")", "OpenRouter Qwen cache-control support");

console.log("hivemind prompt cache layout checks passed");

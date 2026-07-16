export type ComputerInteractionToolProvider = "anthropic" | "openai" | "openrouter" | "xai" | "llama" | "unknown";

const TOOL_CAPABILITIES = {
  anthropic: { strict: true, inputExamples: true, cacheControl: true, deferLoading: true },
  openai: { strict: true, inputExamples: false, cacheControl: false, deferLoading: false },
  openrouter: { strict: false, inputExamples: false, cacheControl: false, deferLoading: false },
  xai: { strict: false, inputExamples: false, cacheControl: false, deferLoading: false },
  llama: { strict: false, inputExamples: false, cacheControl: false, deferLoading: false },
  unknown: { strict: false, inputExamples: false, cacheControl: false, deferLoading: false },
} as const;

export function providerToolContractCapabilities(provider: ComputerInteractionToolProvider) {
  return { ...TOOL_CAPABILITIES[provider] };
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const nullableBoolean = { anyOf: [{ type: "boolean" }, { type: "null" }] };
const nullableStringArray = { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] };
const actionParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    index: nullableNumber,
    url: nullableString,
    text: nullableString,
    path: nullableString,
    script: nullableString,
    target: nullableString,
    direction: { anyOf: [{ type: "string", enum: ["up", "down"] }, { type: "null" }] },
    amount: nullableNumber,
    app: nullableString,
    hiveActionId: nullableString,
    hiveActionInputJson: nullableString,
  },
  required: ["index", "url", "text", "path", "script", "target", "direction", "amount", "app", "hiveActionId", "hiveActionInputJson"],
};

const inputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["start", "step", "pause", "resume", "approve", "stop", "get"] },
    runId: nullableString,
    goal: nullableString,
    adapters: {
      anyOf: [
        { type: "array", items: { type: "string", enum: ["hive-action", "bee-pilot", "page-agent", "browser-use", "screenshot"] } },
        { type: "null" },
      ],
    },
    interactionAction: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["observe", "open", "navigate", "click", "input", "type", "select", "scroll", "screenshot", "submit", "send", "upload", "download", "install", "delete", "purchase", "transfer", "eval", "hive-action", "complete"] },
            adapter: { type: "string", enum: ["hive-action", "bee-pilot", "page-agent", "browser-use", "screenshot"] },
            observationId: nullableString,
            params: actionParamsSchema,
            consequence: nullableBoolean,
            description: nullableString,
          },
          required: ["kind", "adapter", "observationId", "params", "consequence", "description"],
        },
        { type: "null" },
      ],
    },
    approvalId: nullableString,
    reason: nullableString,
    policy: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            allowedDomains: nullableStringArray,
            allowedApps: nullableStringArray,
            requireConfirmationForConsequences: nullableBoolean,
            pauseOnPromptInjection: nullableBoolean,
          },
          required: ["allowedDomains", "allowedApps", "requireConfirmationForConsequences", "pauseOnPromptInjection"],
        },
        { type: "null" },
      ],
    },
    limits: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { maxSteps: nullableNumber, maxRuntimeMs: nullableNumber, maxCostUsd: nullableNumber },
          required: ["maxSteps", "maxRuntimeMs", "maxCostUsd"],
        },
        { type: "null" },
      ],
    },
    adapterContext: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: { browserSession: nullableString },
          required: ["browserSession"],
        },
        { type: "null" },
      ],
    },
  },
  required: ["action", "runId", "goal", "adapters", "interactionAction", "approvalId", "reason", "policy", "limits", "adapterContext"],
} as const;

const description = "Start, inspect, pause, resume, approve, stop, or advance a governed HivemindOS computer-interaction run. Prefer Hive Actions and semantic/DOM adapters; browser element control and screenshots are fallbacks. Every consequential action pauses for approval and every action is bound to a fresh observation.";

export function computerInteractionToolDefinition(provider: ComputerInteractionToolProvider): Record<string, unknown> {
  const capabilities = providerToolContractCapabilities(provider);
  if (provider === "anthropic") {
    return {
      name: "computer_interaction",
      description,
      input_schema: inputSchema,
      ...(capabilities.strict ? { strict: true } : {}),
      ...(capabilities.inputExamples ? { input_examples: [{ action: "get", runId: "run-123", goal: null, adapters: null, interactionAction: null, approvalId: null, reason: null, policy: null, limits: null, adapterContext: null }] } : {}),
      ...(capabilities.cacheControl ? { cache_control: { type: "ephemeral" } } : {}),
      ...(capabilities.deferLoading ? { defer_loading: true } : {}),
    };
  }
  return {
    type: "function",
    function: {
      name: "computer_interaction",
      description,
      parameters: inputSchema,
      ...(capabilities.strict ? { strict: true } : {}),
    },
  };
}

// Per-message reasoning effort for the interactive chat route. Mirrors the
// shape of chat-permissions.ts (const tuple + type + options + normalizer +
// label helper) so the composer, controller, and runtime thread it the same way
// permissionMode is threaded.
//
// Making effort "real" is a capability question: only some providers expose a
// reasoning-effort knob on their chat-completions endpoint, and only for their
// reasoning-capable models. REASONING_EFFORT_PROVIDER_SUPPORT is that capability
// matrix — extend a row here instead of scattering per-provider `if`s at the
// request-building seam (src/app/api/chat/agent-runtime/stream-openai-compatible.ts).

export const CHAT_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "max"] as const;

export type ChatReasoningEffort = typeof CHAT_REASONING_EFFORTS[number];

export type ChatReasoningEffortOption = {
  effort: ChatReasoningEffort;
  label: string;
};

export const CHAT_REASONING_EFFORT_OPTIONS: ChatReasoningEffortOption[] = [
  { effort: "minimal", label: "Minimal" },
  { effort: "low", label: "Low" },
  { effort: "medium", label: "Medium" },
  { effort: "high", label: "High" },
  { effort: "max", label: "Max" },
];

const CHAT_REASONING_EFFORT_SET = new Set<string>(CHAT_REASONING_EFFORTS);

export function normalizeChatReasoningEffort(value: unknown): ChatReasoningEffort {
  const effort = String(value ?? "").trim().toLowerCase();
  return CHAT_REASONING_EFFORT_SET.has(effort) ? (effort as ChatReasoningEffort) : "medium";
}

export function chatReasoningEffortLabel(effort: ChatReasoningEffort) {
  return CHAT_REASONING_EFFORT_OPTIONS.find((option) => option.effort === effort)?.label ?? "Medium";
}

/**
 * Wire shape a provider's chat-completions endpoint accepts for reasoning effort:
 * - "reasoning_effort": top-level OpenAI-style field (`{ reasoning_effort: "high" }`).
 * - "reasoning.effort": nested object (`{ reasoning: { effort: "high" } }`) — the
 *   shape used by the OpenAI Responses API (src/lib/services/openai-oauth.ts:357)
 *   and OpenRouter's unified reasoning param. No provider that flows through the
 *   stream-openai-compatible chat seam uses it today; it is kept here so a future
 *   Responses-style provider can be enabled by a one-line matrix edit.
 * - "none": provider/model does not take an effort knob → send nothing.
 */
export type ReasoningEffortWire = "reasoning_effort" | "reasoning.effort" | "none";

export type ReasoningEffortProviderSupport = {
  wire: ReasoningEffortWire;
  /** When set, only models whose id matches are treated as reasoning-capable. */
  models?: RegExp;
};

/**
 * Capability matrix keyed by provider slug (see src/lib/config/provider-catalog.ts
 * for canonical slugs). Conservative on purpose — a provider is only enabled when
 * there is concrete in-repo evidence that its chat-completions endpoint honors an
 * effort knob for the matched models.
 *
 * Enabled:
 * - "openai" / "openai-api": OpenAI reasoning models take a top-level
 *   `reasoning_effort`. Model gate mirrors the existing precedent in
 *   src/lib/services/queen-bee/voice-turn.ts:848 (`/^(o\d|gpt-5)/i`). For these
 *   models "medium" is the OpenAI default, so the default path is a no-op and a
 *   non-default pick genuinely changes effort.
 *
 * Deliberately NOT enabled (kept as "none" with the reason inline):
 * - "xai": the repo does use `reasoning_effort` with Grok, but only via the xAI
 *   OAuth path (handled separately at the seam) and only ever sends "low"
 *   (xai-oauth-inference-contract.ts:14-20). There is no evidence the plain xAI
 *   API accepts the "medium" default this route would inject, so enabling it
 *   risks breaking grok-4.3/4.5 chats. Left off pending a proven accepted set.
 * - "openrouter": OpenRouter is the adaptive-routing backbone and supports a
 *   `reasoning: { effort }` param, but there is no in-repo call and its model ids
 *   are namespaced (openai/o3, x-ai/grok-4, …), making a safe reasoning-model gate
 *   fragile. Injecting effort by default across every OpenRouter model has real
 *   cost/behavior blast radius, so it stays off until deliberately opted in.
 */
export const REASONING_EFFORT_PROVIDER_SUPPORT: Record<string, ReasoningEffortProviderSupport> = {
  openai: { wire: "reasoning_effort", models: /^(?:o\d|gpt-5)/i },
  "openai-api": { wire: "reasoning_effort", models: /^(?:o\d|gpt-5)/i },
  xai: { wire: "none" },
  openrouter: { wire: "none" },
};

function providerSupport(provider?: string | null): ReasoningEffortProviderSupport | undefined {
  const slug = String(provider ?? "").trim().toLowerCase();
  return slug ? REASONING_EFFORT_PROVIDER_SUPPORT[slug] : undefined;
}

export function modelSupportsReasoningEffort(provider?: string, model?: string): boolean {
  const support = providerSupport(provider);
  if (!support || support.wire === "none") return false;
  if (support.models && !support.models.test(String(model ?? "").trim())) return false;
  return true;
}

// The five UI levels are broader than any single provider's accepted set. "max"
// is not a wire-valid literal anywhere, so it maps to the provider's highest
// ("high") rather than being sent verbatim. Every enabled provider accepts the
// remaining values (notably the "medium" default).
function wireEffortValue(effort: ChatReasoningEffort): string {
  return effort === "max" ? "high" : effort;
}

/**
 * Request-body fragment to merge into an OpenAI-compatible chat request so the
 * chosen effort is honored. Returns {} when the provider/model does not support
 * an effort knob (so it is always safe to spread).
 */
export function reasoningEffortRequestBody(
  provider: string | undefined,
  model: string | undefined,
  effort: unknown,
): Record<string, unknown> {
  const support = providerSupport(provider);
  if (!support || support.wire === "none") return {};
  if (support.models && !support.models.test(String(model ?? "").trim())) return {};
  const value = wireEffortValue(normalizeChatReasoningEffort(effort));
  if (support.wire === "reasoning_effort") return { reasoning_effort: value };
  if (support.wire === "reasoning.effort") return { reasoning: { effort: value } };
  return {};
}

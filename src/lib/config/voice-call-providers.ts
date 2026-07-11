/**
 * Canonical capability matrix for the voices an agent can call with — the single
 * source of truth the Calls settings UI, the credential route, and the call
 * backend all read from, so "which providers exist / how they authenticate /
 * what transport they use" lives in ONE place instead of scattered conditionals.
 *
 * Honesty rules baked into this table (verified against the code + the real
 * provider APIs, 2026-07-11):
 *  - ChatGPT/Codex OAuth is available to an OpenAI pipeline chat brain, but it
 *    does not include OpenAI Platform voice. Public OpenAI TTS and Realtime
 *    voice require Platform API-key billing; the UI keeps those boundaries
 *    explicit instead of silently crossing from OAuth to an API key. xAI/Grok
 *    also has a model/runtime OAuth setup path, but no realtime voice transport.
 *    The repo's Google OAuth is Drive/Gmail/GA4 integration scope, not Gemini
 *    LLM auth.
 *  - Realtime speech-to-speech ("realtime hybrid") is real for OpenAI (Realtime
 *    API) and Gemini (Gemini Live API). Grok has no public realtime voice API;
 *    ElevenLabs and Cartesia are TTS engines. So Grok is a chat BRAIN only, and
 *    ElevenLabs/Cartesia are cloud-TTS PIPELINE voices, not realtime hybrids.
 *  - `status: "available"` = live path exists and is exercised today.
 *    `status: "preview"` = transport is wired/code-complete but not yet
 *    live-verified with a real key + device; the UI surfaces this honestly and
 *    never silently pretends a preview transport is a finished call path.
 */

export type VoiceProviderId = "openai" | "gemini" | "grok" | "elevenlabs" | "cartesia";

/** How a voice participates in a call. */
export type VoiceRuntimeKind = "realtime-hybrid" | "cloud-tts" | "local-tts";

/** Which credential the user chose for a provider. */
export type VoiceProviderAuthMode = "oauth" | "apikey";

/** available = live today; preview = code-complete, needs a real key + device. */
export type VoiceTransportStatus = "available" | "preview";

export type VoiceOptionChoice = { id: string; label: string };

export type VoiceTransport = {
  /** The AgentVoiceRuntime value persisted when this (kind, provider) is picked. */
  runtimeId: string;
  status: VoiceTransportStatus;
  /** Card subtitle, e.g. "Realtime API · gpt-realtime". */
  subtitle: string;
  defaultModel?: string;
  /** Selectable output voices; the first is the default. Empty => gateway default. */
  voices: VoiceOptionChoice[];
};

export type VoiceProviderOAuth = {
  /** provider-catalog slug used for OAuth-credentialled pipeline brain turns. */
  brainProviderSlug: string;
  /** GET returns { connected, preferApiKey }; POST { action:"start" } begins sign-in. */
  endpoint: string;
  label: string;
};

export type VoiceProviderCapability = {
  id: VoiceProviderId;
  name: string;
  /** 2-letter mark shown when no brand icon asset exists. */
  fallback: string;
  iconPath?: string;
  iconMode?: "image" | "mask";
  /** Shared hive-env var(s) that hold this provider's API key; [0] is the save target. */
  apiKeyEnvVars: string[];
  apiKeyPlaceholder: string;
  /** Credentials accepted by this provider's public voice transports. */
  voiceAuthModes: VoiceProviderAuthMode[];
  /** OAuth sign-in exposed for a compatible pipeline chat brain. It does not
   *  imply that the provider's public voice transport accepts subscription OAuth. */
  oauth?: VoiceProviderOAuth;
  /** provider-catalog slug for pipeline chat-brain turns, when usable as a brain. */
  brainProviderSlug?: string;
  brainSubtitle?: string;
  realtime?: VoiceTransport;
  cloudTts?: VoiceTransport;
};

const OPENAI_VOICES: VoiceOptionChoice[] = [
  { id: "alloy", label: "Alloy" },
  { id: "verse", label: "Verse" },
  { id: "sage", label: "Sage" },
  { id: "ash", label: "Ash" },
  { id: "coral", label: "Coral" },
  { id: "ballad", label: "Ballad" },
];

// Gemini Live speech-to-speech prebuilt voices (Gemini Live API), factual set.
const GEMINI_VOICES: VoiceOptionChoice[] = [
  { id: "Puck", label: "Puck" },
  { id: "Charon", label: "Charon" },
  { id: "Kore", label: "Kore" },
  { id: "Fenrir", label: "Fenrir" },
  { id: "Aoede", label: "Aoede" },
];

// ElevenLabs / Cartesia expose account-specific voice IDs; until the backend
// returns the live roster we offer the provider default only (no fabricated ids).
const GATEWAY_DEFAULT_VOICE: VoiceOptionChoice[] = [{ id: "", label: "Provider default" }];

export const CALL_VOICE_PROVIDER_MATRIX: VoiceProviderCapability[] = [
  {
    id: "openai",
    name: "OpenAI",
    fallback: "AI",
    iconPath: "/icons/runtimes/openai.svg",
    iconMode: "mask",
    apiKeyEnvVars: ["OPENAI_API_KEY", "OPENAI_REALTIME_KEY"],
    apiKeyPlaceholder: "OpenAI API key (sk-…)",
    voiceAuthModes: ["apikey"],
    oauth: { brainProviderSlug: "openai-oauth", endpoint: "/api/openai-oauth", label: "OpenAI" },
    brainProviderSlug: "openai-api",
    brainSubtitle: "GPT models via API key",
    realtime: {
      runtimeId: "openai-realtime",
      status: "available",
      subtitle: "Realtime API · gpt-realtime",
      defaultModel: "gpt-realtime",
      voices: OPENAI_VOICES,
    },
    cloudTts: {
      runtimeId: "openai-tts",
      status: "available",
      subtitle: "Pipeline · gpt-4o-mini-tts",
      defaultModel: "gpt-4o-mini-tts",
      voices: OPENAI_VOICES,
    },
  },
  {
    id: "gemini",
    name: "Gemini",
    fallback: "GM",
    // Any of these hive-env names can hold a Gemini key; the panel lets the user
    // pick when more than one is set. GOOGLE_API_KEY is last (often a generic
    // Google key). Kept in sync with GEMINI_KEY_ENV_CANDIDATES server-side.
    apiKeyEnvVars: ["GEMINI_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GOOGLE_API_KEY"],
    apiKeyPlaceholder: "Google AI Studio API key",
    voiceAuthModes: ["apikey"],
    brainProviderSlug: "gemini",
    brainSubtitle: "Gemini models via API key",
    realtime: {
      // Live-verified 2026-07-07: token mint + bidi WS setup complete against a
      // real key for the current Gemini 3.1 Live model.
      runtimeId: "gemini-live",
      status: "available",
      subtitle: "Gemini Live · 3.1 Flash",
      defaultModel: "gemini-3.1-flash-live-preview",
      voices: GEMINI_VOICES,
    },
    cloudTts: {
      runtimeId: "gemini-tts",
      status: "preview",
      subtitle: "Pipeline · Gemini TTS",
      defaultModel: "gemini-2.5-flash-preview-tts",
      voices: GEMINI_VOICES,
    },
  },
  {
    id: "grok",
    name: "Grok",
    fallback: "GK",
    // Grok/xAI has no public realtime voice or TTS API — it is a chat brain only,
    // paired with a TTS voice (OpenAI/Gemini/ElevenLabs/Cartesia/local) for audio.
    apiKeyEnvVars: ["XAI_API_KEY"],
    apiKeyPlaceholder: "xAI API key (xai-…)",
    voiceAuthModes: ["apikey"],
    brainProviderSlug: "xai",
    brainSubtitle: "xAI Grok as the spoken brain",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    fallback: "EL",
    apiKeyEnvVars: ["ELEVENLABS_API_KEY"],
    apiKeyPlaceholder: "ElevenLabs API key",
    voiceAuthModes: ["apikey"],
    cloudTts: {
      runtimeId: "elevenlabs-tts",
      status: "preview",
      subtitle: "Pipeline · Multilingual v2",
      defaultModel: "eleven_multilingual_v2",
      voices: GATEWAY_DEFAULT_VOICE,
    },
  },
  {
    id: "cartesia",
    name: "Cartesia",
    fallback: "CA",
    apiKeyEnvVars: ["CARTESIA_API_KEY"],
    apiKeyPlaceholder: "Cartesia API key",
    voiceAuthModes: ["apikey"],
    cloudTts: {
      runtimeId: "cartesia-tts",
      status: "preview",
      subtitle: "Pipeline · Sonic",
      defaultModel: "sonic-2",
      voices: GATEWAY_DEFAULT_VOICE,
    },
  },
];

const MATRIX_BY_ID = new Map(CALL_VOICE_PROVIDER_MATRIX.map((entry) => [entry.id, entry]));

export function voiceProviderById(id: string | undefined | null): VoiceProviderCapability | undefined {
  return id ? MATRIX_BY_ID.get(id as VoiceProviderId) : undefined;
}

/** Providers offering a transport for the given runtime kind, in matrix order. */
export function voiceProvidersForKind(kind: VoiceRuntimeKind): VoiceProviderCapability[] {
  if (kind === "realtime-hybrid") return CALL_VOICE_PROVIDER_MATRIX.filter((entry) => entry.realtime);
  if (kind === "cloud-tts") return CALL_VOICE_PROVIDER_MATRIX.filter((entry) => entry.cloudTts);
  return [];
}

export function transportForKind(
  provider: VoiceProviderCapability,
  kind: VoiceRuntimeKind,
): VoiceTransport | undefined {
  if (kind === "realtime-hybrid") return provider.realtime;
  if (kind === "cloud-tts") return provider.cloudTts;
  return undefined;
}

/** The persisted voiceRuntime id for a (kind, provider) pair. */
export function runtimeIdForKindProvider(kind: VoiceRuntimeKind, providerId: string): string | undefined {
  if (kind === "local-tts") return "local-tts";
  const provider = voiceProviderById(providerId);
  return provider ? transportForKind(provider, kind)?.runtimeId : undefined;
}

/** All realtime + cloud-tts runtime ids, mapped back to their (kind, provider, transport). */
const RUNTIME_INDEX: Record<string, { kind: VoiceRuntimeKind; provider: VoiceProviderCapability; transport: VoiceTransport }> = {};
for (const provider of CALL_VOICE_PROVIDER_MATRIX) {
  if (provider.realtime) RUNTIME_INDEX[provider.realtime.runtimeId] = { kind: "realtime-hybrid", provider, transport: provider.realtime };
  if (provider.cloudTts) RUNTIME_INDEX[provider.cloudTts.runtimeId] = { kind: "cloud-tts", provider, transport: provider.cloudTts };
}

/** Resolve a stored voiceRuntime id back to its kind + provider (+ transport). */
export function resolveVoiceRuntime(runtimeId: string | undefined | null): {
  kind: VoiceRuntimeKind;
  provider?: VoiceProviderCapability;
  transport?: VoiceTransport;
} {
  if (runtimeId === "local-tts") return { kind: "local-tts" };
  const hit = runtimeId ? RUNTIME_INDEX[runtimeId] : undefined;
  if (hit) return { kind: hit.kind, provider: hit.provider, transport: hit.transport };
  // Unknown/legacy id: treat as an OpenAI realtime hybrid so old profiles keep working.
  return { kind: "realtime-hybrid", provider: voiceProviderById("openai"), transport: voiceProviderById("openai")?.realtime };
}

export const VOICE_RUNTIME_KIND_LABEL: Record<VoiceRuntimeKind, string> = {
  "realtime-hybrid": "Realtime hybrid",
  "cloud-tts": "Cloud voice",
  "local-tts": "Local voice",
};

export const VOICE_RUNTIME_KIND_SUBTITLE: Record<VoiceRuntimeKind, string> = {
  "realtime-hybrid": "Voice + brain in one model",
  "cloud-tts": "Pipeline · cloud TTS",
  "local-tts": "Pipeline · on-device TTS",
};

/** Providers usable as a pipeline chat brain (spoken words come from this LLM). */
export function brainCapableVoiceProviders(): VoiceProviderCapability[] {
  return CALL_VOICE_PROVIDER_MATRIX.filter((entry) => entry.brainProviderSlug);
}

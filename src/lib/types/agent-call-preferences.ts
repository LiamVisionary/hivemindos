// Per-agent voice-call, voice-brain, and Ministry preferences: the durable shape
// behind the Calls and Ministry panels in Agent Settings, plus the normalizers
// that give a partially-populated stored row a complete, defaulted value.
//
// Split out of agent-runtime.ts as a single-concern type module. It is fully
// self-contained — no imports, no back-references into agent-runtime — so any
// consumer can pull it directly. agent-runtime.ts re-exports the public surface
// for the callers that still import these names from there.

export type AgentVoiceRuntime =
  | "openai-realtime"
  | "grok-voice"
  | "gemini-live"
  | (string & {});
export type AgentCallMissedFallback =
  | "none"
  | "in_app"
  | "obsidian_note"
  | "telegram";

/** Which LLM answers PIPELINE voice turns (STT → LLM → TTS). "agent" (default)
 *  = the agent's own selected provider/model, called directly; "custom" = an
 *  explicit voice-only override; "fleet-agent" = the ranked fleet agent's full
 *  runtime (tools/persona, slower). Realtime hybrid runtimes ignore this. */
export type VoiceChatBrainSource = "agent" | "custom" | "fleet-agent";
export interface VoiceChatBrainPreference {
  source: VoiceChatBrainSource;
  provider?: string;
  model?: string;
  /** True when the user explicitly picked this source in the Calls voice UI.
   *  Legacy rows without this flag must not override the agent's own model. */
  explicit?: boolean;
}

/** How the selected voice provider authenticates: "oauth" = a subscription
 *  sign-in (OpenAI only today), "apikey" = the shared hive-env API key. The
 *  Calls UI auto-picks oauth when connected, else apikey when a key is present. */
export type VoiceProviderAuthMode = "oauth" | "apikey";

export const AGENT_MINISTRY_EXPERT_SLOT_COUNT = 3;
export const AGENT_MINISTRY_EFFORTS = ["fast", "balanced", "deep", "council"] as const;

export type AgentMinistryEffort = (typeof AGENT_MINISTRY_EFFORTS)[number];
export type AgentMinistrySlotKind = "model" | "agent";

export interface AgentMinistrySlotConfig {
  kind?: AgentMinistrySlotKind;
  provider?: string;
  model?: string;
  agentId?: string;
}

export interface AgentMinistryPreferences {
  enabled: boolean;
  effort: AgentMinistryEffort;
  orchestrator: AgentMinistrySlotConfig;
  experts: AgentMinistrySlotConfig[];
}

export interface AgentCallPreferences {
  voiceRuntime: AgentVoiceRuntime;
  voiceProviderId?: string;
  voiceModelId?: string;
  voiceId?: string;
  /** Credential mode for the selected voice provider (see VoiceProviderAuthMode). */
  voiceAuthMode?: VoiceProviderAuthMode;
  /** Which hive-env key name to use when several match the provider (e.g. Gemini
   *  can read GEMINI_API_KEY / GOOGLE_AI_STUDIO_API_KEY / GOOGLE_API_KEY). */
  voiceKeyEnv?: string;
  /** Spoken-audio language (ISO 639-1) — sent to the TTS provider (ElevenLabs
   *  `language_code` on the v2.5 models). Empty = provider auto-detect. */
  voiceLanguage?: string;
  /** Language the agent should write/reply in for spoken turns. Empty = app default. */
  voiceTextLanguage?: string;
  voiceChatBrain?: VoiceChatBrainPreference;
  ministry: AgentMinistryPreferences;
  enabled: boolean;
  dailyEnabled: boolean;
  dailyCallTime: string;
  /** JavaScript day numbers, rendered Monday-first in the Calls UI. */
  dailyCallDays: number[];
  timezone: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  maxCallsPerDay: number;
  sources: {
    obsidianBriefing: boolean;
    codingJobCompletion: boolean;
    blockedAgentDecision: boolean;
  };
  missedCallFallback: AgentCallMissedFallback;
}

function detectAgentCallTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function normalizeAgentMinistrySlot(
  input?: Partial<AgentMinistrySlotConfig> | null,
): AgentMinistrySlotConfig {
  if (!input) return {};
  if (input.kind === "agent") {
    const agentId = input.agentId?.trim();
    return agentId ? { kind: "agent", agentId } : {};
  }
  const provider = input.provider?.trim();
  const model = input.model?.trim();
  if (!provider && !model) return {};
  return {
    kind: "model",
    provider: provider || undefined,
    model: model || undefined,
  };
}

function normalizeAgentMinistry(
  input?: Partial<AgentMinistryPreferences> | null,
): AgentMinistryPreferences {
  const effort = AGENT_MINISTRY_EFFORTS.includes(input?.effort as AgentMinistryEffort)
    ? input?.effort as AgentMinistryEffort
    : "balanced";
  const rawExperts = Array.isArray(input?.experts) ? input.experts : [];
  return {
    enabled: input?.enabled ?? false,
    effort,
    orchestrator: normalizeAgentMinistrySlot(input?.orchestrator),
    experts: Array.from({ length: AGENT_MINISTRY_EXPERT_SLOT_COUNT }, (_, index) => (
      normalizeAgentMinistrySlot(rawExperts[index])
    )),
  };
}

const DEFAULT_AGENT_CALL_DAYS = [1, 2, 3, 4, 5, 6, 0];

function normalizeAgentCallDays(input: unknown): number[] {
  if (!Array.isArray(input)) return [...DEFAULT_AGENT_CALL_DAYS];
  const selected = new Set<number>();
  for (const value of input) {
    const day = Number(value);
    if (Number.isInteger(day) && day >= 0 && day <= 6) selected.add(day);
  }
  if (!selected.size) return [...DEFAULT_AGENT_CALL_DAYS];
  return DEFAULT_AGENT_CALL_DAYS.filter((day) => selected.has(day));
}

export function buildAgentCallPreferences(
  input?: Partial<AgentCallPreferences> | null,
): AgentCallPreferences {
  return {
    voiceRuntime: input?.voiceRuntime || "openai-realtime",
    voiceProviderId: input?.voiceProviderId,
    voiceModelId: input?.voiceModelId,
    voiceId: input?.voiceId,
    voiceAuthMode: input?.voiceAuthMode === "oauth" || input?.voiceAuthMode === "apikey"
      ? input.voiceAuthMode
      : undefined,
    voiceKeyEnv: input?.voiceKeyEnv?.trim() || undefined,
    voiceLanguage: input?.voiceLanguage?.trim() || undefined,
    voiceTextLanguage: input?.voiceTextLanguage?.trim() || undefined,
    voiceChatBrain: input?.voiceChatBrain?.source
      ? {
          source: input.voiceChatBrain.source,
          provider: input.voiceChatBrain.provider?.trim() || undefined,
          model: input.voiceChatBrain.model?.trim() || undefined,
          explicit: input.voiceChatBrain.explicit === true ? true : undefined,
        }
      : undefined,
    ministry: normalizeAgentMinistry(input?.ministry),
    enabled: input?.enabled ?? false,
    dailyEnabled: input?.dailyEnabled ?? false,
    dailyCallTime: input?.dailyCallTime || "09:00",
    dailyCallDays: normalizeAgentCallDays(input?.dailyCallDays),
    timezone: input?.timezone || detectAgentCallTimezone(),
    quietHoursEnabled: input?.quietHoursEnabled ?? true,
    quietHoursStart: input?.quietHoursStart || "22:00",
    quietHoursEnd: input?.quietHoursEnd || "08:00",
    maxCallsPerDay: input?.maxCallsPerDay ?? 1,
    sources: {
      obsidianBriefing: input?.sources?.obsidianBriefing ?? true,
      codingJobCompletion: input?.sources?.codingJobCompletion ?? false,
      blockedAgentDecision: input?.sources?.blockedAgentDecision ?? false,
    },
    missedCallFallback: input?.missedCallFallback || "obsidian_note",
  };
}

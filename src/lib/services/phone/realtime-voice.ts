import { readFileSync } from "fs";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import type { RuntimeAgentVoiceBridge } from "@/lib/services/phone/call-gateway";

export type RealtimeVoiceProvider = "openai-realtime" | "grok-voice" | "gemini-live";

export type SyncedVoiceProvider = {
  id: string;
  provider: RealtimeVoiceProvider;
  voice: string;
};

export type ManagedVoiceConfig = {
  keys: Partial<Record<RealtimeVoiceProvider, string>>;
  livekitUrl?: string;
  livekitApiKey?: string;
  livekitApiSecret?: string;
  livekitEnabled: boolean;
  premiumUnlocked: boolean;
  timezone?: string;
};

export type ResolvedVoice = {
  provider: RealtimeVoiceProvider;
  voice: string;
  apiKey?: string;
};

export type CallAgentMetadata = {
  callId: string;
  briefing: string;
  provider: RealtimeVoiceProvider;
  voice: string;
  apiKey: string;
  runtimeAgent?: RuntimeAgentVoiceBridge;
};

export type InAppCallResult =
  | { ok: true; livekitUrl: string; room: string; token: string; dashboardToken: string; voice: ResolvedVoice }
  | { ok: false; reason: string; missing: string[] };

export type RealtimeToolSchema = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ByokAgentCallResult =
  | {
    ok: true;
    mode: "byok";
    clientSecret: string;
    expiresAt?: number;
    model: string;
    voice: string;
    instructions: string;
    tools: RealtimeToolSchema[];
  }
  | { ok: false; reason: string; missing: string[] };

const ENV_FILES = [
  ".env.local",
  join(homedir(), ".hivemindos", ".env"),
  join(homedir(), ".hivemindos", "voice.env"),
  join(homedir(), ".hivemindos", "claw", "voice.env"),
];

const PROVIDER_KEY_LABELS: Record<RealtimeVoiceProvider, string> = {
  "openai-realtime": "OPENAI_REALTIME_KEY or OPENAI_API_KEY",
  "grok-voice": "XAI_API_KEY",
  "gemini-live": "GEMINI_API_KEY or GOOGLE_API_KEY",
};
const SUPPORTED_WORKER_PROVIDERS: RealtimeVoiceProvider[] = ["openai-realtime"];
const OPENAI_REALTIME_CALLS_MODEL = "gpt-realtime";
const OPENAI_REALTIME_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

const LANGUAGE_LOCK =
  "CRITICAL: Speak only English (US). Phone audio is often noisy or muffled. Never switch languages on your own, and stay in English for the whole call unless the user explicitly asks you to switch languages.";
const TOOL_PROGRESS_INSTRUCTION =
  " When you need to call a tool, briefly tell Liam what you are checking before the tool call, then speak the result when it returns.";

export const ASK_COMPUTER_AGENT_TOOL: RealtimeToolSchema = {
  type: "function",
  name: "ask_computer_agent",
  description:
    "Delegate the user's request to the selected HivemindOS computer agent through the paired desktop gateway. Use this whenever the user asks that computer agent to inspect, change, run, schedule, or answer from its runtime context.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The exact request to send to the selected computer-side agent runtime.",
      },
    },
    required: ["message"],
  },
};

function parseEnvValue(raw: string) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\n/g, "\n").trim();
  }
  return value.replace(/\s+#.*$/, "").trim();
}

function readEnvFile(path: string) {
  const values: Record<string, string> = {};
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    values[key] = parseEnvValue(normalized.slice(separator + 1));
  }
  return values;
}

function readLocalEnvValues() {
  const values: Record<string, string> = {};
  for (const path of ENV_FILES) {
    try {
      Object.assign(values, readEnvFile(path));
    } catch {
      // Env files are optional; process env still wins.
    }
  }
  return values;
}

export function readManagedVoiceConfig(env: NodeJS.ProcessEnv = process.env): ManagedVoiceConfig {
  const fileEnv = readLocalEnvValues();
  const value = (key: string) => env[key]?.trim() || fileEnv[key]?.trim() || undefined;
  const flag = (key: string) => /^(1|true|yes|on)$/i.test(value(key) || "");
  return {
    keys: {
      "openai-realtime": value("OPENAI_REALTIME_KEY") || value("OPENAI_API_KEY"),
      "grok-voice": value("XAI_API_KEY"),
      "gemini-live": value("GEMINI_API_KEY") || value("GOOGLE_API_KEY"),
    },
    livekitUrl: value("LIVEKIT_URL"),
    livekitApiKey: value("LIVEKIT_API_KEY"),
    livekitApiSecret: value("LIVEKIT_API_SECRET"),
    livekitEnabled: flag("HIVEMINDOS_LIVEKIT_ENABLED"),
    premiumUnlocked: flag("HIVEMINDOS_PREMIUM"),
    timezone: value("CALLS_TIMEZONE") || value("TZ"),
  };
}

// LiveKit cloud calls connect over the internet, so they stay off in the
// local-first default: they require both the premium entitlement and an
// explicit user opt-in.
export function livekitCallingAllowed(managed: ManagedVoiceConfig) {
  return managed.premiumUnlocked && managed.livekitEnabled;
}

export function missingLivekitOptIn(managed: ManagedVoiceConfig) {
  return [
    managed.premiumUnlocked ? "" : "HIVEMINDOS_PREMIUM",
    managed.livekitEnabled ? "" : "HIVEMINDOS_LIVEKIT_ENABLED",
  ].filter(Boolean);
}

function voiceForProvider(provider: RealtimeVoiceProvider) {
  if (provider === "grok-voice") return "Grok default";
  if (provider === "gemini-live") return "Gemini default";
  return "alloy";
}

export function voiceProvidersFromManagedConfig(managed: ManagedVoiceConfig): SyncedVoiceProvider[] {
  return SUPPORTED_WORKER_PROVIDERS
    .filter((provider) => Boolean(managed.keys[provider]))
    .map((provider) => ({
      id: `runtime-default:${provider}`,
      provider,
      voice: voiceForProvider(provider),
    }));
}

export function resolveVoice(
  voiceProviderId: string | undefined,
  providers: SyncedVoiceProvider[],
  managed: ManagedVoiceConfig,
): ResolvedVoice | null {
  const chosen = providers.find((provider) => provider.id === voiceProviderId) ?? providers[0] ?? null;
  if (chosen) {
    const apiKey = managed.keys[chosen.provider];
    return apiKey ? { provider: chosen.provider, voice: chosen.voice, apiKey } : null;
  }

  const provider = SUPPORTED_WORKER_PROVIDERS.find((candidate) => managed.keys[candidate]);
  return provider ? { provider, voice: voiceForProvider(provider), apiKey: managed.keys[provider] } : null;
}

function callId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function missingForCall(managed: ManagedVoiceConfig, voice: ResolvedVoice | null) {
  const missing: string[] = [];
  if (!managed.livekitUrl) missing.push("LIVEKIT_URL");
  if (!managed.livekitApiKey) missing.push("LIVEKIT_API_KEY");
  if (!managed.livekitApiSecret) missing.push("LIVEKIT_API_SECRET");
  if (!voice?.apiKey) missing.push(voice?.provider ? PROVIDER_KEY_LABELS[voice.provider] : "OPENAI_REALTIME_KEY or OPENAI_API_KEY");
  return missing;
}

function openingLineForBriefing(briefing: string) {
  const match = briefing.match(/\[greeting\]\s*Start the call with exactly:\s*["“](.+?)["”]/i);
  return match?.[1]?.trim() || "Hello Liam, this is your HivemindOS coding agent.";
}

export function buildByokAgentCallInstructions(args: {
  briefing: string;
  runtimeAgent?: RuntimeAgentVoiceBridge;
}) {
  const openingLine = openingLineForBriefing(args.briefing);
  const runtimeAgent = args.runtimeAgent;
  const runtimeAgentNote = runtimeAgent
    ? ` You are connected to ${runtimeAgent.agent.name || "a HivemindOS computer agent"} on ${runtimeAgent.machine?.name || "the paired computer"}. When Liam asks that computer agent to do or answer something, call ask_computer_agent and speak back the result concisely.`
    : "";
  return (
    "You are a HivemindOS voice bridge for a computer-side coding agent. " +
    LANGUAGE_LOCK +
    ` On the first assistant turn only, say exactly: "${openingLine}" ` +
    "After that first turn, never reintroduce yourself. Answer the user's latest question directly and concisely." +
    TOOL_PROGRESS_INSTRUCTION +
    runtimeAgentNote +
    "\n\nPRIVATE BRIEFING CONTEXT:\n" +
    (args.briefing || "No briefing was provided.")
  );
}

export async function createByokAgentCall(args: {
  briefing: string;
  voice: ResolvedVoice | null;
  runtimeAgent?: RuntimeAgentVoiceBridge;
}): Promise<ByokAgentCallResult> {
  if (!args.voice?.apiKey) {
    return { ok: false, reason: "openai_realtime_not_configured", missing: ["OPENAI_REALTIME_KEY or OPENAI_API_KEY"] };
  }
  const instructions = buildByokAgentCallInstructions({
    briefing: args.briefing,
    runtimeAgent: args.runtimeAgent,
  });
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.voice.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: process.env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_CALLS_MODEL,
        instructions,
        audio: {
          input: {
            transcription: { model: OPENAI_REALTIME_TRANSCRIBE_MODEL, language: "en" },
            turn_detection: {
              type: "server_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: args.voice.voice || "alloy" },
        },
        tools: [ASK_COMPUTER_AGENT_TOOL],
        tool_choice: "auto",
      },
    }),
    signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    // Surface the real network reason (cause of undici's "fetch failed")
    // so the phone/dashboard shows something actionable.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `The hub couldn't reach api.openai.com to mint the Realtime session: ${cause}`, missing: [] };
  }
  const data = await response.json().catch(() => null) as {
    value?: unknown;
    expires_at?: unknown;
    client_secret?: { value?: unknown; expires_at?: unknown };
    error?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const error = typeof data?.error === "string" ? data.error : data?.error?.message;
    return { ok: false, reason: error || `openai_realtime_error:${response.status}`, missing: [] };
  }
  const clientSecret = typeof data?.value === "string"
    ? data.value
    : typeof data?.client_secret?.value === "string" ? data.client_secret.value : "";
  if (!clientSecret) return { ok: false, reason: "openai_realtime_missing_client_secret", missing: [] };
  const expiresAt = typeof data?.expires_at === "number"
    ? data.expires_at
    : typeof data?.client_secret?.expires_at === "number" ? data.client_secret.expires_at : undefined;
  return {
    ok: true,
    mode: "byok",
    clientSecret,
    expiresAt,
    model: process.env.OPENAI_REALTIME_MODEL || OPENAI_REALTIME_CALLS_MODEL,
    voice: args.voice.voice || "alloy",
    instructions,
    tools: [ASK_COMPUTER_AGENT_TOOL],
  };
}

export async function createInAppCall(args: {
  briefing: string;
  voice: ResolvedVoice | null;
  callId?: string;
  runtimeAgent?: RuntimeAgentVoiceBridge;
}, managed: ManagedVoiceConfig = readManagedVoiceConfig()): Promise<InAppCallResult> {
  if (!livekitCallingAllowed(managed)) {
    return { ok: false, reason: "livekit_disabled", missing: missingLivekitOptIn(managed) };
  }
  const missing = missingForCall(managed, args.voice);
  if (missing.length || !args.voice?.apiKey) {
    return { ok: false, reason: "voice_transport_not_configured", missing };
  }

  const url = managed.livekitUrl!;
  const apiKey = managed.livekitApiKey!;
  const apiSecret = managed.livekitApiSecret!;
  const id = args.callId || callId("call");
  const room = `call_${id}`;

  try {
    const { AccessToken, AgentDispatchClient, RoomServiceClient } = await import("livekit-server-sdk");
    await new RoomServiceClient(url, apiKey, apiSecret).createRoom({ name: room });
    const metadata: CallAgentMetadata = {
      callId: id,
      briefing: args.briefing,
      provider: args.voice.provider,
      voice: args.voice.voice,
      apiKey: args.voice.apiKey,
      runtimeAgent: args.runtimeAgent,
    };
    await new AgentDispatchClient(url, apiKey, apiSecret).createDispatch(
      room,
      process.env.LIVEKIT_AGENT_NAME || "hivemindos-call-agent",
      { metadata: JSON.stringify(metadata) },
    );

    const deviceToken = new AccessToken(apiKey, apiSecret, { identity: `device_${id}` });
    deviceToken.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
    const dashboardToken = new AccessToken(apiKey, apiSecret, { identity: `dashboard_${id}` });
    dashboardToken.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });

    return {
      ok: true,
      livekitUrl: url,
      room,
      token: await deviceToken.toJwt(),
      dashboardToken: await dashboardToken.toJwt(),
      voice: args.voice,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `livekit_error:${error instanceof Error ? error.message : String(error)}`,
      missing: [],
    };
  }
}

export function voiceConfigPayload(managed: ManagedVoiceConfig = readManagedVoiceConfig()) {
  const voiceProviders = voiceProvidersFromManagedConfig(managed);
  const voiceOptions = voiceProviders.map((provider) => ({ ...provider, source: "configured" }));
  const livekitAllowed = livekitCallingAllowed(managed);
  const missing = [
    // LiveKit credentials only matter once the cloud mode is unlocked and
    // explicitly enabled; the local-first default needs none of them.
    ...(livekitAllowed
      ? [
        managed.livekitUrl ? "" : "LIVEKIT_URL",
        managed.livekitApiKey ? "" : "LIVEKIT_API_KEY",
        managed.livekitApiSecret ? "" : "LIVEKIT_API_SECRET",
      ]
      : []),
    voiceProviders.length ? "" : "OPENAI_REALTIME_KEY or OPENAI_API_KEY",
  ].filter(Boolean);
  return {
    ok: true,
    config: {
      enabled: missing.length === 0,
      timezone: managed.timezone,
      quietHoursEnabled: false,
      dailyEnabled: false,
      voiceProviders,
      voiceOptions: voiceOptions.length ? voiceOptions : [{
        id: "runtime-default:openai-realtime",
        provider: "openai-realtime",
        voice: "alloy",
        source: "runtime-default",
      }],
      managedBy: "hivemindos-tauri-dev",
      defaultCallMode: "byok",
      callModes: [
        {
          id: "byok",
          label: "BYOK Agent Calls",
          description: "Direct 1:1 OpenAI Realtime calls using the user's HivemindOS OpenAI key.",
          premium: false,
          enabled: true,
        },
        {
          id: "cloud",
          label: "HivemindOS Cloud Agent Calls",
          description: "Managed multi-party rooms for humans and multiple agents. Connects over the internet, so it stays off until premium is unlocked and LiveKit is explicitly enabled.",
          premium: true,
          enabled: livekitAllowed,
          requires: missingLivekitOptIn(managed),
        },
        {
          id: "local-tts",
          label: "Local TTS Agent Calls",
          description: "Use a connected local or Tailnet TTS service for agent speech while the selected agent runtime remains the LLM.",
          premium: false,
          enabled: true,
        },
      ],
      missing,
    },
  };
}

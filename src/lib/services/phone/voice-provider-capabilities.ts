import type { ManagedVoiceConfig } from "@/lib/services/phone/realtime-voice";

export type VoiceProviderCapability = {
  id: string;
  label: string;
  transport: "direct-webrtc" | "managed-room" | "server-tts" | "speech-to-speech";
  realtimeSpeech: boolean;
  separateSttTts: boolean;
  roomCapable: boolean;
  localFirst: boolean;
  supportsBargeIn: boolean;
  supportsToolCalls: boolean;
  supportsTranscripts: boolean;
  supportsRecording: boolean;
  supportsMultiParty: boolean;
  credentialLabels: string[];
  sideEffectGates: string[];
  fallbackProviderIds: string[];
  status: "configured" | "available" | "missing-credentials" | "disabled";
};

const BASE_CAPABILITIES: Omit<VoiceProviderCapability, "status">[] = [
  {
    id: "openai-realtime",
    label: "OpenAI Realtime BYOK",
    transport: "direct-webrtc",
    realtimeSpeech: true,
    separateSttTts: false,
    roomCapable: false,
    localFirst: true,
    supportsBargeIn: true,
    supportsToolCalls: true,
    supportsTranscripts: true,
    supportsRecording: false,
    supportsMultiParty: false,
    credentialLabels: ["OPENAI_REALTIME_KEY", "OPENAI_API_KEY"],
    sideEffectGates: [],
    fallbackProviderIds: ["local-tts"],
  },
  {
    id: "local-tts",
    label: "Local TTS Runtime Bridge",
    transport: "server-tts",
    realtimeSpeech: false,
    separateSttTts: true,
    roomCapable: false,
    localFirst: true,
    supportsBargeIn: true,
    supportsToolCalls: true,
    supportsTranscripts: true,
    supportsRecording: false,
    supportsMultiParty: false,
    credentialLabels: ["OPENAI_REALTIME_KEY or OPENAI_API_KEY for realtime STT"],
    sideEffectGates: ["Validated local or Tailnet TTS app"],
    fallbackProviderIds: ["openai-realtime"],
  },
  {
    id: "livekit-cloud-room",
    label: "HivemindOS Cloud Agent Calls",
    transport: "managed-room",
    realtimeSpeech: true,
    separateSttTts: false,
    roomCapable: true,
    localFirst: false,
    supportsBargeIn: true,
    supportsToolCalls: true,
    supportsTranscripts: true,
    supportsRecording: true,
    supportsMultiParty: true,
    credentialLabels: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "OPENAI_REALTIME_KEY or OPENAI_API_KEY"],
    sideEffectGates: ["HIVEMINDOS_PREMIUM=1", "HIVEMINDOS_LIVEKIT_ENABLED=1"],
    fallbackProviderIds: ["openai-realtime", "local-tts"],
  },
  {
    id: "native-callkit",
    label: "Native Data Call Presentation",
    transport: "managed-room",
    realtimeSpeech: false,
    separateSttTts: false,
    roomCapable: true,
    localFirst: false,
    supportsBargeIn: true,
    supportsToolCalls: true,
    supportsTranscripts: true,
    supportsRecording: true,
    supportsMultiParty: true,
    credentialLabels: ["APNS VoIP credentials", "Paired mobile device token"],
    sideEffectGates: ["User-enabled proactive calls", "Real incoming CallKit call only"],
    fallbackProviderIds: ["openai-realtime", "livekit-cloud-room"],
  },
];

export function voiceProviderCapabilitiesPayload(managed?: ManagedVoiceConfig): VoiceProviderCapability[] {
  return BASE_CAPABILITIES.map((capability) => {
    if (capability.id === "openai-realtime") {
      return {
        ...capability,
        status: managed?.keys["openai-realtime"] ? "configured" : "missing-credentials",
      };
    }
    if (capability.id === "local-tts") {
      return {
        ...capability,
        status: "available",
      };
    }
    if (capability.id === "livekit-cloud-room") {
      const hasCredentials = Boolean(managed?.livekitUrl && managed.livekitApiKey && managed.livekitApiSecret);
      const enabled = Boolean(managed?.premiumUnlocked && managed.livekitEnabled);
      return {
        ...capability,
        status: enabled && hasCredentials ? "configured" : enabled ? "missing-credentials" : "disabled",
      };
    }
    return {
      ...capability,
      status: "available",
    };
  });
}

export function voiceCapabilitySearchEvidence(managed?: ManagedVoiceConfig) {
  return voiceProviderCapabilitiesPayload(managed).map((capability) => ({
    id: capability.id,
    implementation: capability.label,
    status: capability.status,
    transport: capability.transport,
    requiredCredentials: capability.credentialLabels,
    sideEffectGates: capability.sideEffectGates,
    fallbackProviderIds: capability.fallbackProviderIds,
  }));
}

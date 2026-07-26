import type { AgentProfile } from "@/lib/types/agent-runtime";

export const AGENT_PROFILES_STORAGE_KEY = "hivemindos.agentProfiles.v1";

const CONFIGURATION_FIELDS = [
  "runtime",
  "provider",
  "model",
  "gatewayUrl",
  "chatPath",
  "statusPath",
  "localDataDir",
] as const satisfies readonly (keyof AgentProfile)[];

type MergeConfigurationOptions = {
  preferExistingOnEqual?: boolean;
};

function configurationRevision(profile: Partial<AgentProfile>) {
  const value = Number(profile.configurationUpdatedAt);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function provider(profile: Partial<AgentProfile>) {
  return String(profile.provider || "").trim().toLowerCase();
}

function isOAuthOpenAiProfile(profile: Partial<AgentProfile>) {
  return provider(profile) === "openai-codex" || provider(profile) === "openai-oauth";
}

function isApiKeyOpenAiProfile(profile: Partial<AgentProfile>) {
  return provider(profile) === "openai" || provider(profile) === "openai-api";
}

export function stampAgentProfileConfigurationPatch(
  patch: Partial<AgentProfile>,
  now = Date.now(),
): Partial<AgentProfile> {
  const changesConfiguration = CONFIGURATION_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(patch, field),
  );
  return changesConfiguration
    ? { ...patch, configurationUpdatedAt: now }
    : patch;
}

/**
 * Merge a synchronized profile without letting an older full-profile snapshot
 * overwrite a newer runtime/provider/model choice. Unversioned OAuth-to-API
 * downgrades are also rejected: old clients and vault mirrors cannot silently
 * turn a subscription-backed profile into API-key billing.
 */
export function mergeAgentProfileConfiguration(
  current: AgentProfile,
  incoming: AgentProfile,
  options: MergeConfigurationOptions = {},
): AgentProfile {
  const currentRevision = configurationRevision(current);
  const incomingRevision = configurationRevision(incoming);
  const unversionedOAuthDowngrade =
    currentRevision === 0 &&
    incomingRevision === 0 &&
    isOAuthOpenAiProfile(current) &&
    isApiKeyOpenAiProfile(incoming);
  const preserveCurrent =
    currentRevision > incomingRevision ||
    (options.preferExistingOnEqual &&
      currentRevision === incomingRevision) ||
    unversionedOAuthDowngrade;
  if (!preserveCurrent) return { ...current, ...incoming };

  const merged = { ...current, ...incoming };
  for (const field of CONFIGURATION_FIELDS) {
    Object.assign(merged, { [field]: current[field] });
  }
  merged.configurationUpdatedAt = current.configurationUpdatedAt;
  return merged;
}

export function mergeAgentProfileSnapshot(
  current: AgentProfile[],
  incoming: AgentProfile[],
  now = Date.now(),
): AgentProfile[] {
  const currentById = new Map(current.map((profile) => [profile.id, profile]));
  return incoming.map((profile) => {
    const existing = currentById.get(profile.id);
    const merged = existing
      ? mergeAgentProfileConfiguration(existing, profile)
      : profile;
    return configurationRevision(merged) > 0
      ? merged
      : { ...merged, configurationUpdatedAt: now };
  });
}

function parseProfiles(raw: string | null | undefined): AgentProfile[] | null {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (profile): profile is AgentProfile =>
        Boolean(profile) &&
        typeof profile === "object" &&
        typeof (profile as AgentProfile).id === "string",
    );
  } catch {
    return null;
  }
}

export function mergeSerializedAgentProfileSnapshot(
  currentRaw: string | null | undefined,
  incomingRaw: string,
  now = Date.now(),
) {
  const current = parseProfiles(currentRaw);
  const incoming = parseProfiles(incomingRaw);
  if (!current || !incoming) return incomingRaw;
  return JSON.stringify(mergeAgentProfileSnapshot(current, incoming, now));
}

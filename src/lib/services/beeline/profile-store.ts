import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "@/lib/home-dir";
import {
  BEELINE_CAPABILITIES,
  BEELINE_RELATIONSHIPS,
  type BeelineBrowserBinding,
  type BeelineCapability,
  type BeelineConsentStatus,
  type BeelineProfile,
  type BeelineProfileCreateInput,
  type BeelineProfileResolution,
  type BeelineProfilesFile,
  type BeelineProfileUpdateInput,
  type BeelineRelationship,
} from "@/lib/types/beeline";

const DEFAULT_STORAGE_PATH = join(homedir(), ".hivemindos", "beeline", "profiles.json");
const relationshipSet = new Set<string>(BEELINE_RELATIONSHIPS);
const capabilitySet = new Set<string>(BEELINE_CAPABILITIES);
const writeQueues = new Map<string, Promise<BeelineProfilesFile>>();

export type BeelineStoreOptions = { storagePath?: string };

export class BeelineProfileNotFoundError extends Error {
  readonly status = 404;

  constructor(profileId: string) {
    super(`Beeline profile ${profileId} was not found.`);
    this.name = "BeelineProfileNotFoundError";
  }
}

function emptyProfiles(): BeelineProfilesFile {
  return { version: 1, profiles: [], updatedAt: new Date(0).toISOString() };
}

function cleanText(value: unknown, maximumLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximumLength)
    : "";
}

function normalizeRelationship(value: unknown): BeelineRelationship {
  return relationshipSet.has(String(value)) ? value as BeelineRelationship : "other";
}

function normalizeCapabilities(value: unknown): BeelineCapability[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is BeelineCapability => capabilitySet.has(String(item))))];
}

function normalizeAliases(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((alias) => cleanText(alias, 50).toLowerCase()).filter(Boolean))].slice(0, 12);
}

function normalizeConsentStatus(value: unknown): BeelineConsentStatus {
  return value === "confirmed" || value === "revoked" ? value : "pending";
}

function normalizeBrowserBinding(value: unknown): BeelineBrowserBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const profileDirectory = cleanText(input.profileDirectory, 120);
  const profileName = cleanText(input.profileName, 120);
  if (input.browserId !== "chrome" || !profileDirectory || !profileName) return undefined;
  const passwordManager = ["none", "chrome", "bitwarden", "keepassxc", "other"].includes(String(input.passwordManager))
    ? input.passwordManager as BeelineBrowserBinding["passwordManager"]
    : "none";
  return {
    browserId: "chrome",
    profileDirectory,
    profileName,
    passwordManager,
    automationMode: input.automationMode === "trusted-agent" ? "trusted-agent" : "manual-first",
  };
}

function normalizeProfile(value: unknown): BeelineProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = cleanText(input.id, 100);
  const displayName = cleanText(input.displayName, 100);
  if (!id || !displayName) return null;
  const consentInput = input.consent && typeof input.consent === "object" && !Array.isArray(input.consent)
    ? input.consent as Record<string, unknown>
    : {};
  const consentStatus = normalizeConsentStatus(consentInput.status);
  const confirmedAt = cleanText(consentInput.confirmedAt, 50);
  const revokedAt = cleanText(consentInput.revokedAt, 50);
  const createdAt = cleanText(input.createdAt, 50) || new Date(0).toISOString();
  const updatedAt = cleanText(input.updatedAt, 50) || createdAt;
  return {
    id,
    displayName,
    relationship: normalizeRelationship(input.relationship),
    aliases: normalizeAliases(input.aliases),
    capabilities: normalizeCapabilities(input.capabilities),
    consent: {
      status: consentStatus,
      ...(confirmedAt ? { confirmedAt } : {}),
      ...(revokedAt ? { revokedAt } : {}),
    },
    ...(normalizeBrowserBinding(input.browserBinding) ? { browserBinding: normalizeBrowserBinding(input.browserBinding) } : {}),
    // Credential material and client-asserted connection state are deliberately not accepted.
    connections: [],
    createdAt,
    updatedAt,
  };
}

function normalizeProfilesFile(value: unknown): BeelineProfilesFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyProfiles();
  const input = value as Record<string, unknown>;
  const profiles = Array.isArray(input.profiles)
    ? input.profiles.map(normalizeProfile).filter((profile): profile is BeelineProfile => Boolean(profile))
    : [];
  return {
    version: 1,
    profiles,
    updatedAt: cleanText(input.updatedAt, 50) || new Date(0).toISOString(),
  };
}

function storagePath(options?: BeelineStoreOptions) {
  return options?.storagePath || DEFAULT_STORAGE_PATH;
}

export async function readBeelineProfiles(options?: BeelineStoreOptions): Promise<BeelineProfilesFile> {
  try {
    const raw = await readFile(storagePath(options), "utf8");
    return normalizeProfilesFile(JSON.parse(raw) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return emptyProfiles();
    throw error;
  }
}

async function writeProfiles(file: BeelineProfilesFile, options?: BeelineStoreOptions) {
  const path = storagePath(options);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

async function mutateProfiles(
  mutate: (current: BeelineProfilesFile) => BeelineProfilesFile,
  options?: BeelineStoreOptions,
) {
  const path = storagePath(options);
  const queued = (writeQueues.get(path) ?? Promise.resolve(emptyProfiles()))
    .catch(() => emptyProfiles())
    .then(async () => {
      const next = mutate(await readBeelineProfiles(options));
      await writeProfiles(next, options);
      return next;
    });
  writeQueues.set(path, queued);
  return queued;
}

function requireDisplayName(value: unknown) {
  const displayName = cleanText(value, 100);
  if (!displayName) throw new Error("A family member name is required.");
  return displayName;
}

export async function createBeelineProfile(input: BeelineProfileCreateInput, options?: BeelineStoreOptions) {
  const now = new Date().toISOString();
  const profile: BeelineProfile = {
    id: `beeline_${randomUUID()}`,
    displayName: requireDisplayName(input.displayName),
    relationship: normalizeRelationship(input.relationship),
    aliases: normalizeAliases(input.aliases),
    capabilities: normalizeCapabilities(input.capabilities),
    consent: { status: "pending" },
    connections: [],
    createdAt: now,
    updatedAt: now,
  };
  await mutateProfiles((current) => ({
    version: 1,
    profiles: [...current.profiles, profile],
    updatedAt: now,
  }), options);
  return profile;
}

export async function updateBeelineProfile(
  profileId: string,
  input: BeelineProfileUpdateInput,
  options?: BeelineStoreOptions,
) {
  let updated: BeelineProfile | undefined;
  await mutateProfiles((current) => {
    const existing = current.profiles.find((profile) => profile.id === profileId);
    if (!existing) throw new BeelineProfileNotFoundError(profileId);
    const now = new Date().toISOString();
    const consentStatus = input.consentStatus ?? existing.consent.status;
    updated = {
      ...existing,
      ...(input.displayName !== undefined ? { displayName: requireDisplayName(input.displayName) } : {}),
      ...(input.relationship !== undefined ? { relationship: normalizeRelationship(input.relationship) } : {}),
      ...(input.aliases !== undefined ? { aliases: normalizeAliases(input.aliases) } : {}),
      ...(input.capabilities !== undefined ? { capabilities: normalizeCapabilities(input.capabilities) } : {}),
      ...(input.browserBinding !== undefined ? { browserBinding: normalizeBrowserBinding(input.browserBinding) } : {}),
      consent: {
        status: consentStatus,
        ...(consentStatus === "confirmed" ? { confirmedAt: existing.consent.confirmedAt ?? now } : {}),
        ...(consentStatus === "revoked" ? { revokedAt: now } : {}),
      },
      updatedAt: now,
    };
    return {
      version: 1,
      profiles: current.profiles.map((profile) => profile.id === profileId ? updated! : profile),
      updatedAt: now,
    };
  }, options);
  return updated!;
}

export async function deleteBeelineProfile(profileId: string, options?: BeelineStoreOptions) {
  await mutateProfiles((current) => {
    if (!current.profiles.some((profile) => profile.id === profileId)) {
      throw new BeelineProfileNotFoundError(profileId);
    }
    return {
      version: 1,
      profiles: current.profiles.filter((profile) => profile.id !== profileId),
      updatedAt: new Date().toISOString(),
    };
  }, options);
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profileTerms(profile: BeelineProfile) {
  return [...new Set([
    profile.displayName.toLowerCase(),
    profile.relationship.toLowerCase(),
    ...profile.aliases,
  ].filter((term) => term.length >= 2))];
}

export async function resolveBeelineProfile(query: string, options?: BeelineStoreOptions): Promise<BeelineProfileResolution> {
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedQuery) return { status: "no-match", matches: [] };
  const matches = (await readBeelineProfiles(options)).profiles.filter((profile) =>
    profileTerms(profile).some((term) => new RegExp(`(^|\\W)${escapeRegularExpression(term)}(?=$|\\W)`, "i").test(normalizedQuery)),
  );
  if (matches.length === 0) return { status: "no-match", matches: [] };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "matched", profile: matches[0], matches };
}

export function buildBeelinePromptContext(resolution: BeelineProfileResolution) {
  if (resolution.status === "no-match") return "";
  if (resolution.status === "ambiguous") {
    return [
      "Beeline delegated-person context:",
      `The request could refer to more than one Beeline profile: ${resolution.matches.map((profile) => profile.displayName).join(", ")}.`,
      "Ask the user which person they mean before reading or using any delegated-person capability.",
    ].join("\n");
  }
  const profile = resolution.profile;
  if (profile.consent.status !== "confirmed") {
    return [
      "Beeline delegated-person context:",
      `Matched ${profile.displayName} (${profile.relationship}), but Authorization is not confirmed.`,
      "Do not act as this person, open their browser profile, or use any connected service. Ask the user to confirm authority in Beeline first.",
    ].join("\n");
  }
  const browser = profile.browserBinding
    ? `Chrome profile ${profile.browserBinding.profileName} (${profile.browserBinding.profileDirectory}); automation mode ${profile.browserBinding.automationMode}.`
    : "No browser profile is bound.";
  return [
    "Beeline delegated-person context:",
    `Matched profile: ${profile.displayName} (${profile.relationship}). Confirmed capabilities: ${profile.capabilities.join(", ") || "none"}.`,
    browser,
    "Use beeline_profiles to resolve or re-check the profile. Then use beeline_local_credentials for device-held login/API handles or beeline_connections for hosted OAuth/MCP handles; both are secret-free.",
    "For local credentials, infer the credential and steps from the goal. Use beeline_local_credential_use at the exact saved website origin; only extra-restricted credentials require CONFIRM_BEELINE_LOCAL_CREDENTIAL and method limits.",
    "Use beeline_calendar_list or beeline_mcp_read for family-scoped reads. Calendar writes require beeline_calendar_create with CONFIRM_BEELINE_CALENDAR; MCP tool calls require beeline_mcp_call with CONFIRM_BEELINE_MCP_ACTION.",
    "Use beeline_open_browser only after explicit CONFIRM_BEELINE_BROWSER confirmation. Trusted-agent browser automation uses beeline_browser_use with CONFIRM_BEELINE_BROWSER_ACTION for the exact action and website.",
    "Never request, reveal, export, or place family credentials, session cookies, or OAuth tokens in chat, prompts, tool arguments, logs, or files.",
    "Treat healthcare, purchases, bookings, messages, and other consequential actions as separate approval-gated operations even after the browser is opened.",
  ].join("\n");
}

export async function buildBeelineContextForPrompt(query: string, options?: BeelineStoreOptions) {
  return buildBeelinePromptContext(await resolveBeelineProfile(query, options));
}

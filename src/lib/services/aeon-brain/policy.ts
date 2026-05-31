import { readFile } from "fs/promises";
import { join } from "path";

export type AeonBrainVisibility = "public" | "private" | "internal" | "unknown";
export type AeonBrainMode = "restricted" | "unrestricted";
export type AeonBrainAction = "policy" | "search" | "read" | "list" | "append" | "bulk";

export type AeonBrainPolicy = {
  mode: AeonBrainMode;
  visibility: AeonBrainVisibility;
  allowedActions: AeonBrainAction[];
  include: string[];
  exclude: string[];
  appendAllow: string[];
  maxResults: number;
  maxCharsPerResult: number;
  maxCharsPerRun: number;
  allowNoteOpen: boolean;
  allowDirectoryListing: boolean;
  allowBulkExport: boolean;
};

type AeonBrainPolicyProfile = Partial<Pick<
  AeonBrainPolicy,
  "include" | "exclude" | "appendAllow" | "maxResults" | "maxCharsPerResult" | "maxCharsPerRun"
>> & {
  mode?: AeonBrainMode;
  allowedActions?: AeonBrainAction[];
  allowNoteOpen?: boolean;
  allowDirectoryListing?: boolean;
  allowBulkExport?: boolean;
};

type AeonBrainPolicyConfig = {
  visibility?: Partial<Record<AeonBrainVisibility, AeonBrainPolicyProfile>>;
  repos?: Record<string, AeonBrainPolicyProfile>;
};

export type AeonBrainPolicyContext = {
  repo: string;
  runId: string;
  visibility: AeonBrainVisibility;
  vaultPath: string;
};

const DEFAULT_RESTRICTED_EXCLUDES = [
  "PRIVATE/**",
  "Private/**",
  "People/Private/**",
  "Operations/Secrets/**",
  "**/secrets/**",
  "**/Secrets/**",
  ".obsidian/**",
  ".trash/**",
  "**/.env*",
  "**/*.gpg",
];

const DEFAULT_RESTRICTED: Omit<AeonBrainPolicy, "visibility"> = {
  mode: "restricted",
  allowedActions: ["policy", "search", "append"],
  include: ["*.md", "**/*.md"],
  exclude: DEFAULT_RESTRICTED_EXCLUDES,
  appendAllow: [
    "Agents/AEON/Runs/${repo}/${runId}/**",
    "Agents/AEON/Working Memory/${repo}/**",
  ],
  maxResults: 12,
  maxCharsPerResult: 2_000,
  maxCharsPerRun: 50_000,
  allowNoteOpen: false,
  allowDirectoryListing: false,
  allowBulkExport: false,
};

const DEFAULT_UNRESTRICTED: Omit<AeonBrainPolicy, "visibility"> = {
  mode: "unrestricted",
  allowedActions: ["policy", "search", "read", "list", "append", "bulk"],
  include: ["**"],
  exclude: [],
  appendAllow: ["**"],
  maxResults: Number.MAX_SAFE_INTEGER,
  maxCharsPerResult: Number.MAX_SAFE_INTEGER,
  maxCharsPerRun: Number.MAX_SAFE_INTEGER,
  allowNoteOpen: true,
  allowDirectoryListing: true,
  allowBulkExport: true,
};

export function repoSlug(repo: string) {
  return repo.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-repo";
}

export async function resolveAeonBrainPolicy(context: AeonBrainPolicyContext): Promise<AeonBrainPolicy> {
  const base = context.visibility === "private" || context.visibility === "internal"
    ? { ...DEFAULT_UNRESTRICTED, visibility: context.visibility }
    : { ...DEFAULT_RESTRICTED, visibility: context.visibility };

  const config = await readPolicyConfig(context.vaultPath);
  const visibilityProfile = config.visibility?.[context.visibility];
  const repoProfile = config.repos?.[context.repo.toLowerCase()] ?? config.repos?.[context.repo];

  return normalizePolicy(context, mergePolicy(mergePolicy(base, visibilityProfile), repoProfile));
}

export function assertActionAllowed(policy: AeonBrainPolicy, action: AeonBrainAction) {
  if (!policy.allowedActions.includes(action)) {
    throw Object.assign(new Error(`AEON brain policy does not allow ${action} for ${policy.visibility} repositories.`), { status: 403 });
  }
  if (action === "read" && !policy.allowNoteOpen) {
    throw Object.assign(new Error("AEON brain policy does not allow opening exact notes in this mode."), { status: 403 });
  }
  if (action === "list" && !policy.allowDirectoryListing) {
    throw Object.assign(new Error("AEON brain policy does not allow directory listing in this mode."), { status: 403 });
  }
  if (action === "bulk" && !policy.allowBulkExport) {
    throw Object.assign(new Error("AEON brain policy does not allow bulk export in this mode."), { status: 403 });
  }
}

export function pathAllowed(policy: AeonBrainPolicy, relativePath: string) {
  const normalized = normalizeVaultRelativePath(relativePath);
  const included = policy.include.length === 0 || policy.include.some((pattern) => matchGlob(pattern, normalized));
  const excluded = policy.exclude.some((pattern) => matchGlob(pattern, normalized));
  return included && !excluded;
}

export function appendPathAllowed(policy: AeonBrainPolicy, relativePath: string) {
  const normalized = normalizeVaultRelativePath(relativePath);
  return pathAllowed(policy, normalized) && policy.appendAllow.some((pattern) => matchGlob(pattern, normalized));
}

export function normalizeVaultRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean).join("/");
}

function normalizePolicy(context: AeonBrainPolicyContext, policy: AeonBrainPolicy): AeonBrainPolicy {
  const replacements = {
    "${repo}": repoSlug(context.repo),
    "${runId}": repoSlug(context.runId || "unknown-run"),
  };
  const expand = (pattern: string) => Object.entries(replacements).reduce((value, [key, replacement]) => value.split(key).join(replacement), pattern);
  return {
    ...policy,
    include: policy.include.map(expand),
    exclude: policy.exclude.map(expand),
    appendAllow: policy.appendAllow.map(expand),
  };
}

async function readPolicyConfig(vaultPath: string): Promise<AeonBrainPolicyConfig> {
  const configured = process.env.HIVE_AEON_BRAIN_POLICY_PATH?.trim();
  const candidates = [
    configured,
    join(vaultPath, ".hivemindos", "aeon-brain-policy.json"),
  ].filter((path): path is string => Boolean(path));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await readFile(candidate, "utf8")) as AeonBrainPolicyConfig;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // Missing or malformed local policy falls back to safe defaults.
    }
  }
  return {};
}

function mergePolicy(policy: AeonBrainPolicy, profile?: AeonBrainPolicyProfile): AeonBrainPolicy {
  if (!profile) return policy;
  const mode = profile.mode ?? policy.mode;
  return {
    ...policy,
    mode,
    allowedActions: profile.allowedActions ?? policy.allowedActions,
    include: profile.include ?? policy.include,
    exclude: profile.exclude ?? policy.exclude,
    appendAllow: profile.appendAllow ?? policy.appendAllow,
    maxResults: profile.maxResults ?? policy.maxResults,
    maxCharsPerResult: profile.maxCharsPerResult ?? policy.maxCharsPerResult,
    maxCharsPerRun: profile.maxCharsPerRun ?? policy.maxCharsPerRun,
    allowNoteOpen: profile.allowNoteOpen ?? policy.allowNoteOpen,
    allowDirectoryListing: profile.allowDirectoryListing ?? policy.allowDirectoryListing,
    allowBulkExport: profile.allowBulkExport ?? policy.allowBulkExport,
  };
}

function matchGlob(pattern: string, relativePath: string) {
  const normalizedPattern = normalizeVaultRelativePath(pattern);
  if (normalizedPattern === "**") return true;
  const regex = new RegExp(`^${globToRegExpSource(normalizedPattern)}$`, "i");
  return regex.test(relativePath);
}

function globToRegExpSource(pattern: string) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char ?? "");
  }
  return source;
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

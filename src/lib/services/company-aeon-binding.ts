import "server-only";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type {
  CompanyAeonOptionsPayload,
  CompanyAeonProfileOption,
  CompanyAeonSkillOption,
} from "@/lib/types/company-aeon";
import type { CompanyExecutionConfig } from "@/lib/types/company";
import { readVaultAgentProfiles } from "@/lib/services/obsidian/agent-profiles";
import { aeonAdapter, listAeonRuns } from "@/lib/services/runtime-adapters/aeon";
import type { RuntimeRun, RuntimeSkill } from "@/lib/services/runtime-adapters/types";

export type CompanyAeonBinding = {
  profile: AgentProfile;
  skill: RuntimeSkill;
};

type CompanyAeonBindingDependencies = {
  readProfiles: (vaultPath?: string) => Promise<AgentProfile[]>;
  listSkills: (profile: AgentProfile, vaultPath?: string) => Promise<RuntimeSkill[]>;
  listRuns: (profile: AgentProfile) => Promise<RuntimeRun[]>;
};

async function listAeonProfiles(vaultPath?: string): Promise<AgentProfile[]> {
  return (await readVaultAgentProfiles(vaultPath)).filter((profile) => profile.runtime === "aeon");
}

function findAeonProfileById(profiles: AgentProfile[], profileId: string): AgentProfile | undefined {
  return profiles.find((profile) => profile.id === profileId && profile.runtime === "aeon");
}

const DEFAULT_DEPENDENCIES: CompanyAeonBindingDependencies = {
  readProfiles: listAeonProfiles,
  listSkills: async (profile, vaultPath) => (await aeonAdapter.listSkills?.(profile, { vaultPath })) ?? [],
  listRuns: (profile) => listAeonRuns(profile, { strict: true }),
};

export class CompanyAeonBindingError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CompanyAeonBindingError";
    this.status = status;
  }
}

function profileOption(profile: AgentProfile): CompanyAeonProfileOption {
  return {
    id: profile.id,
    name: profile.name,
    workspace: profile.aeonRepoName || profile.aeonRepo || profile.agentId || profile.name,
    ...(profile.machineName ? { machineName: profile.machineName } : {}),
  };
}

function skillOption(skill: RuntimeSkill): CompanyAeonSkillOption {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    ...(skill.enabled !== undefined ? { enabled: skill.enabled } : {}),
    ...(skill.packName || skill.pack ? { pack: skill.packName || skill.pack } : {}),
  };
}

async function loadProfileCatalog(
  profileId: string,
  vaultPath: string | undefined,
  dependencies: Partial<CompanyAeonBindingDependencies>,
) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const profiles = await deps.readProfiles(vaultPath);
  const profile = findAeonProfileById(profiles, profileId);
  if (!profile) throw new CompanyAeonBindingError("AEON workspace not found.", 404);
  const skills = await deps.listSkills(profile, vaultPath);
  return { profiles, profile, skills };
}

export async function listCompanyAeonOptions(
  profileId?: string,
  options: { vaultPath?: string } = {},
  dependencies: Partial<CompanyAeonBindingDependencies> = {},
): Promise<CompanyAeonOptionsPayload> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  if (!profileId) {
    const profiles = await deps.readProfiles(options.vaultPath);
    return { profiles: profiles.map(profileOption) };
  }
  const catalog = await loadProfileCatalog(profileId, options.vaultPath, deps);
  return {
    profiles: catalog.profiles.map(profileOption),
    skills: catalog.skills.map(skillOption),
  };
}

export async function resolveCompanyAeonBinding(
  profileId: string,
  skillSlug: string,
  options: { vaultPath?: string } = {},
  dependencies: Partial<CompanyAeonBindingDependencies> = {},
): Promise<CompanyAeonBinding> {
  const catalog = await loadProfileCatalog(profileId, options.vaultPath, dependencies);
  const skill = catalog.skills.find((candidate) => candidate.slug === skillSlug);
  if (!skill) {
    throw new CompanyAeonBindingError(
      "The selected AEON skill is no longer available in that workspace. Choose another skill in Edit company.",
      400,
    );
  }
  return { profile: catalog.profile, skill };
}

export async function inspectCompanyAeonActivity(
  execution: Extract<CompanyExecutionConfig, { engine: "aeon" }>,
  options: { vaultPath?: string } = {},
  dependencies: Partial<CompanyAeonBindingDependencies> = {},
) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const binding = await resolveCompanyAeonBinding(execution.profileId, execution.skill, options, deps);
  const runs = await deps.listRuns(binding.profile);
  const activeRuns = runs.filter((run) => run.status === "queued" || run.status === "active");
  return { binding, hasActiveRun: activeRuns.length > 0, activeRunCount: activeRuns.length };
}

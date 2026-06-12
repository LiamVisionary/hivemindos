import { constants } from "fs";
import { access, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { basename, dirname, join, resolve, sep } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";

const AGENT_PROFILES_ROOT = "Agents";
const LEGACY_AGENT_PROFILES_ROOT = "AGENTS";

type VaultAgentProfile = AgentProfile & {
  managedBy?: string;
  mirroredAt?: string;
};

type ProfileRecord = {
  profile: VaultAgentProfile;
  file: string;
  dir: string;
};

function expandHome(path: string) {
  const trimmed = path.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return trimmed;
}

function slug(value: string, fallback = "profile") {
  return (value || fallback)
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || fallback;
}

function runtimeFolder(runtime?: string) {
  const value = (runtime || "Agent").toLowerCase();
  if (value === "aeon") return "AEON";
  if (value === "hermes") return "Hermes";
  if (value === "openclaw") return "OpenClaw";
  if (value === "openai-compatible" || value === "hivemind-os") return "HivemindOS";
  return slug(value, "Agent");
}

export function repoNameFromAgent(agent: AgentProfile) {
  if (agent.aeonRepoName) return slug(agent.aeonRepoName, "Local AEON");
  const repo = agent.aeonRepo?.trim().replace(/\.git$/i, "");
  if (repo) return slug(repo.split(/[/:]/).filter(Boolean).slice(-2).join("-"), "Local AEON");
  const local = agent.aeonLocalPath || agent.localDataDir || "~/.aeon";
  const localName = basename(expandHome(local));
  if (!localName || localName.startsWith(".")) {
    return slug(agent.name || agent.agentId || agent.id || "Local AEON", "Local AEON");
  }
  return slug(localName, "Local AEON");
}

function agentProfileParts(agent: AgentProfile) {
  const runtime = runtimeFolder(agent.runtime);
  const name = slug(agent.name || agent.agentId || agent.id, "profile");
  if (agent.runtime === "aeon") return [runtime, repoNameFromAgent(agent)];
  return [runtime, name];
}

function vaultSafeUsePodConfig(agent: AgentProfile) {
  if (!agent.usePod) return undefined;
  const safeUsePod = { ...agent.usePod };
  delete safeUsePod.dashboardUrl;
  return safeUsePod;
}

function safeAgentProfile(agent: AgentProfile) {
  const { agentEnv, ...safe } = { ...agent, token: undefined };
  return {
    ...safe,
    usePod: vaultSafeUsePodConfig(agent),
    agentEnvKeys: agentEnv ? Object.keys(agentEnv).sort() : undefined,
    mirroredAt: new Date().toISOString(),
    managedBy: "hivemindos",
  };
}

async function canRead(path: string) {
  return access(path, constants.R_OK).then(() => true).catch(() => false);
}

function vaultRoot(vaultPath?: string) {
  return resolve(expandHome(vaultPath || "~/Documents/Obsidian/hivemindos-vault"));
}

async function exactRootFolder(root: string, name: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.find((entry) => entry.isDirectory() && entry.name === name)?.name;
}

async function ensureAgentProfilesRoot(root: string) {
  const current = await exactRootFolder(root, AGENT_PROFILES_ROOT);
  if (current) return join(root, current);

  const legacy = await exactRootFolder(root, LEGACY_AGENT_PROFILES_ROOT);
  if (legacy) {
    const legacyPath = join(root, legacy);
    const temporaryPath = join(root, `.hivemindos-agents-folder-casing-${Date.now()}`);
    await rename(legacyPath, temporaryPath);
    await rename(temporaryPath, join(root, AGENT_PROFILES_ROOT));
    return join(root, AGENT_PROFILES_ROOT);
  }

  return join(root, AGENT_PROFILES_ROOT);
}

async function profileFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const groups = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === "profile.json") return [path];
    if (entry.isDirectory()) return profileFiles(path, depth + 1);
    return [];
  }));
  return groups.flat();
}

async function readProfileRecordsFromFolder(folder: string): Promise<ProfileRecord[]> {
  if (!await canRead(folder)) return [];
  const files = await profileFiles(folder);
  const profiles = await Promise.all(files.map(async (file) => {
    const raw = await readFile(file, "utf8").catch(() => "");
    try {
      const parsed = JSON.parse(raw) as VaultAgentProfile;
      return parsed?.id && parsed?.runtime ? { profile: parsed, file, dir: dirname(file) } : null;
    } catch {
      return null;
    }
  }));
  return profiles.filter((profile): profile is ProfileRecord => Boolean(profile));
}

function profileKey(profile: AgentProfile) {
  return [
    profile.runtime,
    profile.agentId || profile.id || profile.name,
    profile.runtime === "aeon" ? profile.aeonLocalPath || profile.localDataDir || profile.aeonRepo || "" : "",
  ].join("|").toLowerCase();
}

function profileMirrorTime(profile: VaultAgentProfile) {
  const timestamp = profile.mirroredAt ? Date.parse(profile.mirroredAt) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function profileNameMatchesIdentity(profile: VaultAgentProfile) {
  const identity = profile.agentId || profile.id;
  if (!identity || !profile.name) return false;
  return slug(profile.name).toLowerCase() === slug(identity).toLowerCase();
}

function preferProfileRecord(current: ProfileRecord, candidate: ProfileRecord) {
  const currentCustomName = profileNameMatchesIdentity(current.profile) ? 0 : 1;
  const candidateCustomName = profileNameMatchesIdentity(candidate.profile) ? 0 : 1;
  if (currentCustomName !== candidateCustomName) {
    return candidateCustomName > currentCustomName ? candidate : current;
  }
  const currentTime = profileMirrorTime(current.profile);
  const candidateTime = profileMirrorTime(candidate.profile);
  if (currentTime !== candidateTime) return candidateTime > currentTime ? candidate : current;
  return candidate.file.localeCompare(current.file) > 0 ? candidate : current;
}

function sameStableProfileIdentity(left: AgentProfile, right: AgentProfile) {
  const leftId = left.id?.trim().toLowerCase();
  const rightId = right.id?.trim().toLowerCase();
  if (leftId && rightId && leftId === rightId) return true;
  if (left.runtime !== right.runtime) return false;
  const leftAgentId = left.agentId?.trim().toLowerCase();
  const rightAgentId = right.agentId?.trim().toLowerCase();
  if (leftAgentId && rightAgentId && leftAgentId === rightAgentId) return true;
  return false;
}

async function pruneStaleManagedProfileRecords(root: string, agent: AgentProfile, currentDir: string) {
  const current = await realpath(currentDir).catch(() => resolve(currentDir));
  const records = await readProfileRecordsFromFolder(root);
  await Promise.all(records.map(async (record) => {
    const recordDir = await realpath(record.dir).catch(() => resolve(record.dir));
    if (recordDir === current) return;
    if (record.profile.managedBy !== "hivemindos") return;
    if (!sameStableProfileIdentity(agent, record.profile)) return;
    await rm(record.file, { force: true });
  }));
}

function dedupeProfileRecords(records: ProfileRecord[], keyForProfile: (profile: VaultAgentProfile) => string) {
  const byKey = new Map<string, ProfileRecord>();
  for (const record of records) {
    const key = keyForProfile(record.profile);
    if (!key) continue;
    const current = byKey.get(key);
    byKey.set(key, current ? preferProfileRecord(current, record) : record);
  }
  return Array.from(byKey.values());
}

export async function readVaultAgentProfiles(vaultPath?: string): Promise<AgentProfile[]> {
  const root = vaultRoot(vaultPath);
  const currentRoot = await exactRootFolder(root, AGENT_PROFILES_ROOT);
  const legacyRoot = await exactRootFolder(root, LEGACY_AGENT_PROFILES_ROOT);
  const currentProfiles = currentRoot ? await readProfileRecordsFromFolder(join(root, currentRoot)) : [];
  const legacyProfiles = legacyRoot ? await readProfileRecordsFromFolder(join(root, legacyRoot)) : [];
  const profileKeyRecords = dedupeProfileRecords([...legacyProfiles, ...currentProfiles], profileKey);
  const stableIdRecords = dedupeProfileRecords(profileKeyRecords, (profile) => profile.id?.trim().toLowerCase() || profileKey(profile));
  return stableIdRecords.map((record) => record.profile);
}

export async function mirrorAgentProfilesToVault(input: { vaultPath?: string; agents: AgentProfile[] }) {
  const root = vaultRoot(input.vaultPath);
  const agentsRoot = await ensureAgentProfilesRoot(root);
  await mkdir(agentsRoot, { recursive: true });
  await writeFile(join(agentsRoot, "README.md"), [
    "# Agents",
    "",
    "HivemindOS mirrors dashboard runtime profiles here so agents have a durable Obsidian home.",
    "",
    "- Runtime folders contain profile records and agent notes.",
    "- AEON folders are agents with their own skills, memory, outputs, and notes.",
    "- Secret values are not mirrored; profile files only include non-secret profile metadata and env key names.",
    "",
  ].join("\n"));

  const written: string[] = [];
  for (const agent of input.agents) {
    const dir = join(agentsRoot, ...agentProfileParts(agent));
    const isAeon = agent.runtime === "aeon";
    const title = isAeon ? repoNameFromAgent(agent) : agent.name || agent.id;
    await mkdir(join(dir, "Notes"), { recursive: true });
    await writeFile(join(dir, "profile.json"), `${JSON.stringify(safeAgentProfile(agent), null, 2)}\n`);
    await writeFile(join(dir, "README.md"), [
      `# ${title}`,
      "",
      `Runtime: ${agent.runtime}`,
      isAeon ? `Agent: ${repoNameFromAgent(agent)}` : "",
      "",
      isAeon
        ? "Use `Notes/` for durable context specific to this AEON agent."
        : "Use `Notes/` for durable context specific to this agent profile.",
      "",
    ].filter(Boolean).join("\n"));
    if (!isAeon) {
      await writeFile(join(dir, "Notes", "README.md"), [
        `# ${title} Notes`,
        "",
        "Agent-specific notes, decisions, and operating context can live here.",
        "",
      ].join("\n"));
    }
    await pruneStaleManagedProfileRecords(agentsRoot, agent, dir);
    const legacyRoot = await exactRootFolder(root, LEGACY_AGENT_PROFILES_ROOT);
    if (legacyRoot) await pruneStaleManagedProfileRecords(join(root, legacyRoot), agent, dir);
    written.push(dir.replace(`${root}${sep}`, ""));
  }
  return { root, agentsRoot, written };
}

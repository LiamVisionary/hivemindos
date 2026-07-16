import { existsSync, statSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { homedir } from "@/lib/home-dir";
import { dirname, join, resolve } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { sanitizeGitLawbProof } from "@/lib/services/gitlawb/gitlawb-service";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { AppBuilderProjectReference, GitLawbProof, GitLawbRepoLink, HivemindProject, ProjectRegistry } from "@/lib/types/gitlawb";

const VAULT_PROJECTS_FILE = join("Operations", "Code Projects", "projects.json");
const LOCAL_PROJECTS_FILE = join(homedir(), ".hivemindos", "projects.json");

export type ProjectRegistryStorage = {
  source: "obsidian" | "local";
  file: string;
  fallbackReason?: string;
};

export type ProjectRegistryResult = ProjectRegistry & {
  storage: ProjectRegistryStorage;
};

function cleanOptional(value?: string | null) {
  const next = value?.trim();
  return next || undefined;
}

function resolveProjectStorage(vaultPath?: string | null): ProjectRegistryStorage {
  const requestedVault = cleanOptional(vaultPath) ?? cleanOptional(DEFAULT_SHARED_VAULT.vaultPath);
  const explicitVault = Boolean(cleanOptional(vaultPath));
  if (requestedVault) {
    const root = resolveObsidianVaultPath(requestedVault);
    try {
      if (!statSync(root).isDirectory()) throw new Error("Vault path is not a directory.");
      return { source: "obsidian", file: join(root, VAULT_PROJECTS_FILE) };
    } catch (error) {
      if (explicitVault) {
        const message = error instanceof Error ? error.message : "Vault path is unavailable.";
        throw new Error(`Project vault path is unavailable: ${message}`);
      }
    }
  }
  return { source: "local", file: LOCAL_PROJECTS_FILE, fallbackReason: "Default Obsidian vault path was unavailable." };
}

function normalizeProject(value: unknown): HivemindProject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<HivemindProject>;
  const name = cleanOptional(item.name);
  if (!name) return null;
  const id = cleanOptional(item.id) ?? projectIdFor(name, item.localPath);
  const now = Date.now();
  return {
    id,
    name,
    localPath: cleanOptional(item.localPath),
    vaultNotePath: cleanOptional(item.vaultNotePath),
    preferredMachineKey: cleanOptional(item.preferredMachineKey),
    appBuilder: normalizeAppBuilderReference(item.appBuilder),
    gitlawbRepo: item.gitlawbRepo && typeof item.gitlawbRepo === "object" ? normalizeRepoLink(item.gitlawbRepo) : undefined,
    allowedAgentIds: Array.isArray(item.allowedAgentIds) ? item.allowedAgentIds.filter((agentId): agentId is string => typeof agentId === "string" && Boolean(agentId.trim())) : [],
    createdAt: positiveNumber(item.createdAt) ?? now,
    updatedAt: positiveNumber(item.updatedAt) ?? now,
  };
}

function normalizeAppBuilderReference(value: unknown): AppBuilderProjectReference | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Partial<AppBuilderProjectReference>;
  const backend = item.backend === "local" || item.backend === "managed" ? item.backend : undefined;
  const contractVersion = cleanOptional(item.contractVersion);
  const status = ["creating", "stopped", "starting", "running", "stopping", "error"].includes(String(item.status))
    ? item.status as AppBuilderProjectReference["status"]
    : undefined;
  const templateId = item.templateId === "nextjs" || item.templateId === "static" ? item.templateId : undefined;
  if (!backend || !contractVersion || !templateId || !status) return undefined;
  return {
    backend,
    contractVersion,
    templateId,
    status,
    localProjectId: cleanOptional(item.localProjectId),
    managedAgentId: cleanOptional(item.managedAgentId),
    managedProjectId: cleanOptional(item.managedProjectId),
    hostingSiteId: cleanOptional(item.hostingSiteId),
    hostingUrl: cleanOptional(item.hostingUrl),
  };
}

function normalizeRepoLink(value: GitLawbRepoLink): GitLawbRepoLink {
  return {
    repoId: cleanOptional(value.repoId),
    repoName: cleanOptional(value.repoName),
    remoteUrl: cleanOptional(value.remoteUrl),
    nodeUrl: cleanOptional(value.nodeUrl),
    branch: cleanOptional(value.branch),
    linkedAt: positiveNumber(value.linkedAt) ?? Date.now(),
  };
}

export function gitLawbProofForProject(project: HivemindProject): GitLawbProof | null {
  const repo = project.gitlawbRepo ? normalizeRepoLink(project.gitlawbRepo) : undefined;
  if (!repo) return null;
  return sanitizeGitLawbProof({
    id: `project-${project.id}`,
    kind: "task",
    status: "linked",
    repo: repo.repoName ?? repo.repoId,
    branch: repo.branch,
    title: project.name,
    metadata: {
      source: "project-registry",
      projectId: project.id,
      projectName: project.name,
      linkedAt: repo.linkedAt,
      repoId: repo.repoId,
      remoteUrl: repo.remoteUrl,
    },
  }) as GitLawbProof;
}

function positiveNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function projectIdFor(name: string, localPath?: string) {
  const base = `${name}:${localPath ?? ""}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 10);
  return `${slug}-${hash}`;
}

async function readRegistryFile(file: string): Promise<ProjectRegistry> {
  if (!existsSync(file)) return { projects: [], updatedAt: Date.now() };
  const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<ProjectRegistry>;
  return {
    projects: Array.isArray(parsed.projects) ? parsed.projects.map(normalizeProject).filter(Boolean) as HivemindProject[] : [],
    updatedAt: positiveNumber(parsed.updatedAt) ?? Date.now(),
  };
}

async function writeRegistryFile(file: string, registry: ProjectRegistry) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

export async function readProjectRegistry(options: { vaultPath?: string | null } = {}): Promise<ProjectRegistryResult> {
  const storage = resolveProjectStorage(options.vaultPath);
  const registry = await readRegistryFile(storage.file);
  return { ...registry, storage };
}

export async function upsertProject(input: Partial<HivemindProject> & { name: string }, options: { vaultPath?: string | null } = {}) {
  const current = await readProjectRegistry(options);
  const now = Date.now();
  const id = cleanOptional(input.id) ?? projectIdFor(input.name, input.localPath);
  const existing = current.projects.find((project) => project.id === id);
  const nextProject = normalizeProject({
    ...existing,
    ...input,
    id,
    allowedAgentIds: input.allowedAgentIds ?? existing?.allowedAgentIds ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (!nextProject) throw new Error("Project name is required.");
  const projects = [...current.projects.filter((project) => project.id !== id), nextProject]
    .sort((a, b) => a.name.localeCompare(b.name));
  const registry = { projects, updatedAt: now };
  await writeRegistryFile(current.storage.file, registry);
  return { project: nextProject, registry: { ...registry, storage: current.storage } };
}

export async function linkProjectGitLawb(input: {
  projectId?: string;
  name?: string;
  repo: GitLawbRepoLink;
  vaultPath?: string | null;
}) {
  let registry = await readProjectRegistry({ vaultPath: input.vaultPath });
  let project = input.projectId
    ? registry.projects.find((item) => item.id === input.projectId)
    : registry.projects.find((item) => item.name === input.name);
  if (!project) {
    const created = await upsertProject({ id: input.projectId || randomUUID(), name: input.name || input.repo.repoName || "Code project" }, { vaultPath: input.vaultPath });
    project = created.project;
    registry = created.registry;
  }
  const linked = await upsertProject({
    ...project,
    gitlawbRepo: sanitizeGitLawbProof(normalizeRepoLink(input.repo)) as GitLawbRepoLink,
  }, { vaultPath: input.vaultPath });
  return linked;
}

export function projectRegistryLocations() {
  return {
    vaultRelativePath: VAULT_PROJECTS_FILE,
    localFallbackPath: resolve(LOCAL_PROJECTS_FILE),
  };
}

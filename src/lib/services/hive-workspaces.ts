import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "@/lib/home-dir";

export const MAIN_HIVE_WORKSPACE_ID = "main";
export const DEFAULT_WORKSPACE_STORE_PATH = "~/.hivemindos/workspaces.json";
export const DEFAULT_MAIN_VAULT_PATH = "~/Documents/Obsidian/hivemindos-vault";
export const DEFAULT_MAIN_ENV_PATH = "~/.hivemindos/.env";

export type HiveWorkspace = {
  id: string;
  name: string;
  vaultPath: string;
  envPath: string;
  skillsPath: string;
  brainServicesPath: string;
  default?: boolean;
  description?: string;
};

export type HiveWorkspaceInput = {
  id?: string;
  name?: string;
  vaultPath: string;
  envPath?: string;
  skillsPath?: string;
  brainServicesPath?: string;
  description?: string;
  setActive?: boolean;
};

export type HiveWorkspaceStore = {
  version: 1;
  activeWorkspaceId: string;
  workspaces: HiveWorkspace[];
};

export function expandHomePath(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

export function collapseHomePath(path: string): string {
  const home = homedir();
  const resolved = resolve(expandHomePath(path));
  return resolved === home ? "~" : resolved.startsWith(`${home}/`) ? `~/${resolved.slice(home.length + 1)}` : resolved;
}

function workspaceStorePath() {
  return resolve(expandHomePath(process.env.HIVE_WORKSPACES_FILE?.trim() || DEFAULT_WORKSPACE_STORE_PATH));
}

function slug(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanWorkspaceId(id?: string, fallbackName?: string) {
  const cleaned = slug(id || fallbackName || "workspace");
  if (!cleaned) throw new Error("Workspace id is required.");
  return cleaned;
}

function defaultMainWorkspace(): HiveWorkspace {
  const vaultPath = collapseHomePath(process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH?.trim() || DEFAULT_MAIN_VAULT_PATH);
  return normalizeWorkspace({
    id: MAIN_HIVE_WORKSPACE_ID,
    name: "Main shared brain",
    vaultPath,
    envPath: process.env.HIVE_ENV_FILE?.trim() || DEFAULT_MAIN_ENV_PATH,
    default: true,
    description: "Default HivemindOS shared brain, env, and skills workspace.",
  });
}

function normalizeWorkspace(input: Partial<HiveWorkspace> & Pick<HiveWorkspace, "id" | "name" | "vaultPath">): HiveWorkspace {
  const vaultPath = collapseHomePath(input.vaultPath);
  const id = cleanWorkspaceId(input.id, input.name);
  const name = input.name?.trim() || id;
  const skillsPath = input.skillsPath?.trim() || `${vaultPath}/Skills`;
  const brainServicesPath = input.brainServicesPath?.trim() || `${vaultPath}/Operations/Brain Services`;
  const envPath = input.envPath?.trim() || `~/.hivemindos/workspaces/${id}/.env`;
  return {
    id,
    name,
    vaultPath,
    envPath: collapseHomePath(envPath),
    skillsPath: collapseHomePath(skillsPath),
    brainServicesPath: collapseHomePath(brainServicesPath),
    default: input.default,
    description: input.description?.trim() || undefined,
  };
}

function parseStore(raw: string): HiveWorkspaceStore | null {
  try {
    const parsed = JSON.parse(raw) as Partial<HiveWorkspaceStore>;
    if (!Array.isArray(parsed.workspaces)) return null;
    const workspaces = parsed.workspaces
      .filter((workspace): workspace is HiveWorkspace => Boolean(workspace?.id && workspace?.name && workspace?.vaultPath))
      .map((workspace) => normalizeWorkspace(workspace));
    if (!workspaces.some((workspace) => workspace.id === MAIN_HIVE_WORKSPACE_ID)) workspaces.unshift(defaultMainWorkspace());
    const activeWorkspaceId = parsed.activeWorkspaceId && workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
      ? parsed.activeWorkspaceId
      : MAIN_HIVE_WORKSPACE_ID;
    return { version: 1, activeWorkspaceId, workspaces };
  } catch {
    return null;
  }
}

export function loadHiveWorkspaceStore(): HiveWorkspaceStore {
  const path = workspaceStorePath();
  const parsed = existsSync(path) ? parseStore(readFileSync(path, "utf8")) : null;
  return parsed || { version: 1, activeWorkspaceId: MAIN_HIVE_WORKSPACE_ID, workspaces: [defaultMainWorkspace()] };
}

export function saveHiveWorkspaceStore(store: HiveWorkspaceStore) {
  const path = workspaceStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function activeHiveWorkspaceId() {
  return process.env.HIVE_WORKSPACE_ID?.trim() || process.env.NEXT_PUBLIC_HIVE_WORKSPACE_ID?.trim() || loadHiveWorkspaceStore().activeWorkspaceId;
}

export function resolveHiveWorkspace(id?: string): HiveWorkspace {
  const store = loadHiveWorkspaceStore();
  const requested = id?.trim() || activeHiveWorkspaceId();
  return store.workspaces.find((workspace) => workspace.id === requested)
    || store.workspaces.find((workspace) => workspace.id === MAIN_HIVE_WORKSPACE_ID)
    || defaultMainWorkspace();
}

export function listHiveWorkspaces(): HiveWorkspaceStore {
  return loadHiveWorkspaceStore();
}

export function upsertHiveWorkspace(input: HiveWorkspaceInput): HiveWorkspaceStore {
  const workspace = normalizeWorkspace({
    id: cleanWorkspaceId(input.id, input.name || input.vaultPath),
    name: input.name?.trim() || input.id?.trim() || input.vaultPath,
    vaultPath: input.vaultPath,
    envPath: input.envPath,
    skillsPath: input.skillsPath,
    brainServicesPath: input.brainServicesPath,
    description: input.description,
  });
  const store = loadHiveWorkspaceStore();
  const next = store.workspaces.filter((item) => item.id !== workspace.id);
  next.push(workspace);
  next.sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)) || a.name.localeCompare(b.name));
  const nextStore = {
    version: 1 as const,
    activeWorkspaceId: input.setActive ? workspace.id : store.activeWorkspaceId,
    workspaces: next,
  };
  saveHiveWorkspaceStore(nextStore);
  return nextStore;
}

export function workspacePathExists(path: string) {
  try {
    return statSync(resolve(expandHomePath(path))).isDirectory();
  } catch {
    return false;
  }
}

export function ensureWorkspaceScaffold(workspace: HiveWorkspace) {
  const folders = [
    workspace.vaultPath,
    workspace.skillsPath,
    workspace.brainServicesPath,
    `${workspace.vaultPath}/Memory/Distillations/Agent Memory`,
    `${workspace.vaultPath}/Operations/Secure`,
    dirname(expandHomePath(workspace.envPath)),
  ];
  for (const folder of folders) mkdirSync(resolve(expandHomePath(folder)), { recursive: true });
  const envFile = resolve(expandHomePath(workspace.envPath));
  if (!existsSync(envFile)) writeFileSync(envFile, "", "utf8");
}

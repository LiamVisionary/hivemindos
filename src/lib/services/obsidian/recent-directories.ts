import { constants } from "fs";
import { access, mkdir, readFile, readdir, writeFile } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "path";
import { hostname } from "os";
import type { KanbanBoard, KanbanLinkedDirectory } from "@/lib/types/kanban";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { RecentDirectory } from "@/lib/types/recent-directories";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

const RECENT_DIRECTORIES_PATH = "Projects/HivemindOS/Brain Access/recent-directories.json";
const LEGACY_KANBAN_FOLDER = "Kanban";
const LEGACY_PROJECT_KANBAN_FOLDERS = [
  "Projects/HivemindOS/Kanban",
  "Projects/Omni-Agent Hivemind/Kanban",
];
const MAX_RECENT_DIRECTORIES = 40;
const RECENT_DIRECTORIES_CACHE_MS = 30_000;

type ListRecentDirectoriesInput = string | { vaultPath?: string | null; kanbanFolder?: string | null };
type RecentDirectoriesResult = { vaultPath: string; directories: RecentDirectory[] };
type RecentDirectoriesCacheEntry = {
  expiresAt: number;
  result?: RecentDirectoriesResult;
  inFlight?: Promise<RecentDirectoriesResult>;
};

const recentDirectoriesCache = new Map<string, RecentDirectoriesCacheEntry>();

function assertInside(root: string, path: string) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || (relativePath === "" && resolve(path) !== resolve(root))) {
    throw new Error("Path escaped the selected vault.");
  }
}

function recentDirectoriesFile(root: string) {
  const file = resolve(root, RECENT_DIRECTORIES_PATH);
  assertInside(root, file);
  return file;
}

function normalizeListInput(input?: ListRecentDirectoriesInput) {
  if (typeof input === "string") return { vaultPath: input, kanbanFolder: undefined };
  return {
    vaultPath: input?.vaultPath ?? undefined,
    kanbanFolder: input?.kanbanFolder ?? undefined,
  };
}

function cacheKey(root: string, kanbanFolder?: string) {
  return `${root}\0${kanbanFolder ?? ""}`;
}

function deleteCacheForRoot(root: string) {
  const prefix = `${root}\0`;
  for (const key of recentDirectoriesCache.keys()) {
    if (key.startsWith(prefix)) recentDirectoriesCache.delete(key);
  }
}

function safeVaultFolder(folder?: string | null) {
  const value = folder?.trim();
  if (!value) return "";
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Kanban folder must be a relative path inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function normalizeKanbanFolder(folder?: string | null) {
  const value = safeVaultFolder(folder);
  return /^kanban$/i.test(value) ? DEFAULT_SHARED_VAULT.kanbanFolder : value;
}

function normalizeDirectoryName(input?: string) {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return "";
  return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? trimmed;
}

function directoryKey(directory: Pick<RecentDirectory, "path" | "name" | "machineKey" | "machineName">) {
  return [
    directory.machineKey?.trim().toLowerCase() || directory.machineName?.trim().toLowerCase() || "any",
    directory.path?.trim().toLowerCase() || directory.name.trim().toLowerCase(),
  ].join("|");
}

function normalizeRecentDirectory(input: Partial<RecentDirectory>): RecentDirectory | null {
  const name = normalizeDirectoryName(input.name || input.path);
  if (!name) return null;
  const lastUsedAt = Number.isFinite(input.lastUsedAt) ? Number(input.lastUsedAt) : Date.now();
  return {
    id: input.id?.trim() || `${name}-${lastUsedAt}`,
    name,
    path: input.path?.trim() || undefined,
    machineName: input.machineName?.trim() || undefined,
    machineKey: input.machineKey?.trim() || undefined,
    source: input.source ?? "recent",
    lastUsedAt,
    useCount: Math.max(1, Math.round(input.useCount ?? 1)),
  };
}

function hasReusableDirectoryPath(directory: Pick<RecentDirectory, "path">) {
  return Boolean(directory.path?.trim());
}

async function readStoredRecents(root: string): Promise<RecentDirectory[]> {
  const raw = await readFile(recentDirectoriesFile(root), "utf-8").catch(() => "");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as { directories?: Partial<RecentDirectory>[] } | Partial<RecentDirectory>[];
  const entries = Array.isArray(parsed) ? parsed : parsed.directories ?? [];
  return entries
    .map(normalizeRecentDirectory)
    .filter((entry): entry is RecentDirectory => entry !== null && hasReusableDirectoryPath(entry));
}

async function kanbanFilesInFolder(root: string, folder: string): Promise<string[]> {
  const kanbanRoot = resolve(root, folder);
  assertInside(root, kanbanRoot);
  const files = [resolve(kanbanRoot, "kanban.json")];
  const boardsRoot = resolve(kanbanRoot, "boards");
  assertInside(root, boardsRoot);
  const entries = await readdir(boardsRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "_archived") continue;
    const file = resolve(boardsRoot, entry.name, "kanban.json");
    assertInside(root, file);
    files.push(file);
  }
  return files;
}

async function knownKanbanFiles(root: string, kanbanFolder?: string): Promise<string[]> {
  const folders = [
    normalizeKanbanFolder(kanbanFolder) || DEFAULT_SHARED_VAULT.kanbanFolder,
    DEFAULT_SHARED_VAULT.kanbanFolder,
    LEGACY_KANBAN_FOLDER,
    ...LEGACY_PROJECT_KANBAN_FOLDERS,
  ];
  const uniqueFolders = [...new Set(folders.filter(Boolean))];
  const files = await Promise.all(uniqueFolders.map((folder) => kanbanFilesInFolder(root, folder)));
  return [...new Set(files.flat())];
}

async function readKanbanRecents(root: string, kanbanFolder?: string): Promise<RecentDirectory[]> {
  const files = await knownKanbanFiles(root, kanbanFolder);
  const recents: RecentDirectory[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf-8").catch(() => "");
    if (!raw.trim()) continue;
    let board: KanbanBoard | null = null;
    try {
      board = JSON.parse(raw) as KanbanBoard;
    } catch {
      continue;
    }
    for (const task of board.tasks ?? []) {
      for (const directory of task.linkedDirectories ?? []) {
        const normalized = normalizeRecentDirectory({
          ...directory,
          source: "kanban",
          lastUsedAt: task.updatedAt || task.createdAt || Date.now(),
        });
        if (normalized && hasReusableDirectoryPath(normalized)) recents.push(normalized);
      }
    }
  }
  return recents;
}

function mergeRecents(entries: RecentDirectory[]) {
  const merged = new Map<string, RecentDirectory>();
  for (const entry of entries) {
    const normalized = normalizeRecentDirectory(entry);
    if (!normalized || !hasReusableDirectoryPath(normalized)) continue;
    const key = directoryKey(normalized);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, normalized);
      continue;
    }
    merged.set(key, {
      ...existing,
      ...normalized,
      id: existing.id,
      lastUsedAt: Math.max(existing.lastUsedAt, normalized.lastUsedAt),
      useCount: existing.useCount + normalized.useCount,
      source: existing.source === "picker" || normalized.source === "picker" ? "picker" : normalized.source,
    });
  }
  return [...merged.values()]
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt || right.useCount - left.useCount || left.name.localeCompare(right.name))
    .slice(0, MAX_RECENT_DIRECTORIES);
}

export async function listRecentDirectories(input?: ListRecentDirectoriesInput): Promise<RecentDirectoriesResult> {
  const { vaultPath, kanbanFolder } = normalizeListInput(input);
  const root = resolveObsidianVaultPath(vaultPath);
  await access(root, constants.R_OK);
  const now = Date.now();
  const key = cacheKey(root, normalizeKanbanFolder(kanbanFolder));
  const cached = recentDirectoriesCache.get(key);
  if (cached?.result && cached.expiresAt > now) return cached.result;
  if (cached?.inFlight) return cached.inFlight;

  const inFlight = scanRecentDirectories(root, kanbanFolder).finally(() => {
    const entry = recentDirectoriesCache.get(key);
    if (entry?.inFlight === inFlight) {
      recentDirectoriesCache.set(key, { ...entry, inFlight: undefined });
    }
  });
  recentDirectoriesCache.set(key, { expiresAt: now + RECENT_DIRECTORIES_CACHE_MS, inFlight });
  return inFlight;
}

async function scanRecentDirectories(root: string, kanbanFolder?: string): Promise<RecentDirectoriesResult> {
  const [stored, kanban] = await Promise.all([
    readStoredRecents(root),
    readKanbanRecents(root, kanbanFolder),
  ]);
  const result = { vaultPath: root, directories: mergeRecents([...stored, ...kanban]) };
  recentDirectoriesCache.set(cacheKey(root, normalizeKanbanFolder(kanbanFolder)), { expiresAt: Date.now() + RECENT_DIRECTORIES_CACHE_MS, result });
  return result;
}

export async function recordRecentDirectory(input: {
  vaultPath?: string;
  directory: Partial<KanbanLinkedDirectory & RecentDirectory>;
  machineName?: string;
  machineKey?: string;
  source?: RecentDirectory["source"];
}): Promise<{ vaultPath: string; directory: RecentDirectory; directories: RecentDirectory[] }> {
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);
  const directory = normalizeRecentDirectory({
    ...input.directory,
    machineName: input.directory.machineName || input.machineName || hostname(),
    machineKey: input.directory.machineKey || input.machineKey,
    source: input.source ?? input.directory.source ?? "picker",
    lastUsedAt: Date.now(),
  });
  if (!directory) throw new Error("Directory name is required.");
  if (!hasReusableDirectoryPath(directory)) throw new Error("Directory path is required to save a recent folder.");
  const existing = await readStoredRecents(root);
  const directories = mergeRecents([directory, ...existing]);
  const file = recentDirectoriesFile(root);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ updatedAt: new Date().toISOString(), directories }, null, 2)}\n`, "utf-8");
  deleteCacheForRoot(root);
  return { vaultPath: root, directory, directories };
}

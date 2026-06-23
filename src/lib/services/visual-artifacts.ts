import "server-only";

import { randomUUID } from "crypto";
import { access, constants } from "fs";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { basename, dirname, isAbsolute, join } from "path";
import { promisify } from "util";
import { homedir } from "@/lib/home-dir";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import {
  VISUAL_ARTIFACT_BLOCK_TYPES,
  VISUAL_ARTIFACT_KINDS,
  type VisualArtifact,
  type VisualArtifactBlock,
  type VisualArtifactCreateInput,
  type VisualArtifactFileTreeItem,
  type VisualArtifactKind,
  type VisualArtifactListFilter,
  type VisualArtifactStorageLocation,
} from "@/lib/types/visual-artifacts";

const canAccess = promisify(access);

const VAULT_VISUAL_ARTIFACTS_FOLDER = "Operations/Plans/Visual Artifacts";
const FALLBACK_VISUAL_ARTIFACTS_FOLDER = join(homedir(), ".hivemindos", "visual-artifacts");
const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 20_000;
const MAX_PATH_LENGTH = 1_000;
const MAX_BLOCKS = 40;
const MAX_FILE_TREE_ITEMS = 120;
const DEFAULT_LIST_LIMIT = 40;
const MAX_LIST_LIMIT = 200;

export async function createVisualArtifact(input: VisualArtifactCreateInput) {
  const normalized = normalizeCreateInput(input);
  const now = new Date().toISOString();
  const artifact: VisualArtifact = {
    id: `artifact_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    ...normalized,
  };
  const storage = await writeVisualArtifact(artifact, cleanString(input.vaultPath));
  return { artifact, storage };
}

export async function getVisualArtifact(id: string, options: { vaultPath?: unknown } = {}) {
  const safeId = normalizeArtifactId(id);
  if (!safeId) throw new Error("Visual artifact id is required.");
  const records = await readVisualArtifactRecords(cleanString(options.vaultPath));
  const found = records.find((record) => record.artifact.id === safeId);
  if (!found) throw new Error("Visual artifact not found.");
  return found;
}

export async function listVisualArtifacts(filter: VisualArtifactListFilter = {}) {
  const kind = normalizeOptionalKind(filter.kind);
  const workBoardTaskId = cleanString(filter.workBoardTaskId);
  const queenBeeRunId = cleanString(filter.queenBeeRunId);
  const limit = normalizeLimit(filter.limit);
  const records = await readVisualArtifactRecords(cleanString(filter.vaultPath));
  const artifacts = records
    .filter((record) => !kind || record.artifact.kind === kind)
    .filter((record) => !workBoardTaskId || record.artifact.workBoardTaskId === workBoardTaskId)
    .filter((record) => !queenBeeRunId || record.artifact.queenBeeRunId === queenBeeRunId)
    .sort((left, right) => right.artifact.createdAt.localeCompare(left.artifact.createdAt))
    .slice(0, limit);
  return {
    artifacts: artifacts.map((record) => record.artifact),
    records: artifacts,
    updatedAt: artifacts[0]?.artifact.updatedAt ?? new Date(0).toISOString(),
  };
}

export function visualArtifactPublicView(artifact: VisualArtifact): VisualArtifact {
  return {
    ...artifact,
    projectPath: redactLocalPath(artifact.projectPath),
    blocks: artifact.blocks.map((block) => {
      if (block.type !== "file-tree") return block;
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          path: redactLocalPath(item.path) ?? item.path,
        })),
      };
    }),
  };
}

async function writeVisualArtifact(artifact: VisualArtifact, vaultPath?: string): Promise<VisualArtifactStorageLocation> {
  const storage = await resolveStorageLocation(artifact.id, vaultPath);
  await mkdir(dirname(storage.path), { recursive: true, mode: 0o700 });
  await writeFile(storage.path, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return storage;
}

async function readVisualArtifactRecords(vaultPath?: string) {
  const locations = await listStorageLocations(vaultPath);
  const records = await Promise.all(locations.map(async (storage) => {
    const artifact = await readStoredArtifact(storage.path);
    return artifact ? { artifact, storage } : null;
  }));
  const byId = new Map<string, { artifact: VisualArtifact; storage: VisualArtifactStorageLocation }>();
  for (const record of records) {
    if (!record) continue;
    const existing = byId.get(record.artifact.id);
    if (!existing || (existing.storage.kind === "fallback" && record.storage.kind === "vault")) {
      byId.set(record.artifact.id, record);
    }
  }
  return [...byId.values()];
}

async function readStoredArtifact(path: string) {
  try {
    const raw = await readFile(path, "utf8");
    return normalizeStoredArtifact(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

async function listStorageLocations(vaultPath?: string): Promise<VisualArtifactStorageLocation[]> {
  const folders = await storageFolders(vaultPath);
  const files = await Promise.all(folders.map(async (folder) => {
    try {
      const names = await readdir(folder.path);
      return names
        .filter((name) => name.endsWith(".json"))
        .map((name) => ({ kind: folder.kind, path: join(folder.path, name) }));
    } catch {
      return [];
    }
  }));
  return files.flat();
}

async function resolveStorageLocation(id: string, vaultPath?: string): Promise<VisualArtifactStorageLocation> {
  const vaultFolder = await writableVaultFolder(vaultPath);
  if (vaultFolder) return { kind: "vault", path: join(vaultFolder, `${id}.json`) };
  return { kind: "fallback", path: join(FALLBACK_VISUAL_ARTIFACTS_FOLDER, `${id}.json`) };
}

async function storageFolders(vaultPath?: string): Promise<VisualArtifactStorageLocation[]> {
  const vaultFolder = await writableVaultFolder(vaultPath);
  return [
    ...(vaultFolder ? [{ kind: "vault" as const, path: vaultFolder }] : []),
    { kind: "fallback" as const, path: FALLBACK_VISUAL_ARTIFACTS_FOLDER },
  ];
}

async function writableVaultFolder(vaultPath?: string) {
  try {
    const vault = resolveObsidianVaultPath(vaultPath, { requireWritable: true });
    await canAccess(vault, constants.R_OK | constants.W_OK);
    return join(vault, VAULT_VISUAL_ARTIFACTS_FOLDER);
  } catch {
    return undefined;
  }
}

function normalizeStoredArtifact(value: unknown): VisualArtifact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<VisualArtifact>;
  const id = normalizeArtifactId(item.id);
  const title = cleanTitle(item.title);
  const createdAt = cleanString(item.createdAt);
  const updatedAt = cleanString(item.updatedAt);
  const blocks = normalizeBlocks(item.blocks, false);
  if (!id || !title || !createdAt || !updatedAt || !blocks.length) return null;
  return {
    id,
    kind: normalizeKind(item.kind),
    title,
    createdAt,
    updatedAt,
    workBoardTaskId: cleanString(item.workBoardTaskId),
    queenBeeRunId: cleanString(item.queenBeeRunId),
    projectPath: cleanPath(item.projectPath),
    blocks,
    redactedLabels: uniqueLabels([
      ...cleanStringList(item.redactedLabels),
      ...blocks.flatMap(blockRedactedLabels),
    ]),
  };
}

function normalizeCreateInput(input: VisualArtifactCreateInput) {
  const title = cleanTitle(input.title);
  if (!title) throw new Error("Visual artifact title is required.");
  const blocks = normalizeBlocks(input.blocks, true);
  if (!blocks.length) throw new Error("Visual artifact needs at least one valid block.");
  return {
    kind: normalizeKind(input.kind),
    title,
    workBoardTaskId: cleanString(input.workBoardTaskId),
    queenBeeRunId: cleanString(input.queenBeeRunId),
    projectPath: cleanPath(input.projectPath),
    blocks,
    redactedLabels: uniqueLabels(blocks.flatMap(blockRedactedLabels)),
  };
}

function normalizeBlocks(value: unknown, strict: boolean): VisualArtifactBlock[] {
  if (!Array.isArray(value)) {
    if (strict) throw new Error("Visual artifact blocks must be an array.");
    return [];
  }
  const blocks: VisualArtifactBlock[] = [];
  for (const rawBlock of value.slice(0, MAX_BLOCKS)) {
    const block = normalizeBlock(rawBlock, strict);
    if (block) blocks.push(block);
  }
  return blocks;
}

function normalizeBlock(value: unknown, strict: boolean): VisualArtifactBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (strict) throw new Error("Visual artifact block must be an object.");
    return null;
  }
  const block = value as Record<string, unknown>;
  const type = cleanString(block.type);
  if (!VISUAL_ARTIFACT_BLOCK_TYPES.includes(type as VisualArtifactBlock["type"])) {
    if (strict) throw new Error(`Unsupported visual artifact block type: ${type ?? "missing"}.`);
    return null;
  }
  if (type === "file-tree") {
    const items = normalizeFileTreeItems(block.items);
    if (!items.length && strict) throw new Error("File-tree blocks need at least one item.");
    return items.length ? { type, items } : null;
  }
  if (type === "diagram") {
    const mermaid = redactMarkdown(block.mermaid);
    if (!mermaid && strict) throw new Error("Diagram blocks need mermaid content.");
    return mermaid ? { type, mermaid } : null;
  }
  const markdown = redactMarkdown(block.markdown);
  if (!markdown && strict) throw new Error(`${type} blocks need markdown content.`);
  return markdown ? { type: type as Exclude<VisualArtifactBlock["type"], "file-tree" | "diagram">, markdown } as VisualArtifactBlock : null;
}

function normalizeFileTreeItems(value: unknown): VisualArtifactFileTreeItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const record = item as Partial<VisualArtifactFileTreeItem>;
      const path = cleanPath(record.path);
      const note = redactMarkdown(record.note, 1_000);
      return path && note ? { path, note } : null;
    })
    .filter((item): item is VisualArtifactFileTreeItem => Boolean(item))
    .slice(0, MAX_FILE_TREE_ITEMS);
}

function blockRedactedLabels(block: VisualArtifactBlock): string[] {
  if (block.type === "file-tree") {
    return block.items.flatMap((item) => [
      ...redactSecretText(item.path).redactedLabels,
      ...redactSecretText(item.note).redactedLabels,
    ]);
  }
  if (block.type === "diagram") return redactSecretText(block.mermaid).redactedLabels;
  return redactSecretText(block.markdown).redactedLabels;
}

function redactMarkdown(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  const text = cleanString(value, maxLength);
  if (!text) return undefined;
  return redactSecretText(text).text || undefined;
}

function normalizeArtifactId(value: unknown) {
  const text = cleanString(value, 160);
  return text && /^[A-Za-z0-9._:-]+$/.test(text) ? text : undefined;
}

function normalizeKind(value: unknown): VisualArtifactKind {
  return VISUAL_ARTIFACT_KINDS.includes(value as VisualArtifactKind)
    ? (value as VisualArtifactKind)
    : "plan";
}

function normalizeOptionalKind(value: unknown): VisualArtifactKind | undefined {
  return VISUAL_ARTIFACT_KINDS.includes(value as VisualArtifactKind)
    ? (value as VisualArtifactKind)
    : undefined;
}

function normalizeLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(numeric)));
}

function cleanTitle(value: unknown) {
  const title = cleanString(value, MAX_TITLE_LENGTH);
  return title || undefined;
}

function cleanPath(value: unknown) {
  const path = cleanString(value, MAX_PATH_LENGTH);
  if (!path || /[\0\r\n]/.test(path)) return undefined;
  return redactSecretText(path).text || undefined;
}

function cleanString(value: unknown, maxLength = MAX_PATH_LENGTH) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/[\0\r\n]+/g, " ");
  return text ? text.slice(0, maxLength) : undefined;
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 120)).filter((item): item is string => Boolean(item));
}

function uniqueLabels(values: string[]) {
  return [...new Set(values.filter(Boolean))].slice(0, 20);
}

function redactLocalPath(value?: string) {
  if (!value) return undefined;
  if (value.startsWith(homedir()) || (isAbsolute(value) && !value.startsWith("/Volumes/"))) {
    return `[local-path]/${basename(value) || "path"}`;
  }
  return value;
}

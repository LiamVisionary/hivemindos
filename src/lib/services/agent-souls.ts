import "server-only";

import { mkdir, readdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";

export type SavedAgentSoul = {
  id: string;
  title: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  content?: string;
};

type SavedAgentSoulMetadata = {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

const AGENT_SOULS_DIR = join(homedir(), ".hivemindos", "agent-souls");
const MAX_SOUL_CHARS = 12_000;

function slugifySoulTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "soul";
}

function normalizeSoulContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("SOUL.md content is required.");
  if (trimmed.length > MAX_SOUL_CHARS) {
    throw new Error(`SOUL.md content must be ${MAX_SOUL_CHARS.toLocaleString()} characters or less.`);
  }
  return trimmed;
}

async function readSoulMetadata(id: string): Promise<SavedAgentSoulMetadata | null> {
  try {
    const raw = await readFile(join(AGENT_SOULS_DIR, id, "metadata.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<SavedAgentSoulMetadata>;
    if (parsed.version !== 1 || parsed.id !== id || typeof parsed.title !== "string") return null;
    return {
      version: 1,
      id,
      title: parsed.title,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function soulPreview(content: string) {
  return content
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function listSavedAgentSouls(input: { includeContent?: boolean } = {}): Promise<SavedAgentSoul[]> {
  const entries = await readdir(AGENT_SOULS_DIR, { withFileTypes: true }).catch(() => []);
  const souls = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const id = entry.name;
        const path = join(AGENT_SOULS_DIR, id, "SOUL.md");
        const [metadata, content] = await Promise.all([
          readSoulMetadata(id),
          readFile(path, "utf8").catch(() => ""),
        ]);
        const normalizedContent = content.trim();
        if (!metadata || !normalizedContent) return null;
        return {
          id,
          title: metadata.title,
          path,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          preview: soulPreview(normalizedContent),
          ...(input.includeContent ? { content: normalizedContent } : {}),
        } satisfies SavedAgentSoul;
      }),
  );
  return souls
    .filter((soul): soul is SavedAgentSoul => Boolean(soul))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

export async function saveNewAgentSoul(input: { title: string; content: string }): Promise<SavedAgentSoul> {
  const title = input.title.trim();
  if (!title) throw new Error("A soul name is required.");
  const id = slugifySoulTitle(title);
  const soulDir = join(AGENT_SOULS_DIR, id);
  const soulPath = join(soulDir, "SOUL.md");
  const metadataPath = join(soulDir, "metadata.json");
  const content = normalizeSoulContent(input.content);
  const existing = await readFile(soulPath, "utf8").catch(() => "");
  if (existing.trim()) {
    throw new Error("A saved SOUL.md with that name already exists. Choose a new name.");
  }
  const now = new Date().toISOString();
  await mkdir(soulDir, { recursive: true, mode: 0o700 });
  const metadata: SavedAgentSoulMetadata = {
    version: 1,
    id,
    title,
    createdAt: now,
    updatedAt: now,
  };
  const temporarySoulPath = `${soulPath}.${process.pid}.${Date.now()}.tmp`;
  const temporaryMetadataPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporarySoulPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await mkdir(dirname(soulPath), { recursive: true, mode: 0o700 });
  await rename(temporarySoulPath, soulPath);
  await rename(temporaryMetadataPath, metadataPath);
  return {
    id,
    title,
    path: soulPath,
    createdAt: now,
    updatedAt: now,
    preview: soulPreview(content),
    content,
  };
}

import { constants } from "fs";
import { execFile } from "child_process";
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { hostname } from "os";
import { dirname, relative, resolve, sep } from "path";
import { promisify } from "util";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

const ACCESS_LOG_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/access-log.jsonl`;
const LEGACY_ACCESS_LOG_PATH = "Projects/HivemindOS/Brain Access/access-log.jsonl";
const OBSIDIAN_CLI = process.env.OBSIDIAN_CLI_PATH ?? "obsidian";
const MAX_NOTE_BYTES = 524_288;
const MAX_GRAPH_NOTES = 420;
const GRAPH_CACHE_TTL_MS = 30_000;
const SKIPPED_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules"]);
const execFileAsync = promisify(execFile);
const graphCache = new Map<string, { cachedAt: number; graph: BrainGraph }>();

export type BrainAccessEvent = {
  id: string;
  notePath: string;
  agentName: string;
  agentId?: string;
  runtime?: string;
  machineName: string;
  dashboardMachine: string;
  accessedAt: string;
  action: "view" | "read" | "write" | "inspect";
};

export type BrainGraphNode = {
  id: string;
  label: string;
  folder: string;
  tags: string[];
  byteSize: number;
  lineCount?: number;
  modifiedAt?: string;
  preview?: string;
  incoming: number;
  outgoing: number;
  accessCount: number;
  lastAccessedAt?: string;
  recentAccesses: BrainAccessEvent[];
};

export type BrainGraphLink = {
  source: string;
  target: string;
  unresolved?: boolean;
};

export type BrainGraph = {
  vaultPath: string;
  accessLogPath: string;
  generatedAt: string;
  nodes: BrainGraphNode[];
  links: BrainGraphLink[];
  recentAccesses: BrainAccessEvent[];
  truncated: boolean;
};

type NoteRecord = {
  path: string;
  content: string;
  byteSize: number;
  lineCount: number;
  modifiedAt?: string;
  preview: string;
  tags: string[];
};

export function resolveVaultPath(vaultPath?: string): string {
  return resolveObsidianVaultPath(vaultPath);
}

function toVaultPath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function assertInside(root: string, path: string) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || relativePath === "" || resolve(path) === resolve(root)) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected vault.");
  }
}

function accessLogFile(root: string): string {
  const path = resolve(root, ACCESS_LOG_PATH);
  assertInside(root, path);
  return path;
}

function isSyncConflictFile(path: string): boolean {
  return /(?:^|[./])[^/]*sync-conflict-[^/]*\.md$/i.test(path);
}

async function walkMarkdown(root: string, dir = root, output: string[] = []): Promise<string[]> {
  if (output.length >= MAX_GRAPH_NOTES) return output;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= MAX_GRAPH_NOTES) break;
    if (entry.name.startsWith(".") && SKIPPED_DIRS.has(entry.name)) continue;
    const fullPath = resolve(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walkMarkdown(root, fullPath, output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !isSyncConflictFile(entry.name)) {
      output.push(fullPath);
    }
  }
  return output;
}

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]|#^]+?)(?:#[^\]|^]+?)?(?:\^[^\]|]+?)?(?:\|[^\]]+?)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) links.push(match[1].trim());
  return links;
}

function extractTags(content: string): string[] {
  const tags = new Set<string>();
  const re = /(^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]{1,48})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) tags.add(match[2]);
  return [...tags].slice(0, 10);
}

function markdownPreview(content: string): string {
  const withoutFrontmatter = content.replace(/^---\s*[\s\S]*?\s*---\s*/, "");
  const text = withoutFrontmatter
    .split("\n")
    .map((line) => line
      .replace(/^#{1,6}\s+/, "")
      .replace(/!\[[^\]]*]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|([^\]]+))?]]/g, "$2$1")
      .trim())
    .filter((line) => line && !line.startsWith("```") && !line.startsWith("|"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 280);
}

function resolveLink(target: string, allPaths: string[]): string | null {
  const targetLower = target.toLowerCase().replace(/\.md$/, "");
  for (const path of allPaths) {
    const nameLower = path.split("/").pop()?.replace(/\.md$/, "").toLowerCase();
    if (nameLower === targetLower) return path;
  }
  for (const path of allPaths) {
    if (path.toLowerCase().replace(/\.md$/, "").endsWith(`/${targetLower}`)) return path;
  }
  return null;
}

async function readNotes(root: string): Promise<{ notes: NoteRecord[]; truncated: boolean }> {
  const paths = await walkMarkdown(root);
  const notes: NoteRecord[] = [];
  for (const fullPath of paths) {
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_NOTE_BYTES) continue;
    const content = await readFile(fullPath, "utf-8").catch(() => "");
    notes.push({
      path: toVaultPath(root, fullPath),
      content,
      byteSize: fileStat.size,
      lineCount: content ? content.split("\n").length : 0,
      modifiedAt: fileStat.mtime.toISOString(),
      preview: markdownPreview(content),
      tags: extractTags(content),
    });
  }
  return { notes, truncated: paths.length >= MAX_GRAPH_NOTES };
}

export async function readAccessEvents(root: string): Promise<BrainAccessEvent[]> {
  const logPath = accessLogFile(root);
  const legacyLogPath = resolve(root, LEGACY_ACCESS_LOG_PATH);
  assertInside(root, legacyLogPath);
  const raw = [
    await readFile(logPath, "utf-8").catch(() => ""),
    legacyLogPath !== logPath ? await readFile(legacyLogPath, "utf-8").catch(() => "") : "",
  ].filter(Boolean).join("\n");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as BrainAccessEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is BrainAccessEvent => Boolean(event?.notePath && event.accessedAt))
    .sort((a, b) => Date.parse(b.accessedAt) - Date.parse(a.accessedAt))
    .slice(0, 500);
}

export async function buildBrainGraph(vaultPath?: string, options: { force?: boolean } = {}): Promise<BrainGraph> {
  const root = resolveVaultPath(vaultPath);
  const cached = graphCache.get(root);
  if (!options.force && cached && Date.now() - cached.cachedAt < GRAPH_CACHE_TTL_MS) return cached.graph;

  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("Vault path is not a directory.");
  await access(root, constants.R_OK);

  const [{ notes, truncated }, accesses] = await Promise.all([readNotes(root), readAccessEvents(root)]);
  const notePaths = notes.map((note) => note.path);
  const accessesByNote = new Map<string, BrainAccessEvent[]>();
  for (const event of accesses) {
    accessesByNote.set(event.notePath, [...(accessesByNote.get(event.notePath) ?? []), event]);
  }

  const links: BrainGraphLink[] = [];
  const linkKeys = new Set<string>();
  const addLink = (link: BrainGraphLink) => {
    const key = `${link.source}\u0000${link.target}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push(link);
  };
  const unresolved = new Set<string>();
  for (const note of notes) {
    for (const target of extractWikiLinks(note.content)) {
      const resolvedTarget = resolveLink(target, notePaths);
      if (resolvedTarget) {
        addLink({ source: note.path, target: resolvedTarget });
      } else {
        const unresolvedId = `unresolved:${target}`;
        unresolved.add(unresolvedId);
        addLink({ source: note.path, target: unresolvedId, unresolved: true });
      }
    }
  }

  const degree = new Map<string, { incoming: number; outgoing: number }>();
  for (const link of links) {
    degree.set(link.source, { incoming: degree.get(link.source)?.incoming ?? 0, outgoing: (degree.get(link.source)?.outgoing ?? 0) + 1 });
    degree.set(link.target, { incoming: (degree.get(link.target)?.incoming ?? 0) + 1, outgoing: degree.get(link.target)?.outgoing ?? 0 });
  }

  const nodes: BrainGraphNode[] = [
    ...notes.map((note) => {
      const recentAccesses = (accessesByNote.get(note.path) ?? []).slice(0, 6);
      const parts = note.path.split("/");
      return {
        id: note.path,
        label: parts.pop()?.replace(/\.md$/, "") ?? note.path,
        folder: parts.join("/") || "Vault root",
        tags: note.tags,
        byteSize: note.byteSize,
        lineCount: note.lineCount,
        modifiedAt: note.modifiedAt,
        preview: note.preview,
        incoming: degree.get(note.path)?.incoming ?? 0,
        outgoing: degree.get(note.path)?.outgoing ?? 0,
        accessCount: accessesByNote.get(note.path)?.length ?? 0,
        lastAccessedAt: recentAccesses[0]?.accessedAt,
        recentAccesses,
      };
    }),
    ...[...unresolved].map((id) => ({
      id,
      label: id.replace(/^unresolved:/, ""),
      folder: "Unresolved links",
      tags: [],
      byteSize: 0,
      lineCount: 0,
      preview: "",
      incoming: degree.get(id)?.incoming ?? 0,
      outgoing: 0,
      accessCount: 0,
      recentAccesses: [],
    })),
  ].sort((a, b) => (b.incoming + b.outgoing + b.accessCount) - (a.incoming + a.outgoing + a.accessCount));

  const graph = {
    vaultPath: root,
    accessLogPath: accessLogFile(root),
    generatedAt: new Date().toISOString(),
    nodes,
    links,
    recentAccesses: accesses.slice(0, 24),
    truncated,
  };
  graphCache.set(root, { cachedAt: Date.now(), graph });
  return graph;
}

export async function recordBrainAccess(input: {
  vaultPath?: string;
  notePath: string;
  agentName?: string;
  agentId?: string;
  runtime?: string;
  machineName?: string;
  action?: BrainAccessEvent["action"];
}): Promise<BrainAccessEvent> {
  const root = resolveVaultPath(input.vaultPath);
  await access(root, constants.R_OK | constants.W_OK);
  const notePath = input.notePath.replace(/^\/+/, "");
  const absoluteNotePath = resolve(root, notePath);
  assertInside(root, absoluteNotePath);

  const event: BrainAccessEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    notePath,
    agentName: input.agentName?.trim() || "Dashboard",
    agentId: input.agentId?.trim() || undefined,
    runtime: input.runtime?.trim() || undefined,
    machineName: input.machineName?.trim() || "local",
    dashboardMachine: hostname(),
    accessedAt: new Date().toISOString(),
    action: input.action ?? "view",
  };

  const logPath = accessLogFile(root);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf-8");
  return event;
}

export async function openBrainNoteInObsidian(input: {
  vaultPath?: string;
  notePath: string;
  newtab?: boolean;
}): Promise<{ notePath: string; vaultName: string; stdout: string; stderr: string }> {
  if (input.notePath.startsWith("unresolved:")) throw new Error("This graph node is an unresolved link, not an existing note.");
  const root = resolveVaultPath(input.vaultPath);
  const notePath = input.notePath.replace(/^\/+/, "");
  const absoluteNotePath = resolve(root, notePath);
  assertInside(root, absoluteNotePath);
  await access(absoluteNotePath, constants.R_OK);

  const vaultName = root.split(sep).filter(Boolean).pop() || "HivemindOS Vault";
  const { stdout, stderr } = await execFileAsync(OBSIDIAN_CLI, [
    "open",
    `vault=${vaultName}`,
    `path=${notePath}`,
    ...(input.newtab === false ? [] : ["newtab"]),
  ], { timeout: 10_000 });

  return { notePath, vaultName, stdout, stderr };
}

function unresolvedTargetToNotePath(target: string): string {
  const cleanTarget = target
    .replace(/^unresolved:/, "")
    .replace(/\.md$/i, "")
    .trim();
  const parts = cleanTarget
    .split("/")
    .map((part) => part
      .trim()
      .replace(/[\\:*?"<>|]/g, "-")
      .replace(/^\.+|\.+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 80))
    .filter(Boolean);
  if (!parts.length) throw new Error("Missing note title.");
  return `${parts.join("/")}.md`;
}

export async function createBrainNoteFromUnresolved(input: {
  vaultPath?: string;
  target: string;
  sourceNotePath?: string;
}): Promise<{ notePath: string; title: string }> {
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const notePath = unresolvedTargetToNotePath(input.target);
  const absoluteNotePath = resolve(root, notePath);
  assertInside(root, absoluteNotePath);
  await access(absoluteNotePath, constants.F_OK).then(() => {
    throw new Error("That note already exists.");
  }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code !== "ENOENT") throw error;
  });

  const title = notePath.split("/").pop()?.replace(/\.md$/i, "") ?? notePath;
  const createdAt = new Date().toISOString();
  const sourceLine = input.sourceNotePath?.trim()
    ? `\nCreated from unresolved link in [[${input.sourceNotePath.replace(/\.md$/i, "")}]].`
    : "";
  const body = `---\ntype: note\ncreated: ${createdAt}\nsource: shared-brain-graph\n---\n\n# ${title}\n\nCreated from the Shared Brain graph.${sourceLine}\n\n`;
  await mkdir(dirname(absoluteNotePath), { recursive: true });
  await writeFile(absoluteNotePath, body, "utf-8");
  return { notePath, title };
}

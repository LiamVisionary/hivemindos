import { createHash } from "crypto";
import { existsSync, statSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { extname, isAbsolute, join, relative, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { createTask, readBoard, type KanbanStorageOptions } from "@/lib/services/kanban/local-kanban-store";
import type { KanbanPriority } from "@/lib/types/kanban";

export type NoteTaskCandidate = {
  idempotencyKey: string;
  title: string;
  body: string;
  sourcePath: string;
  line: number;
  project?: string;
  section?: string;
  kind: "checkbox" | "next-action";
};

export type NoteTaskIntakeOptions = KanbanStorageOptions & {
  folders?: string[] | string | null;
  board?: string | null;
  limit?: number;
};

const DEFAULT_FOLDERS = ["Projects", "Intake", "Memory"];
const SKIPPED_SECTIONS = new Set(["maintenance checklist", "related notes", "activity log", "decisions"]);
const CHECKBOX_RE = /^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/;
const COMPLETE_CHECKBOX_RE = /^\s*[-*]\s+\[[xX]\]\s+/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export async function scanNoteTasks(options: NoteTaskIntakeOptions = {}) {
  const vaultRoot = resolveObsidianVaultPath(options.vaultPath ?? undefined);
  const folders = noteTaskFolders(options.folders);
  const files = await markdownFiles(vaultRoot, folders);
  const candidates: NoteTaskCandidate[] = [];

  for (const file of files) {
    const raw = await readFile(file, "utf-8").catch(() => "");
    if (!raw.trim()) continue;
    candidates.push(...extractNoteTasks(vaultRoot, file, raw));
    if (candidates.length >= (options.limit ?? 250)) break;
  }

  return {
    vaultRoot,
    folders,
    candidates: dedupeCandidates(candidates).slice(0, options.limit ?? 250),
  };
}

export async function importNoteTasksToIdeas(options: NoteTaskIntakeOptions = {}) {
  const scan = await scanNoteTasks(options);
  const board = await readBoard(options.board, options);
  const existingKeys = new Set(board.tasks.map((task) => task.idempotencyKey).filter(Boolean));
  const imported: NoteTaskCandidate[] = [];
  let skipped = 0;

  for (const candidate of scan.candidates) {
    if (existingKeys.has(candidate.idempotencyKey)) {
      skipped += 1;
      continue;
    }
    await createTask(options.board ?? null, {
      title: candidate.title,
      body: candidate.body,
      tenant: candidate.project || "note-intake",
      status: "ideas",
      priority: priorityFor(candidate),
      workspace: "dir:notes",
      skills: ["notes", "project-tracking"],
      idempotencyKey: candidate.idempotencyKey,
    }, options);
    existingKeys.add(candidate.idempotencyKey);
    imported.push(candidate);
  }

  const updatedBoard = await readBoard(options.board, options);
  return {
    ...scan,
    imported,
    skipped,
    board: updatedBoard,
  };
}

function extractNoteTasks(vaultRoot: string, file: string, raw: string): NoteTaskCandidate[] {
  const sourcePath = relative(vaultRoot, file).split(sep).join("/");
  const lines = raw.split(/\r?\n/);
  const candidates: NoteTaskCandidate[] = [];
  let section = "";
  let inNextAction = false;
  let nextActionStart = 0;
  let nextActionLines: string[] = [];

  const flushNextAction = () => {
    const text = cleanTaskText(nextActionLines.join(" "));
    if (text && !COMPLETE_CHECKBOX_RE.test(text) && !SKIPPED_SECTIONS.has(section.toLowerCase())) {
      candidates.push(candidateFrom(sourcePath, nextActionStart, text, "next-action", section));
    }
    nextActionLines = [];
  };

  lines.forEach((line, index) => {
    const heading = line.match(HEADING_RE);
    if (heading) {
      if (inNextAction) flushNextAction();
      section = heading[2].trim();
      inNextAction = /^next action$/i.test(section);
      nextActionStart = index + 1;
      return;
    }

    if (inNextAction) {
      if (line.trim()) nextActionLines.push(line);
      return;
    }

    const checkbox = line.match(CHECKBOX_RE);
    if (!checkbox || SKIPPED_SECTIONS.has(section.toLowerCase())) return;
    const title = cleanTaskText(checkbox[1]);
    if (title) candidates.push(candidateFrom(sourcePath, index + 1, title, "checkbox", section));
  });

  if (inNextAction) flushNextAction();
  return candidates;
}

function candidateFrom(
  sourcePath: string,
  line: number,
  title: string,
  kind: NoteTaskCandidate["kind"],
  section: string,
): NoteTaskCandidate {
  const project = projectName(sourcePath);
  const idSource = `${sourcePath}:${line}:${kind}:${title}`;
  return {
    idempotencyKey: `note-intake:${sha1(idSource)}`,
    title,
    body: [
      project ? `Project: ${project}` : "",
      section ? `Section: ${section}` : "",
      `Source: ${sourcePath}${line > 0 ? `:${line}` : ""}`,
      kind === "next-action" ? "Imported from a project Next action." : "Imported from an unchecked markdown task.",
    ].filter(Boolean).join("\n"),
    sourcePath,
    line,
    project,
    section,
    kind,
  };
}

async function markdownFiles(vaultRoot: string, folders: string[]) {
  const files: string[] = [];
  for (const folder of folders) {
    const root = join(vaultRoot, safeVaultFolder(folder));
    if (!existsSync(root)) continue;
    const stat = statSync(root);
    if (stat.isFile() && extname(root).toLowerCase() === ".md") {
      files.push(root);
      continue;
    }
    if (stat.isDirectory()) await collectMarkdown(root, files);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function collectMarkdown(dir: string, files: string[]) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectMarkdown(fullPath, files);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      files.push(fullPath);
    }
  }
}

function noteTaskFolders(input?: string[] | string | null) {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\n,]+/) : DEFAULT_FOLDERS;
  return raw.map((folder) => safeVaultFolder(folder)).filter(Boolean);
}

function safeVaultFolder(folder: string) {
  const value = folder.trim();
  if (!value || isAbsolute(value) || value.split(/[\\/]+/).includes("..")) return "";
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function cleanTaskText(text: string) {
  return text
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function projectName(sourcePath: string) {
  const parts = sourcePath.split("/");
  if (parts[0] !== "Projects") return undefined;
  if (parts.length === 2) return parts[1].replace(/\.md$/i, "");
  return parts[1];
}

function priorityFor(candidate: NoteTaskCandidate): KanbanPriority {
  return /urgent|blocked|critical|asap|broken|wtf/i.test(candidate.title) ? "high" : "normal";
}

function dedupeCandidates(candidates: NoteTaskCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.idempotencyKey)) return false;
    seen.add(candidate.idempotencyKey);
    return true;
  });
}

function sha1(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 20);
}

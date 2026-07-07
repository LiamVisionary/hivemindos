import { constants } from "fs";
import { access, mkdir, writeFile } from "fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

const MAX_NOTE_CHARS = 100_000;

export type CaptureObsidianNoteInput = {
  vaultPath?: string | null;
  inboxFolder?: string | null;
  content: string;
  now?: Date;
};

export type CapturedObsidianNote = {
  vaultPath: string;
  notePath: string;
  title: string;
  createdAt: string;
};

function assertInside(root: string, path: string) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Note path escaped the selected vault.");
  }
}

function toVaultPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function safeVaultFolder(folder?: string | null) {
  const value = folder?.trim() || DEFAULT_SHARED_VAULT.inboxFolder || "Intake";
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) {
    throw new Error("Note folder must be a relative path inside the shared vault.");
  }
  return value.split(/[\\/]+/).filter(Boolean).join(sep);
}

function noteTitle(content: string) {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return (firstLine || "Quick note").slice(0, 80);
}

function filenameSlug(title: string) {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "note";
}

function yamlScalar(value: string) {
  return JSON.stringify(value);
}

function noteMarkdown(input: {
  content: string;
  title: string;
  createdAt: string;
}) {
  return [
    "---",
    `type: ${yamlScalar("note")}`,
    `created: ${yamlScalar(input.createdAt)}`,
    `source: ${yamlScalar("dashboard-slash-command")}`,
    `tags: [${yamlScalar("hivemindos-note")}]`,
    "---",
    "",
    `# ${input.title}`,
    "",
    input.content,
    "",
  ].join("\n");
}

export async function captureObsidianNote(input: CaptureObsidianNoteInput): Promise<CapturedObsidianNote> {
  const content = input.content.replace(/\r\n?/g, "\n").trim();
  if (!content) throw new Error("Add note text after /note.");
  if (content.length > MAX_NOTE_CHARS) throw new Error("Note is too large to save from chat.");

  const root = resolveObsidianVaultPath(input.vaultPath ?? undefined, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);

  const createdAt = (input.now ?? new Date()).toISOString();
  const title = noteTitle(content);
  const dateFolder = createdAt.slice(0, 10);
  const timeStamp = createdAt
    .slice(0, 19)
    .replace("T", "-")
    .replace(/:/g, "");
  const folder = join(safeVaultFolder(input.inboxFolder), dateFolder);
  const dir = resolve(root, folder);
  assertInside(root, dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const markdown = noteMarkdown({ content, title, createdAt });
  const baseName = `${timeStamp}-${filenameSlug(title)}`;
  for (let index = 0; index < 50; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const file = resolve(dir, `${baseName}${suffix}.md`);
    assertInside(root, file);
    try {
      await writeFile(file, markdown, { encoding: "utf-8", mode: 0o600, flag: "wx" });
      return {
        vaultPath: root,
        notePath: toVaultPath(root, file),
        title,
        createdAt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") continue;
      throw error;
    }
  }

  throw new Error("Could not find an unused filename for the note.");
}

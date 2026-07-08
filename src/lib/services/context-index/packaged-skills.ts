import { constants } from "fs";
import { access, readdir, readFile, stat } from "fs/promises";
import { basename, dirname, join, relative, sep } from "path";
import type { ContextIndexItem } from "@/lib/services/context-index";

const SKIPPED_DIRS = new Set([".git", ".next", ".next-tauri", ".next-tauri-build", "node_modules", "out", "dist", "build"]);
const PACKAGED_AUTO_INSTALL_SKILLS_ROOT = "packaged-skills/auto-install";
const PACKAGED_OPTIONAL_SKILLS_ROOT = "packaged-skills/optional";

type PackagedSkillFileStat = { path: string; mtimeMs: number; size: number };

function workspaceRoot() {
  return process.cwd();
}

function toPosix(path: string) {
  return path.split(sep).join("/");
}

function absolutePath(path: string) {
  return join(workspaceRoot(), path);
}

async function canRead(path: string) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(path: string) {
  return stat(path).catch(() => null);
}

async function statPaths(paths: string[]): Promise<PackagedSkillFileStat[]> {
  const stats = await Promise.all(paths.map(async (path) => {
    const st = await safeStat(path);
    return st?.isFile() ? { path, mtimeMs: st.mtimeMs, size: st.size } : null;
  }));
  return stats.filter((entry): entry is PackagedSkillFileStat => entry !== null);
}

async function walkSkillFiles(root: string, output: string[] = [], maxFiles = 800, maxDepth = 6, depth = 0): Promise<string[]> {
  if (depth > maxDepth || output.length >= maxFiles || !(await canRead(root))) return output;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= maxFiles || SKIPPED_DIRS.has(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === "SKILL.md") {
      output.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      await walkSkillFiles(path, output, maxFiles, maxDepth, depth + 1);
    }
  }
  return output;
}

function firstUsefulParagraph(markdown: string) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---/, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/, "").replace(/\s+/g, " ").trim())
    .find((part) => part && !part.startsWith("![")) ?? "";
}

function parseSimpleFrontmatter(markdown: string) {
  const fields = new Map<string, string>();
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) fields.set(field[1].toLowerCase(), field[2].replace(/^["']|["']$/g, "").trim());
  }
  return fields;
}

function tagParts(...values: Array<string | undefined>) {
  return [...new Set(values
    .filter(Boolean)
    .flatMap((value) => value!.split(/[^A-Za-z0-9_-]+/))
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 2))].slice(0, 12);
}

function uniqueList(values: Array<string | undefined>) {
  return [...new Set(values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value)))];
}

function retrievalText(parts: Array<string | undefined | string[]>) {
  return parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export async function packagedSkillFileStats(): Promise<PackagedSkillFileStat[]> {
  const autoInstallRoot = absolutePath(PACKAGED_AUTO_INSTALL_SKILLS_ROOT);
  const optionalRoot = absolutePath(PACKAGED_OPTIONAL_SKILLS_ROOT);
  const files = [
    ...(await walkSkillFiles(autoInstallRoot, [], 200, 3)),
    ...(await walkSkillFiles(optionalRoot, [], 800, 6)),
  ];
  return statPaths(files.sort());
}

export async function packagedSkillItem(file: PackagedSkillFileStat): Promise<ContextIndexItem> {
  const markdown = await readFile(file.path, "utf8").catch(() => "");
  const frontmatter = parseSimpleFrontmatter(markdown);
  const relativePath = toPosix(relative(workspaceRoot(), file.path));
  const slug = basename(dirname(file.path));
  const description = frontmatter.get("description") || firstUsefulParagraph(markdown) || `Packaged skill ${slug}.`;
  const title = frontmatter.get("name") || slug;
  const optionalRoot = absolutePath(PACKAGED_OPTIONAL_SKILLS_ROOT);
  const packageDir = dirname(file.path);
  const isOptional = packageDir === optionalRoot || packageDir.startsWith(`${optionalRoot}${sep}`);

  if (isOptional) {
    const optionalPath = toPosix(relative(optionalRoot, packageDir));
    const isNansen = /\bnansen\b/i.test(`${title} ${description} ${optionalPath}`);
    const optionalNote = isNansen
      ? "Optional Nansen workflow playbook; not required for Nansen access. Use the built-in nansen_intelligence Hive action or /api/nansen routes for execution, and install this skill only when the user wants a reusable shared-brain workflow."
      : "Optional packaged workflow playbook. It is discoverable for catalog/install decisions, but it is not an active runtime skill until installed into the shared brain.";
    return {
      id: `skill:packaged:optional:${optionalPath}`,
      kind: "skill",
      title,
      summary: `Optional installable workflow playbook: ${description}`,
      tags: tagParts(slug, optionalPath, "packaged", "optional", "installable", "workflow", "playbook", "skill"),
      aliases: uniqueList([
        title,
        slug,
        optionalPath,
        optionalPath.replace(/\//g, " "),
        `${slug} optional skill`,
        isNansen ? "nansen optional skill" : undefined,
        isNansen ? "nansen workflow playbook" : undefined,
      ]),
      path: file.path,
      retrievalText: retrievalText([
        description,
        relativePath,
        optionalPath,
        "optional packaged skill installable workflow playbook catalog shared-brain install",
        isNansen
          ? "Nansen intelligence built-in capability nansen_intelligence simple-template complex-template; install is not required to use Nansen access."
          : undefined,
        markdown.slice(0, 2_000),
      ]),
      load: {
        type: "file",
        target: file.path,
        note: optionalNote,
      },
      updatedAt: file.mtimeMs,
      sizeBytes: file.size,
    };
  }

  return {
    id: `skill:packaged:auto-install:${slug}`,
    kind: "skill",
    title,
    summary: description,
    tags: tagParts(slug, "packaged", "auto-install", "installable", "one-click", "skill"),
    path: file.path,
    retrievalText: retrievalText([description, relativePath, "packaged skill auto-install catalog"]),
    load: {
      type: "file",
      target: file.path,
      note: "Packaged auto-install skill metadata is indexed for setup discovery. Setup copies these skills into the shared brain automatically.",
    },
    updatedAt: file.mtimeMs,
    sizeBytes: file.size,
  };
}

import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";

const OKF_VERSION = "0.1";
const DEFAULT_EXPORT_FOLDER = "Operations/Brain Services/OKF Export";
const AGENT_MEMORY_FOLDER = "Memory/Distillations/Agent Memory";
const CONVERSATIONS_FOLDER = "Memory/Conversations";
const RESERVED_MARKDOWN = new Set(["index.md", "log.md"]);
const MAX_MARKDOWN_BYTES = 256 * 1024;

export type OkfExportInclude = "agent-memory" | "conversations" | "all";

export type OkfExportInput = {
  vaultPath?: string;
  outputPath?: string;
  include?: OkfExportInclude;
  clean?: boolean;
};

export type OkfValidateInput = {
  bundlePath?: string;
  vaultPath?: string;
};

export type OkfIssue = {
  severity: "error" | "warning";
  code: string;
  file: string;
  message: string;
};

export type OkfValidationResult = {
  ok: boolean;
  bundlePath: string;
  concepts: number;
  reservedFiles: number;
  errors: OkfIssue[];
  warnings: OkfIssue[];
};

type FrontmatterParseResult = {
  fields: Map<string, unknown>;
  body: string;
};

type SourceConcept = {
  sourcePath: string;
  targetPath: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
  tags: string[];
  body: string;
};

function normalizedPath(path: string) {
  return path.split(sep).join("/");
}

function toRelativePath(root: string, path: string) {
  return normalizedPath(relative(root, path));
}

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(path) === resolve(root)) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected root.");
  }
}

function safeSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "concept";
}

function cleanScalar(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactDescription(value: string, maxLength = 180) {
  const compacted = value
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^#\s+.+$/m, "")
    .replace(/^## Metadata[\s\S]*$/m, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compacted) return "";
  return compacted.length <= maxLength ? compacted : `${compacted.slice(0, maxLength - 3).trim()}...`;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value.replace(/'/g, "\""));
      return Array.isArray(parsed) ? parsed : value;
    } catch {
      return value.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const lines = markdown.split(/\r?\n/);
  const fields = new Map<string, unknown>();
  if (lines[0]?.trim() !== "---") return { fields, body: markdown };

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex === -1) throw new Error("Unterminated YAML frontmatter block.");

  for (let index = 1; index < endIndex; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) throw new Error(`Unsupported YAML frontmatter line: ${line}`);
    const [, key, raw] = match;
    if (!raw.trim()) {
      const values: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < endIndex) {
        const item = lines[nextIndex].match(/^\s+-\s+(.+)$/);
        if (!item) break;
        values.push(String(parseScalar(item[1])));
        nextIndex += 1;
      }
      if (values.length) {
        fields.set(key, values);
        index = nextIndex - 1;
        continue;
      }
    }
    fields.set(key, parseScalar(raw));
  }

  return { fields, body: lines.slice(endIndex + 1).join("\n").replace(/^\n/, "") };
}

function yamlValue(value: string | string[]) {
  if (Array.isArray(value)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
  return JSON.stringify(value);
}

function conceptMarkdown(concept: SourceConcept) {
  const frontmatter = [
    "---",
    `type: ${yamlValue(concept.type)}`,
    `title: ${yamlValue(concept.title)}`,
    `description: ${yamlValue(concept.description || concept.title)}`,
    `resource: ${yamlValue(concept.sourcePath)}`,
    `tags: ${yamlValue(concept.tags)}`,
    `timestamp: ${yamlValue(concept.timestamp)}`,
    "okf_version: \"0.1\"",
    "source_system: \"hivemindos\"",
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${concept.body.trim()}\n`;
}

async function walkMarkdown(root: string, dir: string, output: string[] = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      await walkMarkdown(root, fullPath, output);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) output.push(fullPath);
  }
  return output;
}

function tagsFromFrontmatter(value: unknown, extra: string[] = []) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set([...raw, ...extra]
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9/_-]+/g, "-"))
    .filter(Boolean))]
    .slice(0, 16);
}

function conceptFromAgentMemory(vaultRoot: string, file: string, markdown: string): SourceConcept | null {
  const { fields, body } = parseFrontmatter(markdown);
  const title = cleanScalar(fields.get("title")) || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(file, ".md");
  const memoryType = cleanScalar(fields.get("memoryType")) || "context";
  const createdAt = cleanScalar(fields.get("updatedAt")) || cleanScalar(fields.get("createdAt")) || new Date().toISOString();
  const sourcePath = toRelativePath(vaultRoot, file);
  const content = body.trim() || markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!content) return null;
  return {
    sourcePath,
    targetPath: `agent-memory/${safeSlug(memoryType)}/${safeSlug(title)}.md`,
    type: `agent_memory_${safeSlug(memoryType).replace(/-/g, "_")}`,
    title,
    description: compactDescription(content) || `HivemindOS ${memoryType} memory.`,
    timestamp: createdAt,
    tags: tagsFromFrontmatter(fields.get("tags"), ["hivemindos", "agent-memory", memoryType]),
    body: content,
  };
}

function conceptFromConversation(vaultRoot: string, file: string, markdown: string): SourceConcept | null {
  const { fields, body } = parseFrontmatter(markdown);
  const title = cleanScalar(fields.get("title")) || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(file, ".md");
  const timestamp = cleanScalar(fields.get("endedAt")) || cleanScalar(fields.get("startedAt")) || new Date().toISOString();
  const sourcePath = toRelativePath(vaultRoot, file);
  const content = body.trim() || markdown.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (!content) return null;
  const agentName = cleanScalar(fields.get("agentName")) || "agent";
  return {
    sourcePath,
    targetPath: `conversations/${safeSlug(agentName)}/${safeSlug(title)}.md`,
    type: "conversation",
    title,
    description: compactDescription(content) || `HivemindOS conversation with ${agentName}.`,
    timestamp,
    tags: tagsFromFrontmatter(fields.get("tags"), ["hivemindos", "conversation", safeSlug(agentName)]),
    body: content,
  };
}

async function collectConcepts(vaultRoot: string, include: OkfExportInclude) {
  const concepts: SourceConcept[] = [];
  const addFromFolder = async (
    folder: string,
    factory: (vaultRoot: string, file: string, markdown: string) => SourceConcept | null,
  ) => {
    const root = join(vaultRoot, folder);
    const files = await walkMarkdown(vaultRoot, root);
    for (const file of files) {
      const st = await stat(file).catch(() => null);
      if (!st || st.size > MAX_MARKDOWN_BYTES) continue;
      const markdown = await readFile(file, "utf8").catch(() => "");
      const concept = factory(vaultRoot, file, markdown);
      if (concept) concepts.push(concept);
    }
  };

  if (include === "agent-memory" || include === "all") {
    await addFromFolder(AGENT_MEMORY_FOLDER, conceptFromAgentMemory);
  }
  if (include === "conversations" || include === "all") {
    await addFromFolder(CONVERSATIONS_FOLDER, conceptFromConversation);
  }
  return concepts;
}

function indexText(title: string, entries: SourceConcept[]) {
  const grouped = new Map<string, SourceConcept[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.type) ?? [];
    list.push(entry);
    grouped.set(entry.type, list);
  }
  const sections = [`# ${title}`, "", `Generated as an OKF v${OKF_VERSION} exchange bundle from HivemindOS shared-brain notes.`];
  for (const [type, concepts] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    sections.push("", `# ${type}`, "");
    for (const concept of concepts.sort((left, right) => left.title.localeCompare(right.title))) {
      sections.push(`* [${concept.title}](/${concept.targetPath}) - ${concept.description}`);
    }
  }
  return `${sections.join("\n")}\n`;
}

function logText(conceptCount: number, include: OkfExportInclude) {
  const day = new Date().toISOString().slice(0, 10);
  return [
    "# OKF Export Log",
    "",
    `## ${day}`,
    `* **Export**: Wrote ${conceptCount} HivemindOS ${include} concepts into an OKF v${OKF_VERSION} bundle.`,
    "",
  ].join("\n");
}

function resolveOutputPath(vaultRoot: string, outputPath?: string) {
  if (!outputPath?.trim()) return join(vaultRoot, DEFAULT_EXPORT_FOLDER);
  const resolved = resolve(outputPath.trim().startsWith("/") ? outputPath.trim() : join(vaultRoot, outputPath.trim()));
  assertInside(vaultRoot, resolved);
  if (resolve(resolved) === resolve(vaultRoot)) throw new Error("OKF export path cannot be the vault root.");
  return resolved;
}

export async function exportOkfBundle(input: OkfExportInput = {}) {
  const vaultRoot = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const include = input.include ?? "all";
  const outputRoot = resolveOutputPath(vaultRoot, input.outputPath);
  if (input.clean ?? true) await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const concepts = await collectConcepts(vaultRoot, include);
  for (const concept of concepts) {
    const file = join(outputRoot, concept.targetPath);
    assertInside(outputRoot, file);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, conceptMarkdown(concept), "utf8");
  }
  await writeFile(join(outputRoot, "index.md"), indexText("HivemindOS Shared Brain OKF Bundle", concepts), "utf8");
  await writeFile(join(outputRoot, "log.md"), logText(concepts.length, include), "utf8");

  const validation = await validateOkfBundle({ bundlePath: outputRoot });
  return {
    bundlePath: outputRoot,
    include,
    concepts: concepts.length,
    validation,
  };
}

function issue(severity: OkfIssue["severity"], code: string, file: string, message: string): OkfIssue {
  return { severity, code, file, message };
}

function validateReservedFile(fileName: string, rel: string, body: string, warnings: OkfIssue[]) {
  if (fileName === "index.md") {
    if (!/^#\s+.+/m.test(body)) warnings.push(issue("warning", "OKF_INDEX_HEADING", rel, "index.md should contain at least one heading."));
    return;
  }
  const invalidDate = body.match(/^##\s+(.+)$/gm)?.find((line) => !/^##\s+\d{4}-\d{2}-\d{2}\s*$/.test(line));
  if (invalidDate) warnings.push(issue("warning", "OKF_LOG_DATE", rel, "log.md date headings should use YYYY-MM-DD."));
}

export async function validateOkfBundle(input: OkfValidateInput = {}): Promise<OkfValidationResult> {
  const bundleRoot = input.bundlePath
    ? resolve(input.bundlePath)
    : resolveOutputPath(resolveObsidianVaultPath(input.vaultPath), undefined);
  const bundleStat = await stat(bundleRoot).catch(() => null);
  if (!bundleStat?.isDirectory()) throw new Error("OKF bundle path must be an existing directory.");
  const files = await walkMarkdown(bundleRoot, bundleRoot);
  const errors: OkfIssue[] = [];
  const warnings: OkfIssue[] = [];
  let concepts = 0;
  let reservedFiles = 0;

  for (const file of files) {
    const rel = toRelativePath(bundleRoot, file);
    const fileName = basename(file);
    const markdown = await readFile(file, "utf8").catch(() => "");
    if (RESERVED_MARKDOWN.has(fileName)) {
      reservedFiles += 1;
      const body = markdown.startsWith("---") ? parseFrontmatter(markdown).body : markdown;
      validateReservedFile(fileName, rel, body, warnings);
      continue;
    }

    concepts += 1;
    try {
      const parsed = parseFrontmatter(markdown);
      if (!parsed.fields.size) {
        errors.push(issue("error", "OKF001", rel, "Concept file must start with YAML frontmatter."));
        continue;
      }
      if (!cleanScalar(parsed.fields.get("type"))) {
        errors.push(issue("error", "OKF002", rel, "Frontmatter must contain a non-empty type field."));
      }
      if (!cleanScalar(parsed.fields.get("title"))) {
        warnings.push(issue("warning", "OKF_TITLE", rel, "title is recommended for useful OKF discovery."));
      }
      if (!cleanScalar(parsed.fields.get("description"))) {
        warnings.push(issue("warning", "OKF_DESCRIPTION", rel, "description is recommended for generated indexes."));
      }
      if (!cleanScalar(parsed.fields.get("timestamp"))) {
        warnings.push(issue("warning", "OKF_TIMESTAMP", rel, "timestamp is recommended for freshness-aware consumers."));
      }
    } catch (error) {
      errors.push(issue("error", "OKF003", rel, error instanceof Error ? error.message : "Could not parse frontmatter."));
    }
  }

  return {
    ok: errors.length === 0,
    bundlePath: bundleRoot,
    concepts,
    reservedFiles,
    errors,
    warnings,
  };
}

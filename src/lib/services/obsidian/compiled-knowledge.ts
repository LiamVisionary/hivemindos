import { constants } from "fs";
import { access, appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { resolveSharedContributionPolicy, type BrainActorKind, type BrainCollaborationMode } from "@/lib/services/brain/shared-contribution-contract";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { listFilesMatchingTerms, searchTermsFromQuery } from "@/lib/services/search/ripgrep-search";

const COMPILED_ROOT = "Synthesis/Compiled Knowledge";
const DISMISSED_FILE = "wiki/.health-dismissed.jsonl";
const RESERVED_FILES = new Set(["index.md", "log.md", ".health-dismissed.jsonl"]);

export type KnowledgePageKind = "entity" | "concept" | "summary";

export type KnowledgeNodeDraft = {
  name: string;
  slug?: string;
  description?: string;
  facts?: string[];
  tags?: string[];
  related?: string[];
};

export type CompileKnowledgeInput = {
  vaultPath?: string;
  domain?: string;
  title: string;
  content: string;
  summary?: string;
  sourcePath?: string;
  tags?: string[];
  entities?: KnowledgeNodeDraft[];
  concepts?: KnowledgeNodeDraft[];
  actorKind?: BrainActorKind;
  collaborationMode?: BrainCollaborationMode;
  optedInDomain?: string;
  createdAt?: string;
};

export type CompiledKnowledgeWrite = {
  path: string;
  type: KnowledgePageKind;
  slug: string;
  status: "created" | "updated" | "unchanged";
  bytesBefore: number;
  bytesAfter: number;
};

export type CompiledKnowledgeResult = {
  ok: true;
  domain: string;
  root: string;
  summaryPath: string;
  sourceHash: string;
  pagesWritten: CompiledKnowledgeWrite[];
  warnings: string[];
};

export type CompiledKnowledgeGraphNode = {
  slug: string;
  path: string;
  type: KnowledgePageKind;
  title: string;
  tags: string[];
  body: string;
  outgoing: string[];
  backlinks: string[];
};

export type CompiledKnowledgeGraph = {
  domain: string;
  root: string;
  generatedAt: string;
  nodes: CompiledKnowledgeGraphNode[];
  edges: Array<{ source: string; target: string }>;
};

export type CompiledKnowledgeHealthIssue = {
  id: string;
  type: "broken-link" | "orphan" | "duplicate-slug" | "missing-backlink";
  severity: "safe" | "review";
  sourcePath?: string;
  targetPath?: string;
  slug?: string;
  target?: string;
  suggestedTarget?: string;
  message: string;
};

export type CompiledKnowledgeHealth = {
  domain: string;
  root: string;
  generatedAt: string;
  counts: {
    pages: number;
    brokenLinks: number;
    orphans: number;
    duplicateSlugs: number;
    missingBacklinks: number;
    dismissed: number;
  };
  issues: CompiledKnowledgeHealthIssue[];
};

export type CompiledKnowledgeSearchHit = {
  slug: string;
  path: string;
  type: KnowledgePageKind;
  title: string;
  score: number;
  matchedFields: string[];
  snippet: string;
  outgoingCount: number;
};

export type CompiledKnowledgeSearchResult = {
  domain: string;
  root: string;
  generatedAt: string;
  query: string;
  limit: number;
  searchMode: "metadata-and-binary" | "metadata-and-walk";
  results: CompiledKnowledgeSearchHit[];
};

export type CompiledKnowledgeStatus = {
  domain: string;
  root: string;
  exists: boolean;
  pages: number;
  entities: number;
  concepts: number;
  summaries: number;
};

function toPosix(path: string) {
  return path.split(sep).join("/");
}

function assertInside(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(path) === resolve(root)) {
    if (resolve(path) !== resolve(root)) throw new Error("Path escaped the selected root.");
  }
}

function safeSlug(value: string, fallback = "knowledge") {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function yamlList(values: string[]) {
  return `[${[...new Set(values.map((value) => value.trim()).filter(Boolean))].map(yamlString).join(", ")}]`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string) {
  return sha256(value).slice(0, 12);
}

function firstParagraph(value: string, max = 900) {
  const paragraph = value
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find(Boolean) || value.replace(/\s+/g, " ").trim();
  return paragraph.length <= max ? paragraph : `${paragraph.slice(0, max - 3).trim()}...`;
}

function domainSlug(domain?: string) {
  return safeSlug(domain || "shared-brain", "shared-brain");
}

function domainRoot(vaultRoot: string, domain?: string) {
  const root = join(vaultRoot, COMPILED_ROOT, domainSlug(domain));
  assertInside(vaultRoot, root);
  return root;
}

function wikiRoot(root: string) {
  return join(root, "wiki");
}

function pageTypeFromPath(path: string): KnowledgePageKind | null {
  if (path.startsWith("entities/")) return "entity";
  if (path.startsWith("concepts/")) return "concept";
  if (path.startsWith("summaries/")) return "summary";
  return null;
}

function pathFor(type: KnowledgePageKind, slug: string) {
  if (type === "entity") return `entities/${slug}.md`;
  if (type === "concept") return `concepts/${slug}.md`;
  return `summaries/${slug}.md`;
}

function normalizeRelPath(type: KnowledgePageKind, relPath: string) {
  const slug = safeSlug(basename(relPath).replace(/\.md$/i, ""));
  return pathFor(type, slug);
}

async function writeAtomic(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

async function ensureDomain(root: string) {
  await Promise.all([
    mkdir(join(root, "raw"), { recursive: true }),
    mkdir(join(root, "wiki", "entities"), { recursive: true }),
    mkdir(join(root, "wiki", "concepts"), { recursive: true }),
    mkdir(join(root, "wiki", "summaries"), { recursive: true }),
  ]);
}

function stripFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function parseFrontmatter(markdown: string) {
  const fields = new Map<string, string | string[]>();
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fields;
  for (const line of match[1].split("\n")) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!item) continue;
    const [, key, raw] = item;
    const value = raw.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      fields.set(key, value.slice(1, -1).split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
    } else {
      fields.set(key, value.replace(/^["']|["']$/g, ""));
    }
  }
  return fields;
}

function normalizeLinks(markdown: string) {
  return markdown.replace(/\[\[([^\]|#^]+)(#[^\]|^]+)?(\^[^\]|]+)?(\|[^\]]+)?]]/g, (_match, rawTarget: string, heading = "", block = "", alias = "") => {
    const parts = rawTarget.trim().replace(/\.md$/i, "").split("/");
    const prefix = parts.length > 1 ? parts[0].toLowerCase() : "";
    const slug = safeSlug(parts[parts.length - 1]);
    const target = prefix === "summaries" ? `summaries/${slug}` : slug;
    return `[[${target}${heading}${block}${alias}]]`;
  });
}

function extractWikiLinks(markdown: string) {
  const links: string[] = [];
  const re = /\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|[^\]]+)?]]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const parts = match[1].trim().replace(/\.md$/i, "").split("/");
    links.push(safeSlug(parts[parts.length - 1]));
  }
  return [...new Set(links)];
}

function countOccurrences(text: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

function snippetForQuery(body: string, terms: string[], max = 100) {
  const compactBody = body
    .replace(/^#+\s+.+$/gm, " ")
    .replace(/\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|([^\]]+))?]]/g, "$2$1")
    .replace(/\s+/g, " ")
    .trim();
  const lower = compactBody.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = firstHit === undefined ? 0 : Math.max(0, firstHit - 90);
  const snippet = compactBody.slice(start, start + max).trim();
  return `${start > 0 ? "... " : ""}${snippet}${start + max < compactBody.length ? " ..." : ""}`;
}

function wikilink(slug: string, type?: KnowledgePageKind) {
  const clean = safeSlug(slug);
  return type === "summary" ? `[[summaries/${clean}]]` : `[[${clean}]]`;
}

function bulletLines(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].map((value) => `- ${value}`).join("\n");
}

function mergeBulletSection(existingBody: string, incomingBody: string, heading: string) {
  const sectionRe = new RegExp(`(^## ${heading}\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");
  const existing = existingBody.match(sectionRe)?.[2] ?? "";
  const incoming = incomingBody.match(sectionRe)?.[2] ?? "";
  const bullets = [...new Set([...existing.split("\n"), ...incoming.split("\n")]
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ")))];
  if (!bullets.length) return existingBody || incomingBody;
  if (sectionRe.test(existingBody)) {
    return existingBody.replace(sectionRe, `$1${bullets.join("\n").trim()}\n`);
  }
  return `${existingBody.trim()}\n\n## ${heading}\n${bullets.join("\n")}\n`;
}

function mergeBodies(existing: string, incoming: string) {
  let merged = stripFrontmatter(existing).trim() || stripFrontmatter(incoming).trim();
  const incomingBody = stripFrontmatter(incoming).trim();
  for (const heading of ["Key Facts", "Related", "Entities Mentioned", "Concepts Mentioned", "Sources"]) {
    merged = mergeBulletSection(merged, incomingBody, heading);
  }
  return `${merged.trim()}\n`;
}

function frontmatter(type: KnowledgePageKind, title: string, tags: string[], createdAt: string, updatedAt: string, sourceHash?: string) {
  return [
    "---",
    `type: ${yamlString(`compiled-${type}`)}`,
    `title: ${yamlString(title)}`,
    `tags: ${yamlList(["compiled-knowledge", type, ...tags])}`,
    `createdAt: ${yamlString(createdAt)}`,
    `updatedAt: ${yamlString(updatedAt)}`,
    sourceHash ? `sourceHash: ${yamlString(sourceHash)}` : "",
    "---",
  ].filter(Boolean).join("\n");
}

async function writeCompiledKnowledgePage(root: string, input: {
  relPath: string;
  type: KnowledgePageKind;
  title: string;
  body: string;
  tags?: string[];
  sourceHash?: string;
  createdAt: string;
}): Promise<CompiledKnowledgeWrite> {
  const wiki = wikiRoot(root);
  const relPath = normalizeRelPath(input.type, input.relPath);
  const absolute = join(wiki, relPath);
  assertInside(wiki, absolute);
  const previous = await readFile(absolute, "utf8").catch(() => "");
  const previousFields = parseFrontmatter(previous);
  const createdAt = String(previousFields.get("createdAt") || input.createdAt);
  const updatedAt = input.createdAt;
  const normalizedBody = normalizeLinks(input.body);
  const body = previous ? mergeBodies(previous, normalizedBody) : `${stripFrontmatter(normalizedBody).trim()}\n`;
  const next = `${frontmatter(input.type, input.title, input.tags ?? [], createdAt, updatedAt, input.sourceHash)}\n\n${body}`;
  const status = !previous ? "created" : previous === next ? "unchanged" : "updated";
  if (status !== "unchanged") await writeAtomic(absolute, next);
  return {
    path: relPath,
    type: input.type,
    slug: safeSlug(basename(relPath).replace(/\.md$/i, "")),
    status,
    bytesBefore: Buffer.byteLength(previous, "utf8"),
    bytesAfter: Buffer.byteLength(next, "utf8"),
  };
}

function normalizeDrafts(values: KnowledgeNodeDraft[] | undefined, fallbackNames: string[]) {
  const bySlug = new Map<string, KnowledgeNodeDraft>();
  const fallbackDrafts: KnowledgeNodeDraft[] = fallbackNames.map((name) => ({ name }));
  for (const value of [...(values ?? []), ...fallbackDrafts]) {
    const name = value.name?.trim();
    if (!name) continue;
    const slug = safeSlug(value.slug || name);
    if (!bySlug.has(slug)) bySlug.set(slug, { ...value, name, slug });
  }
  return [...bySlug.values()].slice(0, 24);
}

function extractEntityNames(content: string) {
  const names = new Set<string>();
  const re = /\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const name = match[1].trim();
    if (!["The", "This", "That", "When", "Where", "What", "Why", "How"].includes(name)) names.add(name);
  }
  return [...names].slice(0, 12);
}

function extractConceptNames(content: string) {
  const names = new Set<string>();
  for (const match of content.matchAll(/^#{2,4}\s+(.+)$/gm)) names.add(match[1].trim());
  for (const match of content.matchAll(/\b([a-z][a-z0-9]+(?:[- ][a-z0-9]+){1,3})\b/g)) {
    const phrase = match[1].trim();
    if (phrase.length > 8 && !phrase.includes(" the ") && !phrase.includes(" and ")) names.add(phrase);
  }
  return [...names].slice(0, 12);
}

async function updateIndex(root: string, writes: CompiledKnowledgeWrite[]) {
  const wiki = wikiRoot(root);
  const indexPath = join(wiki, "index.md");
  const previous = await readFile(indexPath, "utf8").catch(() => "# Compiled Knowledge Index\n\n## Summaries\n\n## Entities\n\n## Concepts\n");
  let next = previous;
  for (const write of writes) {
    if (write.status !== "created") continue;
    const section = write.type === "entity" ? "Entities" : write.type === "concept" ? "Concepts" : "Summaries";
    const line = `- ${wikilink(write.slug, write.type)} — ${write.path}`;
    if (next.includes(line)) continue;
    const re = new RegExp(`(## ${section}\\n)`);
    next = re.test(next) ? next.replace(re, `$1${line}\n`) : `${next.trim()}\n\n## ${section}\n${line}\n`;
  }
  if (next !== previous) await writeAtomic(indexPath, next.endsWith("\n") ? next : `${next}\n`);
}

async function appendLog(root: string, title: string, writes: CompiledKnowledgeWrite[], warnings: string[]) {
  const logPath = join(wikiRoot(root), "log.md");
  const lines = [
    `## ${new Date().toISOString()} compile | ${title}`,
    ...writes.map((write) => `- ${write.status}: ${write.path} (${write.bytesBefore} -> ${write.bytesAfter} bytes)`),
    ...warnings.map((warning) => `- warning: ${warning}`),
    "",
  ];
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${lines.join("\n")}\n`, "utf8");
}

export async function compileKnowledgeToWiki(input: CompileKnowledgeInput): Promise<CompiledKnowledgeResult> {
  if (!input.title?.trim()) throw new Error("A title is required to compile knowledge.");
  if (!input.content?.trim()) throw new Error("Content is required to compile knowledge.");
  const domain = domainSlug(input.domain);
  const policy = resolveSharedContributionPolicy({
    domain,
    actorKind: input.actorKind,
    collaborationMode: input.collaborationMode,
    operation: "compile",
    optedInDomain: input.optedInDomain,
  });
  if (!policy.canWrite) throw new Error(`${policy.reason} ${policy.guidance}`);

  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const root = domainRoot(vault, domain);
  await ensureDomain(root);

  const now = input.createdAt || new Date().toISOString();
  const sourceHash = `sha256:${sha256(input.content)}`;
  const hash = shortHash(input.content);
  const summarySlug = safeSlug(`${input.title}-${hash}`);
  const title = input.title.trim();
  const tags = input.tags ?? [];
  const entities = normalizeDrafts(input.entities, extractEntityNames(input.content));
  const concepts = normalizeDrafts(input.concepts, extractConceptNames(input.content));
  const warnings: string[] = [];
  if (!entities.length) warnings.push("No entities were provided or extracted.");
  if (!concepts.length) warnings.push("No concepts were provided or extracted.");

  const rawPath = join(root, "raw", `${summarySlug}.md`);
  await writeAtomic(rawPath, `---\ntitle: ${yamlString(title)}\nsourceHash: ${yamlString(sourceHash)}\ncreatedAt: ${yamlString(now)}\n---\n\n${input.content.trim()}\n`);

  const writes: CompiledKnowledgeWrite[] = [];
  const entityLinks = entities.map((entity) => wikilink(entity.slug || entity.name));
  const conceptLinks = concepts.map((concept) => wikilink(concept.slug || concept.name));
  const summaryBody = [
    `# ${title}`,
    "",
    "## Summary",
    "",
    input.summary?.trim() || firstParagraph(input.content),
    "",
    "## Entities Mentioned",
    bulletLines(entityLinks),
    "",
    "## Concepts Mentioned",
    bulletLines(conceptLinks),
    "",
    "## Sources",
    `- ${input.sourcePath ? input.sourcePath : "Compiled from direct input"} (${sourceHash})`,
  ].join("\n");
  writes.push(await writeCompiledKnowledgePage(root, {
    relPath: pathFor("summary", summarySlug),
    type: "summary",
    title,
    body: summaryBody,
    tags,
    sourceHash,
    createdAt: now,
  }));

  for (const entity of entities) {
    const slug = entity.slug || safeSlug(entity.name);
    const related = [...conceptLinks.slice(0, 8), wikilink(summarySlug, "summary"), ...(entity.related ?? []).map((item) => wikilink(item))];
    const body = [
      `# ${entity.name}`,
      "",
      "## Overview",
      "",
      entity.description || `Entity compiled from ${wikilink(summarySlug, "summary")}.`,
      "",
      "## Key Facts",
      bulletLines(entity.facts?.length ? entity.facts : [`Mentioned in ${wikilink(summarySlug, "summary")}.`]),
      "",
      "## Related",
      bulletLines(related),
    ].join("\n");
    writes.push(await writeCompiledKnowledgePage(root, {
      relPath: pathFor("entity", slug),
      type: "entity",
      title: entity.name,
      body,
      tags: entity.tags ?? tags,
      sourceHash,
      createdAt: now,
    }));
  }

  for (const concept of concepts) {
    const slug = concept.slug || safeSlug(concept.name);
    const related = [...entityLinks.slice(0, 8), wikilink(summarySlug, "summary"), ...(concept.related ?? []).map((item) => wikilink(item))];
    const body = [
      `# ${concept.name}`,
      "",
      "## Overview",
      "",
      concept.description || `Concept compiled from ${wikilink(summarySlug, "summary")}.`,
      "",
      "## Key Facts",
      bulletLines(concept.facts?.length ? concept.facts : [`Captured while compiling ${wikilink(summarySlug, "summary")}.`]),
      "",
      "## Related",
      bulletLines(related),
    ].join("\n");
    writes.push(await writeCompiledKnowledgePage(root, {
      relPath: pathFor("concept", slug),
      type: "concept",
      title: concept.name,
      body,
      tags: concept.tags ?? tags,
      sourceHash,
      createdAt: now,
    }));
  }

  await updateIndex(root, writes);
  await appendLog(root, title, writes, warnings);
  return {
    ok: true,
    domain,
    root: toPosix(relative(vault, root)),
    summaryPath: pathFor("summary", summarySlug),
    sourceHash,
    pagesWritten: writes,
    warnings,
  };
}

async function walkMarkdown(root: string, dir = root, output: string[] = []) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    assertInside(root, full);
    if (entry.isDirectory()) {
      await walkMarkdown(root, full, output);
    } else if (entry.isFile() && entry.name.endsWith(".md") && !RESERVED_FILES.has(entry.name)) {
      output.push(full);
    }
  }
  return output;
}

async function readPages(vaultPath: string | undefined, domain?: string) {
  const vault = resolveObsidianVaultPath(vaultPath);
  const root = domainRoot(vault, domain);
  const wiki = wikiRoot(root);
  await access(wiki, constants.R_OK).catch(() => undefined);
  const files = await walkMarkdown(wiki);
  const pages = await Promise.all(files.map(async (file) => {
    const relPath = toPosix(relative(wiki, file));
    const content = await readFile(file, "utf8");
    const fields = parseFrontmatter(content);
    const type = pageTypeFromPath(relPath);
    const slug = safeSlug(basename(relPath).replace(/\.md$/i, ""));
    const title = String(fields.get("title") || content.match(/^#\s+(.+)$/m)?.[1] || slug);
    const tags = Array.isArray(fields.get("tags")) ? fields.get("tags") as string[] : [];
    return { relPath, content, type, slug, title, tags, body: stripFrontmatter(content) };
  }));
  return { vault, root, wiki, pages: pages.filter((page) => page.type) as Array<typeof pages[number] & { type: KnowledgePageKind }> };
}

export async function getCompiledKnowledgeStatus(input: { vaultPath?: string; domain?: string } = {}): Promise<CompiledKnowledgeStatus> {
  const vault = resolveObsidianVaultPath(input.vaultPath);
  const root = domainRoot(vault, input.domain);
  const exists = await stat(wikiRoot(root)).then((value) => value.isDirectory()).catch(() => false);
  if (!exists) {
    return { domain: domainSlug(input.domain), root: toPosix(relative(vault, root)), exists: false, pages: 0, entities: 0, concepts: 0, summaries: 0 };
  }
  const { pages } = await readPages(input.vaultPath, input.domain);
  return {
    domain: domainSlug(input.domain),
    root: toPosix(relative(vault, root)),
    exists: true,
    pages: pages.length,
    entities: pages.filter((page) => page.type === "entity").length,
    concepts: pages.filter((page) => page.type === "concept").length,
    summaries: pages.filter((page) => page.type === "summary").length,
  };
}

export async function buildCompiledKnowledgeGraph(input: { vaultPath?: string; domain?: string } = {}): Promise<CompiledKnowledgeGraph> {
  const { vault, root, pages } = await readPages(input.vaultPath, input.domain);
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  const backlinkMap = new Map<string, Set<string>>();
  const edges: Array<{ source: string; target: string }> = [];
  for (const page of pages) {
    for (const target of extractWikiLinks(page.body)) {
      if (!bySlug.has(target)) continue;
      edges.push({ source: page.slug, target });
      if (!backlinkMap.has(target)) backlinkMap.set(target, new Set());
      backlinkMap.get(target)?.add(page.slug);
    }
  }
  return {
    domain: domainSlug(input.domain),
    root: toPosix(relative(vault, root)),
    generatedAt: new Date().toISOString(),
    nodes: pages.map((page) => ({
      slug: page.slug,
      path: page.relPath,
      type: page.type,
      title: page.title,
      tags: page.tags,
      body: page.body,
      outgoing: extractWikiLinks(page.body).filter((slug) => bySlug.has(slug)),
      backlinks: [...(backlinkMap.get(page.slug) ?? new Set<string>())].sort(),
    })),
    edges,
  };
}

export async function getCompiledKnowledgeGraphOverview(input: { vaultPath?: string; domain?: string } = {}) {
  const graph = await buildCompiledKnowledgeGraph(input);
  const nodes = graph.nodes
    .map((node) => ({ slug: node.slug, path: node.path, type: node.type, title: node.title, degree: node.outgoing.length + node.backlinks.length, outgoing: node.outgoing.length, backlinks: node.backlinks.length }))
    .sort((left, right) => right.degree - left.degree || left.slug.localeCompare(right.slug));
  return {
    domain: graph.domain,
    root: graph.root,
    generatedAt: graph.generatedAt,
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      entities: graph.nodes.filter((node) => node.type === "entity").length,
      concepts: graph.nodes.filter((node) => node.type === "concept").length,
      summaries: graph.nodes.filter((node) => node.type === "summary").length,
      orphans: graph.nodes.filter((node) => node.type !== "summary" && node.backlinks.length === 0).length,
    },
    topHubs: nodes.slice(0, 20),
  };
}

export async function getCompiledKnowledgeNode(input: { vaultPath?: string; domain?: string; slug: string }) {
  const graph = await buildCompiledKnowledgeGraph(input);
  const slug = safeSlug(input.slug);
  const node = graph.nodes.find((item) => item.slug === slug || item.path === input.slug);
  if (!node) throw new Error(`No compiled knowledge node found for "${input.slug}".`);
  return { domain: graph.domain, node };
}

export async function getCompiledKnowledgeBacklinks(input: { vaultPath?: string; domain?: string; slug: string }) {
  const { node } = await getCompiledKnowledgeNode(input);
  return { domain: domainSlug(input.domain), slug: node.slug, backlinks: node.backlinks };
}

export async function searchCompiledKnowledge(input: {
  vaultPath?: string;
  domain?: string;
  query: string;
  limit?: number;
  types?: KnowledgePageKind[];
}): Promise<CompiledKnowledgeSearchResult> {
  const query = input.query?.trim();
  if (!query) throw new Error("Missing compiled knowledge search query.");
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit || 12)), 1), 50);
  const { vault, root, wiki, pages } = await readPages(input.vaultPath, input.domain);
  const allowedTypes = new Set(input.types?.filter(Boolean));
  const queryLower = query.toLowerCase();
  const querySlug = safeSlug(query);
  const terms = searchTermsFromQuery(query);
  const contentMatches = terms.length
    ? await listFilesMatchingTerms({ root: wiki, terms, glob: "*.md", maxResults: 5_000 })
    : null;
  const contentMatchPaths = contentMatches
    ? new Set(contentMatches.map((path) => toPosix(relative(wiki, path))))
    : null;

  const results = pages
    .filter((page) => !allowedTypes.size || allowedTypes.has(page.type))
    .map((page) => {
      const titleLower = page.title.toLowerCase();
      const slugLower = page.slug.toLowerCase();
      const pathLower = page.relPath.toLowerCase();
      const tagsLower = page.tags.map((tag) => tag.toLowerCase());
      const bodyLower = page.body.toLowerCase();
      const matchedFields = new Set<string>();
      let score = 0;

      if (page.slug === querySlug) {
        score += 140;
        matchedFields.add("slug-exact");
      }
      if (titleLower === queryLower) {
        score += 120;
        matchedFields.add("title-exact");
      }
      if (slugLower.includes(querySlug) && querySlug) {
        score += 45;
        matchedFields.add("slug");
      }
      if (titleLower.includes(queryLower)) {
        score += 50;
        matchedFields.add("title");
      }
      if (pathLower.includes(querySlug) && querySlug) {
        score += 18;
        matchedFields.add("path");
      }
      if (contentMatchPaths?.has(page.relPath)) {
        score += 24;
        matchedFields.add("body-rg");
      }

      for (const term of terms) {
        if (slugLower.includes(term)) {
          score += 16;
          matchedFields.add("slug");
        }
        if (titleLower.includes(term)) {
          score += 18;
          matchedFields.add("title");
        }
        if (tagsLower.some((tag) => tag.includes(term))) {
          score += 12;
          matchedFields.add("tags");
        }
        const bodyHits = countOccurrences(bodyLower, term);
        if (bodyHits > 0) {
          score += Math.min(24, bodyHits * 3);
          matchedFields.add(contentMatchPaths ? "body-rg" : "body-walk");
        }
      }

      return {
        slug: page.slug,
        path: page.relPath,
        type: page.type,
        title: page.title,
        score,
        matchedFields: [...matchedFields].sort(),
        snippet: snippetForQuery(page.body, terms.length ? terms : [queryLower]),
        outgoingCount: extractWikiLinks(page.body).length,
      };
    })
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);

  return {
    domain: domainSlug(input.domain),
    root: toPosix(relative(vault, root)),
    generatedAt: new Date().toISOString(),
    query,
    limit,
    searchMode: contentMatchPaths ? "metadata-and-binary" : "metadata-and-walk",
    results,
  };
}

async function readDismissed(root: string) {
  const raw = await readFile(join(root, DISMISSED_FILE), "utf8").catch(() => "");
  return new Set(raw.split("\n").filter(Boolean).map((line) => {
    try {
      const parsed = JSON.parse(line) as { id?: string };
      return parsed.id || "";
    } catch {
      return "";
    }
  }).filter(Boolean));
}

export async function dismissCompiledKnowledgeIssue(input: { vaultPath?: string; domain?: string; issueId: string; reason?: string }) {
  if (!input.issueId?.trim()) throw new Error("Missing issue id.");
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const root = domainRoot(vault, input.domain);
  const path = join(root, DISMISSED_FILE);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ id: input.issueId, reason: input.reason || "dismissed", dismissedAt: new Date().toISOString() })}\n`, "utf8");
  return { ok: true, issueId: input.issueId };
}

export async function scanCompiledKnowledgeHealth(input: { vaultPath?: string; domain?: string } = {}): Promise<CompiledKnowledgeHealth> {
  const { vault, root, pages } = await readPages(input.vaultPath, input.domain);
  const dismissed = await readDismissed(root);
  const bySlug = new Map<string, typeof pages>();
  for (const page of pages) {
    bySlug.set(page.slug, [...(bySlug.get(page.slug) ?? []), page]);
  }
  const graph = await buildCompiledKnowledgeGraph(input);
  const graphNodeBySlug = new Map(graph.nodes.map((node) => [node.slug, node]));
  const issues: CompiledKnowledgeHealthIssue[] = [];

  for (const page of pages) {
    for (const target of extractWikiLinks(page.body)) {
      if (bySlug.has(target)) continue;
      const suggestedTarget = [...bySlug.keys()].find((slug) => slug.replace(/-/g, "") === target.replace(/-/g, ""));
      const id = `broken-link:${page.relPath}:${target}`;
      issues.push({ id, type: "broken-link", severity: suggestedTarget ? "safe" : "review", sourcePath: page.relPath, target, suggestedTarget, message: `${page.relPath} links to missing [[${target}]].` });
    }
  }

  for (const [slug, matchingPages] of bySlug.entries()) {
    if (matchingPages.length > 1) {
      const id = `duplicate-slug:${slug}`;
      issues.push({ id, type: "duplicate-slug", severity: "review", slug, message: `Slug "${slug}" exists in multiple compiled knowledge folders.` });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "summary" && node.backlinks.length === 0) {
      const id = `orphan:${node.path}`;
      issues.push({ id, type: "orphan", severity: "review", sourcePath: node.path, slug: node.slug, message: `${node.path} has no incoming wikilinks.` });
    }
    for (const target of node.outgoing) {
      const targetNode = graphNodeBySlug.get(target);
      if (!targetNode || targetNode.type === "summary" || node.type === "summary") continue;
      if (!targetNode.outgoing.includes(node.slug)) {
        const id = `missing-backlink:${targetNode.path}:${node.slug}`;
        issues.push({ id, type: "missing-backlink", severity: "safe", sourcePath: node.path, targetPath: targetNode.path, slug: node.slug, target, message: `${targetNode.path} should link back to [[${node.slug}]].` });
      }
    }
  }

  const activeIssues = issues.filter((issue) => !dismissed.has(issue.id));
  const countType = (type: CompiledKnowledgeHealthIssue["type"]) => activeIssues.filter((issue) => issue.type === type).length;
  return {
    domain: domainSlug(input.domain),
    root: toPosix(relative(vault, root)),
    generatedAt: new Date().toISOString(),
    counts: {
      pages: pages.length,
      brokenLinks: countType("broken-link"),
      orphans: countType("orphan"),
      duplicateSlugs: countType("duplicate-slug"),
      missingBacklinks: countType("missing-backlink"),
      dismissed: dismissed.size,
    },
    issues: activeIssues,
  };
}

export async function fixCompiledKnowledgeIssue(input: { vaultPath?: string; domain?: string; issueId: string }) {
  if (!input.issueId?.trim()) throw new Error("Missing issue id.");
  const health = await scanCompiledKnowledgeHealth(input);
  const issue = health.issues.find((item) => item.id === input.issueId);
  if (!issue) throw new Error("Issue was not found or has been dismissed.");
  if (issue.severity !== "safe") throw new Error("This issue requires review and cannot be auto-fixed.");
  const vault = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const root = domainRoot(vault, input.domain);
  const wiki = wikiRoot(root);

  if (issue.type === "broken-link" && issue.sourcePath && issue.target && issue.suggestedTarget) {
    const path = join(wiki, issue.sourcePath);
    assertInside(wiki, path);
    const previous = await readFile(path, "utf8");
    const next = previous.replace(new RegExp(`\\[\\[${issue.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\|[^\\]]+)?]]`, "g"), (_match, alias = "") => `[[${issue.suggestedTarget}${alias}]]`);
    if (next !== previous) await writeAtomic(path, next);
    return { ok: true, fixed: issue };
  }

  if (issue.type === "missing-backlink" && issue.targetPath && issue.slug) {
    const path = join(wiki, issue.targetPath);
    assertInside(wiki, path);
    const previous = await readFile(path, "utf8");
    const addition = `- ${wikilink(issue.slug)} — Backlink added by HivemindOS knowledge health.`;
    const next = previous.includes(addition)
      ? previous
      : previous.match(/^## Related$/m)
        ? previous.replace(/^## Related\n/m, `## Related\n${addition}\n`)
        : `${previous.trimEnd()}\n\n## Related\n${addition}\n`;
    if (next !== previous) await writeAtomic(path, next);
    return { ok: true, fixed: issue };
  }

  throw new Error("No safe auto-fix is available for this issue.");
}

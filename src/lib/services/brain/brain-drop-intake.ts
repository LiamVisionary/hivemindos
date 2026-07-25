import { createHash } from "crypto";
import { constants } from "fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { isAbsolute, relative, resolve, sep } from "path";
import { createTask } from "@/lib/services/kanban/local-kanban-store";
import { buildBrainGraph, type BrainGraph } from "@/lib/services/obsidian/brain-graph";
import type { CapturedObsidianNote } from "@/lib/services/obsidian/note-capture";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";

export type BrainDropCategory =
  | "task"
  | "reminder"
  | "idea"
  | "project"
  | "resource"
  | "note"
  | "review";

export type BrainDropConfidence = "high" | "medium" | "low";

export type BrainDropClassification = {
  category: BrainDropCategory;
  confidence: BrainDropConfidence;
  reason: string;
};

export type BrainDropModelClassification = BrainDropClassification & {
  title?: string;
  cleanedContent?: string;
  tags?: string[];
};

type BrainDropRoute = {
  folder: string;
  dateSubfolder: boolean;
  createsTask: boolean;
  sectionTitle: string;
};

export const BRAIN_DROP_ROUTE_MATRIX: Record<BrainDropCategory, BrainDropRoute> = {
  task: {
    folder: `${DEFAULT_SHARED_VAULT.inboxFolder || "Intake"}/Processed`,
    dateSubfolder: true,
    createsTask: true,
    sectionTitle: "Action",
  },
  reminder: {
    folder: `${DEFAULT_SHARED_VAULT.inboxFolder || "Intake"}/Processed`,
    dateSubfolder: true,
    createsTask: true,
    sectionTitle: "Reminder",
  },
  idea: { folder: "Ideas", dateSubfolder: false, createsTask: false, sectionTitle: "Idea" },
  project: { folder: "Projects", dateSubfolder: false, createsTask: false, sectionTitle: "Project" },
  resource: {
    folder: "Memory/Imported Sources",
    dateSubfolder: false,
    createsTask: false,
    sectionTitle: "Resource",
  },
  note: { folder: "Memory/Brain Drops", dateSubfolder: false, createsTask: false, sectionTitle: "Note" },
  review: {
    folder: `${DEFAULT_SHARED_VAULT.inboxFolder || "Intake"}/Review`,
    dateSubfolder: true,
    createsTask: false,
    sectionTitle: "Needs review",
  },
};

export type ProcessBrainDropCaptureInput = {
  vaultPath?: string | null;
  capture: CapturedObsidianNote;
  content: string;
  source?: string | null;
  inputTags?: string[] | null;
  now?: Date;
  classifyWithModel?: (content: string) => Promise<BrainDropModelClassification>;
  /**
   * Batch callers pass one graph for every capture so a 20-capture tick does
   * not force 20 full vault scans. Single interactive captures omit it and
   * keep the fresh forced build.
   */
  prebuiltGraph?: BrainGraph;
};

export type BrainDropProcessingResult = {
  brainDropId: string;
  category: BrainDropCategory;
  confidence: BrainDropConfidence;
  reason: string;
  title: string;
  routedNotePath: string;
  relatedNotePaths: string[];
  taskId?: string;
  created: boolean;
};

const RECEIPTS_FOLDER = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Brain Drop/Receipts`;
const MAX_CAPTURE_CHARS = 100_000;
const MAX_PENDING_CAPTURES = 20;
const MAX_PENDING_SCAN_FILES = 500;
const VALID_CATEGORIES = new Set<BrainDropCategory>(Object.keys(BRAIN_DROP_ROUTE_MATRIX) as BrainDropCategory[]);
const VALID_CONFIDENCES = new Set<BrainDropConfidence>(["high", "medium", "low"]);
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "but", "can", "for", "from", "have", "into", "just",
  "make", "more", "not", "our", "that", "the", "their", "then", "there", "this", "to", "was", "what", "when",
  "with", "would", "you", "your", "add", "save", "create", "something",
]);

function assertInside(root: string, path: string) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Brain Drop path escaped the selected vault.");
  }
}

function toVaultPath(root: string, path: string) {
  return relative(root, path).split(sep).join("/");
}

function withoutMarkdownExtension(path: string) {
  return path.replace(/\.md$/i, "");
}

function yamlScalar(value: string) {
  return JSON.stringify(value);
}

function stableId(notePath: string, content: string) {
  return createHash("sha256").update(notePath).update("\0").update(content, "utf8").digest("hex").slice(0, 24);
}

function filenameSlug(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "brain-drop";
}

function normalizeSpeechText(value: string) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*(?:capture (?:this|that)|remember (?:this|that)|quick note|note to self)\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:idea|task|todo|to-do|reminder|resource|project idea)\s*:\s*/i, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Untitled brain drop.";
  const capitalized = normalized[0].toUpperCase() + normalized.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function titleFromContent(value: string) {
  return value.replace(/^[-*]\s*\[[ xX]\]\s*/, "").replace(/[.!?]+$/, "").trim().slice(0, 80) || "Untitled brain drop";
}

export function classifyBrainDropCapture(content: string): BrainDropClassification {
  const text = content.replace(/^---[\s\S]*?---/, "").replace(/^#+\s+/gm, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (/https?:\/\/\S+|\b(?:resource|reference|article|book|podcast|read later|save this link)\b/.test(text)) {
    return { category: "resource", confidence: "high", reason: "resource-language" };
  }
  if (/\b(?:remind me|reminder|due (?:on|by|tomorrow|today)|tomorrow at|next (?:monday|tuesday|wednesday|thursday|friday|week))\b/.test(text)) {
    return { category: "reminder", confidence: "high", reason: "time-bound-action" };
  }
  if (/^(?:please\s+)?(?:add|buy|call|email|send|pay|schedule|book|fix|finish|update|review|write|order|pick up|submit|cancel|renew|check)\b/.test(text)
      || /\b(?:todo|to-do|grocery list|shopping list|need to)\b/.test(text)) {
    return { category: "task", confidence: "high", reason: "action-language" };
  }
  if (/\b(?:project idea|new project|start (?:a |the )?project|launch (?:a |the )?|multi-step|roadmap)\b/.test(text)) {
    return { category: "project", confidence: "high", reason: "project-language" };
  }
  if (/\b(?:idea|what if|could we|we could|concept|maybe we should)\b/.test(text)) {
    return { category: "idea", confidence: "high", reason: "idea-language" };
  }
  if (/\b(?:remember that|note that|observation|journal)\b/.test(text)) {
    return { category: "note", confidence: "high", reason: "note-language" };
  }
  return { category: "review", confidence: "low", reason: "ambiguous" };
}

function safeTag(value: string) {
  return value.trim().toLowerCase().replace(/^#+/, "");
}

function tagsFor(category: BrainDropCategory, source: string, inputTags?: string[] | null, modelTags?: string[]) {
  const sourceSlug = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const values = [
    "brain-drop",
    `brain-drop/${category}`,
    ...(inputTags ?? []),
    ...(sourceSlug ? [`source/${sourceSlug}`] : []),
    ...(modelTags ?? []),
  ]
    .map(safeTag)
    .filter((tag) => tag && tag.length <= 64 && /^[a-z0-9/_-]+$/.test(tag));
  return [...new Set(values)].slice(0, 16);
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

async function relatedNotePaths(vaultPath: string, content: string, sourceNotePath: string, prebuiltGraph?: BrainGraph) {
  const captureTokens = tokens(content);
  if (captureTokens.size === 0) return [];
  const graph = prebuiltGraph ?? await buildBrainGraph(vaultPath, { force: true });
  return graph.nodes
    .filter((node) => {
      if (node.id.startsWith("unresolved:") || node.id === sourceNotePath) return false;
      return !node.id.startsWith(`${BRAIN_DROP_ROUTE_MATRIX.task.folder}/`)
        && !node.id.startsWith(`${BRAIN_DROP_ROUTE_MATRIX.review.folder}/`);
    })
    .map((node) => {
      const nodeTokens = tokens(`${node.label} ${node.tags.join(" ")} ${node.preview ?? ""}`);
      const overlap = [...captureTokens].filter((token) => nodeTokens.has(token));
      const labelTokens = tokens(node.label);
      const labelMatches = overlap.filter((token) => labelTokens.has(token)).length;
      return { path: node.id, score: overlap.length + labelMatches };
    })
    .filter((match) => match.score >= 2)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 4)
    .map((match) => match.path);
}

function normalizeModelClassification(value: BrainDropModelClassification): BrainDropModelClassification | null {
  if (!VALID_CATEGORIES.has(value.category) || !VALID_CONFIDENCES.has(value.confidence)) return null;
  const category = value.confidence === "low" ? "review" : value.category;
  return {
    category,
    confidence: category === "review" ? "low" : value.confidence,
    reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim().slice(0, 120) : "model-classification",
    title: typeof value.title === "string" ? value.title.trim().slice(0, 80) : undefined,
    cleanedContent: typeof value.cleanedContent === "string" ? value.cleanedContent.trim().slice(0, MAX_CAPTURE_CHARS) : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
  };
}

async function defaultModelClassifier(content: string) {
  const { classifyBrainDropWithModel } = await import("@/lib/services/brain/brain-drop-intake-model");
  return classifyBrainDropWithModel(content);
}

function routePath(category: BrainDropCategory, title: string, createdAt: string, brainDropId: string) {
  const route = BRAIN_DROP_ROUTE_MATRIX[category];
  const date = createdAt.slice(0, 10);
  const folder = route.dateSubfolder ? `${route.folder}/${date}` : route.folder;
  return `${folder}/${date}-${filenameSlug(title)}-${brainDropId.slice(0, 8)}.md`;
}

function routedMarkdown(input: {
  brainDropId: string;
  category: BrainDropCategory;
  confidence: BrainDropConfidence;
  reason: string;
  title: string;
  cleanedContent: string;
  source: string;
  sourceNotePath: string;
  createdAt: string;
  processedAt: string;
  tags: string[];
  relatedPaths: string[];
}) {
  const route = BRAIN_DROP_ROUTE_MATRIX[input.category];
  const sourceLink = withoutMarkdownExtension(input.sourceNotePath);
  const body = route.createsTask ? `- [ ] ${input.cleanedContent}` : input.cleanedContent;
  return [
    "---",
    `type: ${yamlScalar("brain-drop")}`,
    `brain_drop_id: ${yamlScalar(input.brainDropId)}`,
    `category: ${yamlScalar(input.category)}`,
    `status: ${yamlScalar(input.category === "review" ? "needs-review" : "processed")}`,
    `confidence: ${yamlScalar(input.confidence)}`,
    `classification_reason: ${yamlScalar(input.reason)}`,
    `created: ${yamlScalar(input.createdAt)}`,
    `processed: ${yamlScalar(input.processedAt)}`,
    `source: ${yamlScalar(input.source)}`,
    `source_note: ${yamlScalar(input.sourceNotePath)}`,
    `tags: [${input.tags.map(yamlScalar).join(", ")}]`,
    "---",
    "",
    `# ${input.title}`,
    "",
    `## ${route.sectionTitle}`,
    "",
    body,
    "",
    ...(input.relatedPaths.length
      ? ["## Related", "", ...input.relatedPaths.map((path) => `- [[${withoutMarkdownExtension(path)}]]`), ""]
      : []),
    "## Source",
    "",
    `- [[${sourceLink}|Raw capture]]`,
    "",
  ].join("\n");
}

function receiptFile(root: string, brainDropId: string) {
  const path = resolve(root, RECEIPTS_FOLDER, `${brainDropId}.json`);
  assertInside(root, path);
  return path;
}

async function readReceipt(root: string, brainDropId: string): Promise<BrainDropProcessingResult | null> {
  const raw = await readFile(receiptFile(root, brainDropId), "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as BrainDropProcessingResult;
    return value.brainDropId === brainDropId && VALID_CATEGORIES.has(value.category) ? value : null;
  } catch {
    return null;
  }
}

async function writeRoutedNote(root: string, notePath: string, markdown: string, brainDropId: string) {
  const file = resolve(root, notePath);
  assertInside(root, file);
  await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 });
  try {
    await writeFile(file, markdown, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(file, "utf8");
    if (!existing.includes(`brain_drop_id: ${yamlScalar(brainDropId)}`)) {
      throw new Error("Brain Drop route collided with an unrelated note.");
    }
  }
}

export async function processBrainDropCapture(input: ProcessBrainDropCaptureInput): Promise<BrainDropProcessingResult> {
  const content = input.content.replace(/\r\n?/g, "\n").trim();
  if (!content) throw new Error("Brain Drop content is required.");
  if (content.length > MAX_CAPTURE_CHARS) throw new Error("Brain Drop content is too large.");
  const root = resolveObsidianVaultPath(input.vaultPath ?? input.capture.vaultPath, { requireWritable: true });
  await access(root, constants.R_OK | constants.W_OK);
  const brainDropId = stableId(input.capture.notePath, content);
  const existingReceipt = await readReceipt(root, brainDropId);
  if (existingReceipt) return { ...existingReceipt, created: false };

  const deterministic = classifyBrainDropCapture(content);
  let classification: BrainDropModelClassification = deterministic;
  if (deterministic.category === "review") {
    try {
      const modelValue = await (input.classifyWithModel ?? defaultModelClassifier)(content);
      classification = normalizeModelClassification(modelValue) ?? deterministic;
    } catch {
      classification = deterministic;
    }
  }

  const cleanedContent = normalizeSpeechText(classification.cleanedContent || content);
  const modelTitle = classification.title?.replace(/\s+/g, " ").trim().slice(0, 80);
  const title = (modelTitle || titleFromContent(cleanedContent)).replace(/[.!?]+$/, "");
  const processedAt = (input.now ?? new Date()).toISOString();
  const createdAt = input.capture.createdAt || processedAt;
  const source = input.source?.trim() || "brain-drop";
  const relatedPaths = await relatedNotePaths(root, cleanedContent, input.capture.notePath, input.prebuiltGraph);
  const notePath = routePath(classification.category, title, createdAt, brainDropId);
  const tags = tagsFor(classification.category, source, input.inputTags, classification.tags);
  await writeRoutedNote(root, notePath, routedMarkdown({
    brainDropId,
    category: classification.category,
    confidence: classification.confidence,
    reason: classification.reason,
    title,
    cleanedContent,
    source,
    sourceNotePath: input.capture.notePath,
    createdAt,
    processedAt,
    tags,
    relatedPaths,
  }), brainDropId);

  let taskId: string | undefined;
  if (BRAIN_DROP_ROUTE_MATRIX[classification.category].createsTask) {
    const related = relatedPaths.map((path) => `- [[${withoutMarkdownExtension(path)}]]`).join("\n");
    const taskResult = await createTask(null, {
      title,
      body: [`Source: [[${withoutMarkdownExtension(notePath)}]]`, related].filter(Boolean).join("\n\n"),
      tenant: "brain-drop",
      status: "ideas",
      workspace: "dir:notes",
      skills: ["notes"],
      source: `brain-drop:${brainDropId}`,
      idempotencyKey: `brain-drop-${brainDropId}`,
    }, { vaultPath: root });
    taskId = taskResult.task.id;
  }

  const result: BrainDropProcessingResult = {
    brainDropId,
    category: classification.category,
    confidence: classification.confidence,
    reason: classification.reason,
    title,
    routedNotePath: notePath,
    relatedNotePaths: relatedPaths,
    ...(taskId ? { taskId } : {}),
    created: true,
  };
  const receipt = receiptFile(root, brainDropId);
  await mkdir(resolve(receipt, ".."), { recursive: true, mode: 0o700 });
  await writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  return result;
}

function captureBody(markdown: string) {
  return markdown
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "")
    .replace(/^#\s+[^\n]+\n+/, "")
    .trim();
}

function frontmatterValue(markdown: string, key: string) {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return "";
  try {
    const parsed = JSON.parse(match[1]);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return match[1].trim().replace(/^['"]|['"]$/g, "");
  }
}

function frontmatterTags(markdown: string) {
  const match = markdown.match(/^tags:\s*\[(.*)]\s*$/m);
  if (!match) return [];
  try {
    const parsed = JSON.parse(`[${match[1]}]`);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

async function walkPendingMarkdown(root: string, folder: string, output: string[]) {
  const dir = resolve(root, folder);
  assertInside(root, dir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (output.length >= MAX_PENDING_SCAN_FILES) return;
    if (entry.name.startsWith(".") || /sync-conflict/i.test(entry.name)) continue;
    const fullPath = resolve(dir, entry.name);
    assertInside(root, fullPath);
    if (entry.isDirectory()) {
      if (entry.name === "Processed" || entry.name === "Review") continue;
      await walkPendingMarkdown(root, toVaultPath(root, fullPath), output);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      output.push(fullPath);
    }
  }
}

export async function processPendingBrainDropInbox(input: {
  vaultPath?: string | null;
  now?: Date;
  limit?: number;
  classifyWithModel?: (content: string) => Promise<BrainDropModelClassification>;
}) {
  const root = resolveObsidianVaultPath(input.vaultPath ?? undefined, { requireWritable: true });
  const paths: string[] = [];
  for (const folder of [DEFAULT_SHARED_VAULT.inboxFolder || "Intake", "Inbox"]) {
    await walkPendingMarkdown(root, folder, paths);
  }
  const results: BrainDropProcessingResult[] = [];
  let skipped = 0;
  const limit = Math.max(1, Math.min(input.limit ?? MAX_PENDING_CAPTURES, MAX_PENDING_CAPTURES));
  // One forced graph build serves the whole batch (built lazily so an empty
  // inbox tick never scans the vault). Notes routed earlier in the same batch
  // are not in this graph, so intra-batch captures cannot relate to each
  // other's routed notes until the next batch — acceptable for related-note
  // hints, and far cheaper than a forced full vault scan per capture.
  let batchGraph: BrainGraph | undefined;
  for (const fullPath of [...new Set(paths)].sort().reverse()) {
    const markdown = await readFile(fullPath, "utf8");
    const content = captureBody(markdown);
    if (!content) {
      skipped += 1;
      continue;
    }
    const notePath = toVaultPath(root, fullPath);
    const brainDropId = stableId(notePath, content);
    if (await readReceipt(root, brainDropId)) {
      skipped += 1;
      continue;
    }
    if (results.length >= limit) break;
    batchGraph ??= await buildBrainGraph(root, { force: true });
    const fileStat = await stat(fullPath);
    // An injected clock must also govern the undated-note fallback, or replays
    // under a frozen `now` route notes by the real file mtime instead.
    const createdAt = frontmatterValue(markdown, "created")
      || (input.now ?? fileStat.mtime).toISOString();
    const result = await processBrainDropCapture({
      vaultPath: root,
      capture: {
        vaultPath: root,
        notePath,
        title: titleFromContent(content),
        createdAt,
        created: true,
      },
      content,
      source: frontmatterValue(markdown, "source") || "vault-inbox",
      inputTags: frontmatterTags(markdown),
      now: input.now,
      classifyWithModel: input.classifyWithModel,
      prebuiltGraph: batchGraph,
    });
    results.push(result);
  }
  return { processed: results.length, skipped, results };
}

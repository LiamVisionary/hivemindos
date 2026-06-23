import "server-only";

import { randomUUID } from "crypto";
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";
import type { ContextIndexItem } from "@/lib/services/context-index";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import {
  CONTEXT_XRAY_SOURCE_KINDS,
  CONTEXT_XRAY_SOURCE_STATUSES,
  type ContextXrayCreateInput,
  type ContextXrayListFilter,
  type ContextXrayManifest,
  type ContextXraySource,
  type ContextXraySourceKind,
  type ContextXraySourceStatus,
} from "@/lib/types/context-xray";

const CONTEXT_XRAY_FILE = join(homedir(), ".hivemindos", "context-xray.jsonl");
const MAX_SOURCES = 120;
const MAX_STRING_LENGTH = 1_000;
const MAX_SNIPPET_LENGTH = 2_000;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;

let contextXrayWriteQueue: Promise<unknown> = Promise.resolve();

export async function createContextXrayManifest(input: ContextXrayCreateInput) {
  const sources = normalizeSources(input.sources);
  const manifest: ContextXrayManifest = {
    id: `xray_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    runId: cleanString(input.runId),
    threadId: cleanString(input.threadId),
    createdAt: new Date().toISOString(),
    model: redactString(input.model).text,
    totalEstimatedTokens: sources.reduce((sum, source) => sum + source.tokenEstimate, 0),
    sources,
    redactedLabels: uniqueLabels(sources.flatMap((source) => source.redactedLabels ?? [])),
  };
  return enqueueContextXrayWrite(async () => {
    await mkdir(dirname(CONTEXT_XRAY_FILE), { recursive: true, mode: 0o700 });
    await appendFile(CONTEXT_XRAY_FILE, `${JSON.stringify(manifest)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    return manifest;
  });
}

export async function createContextXrayManifestFromContextIndex(input: {
  runId?: unknown;
  threadId?: unknown;
  model?: unknown;
  query?: unknown;
  items?: ContextIndexItem[];
}) {
  const query = cleanString(input.query, 500);
  return createContextXrayManifest({
    runId: input.runId,
    threadId: input.threadId,
    model: input.model,
    sources: (input.items ?? []).map((item, index) => ({
      id: item.id || `context-index-${index + 1}`,
      kind: contextIndexKindToXrayKind(item.kind),
      title: item.title,
      path: item.path,
      route: item.route,
      tokenEstimate: estimateTokens([
        item.title,
        item.summary,
        item.retrievalText,
        item.load?.note,
      ].filter(Boolean).join("\n")),
      status: "active",
      reason: [
        query ? `Matched context-index query: ${query}` : "Returned by context-index search.",
        typeof item.score === "number" ? `score ${Math.round(item.score)}` : "",
        item.methods?.length ? `methods ${item.methods.join(", ")}` : "",
      ].filter(Boolean).join("; "),
      snippet: item.summary || item.retrievalText,
    })),
  });
}

export async function listContextXrayManifests(filter: ContextXrayListFilter = {}) {
  const limit = normalizeLimit(filter.limit);
  const runId = cleanString(filter.runId);
  const threadId = cleanString(filter.threadId);
  const manifests = (await readContextXrayManifests())
    .filter((manifest) => !runId || manifest.runId === runId)
    .filter((manifest) => !threadId || manifest.threadId === threadId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
  return { manifests, updatedAt: manifests[0]?.createdAt ?? new Date(0).toISOString() };
}

export async function getContextXrayManifest(id: string) {
  const cleanId = cleanString(id);
  if (!cleanId) throw new Error("Context X-Ray manifest id is required.");
  const manifest = (await readContextXrayManifests()).find((item) => item.id === cleanId);
  if (!manifest) throw new Error("Context X-Ray manifest not found.");
  return manifest;
}

async function readContextXrayManifests() {
  try {
    const raw = await readFile(CONTEXT_XRAY_FILE, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseManifestLine)
      .filter((manifest): manifest is ContextXrayManifest => Boolean(manifest));
  } catch {
    return [];
  }
}

function parseManifestLine(line: string) {
  try {
    return normalizeStoredManifest(JSON.parse(line) as unknown);
  } catch {
    return null;
  }
}

function normalizeStoredManifest(value: unknown): ContextXrayManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<ContextXrayManifest>;
  const id = cleanString(item.id);
  const createdAt = cleanString(item.createdAt);
  if (!id || !createdAt) return null;
  const sources = normalizeSources(item.sources);
  return {
    id,
    runId: cleanString(item.runId),
    threadId: cleanString(item.threadId),
    createdAt,
    model: redactString(item.model).text,
    totalEstimatedTokens: sources.reduce((sum, source) => sum + source.tokenEstimate, 0),
    sources,
    redactedLabels: uniqueLabels([
      ...cleanStringList(item.redactedLabels),
      ...sources.flatMap((source) => source.redactedLabels ?? []),
    ]),
  };
}

function normalizeSources(value: unknown): ContextXraySource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSource)
    .filter((source): source is ContextXraySource => Boolean(source))
    .slice(0, MAX_SOURCES);
}

function normalizeSource(value: unknown, index: number): ContextXraySource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<ContextXraySource>;
  const title = redactString(item.title).text || "Untitled context source";
  const reason = redactString(item.reason).text;
  const snippet = redactString(item.snippet, MAX_SNIPPET_LENGTH).text;
  const path = redactString(item.path).text;
  const route = normalizeRoute(redactString(item.route).text);
  const redactedLabels = uniqueLabels([
    ...redactString(item.title).labels,
    ...redactString(item.reason).labels,
    ...redactString(item.snippet, MAX_SNIPPET_LENGTH).labels,
    ...redactString(item.path).labels,
    ...redactString(item.route).labels,
  ]);
  const tokenEstimate = normalizeTokenEstimate(item.tokenEstimate)
    ?? estimateTokens([title, reason, snippet].filter(Boolean).join("\n"));
  return {
    id: cleanString(item.id) || `source_${index + 1}`,
    kind: normalizeKind(item.kind),
    title,
    path,
    route,
    tokenEstimate,
    status: normalizeStatus(item.status),
    reason,
    snippet,
    redactedLabels: redactedLabels.length ? redactedLabels : undefined,
  };
}

function normalizeKind(value: unknown): ContextXraySourceKind {
  return CONTEXT_XRAY_SOURCE_KINDS.includes(value as ContextXraySourceKind)
    ? (value as ContextXraySourceKind)
    : "file";
}

function contextIndexKindToXrayKind(kind: ContextIndexItem["kind"]): ContextXraySourceKind {
  if (kind === "skill") return "skill";
  if (kind === "tool-schema") return "tool";
  if (kind === "api-route" || kind === "app-endpoint") return "api-route";
  if (kind === "workspace-file" || kind === "doc") return "workspace-file";
  if (kind === "connected-app" || kind === "runtime") return "tool";
  return "file";
}

function normalizeStatus(value: unknown): ContextXraySourceStatus {
  return CONTEXT_XRAY_SOURCE_STATUSES.includes(value as ContextXraySourceStatus)
    ? (value as ContextXraySourceStatus)
    : "active";
}

function normalizeRoute(value?: string) {
  if (!value || !value.startsWith("/") || /[\0\r\n]/.test(value) || /^[a-z]+:\/\//i.test(value)) {
    return undefined;
  }
  return value.length <= MAX_STRING_LENGTH ? value : undefined;
}

function normalizeTokenEstimate(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.trunc(value));
}

function normalizeLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIST_LIMIT;
  return Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(numeric)));
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function redactString(value: unknown, maxLength = MAX_STRING_LENGTH) {
  const text = cleanString(value, maxLength);
  if (!text) return { text: undefined, labels: [] as string[] };
  const redacted = redactSecretText(text.slice(0, maxLength));
  return {
    text: redacted.text || undefined,
    labels: redacted.redactedLabels,
  };
}

function cleanString(value: unknown, maxLength = MAX_STRING_LENGTH) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/[\0\r\n]+/g, " ");
  return text ? text.slice(0, maxLength) : undefined;
}

function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter((item): item is string => Boolean(item));
}

function uniqueLabels(values: string[]) {
  return [...new Set(values.filter(Boolean))].slice(0, 20);
}

function enqueueContextXrayWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = contextXrayWriteQueue.catch(() => undefined).then(operation);
  contextXrayWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

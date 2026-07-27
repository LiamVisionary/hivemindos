import "server-only";

import { randomUUID } from "crypto";
import { appendFile, mkdir, readFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "@/lib/home-dir";
import type { ContextIndexItem } from "@/lib/services/context-index";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import {
  CONTEXT_XRAY_LIFECYCLE_STAGES,
  CONTEXT_XRAY_SOURCE_KINDS,
  CONTEXT_XRAY_SOURCE_STATUSES,
  type ContextXrayCreateInput,
  type ContextXrayEvidenceEvent,
  type ContextXrayEvidenceInput,
  type ContextXrayLifecycle,
  type ContextXrayLifecycleStage,
  type ContextXrayListFilter,
  type ContextXrayManifest,
  type ContextXraySource,
  type ContextXraySourceKind,
  type ContextXraySourceStatus,
} from "@/lib/types/context-xray";

const CONTEXT_XRAY_FILE = join(homedir(), ".hivemindos", "context-xray.jsonl");
const CONTEXT_XRAY_EVIDENCE_FILE = join(homedir(), ".hivemindos", "context-xray-evidence.jsonl");
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

export async function recordContextXrayEvidence(input: ContextXrayEvidenceInput) {
  const runId = cleanString(input.runId);
  const sourceId = cleanString(input.sourceId);
  const stage = normalizeLifecycleStage(input.stage);
  const evidence = redactString(input.evidence, MAX_SNIPPET_LENGTH).text;
  if (!runId || !sourceId || !evidence) throw new Error("Context X-Ray evidence requires runId, sourceId, stage, and evidence.");
  const createdAt = normalizeIsoDate(input.createdAt) ?? new Date().toISOString();
  const event: ContextXrayEvidenceEvent = {
    id: `xray_evidence_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    runId,
    sourceId,
    stage,
    evidence,
    createdAt,
  };
  return enqueueContextXrayWrite(async () => {
    await mkdir(dirname(CONTEXT_XRAY_EVIDENCE_FILE), { recursive: true, mode: 0o700 });
    await appendFile(CONTEXT_XRAY_EVIDENCE_FILE, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
    return event;
  });
}

export async function recordContextXrayCapabilityUse(input: {
  runId: string;
  rawArguments: string | Record<string, unknown>;
  invoked: boolean;
  ok: boolean;
  target?: string;
}) {
  if (!input.invoked) return null;
  const sourceId = contextSourceIdForCapabilityCall(input.rawArguments);
  if (!sourceId) return null;
  return recordContextXrayEvidence({
    runId: input.runId,
    sourceId,
    stage: "invoked",
    evidence: `${input.ok ? "Completed" : "Attempted"} ${input.target || sourceId} through invoke_hive_capability.`,
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
  const retrievedAt = new Date().toISOString();
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
      lifecycle: {
        availableAt: retrievedAt,
        retrievedAt,
        evidence: ["Available in the context index.", "Returned by the task retrieval query and injected into the run context."],
      },
    })),
  });
}

export async function listContextXrayManifests(filter: ContextXrayListFilter = {}) {
  const limit = normalizeLimit(filter.limit);
  const runId = cleanString(filter.runId);
  const threadId = cleanString(filter.threadId);
  const [stored, evidence] = await Promise.all([readContextXrayManifests(), readContextXrayEvidence()]);
  const manifests = stored
    .filter((manifest) => !runId || manifest.runId === runId)
    .filter((manifest) => !threadId || manifest.threadId === threadId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((manifest) => applyEvidenceEvents(manifest, evidence));
  return { manifests, updatedAt: manifests[0]?.createdAt ?? new Date(0).toISOString() };
}

export async function getContextXrayManifest(id: string) {
  const cleanId = cleanString(id);
  if (!cleanId) throw new Error("Context X-Ray manifest id is required.");
  const [stored, evidence] = await Promise.all([readContextXrayManifests(), readContextXrayEvidence()]);
  const manifest = stored.find((item) => item.id === cleanId);
  if (!manifest) throw new Error("Context X-Ray manifest not found.");
  return applyEvidenceEvents(manifest, evidence);
}

async function readContextXrayEvidence() {
  const raw = await readFile(CONTEXT_XRAY_EVIDENCE_FILE, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeEvidenceEvent(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((event): event is ContextXrayEvidenceEvent => Boolean(event));
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
    lifecycle: normalizeLifecycle(item.lifecycle),
  };
}

function applyEvidenceEvents(manifest: ContextXrayManifest, events: ContextXrayEvidenceEvent[]): ContextXrayManifest {
  const matching = events.filter((event) => event.runId === manifest.runId);
  if (!matching.length) return manifest;
  return {
    ...manifest,
    sources: manifest.sources.map((source) => {
      const sourceEvents = matching.filter((event) => event.sourceId === source.id);
      if (!sourceEvents.length) return source;
      const lifecycle = { ...(source.lifecycle ?? {}) };
      const evidence = [...(lifecycle.evidence ?? [])];
      for (const event of sourceEvents) {
        if (event.stage === "available") lifecycle.availableAt = event.createdAt;
        if (event.stage === "retrieved") lifecycle.retrievedAt = event.createdAt;
        if (event.stage === "invoked") lifecycle.invokedAt = event.createdAt;
        if (event.stage === "relevant") lifecycle.relevantAt = event.createdAt;
        evidence.push(event.evidence);
      }
      lifecycle.evidence = uniqueLabels(evidence);
      return { ...source, lifecycle };
    }),
  };
}

function contextSourceIdForCapabilityCall(raw: string | Record<string, unknown>) {
  let input: Record<string, unknown>;
  try {
    input = typeof raw === "string" ? JSON.parse(raw || "{}") as Record<string, unknown> : raw;
  } catch {
    return "";
  }
  const surface = cleanString(input.surface)?.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (surface === "hive_action") {
    const id = cleanString(input.capabilityId)?.replace(/^hive-action:/i, "");
    return id ? `hive-action:${id}` : "";
  }
  if (surface === "connected_app") {
    const id = cleanString(input.appId) || cleanString(input.serviceKind);
    return id ? `connected-app:${id}` : "";
  }
  if (surface === "mcp") {
    const id = cleanString(input.serverId);
    return id ? `mcp-catalog:${id}` : "";
  }
  return "";
}

function normalizeLifecycle(value: unknown): ContextXrayLifecycle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Partial<ContextXrayLifecycle>;
  const lifecycle: ContextXrayLifecycle = {
    availableAt: normalizeIsoDate(input.availableAt),
    retrievedAt: normalizeIsoDate(input.retrievedAt),
    invokedAt: normalizeIsoDate(input.invokedAt),
    relevantAt: normalizeIsoDate(input.relevantAt),
    evidence: uniqueLabels(cleanStringList(input.evidence)),
  };
  return lifecycle.availableAt || lifecycle.retrievedAt || lifecycle.invokedAt || lifecycle.relevantAt || lifecycle.evidence?.length
    ? lifecycle
    : undefined;
}

function normalizeEvidenceEvent(value: unknown): ContextXrayEvidenceEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<ContextXrayEvidenceEvent>;
  const id = cleanString(input.id);
  const runId = cleanString(input.runId);
  const sourceId = cleanString(input.sourceId);
  const evidence = redactString(input.evidence, MAX_SNIPPET_LENGTH).text;
  const stage = normalizeLifecycleStage(input.stage);
  const createdAt = normalizeIsoDate(input.createdAt);
  return id && runId && sourceId && evidence && createdAt ? { id, runId, sourceId, evidence, stage, createdAt } : null;
}

function normalizeLifecycleStage(value: unknown): ContextXrayLifecycleStage {
  if (CONTEXT_XRAY_LIFECYCLE_STAGES.includes(value as ContextXrayLifecycleStage)) return value as ContextXrayLifecycleStage;
  throw new Error("Context X-Ray lifecycle stage must be available, retrieved, invoked, or relevant.");
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
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
  if (kind === "connected-app" || kind === "connector" || kind === "runtime") return "tool";
  if (kind === "artifact") return "workspace-file";
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

import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import { homedir } from "@/lib/home-dir";
import { join } from "path";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { syncConversationNoteForSession } from "@/lib/services/obsidian/conversation-notes";
import type { ChatResponseBilling } from "@/lib/types/chat-billing";

export type RuntimeChatSessionMessage = {
  index: number;
  role: string;
  content: string;
  createdAt: number;
  type?: string;
  raw?: unknown;
  billing?: ChatResponseBilling;
  applicationGeneration?: RuntimeApplicationGeneration;
};

export type RuntimeApplicationGeneration = {
  id: string;
  kind: string;
  prompt: string;
  status: string;
  [key: string]: unknown;
};

export type RuntimeChatSessionRecord = {
  id: string;
  sessionId: string;
  runtime: string;
  source: "hivemindos-chat";
  agentId: string;
  agentName: string;
  chatStorageKey?: string;
  sharedVaultPath?: string;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  endReason?: string;
  messages: RuntimeChatSessionMessage[];
};

type StartRuntimeChatSessionOptions = {
  sessionId: string;
  agent: AgentProfile;
  chatStorageKey?: string;
  sharedVaultPath?: string;
  userContent: string;
  startedAt?: number;
};

type RuntimeSessionQuery = {
  sessionId?: string;
  runtime?: string;
  agentId?: string;
  chatStorageKey?: string;
  sinceMs?: number;
};

const SESSION_DIR = join(homedir(), ".hivemindos", "chat-runtime-sessions");
const MAX_SESSION_FALLBACK_FILES = 80;

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 160) || "session";
}

function sessionPath(sessionId: string) {
  return join(SESSION_DIR, `${safeFileName(sessionId)}.json`);
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const entry = part as { type?: string; text?: string; image_url?: { url?: string }; file?: { filename?: string } };
    if (entry.type === "text") return entry.text ?? "";
    if (entry.type === "image_url") return entry.image_url?.url ? "[image attachment]" : "";
    if (entry.type === "file") return entry.file?.filename ? `[file attachment: ${entry.file.filename}]` : "[file attachment]";
    return "";
  }).filter(Boolean).join("\n");
}

async function ensureSessionDir() {
  await mkdir(SESSION_DIR, { recursive: true });
}

async function readSessionFile(path: string): Promise<RuntimeChatSessionRecord | null> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RuntimeChatSessionRecord;
    if (!parsed?.sessionId || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeSession(session: RuntimeChatSessionRecord) {
  await ensureSessionDir();
  await writeFile(sessionPath(session.sessionId), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export function createRuntimeChatSessionId(agent: AgentProfile, fallback?: string) {
  const trimmed = fallback?.trim();
  if (trimmed) return trimmed;
  return [
    "hive-chat",
    safeFileName(agent.runtime || "runtime"),
    safeFileName(agent.id || agent.agentId || agent.name || "agent"),
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8),
  ].join("-");
}

export async function startRuntimeChatSession(options: StartRuntimeChatSessionOptions) {
  const startedAt = options.startedAt ?? Date.now();
  const existing = await readSessionFile(sessionPath(options.sessionId));
  const userContent = stringifyContent(options.userContent);
  const session: RuntimeChatSessionRecord = existing ?? {
    id: options.sessionId,
    sessionId: options.sessionId,
    runtime: options.agent.runtime || "unknown",
    source: "hivemindos-chat",
    agentId: options.agent.id || options.agent.agentId || "",
    agentName: options.agent.name || options.agent.id || options.agent.runtime || "Agent",
    chatStorageKey: options.chatStorageKey,
    startedAt,
    updatedAt: startedAt,
    messages: [],
  };
  session.runtime = options.agent.runtime || session.runtime;
  session.agentId = options.agent.id || options.agent.agentId || session.agentId;
  session.agentName = options.agent.name || session.agentName;
  session.chatStorageKey = options.chatStorageKey || session.chatStorageKey;
  session.sharedVaultPath = options.sharedVaultPath || session.sharedVaultPath;
  session.updatedAt = Date.now();
  session.endedAt = undefined;
  session.endReason = undefined;
  if (userContent && !session.messages.some((message) => message.role === "user" && message.content === userContent)) {
    session.messages.push({
      index: session.messages.length,
      role: "user",
      content: userContent,
      createdAt: startedAt,
    });
  }
  await writeSession(session);
  return session;
}

export async function appendRuntimeChatSessionText(sessionId: string, role: "assistant" | "tool" | "system", content: string, raw?: unknown, options?: { billing?: ChatResponseBilling }) {
  if (!content) return;
  const session = await readSessionFile(sessionPath(sessionId));
  if (!session) return;
  const now = Date.now();
  // Streamed assistant text is interleaved with process events (Thinking,
  // runtime telemetry), which would otherwise split one turn's reply across
  // several assistant messages — and session pollers that render "the latest
  // assistant message" would show only the newest fragment. Merge into the
  // turn's assistant message as long as only process events sit between them;
  // user messages and real tool results still start a fresh message.
  let target: RuntimeChatSessionMessage | undefined;
  if (role === "assistant") {
    for (let i = session.messages.length - 1; i >= 0; i -= 1) {
      const message = session.messages[i];
      if (message.type === "process") continue;
      if (message.role === "assistant" && !message.type) target = message;
      break;
    }
  }
  if (target) {
    target.content += content;
    target.createdAt = target.createdAt || now;
    target.raw = raw ?? target.raw;
    target.billing = options?.billing ?? target.billing;
  } else {
    session.messages.push({
      index: session.messages.length,
      role,
      content,
      createdAt: now,
      raw,
      billing: options?.billing,
    });
  }
  session.updatedAt = now;
  await writeSession(session);
}

function applicationGenerationContent(card: RuntimeApplicationGeneration) {
  const label = card.kind === "model3d" ? "3D model" : card.kind;
  if (card.status === "ready") return `Generated ${label}: ${card.prompt}`;
  if (card.status === "error") return `${label} generation failed: ${card.prompt}`;
  return `Generating ${label}: ${card.prompt}`;
}

export function upsertRuntimeApplicationGenerationMessage(
  messages: RuntimeChatSessionMessage[],
  card: RuntimeApplicationGeneration,
  now = Date.now(),
) {
  const content = applicationGenerationContent(card);
  const existingIndex = messages.findIndex((message) => message.applicationGeneration?.id === card.id);
  if (existingIndex < 0) {
    return [...messages, {
      index: messages.length,
      role: "assistant",
      content,
      createdAt: typeof card.createdAt === "number" ? card.createdAt : now,
      applicationGeneration: card,
    }];
  }
  return messages.map((message, index) => index === existingIndex ? {
    ...message,
    content,
    applicationGeneration: card,
  } : message);
}

export async function upsertRuntimeChatSessionApplicationGeneration(sessionId: string, card: RuntimeApplicationGeneration) {
  if (!sessionId) return;
  const session = await readSessionFile(sessionPath(sessionId));
  if (!session) return;
  const now = Date.now();
  session.messages = upsertRuntimeApplicationGenerationMessage(session.messages, card, now);
  session.updatedAt = now;
  await writeSession(session);
}

export async function updateRuntimeChatSessionLastAssistantBilling(sessionId: string, billing: ChatResponseBilling) {
  const session = await readSessionFile(sessionPath(sessionId));
  if (!session) return;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.type === "process") continue;
    if (message.role !== "assistant" || message.type) break;
    message.billing = billing;
    session.updatedAt = Date.now();
    await writeSession(session);
    return;
  }
}

export async function appendRuntimeChatSessionEvent(sessionId: string, label: string, detail?: string, raw?: unknown) {
  const session = await readSessionFile(sessionPath(sessionId));
  if (!session) return;
  const now = Date.now();
  const content = [label.trim(), detail?.trim()].filter(Boolean).join("\n");
  if (!content) return;
  session.messages.push({
    index: session.messages.length,
    role: "tool",
    content,
    createdAt: now,
    type: "process",
    raw,
  });
  session.updatedAt = now;
  await writeSession(session);
}

export async function finishRuntimeChatSession(sessionId: string, endReason = "completed") {
  const session = await readSessionFile(sessionPath(sessionId));
  if (!session) return;
  const now = Date.now();
  session.updatedAt = now;
  session.endedAt = now;
  session.endReason = endReason;
  await writeSession(session);
  // Mirror the finished conversation into the shared vault (best effort) so
  // shared-brain recall can search it; never block or fail the chat response.
  void syncConversationNoteForSession(session).catch(() => {});
}

/**
 * Delete every runtime chat-session file that belongs to `chatStorageKey`. A
 * chat "thread" (its `chatStorageKey`) can span several runtime sessions, so
 * this walks the whole session directory rather than deleting a single path.
 * Returns the number of files removed. Best-effort per file: an unlink race
 * (already gone) is swallowed so a partial concurrent delete still converges.
 */
export async function deleteRuntimeChatSessionsForThread(chatStorageKey: string): Promise<number> {
  const key = (chatStorageKey ?? "").trim();
  if (!key) return 0;
  await ensureSessionDir();
  const entries = await readdir(SESSION_DIR, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  let deleted = 0;
  await Promise.all(files.map(async (entry) => {
    const path = join(SESSION_DIR, entry.name);
    const session = await readSessionFile(path);
    if (!session || session.chatStorageKey !== key) return;
    const removed = await unlink(path).then(() => true).catch(() => false);
    if (removed) deleted += 1;
  }));
  return deleted;
}

export async function readRuntimeChatSession(query: RuntimeSessionQuery) {
  await ensureSessionDir();
  if (query.sessionId) {
    const exact = await readSessionFile(sessionPath(query.sessionId));
    if (exact) return exact;
  }
  const entries = await readdir(SESSION_DIR, { withFileTypes: true }).catch(() => []);
  const sinceMs = Number(query.sinceMs || 0);
  const candidates = (await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(async (entry) => {
      const path = join(SESSION_DIR, entry.name);
      const info = await stat(path).catch(() => null);
      return info ? { path, mtimeMs: info.mtimeMs } : null;
    })))
    .filter((entry): entry is { path: string; mtimeMs: number } => Boolean(entry))
    .filter((entry) => !sinceMs || entry.mtimeMs >= sinceMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_SESSION_FALLBACK_FILES);
  const sessions = (await Promise.all(
    candidates.map((entry) => readSessionFile(entry.path)),
  )).filter((session): session is RuntimeChatSessionRecord => Boolean(session));
  return sessions
    .filter((session) => !query.runtime || session.runtime === query.runtime)
    .filter((session) => !query.agentId || session.agentId === query.agentId)
    .filter((session) => !query.chatStorageKey || session.chatStorageKey === query.chatStorageKey)
    .filter((session) => !sinceMs || session.startedAt >= sinceMs || session.updatedAt >= sinceMs)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

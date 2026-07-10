import "server-only";

import { randomUUID } from "crypto";
import { appendFile, mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import { dirname, join, relative, resolve, sep } from "path";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { listAgentMemoryRecords } from "@/lib/services/obsidian/agent-memory";
import { appendAgentMemoryUsage } from "@/lib/services/obsidian/agent-memory/usage";
import { removeFullVaultSearchIndexPaths } from "@/lib/services/obsidian/full-vault-search-index";
import { resolveObsidianVaultPath } from "@/lib/services/obsidian/vault-path";
import { isAutomationTranscriptText } from "@/lib/utils/automation-transcript";
import { DEFAULT_SHARED_VAULT } from "@/lib/types/agent-runtime";
import type { RuntimeChatSessionMessage, RuntimeChatSessionRecord } from "@/lib/services/chat/runtime-session-store";

// Conversations become shared-brain context: one markdown note per runtime
// chat session under Memory/Conversations/, plus an append-only JSONL index
// for fast structured scans. Notes are redacted before they touch the vault.

const CONVERSATIONS_FOLDER = "Memory/Conversations";
const CONVERSATIONS_INDEX_PATH = `${DEFAULT_SHARED_VAULT.brainServicesFolder}/Conversations Index.jsonl`;
const MAX_MESSAGE_CHARS = 6_000;
const SUMMARY_CHARS = 300;
const MAX_KEYWORDS = 12;
const KEYWORD_STOPWORDS = new Set([
  "about", "after", "again", "agent", "also", "and", "are", "been", "before", "but", "can",
  "cant", "could", "did", "does", "dont", "for", "from", "has", "have", "her", "here", "him",
  "his", "how", "into", "its", "just", "like", "make", "more", "need", "not", "now", "our",
  "out", "over", "please", "she", "should", "some", "than", "that", "the", "their", "them",
  "then", "there", "they", "this", "use", "want", "was", "what", "when", "where", "which",
  "while", "will", "with", "would", "you", "your",
]);

// The index is appended when a session finishes and rewritten when a thread is
// deleted. Chain both through one promise so the purge's read-modify-write
// cannot drop a row a concurrent finish just appended. (In-process only, like
// the telemetry log's serializer; a second Next process would still race.)
let conversationIndexWrites: Promise<unknown> = Promise.resolve();

function serializeConversationIndexWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = conversationIndexWrites.then(task, task);
  conversationIndexWrites = next.catch(() => undefined);
  return next;
}

export type ConversationIndexEntry = {
  timestamp: string;
  action: "conversation";
  sessionId: string;
  agentId: string;
  agentName: string;
  runtime: string;
  chatStorageKey?: string;
  notePath: string;
  title: string;
  keywords: string[];
  messageCount: number;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
};

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "conversation";
}

function isoOrUndefined(ms?: number) {
  return ms ? new Date(ms).toISOString() : undefined;
}

function compactLine(value: string, max: number) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

function visibleMessages(session: RuntimeChatSessionRecord) {
  return session.messages.filter((message) => message.content.trim());
}

function firstUserMessage(messages: RuntimeChatSessionMessage[]) {
  return messages.find((message) => message.role === "user" && message.type !== "process");
}

function lastAssistantMessage(messages: RuntimeChatSessionMessage[]) {
  return [...messages].reverse().find((message) => message.role === "assistant" && message.type !== "process");
}

function keywordsFromMessages(messages: RuntimeChatSessionMessage[]) {
  const counts = new Map<string, number>();
  for (const message of messages) {
    if (message.type === "process") continue;
    for (const word of message.content.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length < 4 || KEYWORD_STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_KEYWORDS)
    .map(([word]) => word);
}

function yamlValue(value: string) {
  return JSON.stringify(value);
}

function transcriptLine(session: RuntimeChatSessionRecord, message: RuntimeChatSessionMessage) {
  const content = redactSecretText(message.content).text.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!content) return "";
  if (message.type === "process") {
    return `> process — ${compactLine(content, 240)}`;
  }
  const speaker = message.role === "user" ? "User" : message.role === "assistant" ? session.agentName : message.role;
  return `**${speaker}:**\n\n${content}`;
}

export function conversationNoteRelativePath(session: RuntimeChatSessionRecord, title: string) {
  const day = new Date(session.startedAt).toISOString().slice(0, 10);
  return join(
    CONVERSATIONS_FOLDER,
    safeSlug(session.agentName),
    `${day}-${safeSlug(title)}-${safeSlug(session.sessionId)}.md`,
  );
}

function conversationMarkdown(session: RuntimeChatSessionRecord, messages: RuntimeChatSessionMessage[], title: string, keywords: string[]) {
  const asked = firstUserMessage(messages);
  const replied = lastAssistantMessage(messages);
  const frontmatterLines = [
    "---",
    "type: conversation",
    `sessionId: ${yamlValue(session.sessionId)}`,
    `agentId: ${yamlValue(session.agentId)}`,
    `agentName: ${yamlValue(session.agentName)}`,
    `runtime: ${yamlValue(session.runtime)}`,
    session.chatStorageKey ? `chatStorageKey: ${yamlValue(session.chatStorageKey)}` : "",
    `title: ${yamlValue(title)}`,
    `startedAt: ${yamlValue(new Date(session.startedAt).toISOString())}`,
    session.endedAt ? `endedAt: ${yamlValue(new Date(session.endedAt).toISOString())}` : "",
    session.endReason ? `endReason: ${yamlValue(session.endReason)}` : "",
    `messageCount: ${messages.length}`,
    `tags: [conversation${keywords.length ? `, ${keywords.join(", ")}` : ""}]`,
    "---",
  ].filter(Boolean);
  const summaryLines = [
    `# [[${session.agentName}]] conversation — ${title}`,
    "",
    asked ? `**Asked:** ${compactLine(redactSecretText(asked.content).text, SUMMARY_CHARS)}` : "",
    replied ? `**Last reply:** ${compactLine(redactSecretText(replied.content).text, SUMMARY_CHARS)}` : "",
    keywords.length ? `**Topics:** ${keywords.join(", ")}` : "",
    "",
    "## Transcript",
    "",
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "");
  const transcript = messages
    .map((message) => transcriptLine(session, message))
    .filter(Boolean)
    .join("\n\n");
  return `${[...frontmatterLines, "", ...summaryLines, transcript].join("\n")}\n`;
}

function indexEntry(session: RuntimeChatSessionRecord, notePath: string, title: string, keywords: string[], messageCount: number): ConversationIndexEntry {
  return {
    timestamp: new Date().toISOString(),
    action: "conversation",
    sessionId: session.sessionId,
    agentId: session.agentId,
    agentName: session.agentName,
    runtime: session.runtime,
    chatStorageKey: session.chatStorageKey,
    notePath,
    title,
    keywords,
    messageCount,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: isoOrUndefined(session.endedAt),
    endReason: session.endReason,
  };
}

/**
 * Writes/refreshes the vault note for a finished runtime chat session and
 * appends a Conversations Index entry (readers dedupe by sessionId, last
 * entry wins). No-op when the session has no shared vault, is an automation
 * transcript, or never got an assistant reply.
 */
export async function syncConversationNoteForSession(session: RuntimeChatSessionRecord) {
  if (!session.sharedVaultPath?.trim()) return null;
  const messages = visibleMessages(session);
  if (messages.length < 2 || !lastAssistantMessage(messages)) return null;
  const probe = messages.slice(0, 8).map((message) => message.content).join("\n");
  if (isAutomationTranscriptText(probe)) return null;

  const root = resolveObsidianVaultPath(session.sharedVaultPath, { requireWritable: true });
  const asked = firstUserMessage(messages);
  const title = compactLine(redactSecretText(asked?.content ?? session.agentName).text, 80) || session.agentName;
  const keywords = keywordsFromMessages(messages);
  const notePath = conversationNoteRelativePath(session, title);
  const absoluteNotePath = join(root, notePath);

  await mkdir(dirname(absoluteNotePath), { recursive: true });
  await writeFile(absoluteNotePath, conversationMarkdown(session, messages, title, keywords), { encoding: "utf8", mode: 0o600 });

  const indexFile = join(root, CONVERSATIONS_INDEX_PATH);
  await mkdir(dirname(indexFile), { recursive: true });
  const entry = indexEntry(session, notePath, title, keywords, messages.length);
  await serializeConversationIndexWrite(() => appendFile(indexFile, `${JSON.stringify(entry)}\n`, "utf8"));
  await recordCitedMemoryUsage(root, session, messages).catch(() => undefined);
  return { notePath, entry };
}

// Final-answer usage is the strong ranking signal: when a finished reply
// actually cites a typed memory (by id, note path, or exact title), record it
// so usageScore rewards genuinely useful memories instead of raw retrievals.
async function recordCitedMemoryUsage(root: string, session: RuntimeChatSessionRecord, messages: RuntimeChatSessionMessage[]) {
  const assistantText = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("\n")
    .toLowerCase();
  if (!assistantText.trim()) return;
  const { records } = await listAgentMemoryRecords({ vaultPath: root });
  const cited = records.filter((record) => {
    if (record.notePath && assistantText.includes(record.notePath.toLowerCase())) return true;
    if (record.id && assistantText.includes(record.id.toLowerCase())) return true;
    const title = record.title?.toLowerCase() ?? "";
    return title.length >= 12 && assistantText.includes(title);
  }).slice(0, 20);
  if (!cited.length) return;
  await appendAgentMemoryUsage(root, {
    memoryIds: cited.map((record) => record.id),
    usageType: "final-answer",
    usageContext: "conversation-citation",
    sessionId: session.sessionId,
    agentName: session.agentName,
    runtime: session.runtime,
  });
}

// --- Deleting a thread's conversation mirror --------------------------------
//
// Deleting a chat thread erases its shared-brain mirror too, so a "deleted"
// chat stops being recallable by every agent on the fleet. This is a HARD
// delete with no undo: the vault is not a git repo, its Syncthing folder has
// file versioning disabled, and Obsidian's trash does not apply to fs.unlink.
// The delete replicates to every fleet machine within seconds. Correct
// addressing is therefore safety-critical — see isPurgeableConversationNotePath.

const CONVERSATION_NOTE_PREFIX = `${CONVERSATIONS_FOLDER}/`;

export type ConversationPurgeResult = {
  vaultPath: string;
  vaultPresent: boolean;
  notesTargeted: number;
  notesDeleted: number;
  indexRowsRemoved: number;
  searchIndexRowsRemoved: number;
  unsafeNotePathsSkipped: string[];
};

/**
 * Read `chatStorageKey` out of a conversation note's frontmatter. The writer
 * emits it as a JSON string (see `yamlValue`), and omits the line entirely for
 * sessions whose key is empty — those notes are not thread-addressable and are
 * never purged.
 */
export function conversationNoteChatStorageKey(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") break;
    const match = /^chatStorageKey:\s*(.+)$/.exec(lines[index]);
    if (!match) continue;
    const raw = match[1].trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "string" && parsed.trim() ? parsed : undefined;
    } catch {
      return raw.replace(/^["']|["']$/g, "").trim() || undefined;
    }
  }
  return undefined;
}

/**
 * Guard for the purge's one untrusted input. `notePath` is read back out of
 * Conversations Index.jsonl — a file Syncthing replicates from other machines
 * — so a corrupt or crafted row must never resolve outside Memory/Conversations.
 * With no undo behind the unlink, treat every row as data, not as truth.
 */
export function isPurgeableConversationNotePath(notePath: string): boolean {
  const normalized = (notePath ?? "").split("\\").join("/");
  if (!normalized.startsWith(CONVERSATION_NOTE_PREFIX)) return false;
  if (!normalized.endsWith(".md")) return false;
  return normalized.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

/**
 * Pure line filter behind {@link deleteConversationNotesForThread}: drop every
 * index row matching `chatStorageKey`, keep everything else byte-for-byte, and
 * report the note paths those rows pointed at. Unparseable lines are KEPT.
 *
 * An empty key matches nothing. Rows written for sessions with no thread key
 * carry `chatStorageKey: ""`, and sweeping them on a blank argument would
 * delete unrelated notes.
 */
export function conversationIndexLinesWithoutThread(raw: string, chatStorageKey: string) {
  const key = (chatStorageKey ?? "").trim();
  const notePaths: string[] = [];
  if (!key) return { removed: 0, contents: raw, notePaths };
  let removed = 0;
  const kept = raw.split("\n").filter((line) => {
    if (!line.length) return false;
    let entry: Partial<ConversationIndexEntry>;
    try {
      entry = JSON.parse(line) as Partial<ConversationIndexEntry>;
    } catch {
      return true;
    }
    if (entry.chatStorageKey !== key) return true;
    if (typeof entry.notePath === "string" && entry.notePath) notePaths.push(entry.notePath);
    removed += 1;
    return false;
  });
  return { removed, contents: kept.length ? `${kept.join("\n")}\n` : "", notePaths };
}

async function writeConversationsIndexAtomically(file: string, contents: string) {
  await mkdir(dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryFile, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryFile, file);
  } finally {
    await unlink(temporaryFile).catch(() => undefined);
  }
}

/**
 * Notes are the source of truth for recall, so scan them by frontmatter rather
 * than trusting the index alone: `syncConversationNoteForSession` writes the
 * note before appending its row, so a failed append leaves a note that no index
 * row can address.
 */
async function conversationNotePathsForThread(root: string, chatStorageKey: string) {
  const matches: string[] = [];
  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const markdown = await readFile(full, "utf8").catch(() => "");
      if (!markdown || conversationNoteChatStorageKey(markdown) !== chatStorageKey) continue;
      matches.push(relative(root, full).split(sep).join("/"));
    }
  };
  await walk(join(root, CONVERSATIONS_FOLDER));
  return matches;
}

/**
 * Erase a deleted chat thread's shared-vault conversation mirror: its notes
 * under Memory/Conversations, its rows in Conversations Index.jsonl, and the
 * generated Full Vault Search Index rows that would otherwise keep the note's
 * excerpt and term vector recallable for up to the index TTL.
 *
 * Irreversible and fleet-wide (Syncthing replicates the unlink). Never fires on
 * an empty `chatStorageKey`. A missing or unwritable vault is a no-op, not an
 * error. Races with the fire-and-forget note write in `finishRuntimeChatSession`:
 * a session finishing during the purge can re-create its note afterwards.
 */
export async function deleteConversationNotesForThread(input: {
  chatStorageKey: string;
  vaultPath?: string;
}): Promise<ConversationPurgeResult> {
  const key = (input.chatStorageKey ?? "").trim();
  const root = resolveObsidianVaultPath(input.vaultPath, { requireWritable: true });
  const empty: ConversationPurgeResult = {
    vaultPath: root,
    vaultPresent: false,
    notesTargeted: 0,
    notesDeleted: 0,
    indexRowsRemoved: 0,
    searchIndexRowsRemoved: 0,
    unsafeNotePathsSkipped: [],
  };
  if (!key) return empty;
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return empty;

  return serializeConversationIndexWrite(async () => {
    const indexFile = join(root, CONVERSATIONS_INDEX_PATH);
    const rawIndex = await readFile(indexFile, "utf8").catch(() => "");
    const indexResult = conversationIndexLinesWithoutThread(rawIndex, key);
    const unsafeNotePathsSkipped = indexResult.notePaths.filter((path) => !isPurgeableConversationNotePath(path));

    const fromFolder = await conversationNotePathsForThread(root, key);
    const fromIndex = indexResult.notePaths.filter(isPurgeableConversationNotePath);
    const targets = [...new Set([...fromFolder, ...fromIndex])].filter(isPurgeableConversationNotePath);

    let notesDeleted = 0;
    const directories = new Set<string>();
    for (const notePath of targets) {
      const absolute = resolve(root, notePath);
      // Defence in depth: the guard above is on the vault-relative string; this
      // one is on the resolved path, so a symlinked or normalised escape fails too.
      if (relative(root, absolute).split(sep).join("/") !== notePath) continue;
      const removed = await unlink(absolute).then(() => true).catch(() => false);
      if (!removed) continue;
      notesDeleted += 1;
      directories.add(dirname(absolute));
    }
    // Prune agent folders this purge emptied (rmdir refuses non-empty ones).
    for (const directory of directories) await rmdir(directory).catch(() => undefined);

    if (indexResult.removed) await writeConversationsIndexAtomically(indexFile, indexResult.contents);
    const searchIndexRowsRemoved = await removeFullVaultSearchIndexPaths(root, targets).catch(() => 0);

    return {
      vaultPath: root,
      vaultPresent: true,
      notesTargeted: targets.length,
      notesDeleted,
      indexRowsRemoved: indexResult.removed,
      searchIndexRowsRemoved,
      unsafeNotePathsSkipped,
    };
  });
}

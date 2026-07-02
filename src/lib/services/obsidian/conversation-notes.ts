import "server-only";

import { appendFile, mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { redactSecretText } from "@/lib/services/agent-security-proxy";
import { listAgentMemoryRecords } from "@/lib/services/obsidian/agent-memory";
import { appendAgentMemoryUsage } from "@/lib/services/obsidian/agent-memory/usage";
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
  await appendFile(indexFile, `${JSON.stringify(entry)}\n`, "utf8");
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

import "server-only";

import {
  mutateRecordsFile,
  readRecordsFile,
  resolveMarketplaceStorage,
} from "@/lib/services/marketplace/marketplace-store-io";
import {
  MARKETPLACE_CONVERSATION_MESSAGE_CAP,
  type MarketplaceConversation,
  type MarketplaceConversationState,
  type MarketplaceMessage,
  type MarketplaceReportConversation,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace conversations — vault-replicated, text-only, bounded history.
 * The agent report is the ingestion source: snapshots merge idempotently
 * (dedupe by message identity) so re-ingesting the same session is a no-op.
 */

const CONVERSATIONS_FILE = "conversations.json";

function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Stable identity for a message with or without an external id. */
function messageKey(message: { id?: string; at?: string; from: string; text: string }): string {
  if (message.id?.trim()) return `id:${message.id.trim()}`;
  return `h:${message.from}:${djb2(`${message.at ?? ""}|${message.text}`)}`;
}

function normalizeMessage(raw: unknown): MarketplaceMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const from = record.from === "buyer" || record.from === "agent" || record.from === "human" ? record.from : null;
  if (!text.trim() || !from) return null;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : messageKey({ from, at: typeof record.at === "string" ? record.at : undefined, text }),
    at: typeof record.at === "string" ? record.at : new Date().toISOString(),
    from,
    text,
  };
}

export function normalizeMarketplaceConversationRecord(raw: unknown): MarketplaceConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  if (!id || !accountId) return null;
  const listingRefRaw = (record.listingRef ?? {}) as Record<string, unknown>;
  const state: MarketplaceConversationState =
    record.state === "awaiting-buyer" || record.state === "needs-human" || record.state === "closed" ? record.state : "active";
  return {
    id,
    accountId,
    listingRef: {
      ...(typeof listingRefRaw.listingId === "string" && listingRefRaw.listingId.trim() ? { listingId: listingRefRaw.listingId.trim() } : {}),
      ...(typeof listingRefRaw.externalId === "string" && listingRefRaw.externalId.trim() ? { externalId: listingRefRaw.externalId.trim() } : {}),
      title: typeof listingRefRaw.title === "string" ? listingRefRaw.title : "",
    },
    buyerName: typeof record.buyerName === "string" && record.buyerName.trim() ? record.buyerName.trim() : "Buyer",
    state,
    messages: Array.isArray(record.messages)
      ? record.messages.map(normalizeMessage).filter((message): message is MarketplaceMessage => message !== null)
      : [],
    ...(typeof record.lastBuyerMessageAt === "string" ? { lastBuyerMessageAt: record.lastBuyerMessageAt } : {}),
    ...(typeof record.lastAgentReplyAt === "string" ? { lastAgentReplyAt: record.lastAgentReplyAt } : {}),
    ...(record.escalation && typeof record.escalation === "object" ? { escalation: record.escalation as MarketplaceConversation["escalation"] } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  };
}

export async function readMarketplaceConversations(accountId?: string): Promise<MarketplaceConversation[]> {
  const storage = resolveMarketplaceStorage(CONVERSATIONS_FILE);
  const records = await readRecordsFile(storage.file, normalizeMarketplaceConversationRecord);
  const filtered = accountId ? records.filter((conversation) => conversation.accountId === accountId) : records;
  return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMarketplaceConversation(id: string): Promise<MarketplaceConversation | null> {
  const conversations = await readMarketplaceConversations();
  return conversations.find((conversation) => conversation.id === id) ?? null;
}

export type ConversationIngestResult = { conversationsTouched: number; newBuyerMessages: number };

/**
 * Merge an agent session's conversation snapshot. Idempotent: message
 * identity is the external id when present, else a content hash — replaying
 * the same report adds nothing. Replies the agent sent land as "agent"
 * messages and stamp lastAgentReplyAt.
 */
export async function ingestConversationSnapshot(
  accountId: string,
  conversations: MarketplaceReportConversation[],
  replies: Array<{ conversationId: string; text: string; at?: string }>,
): Promise<ConversationIngestResult> {
  const now = new Date().toISOString();
  let conversationsTouched = 0;
  let newBuyerMessages = 0;
  await mutateRecordsFile(CONVERSATIONS_FILE, normalizeMarketplaceConversationRecord, (records) => {
    const next = [...records];
    for (const snapshot of conversations) {
      const snapshotId = snapshot.id?.trim();
      if (!snapshotId) continue;
      const conversationId = `${accountId}:${snapshotId}`;
      const incoming: MarketplaceMessage[] = [];
      for (const message of snapshot.messages ?? []) {
        const normalized = normalizeMessage(message);
        if (normalized) incoming.push(normalized);
      }
      for (const reply of replies.filter((candidate) => candidate.conversationId === snapshot.id)) {
        const normalized = normalizeMessage({ from: "agent", text: reply.text, at: reply.at ?? now });
        if (normalized) incoming.push(normalized);
      }
      const index = next.findIndex((conversation) => conversation.id === conversationId);
      const existing = index >= 0 ? next[index] : null;
      const seen = new Set((existing?.messages ?? []).map((message) => messageKey(message)));
      const added: MarketplaceMessage[] = [];
      for (const message of incoming) {
        const key = messageKey(message);
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(message);
        if (message.from === "buyer") newBuyerMessages++;
      }
      if (existing && !added.length) continue;
      const messages = [...(existing?.messages ?? []), ...added].slice(-MARKETPLACE_CONVERSATION_MESSAGE_CAP);
      const lastBuyer = [...messages].reverse().find((message) => message.from === "buyer");
      const lastAgent = [...messages].reverse().find((message) => message.from === "agent" || message.from === "human");
      const merged: MarketplaceConversation = {
        id: conversationId,
        accountId,
        listingRef: {
          ...(existing?.listingRef.listingId ? { listingId: existing.listingRef.listingId } : {}),
          ...(snapshot.listingExternalId?.trim()
            ? { externalId: snapshot.listingExternalId.trim() }
            : existing?.listingRef.externalId
              ? { externalId: existing.listingRef.externalId }
              : {}),
          title: snapshot.listingTitle?.trim() || existing?.listingRef.title || "",
        },
        buyerName: snapshot.buyerName?.trim() || existing?.buyerName || "Buyer",
        state: existing?.state === "closed" ? "closed" : existing?.state === "needs-human" ? "needs-human" : lastAgent && (!lastBuyer || lastAgent.at >= lastBuyer.at) ? "awaiting-buyer" : "active",
        messages,
        ...(lastBuyer ? { lastBuyerMessageAt: lastBuyer.at } : existing?.lastBuyerMessageAt ? { lastBuyerMessageAt: existing.lastBuyerMessageAt } : {}),
        ...(lastAgent ? { lastAgentReplyAt: lastAgent.at } : existing?.lastAgentReplyAt ? { lastAgentReplyAt: existing.lastAgentReplyAt } : {}),
        ...(existing?.escalation ? { escalation: existing.escalation } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      if (index >= 0) next[index] = merged;
      else next.push(merged);
      conversationsTouched++;
    }
    return next;
  });
  return { conversationsTouched, newBuyerMessages };
}

export async function setMarketplaceConversationState(id: string, state: MarketplaceConversationState): Promise<MarketplaceConversation | null> {
  let updated: MarketplaceConversation | null = null;
  await mutateRecordsFile(CONVERSATIONS_FILE, normalizeMarketplaceConversationRecord, (records) =>
    records.map((conversation) => {
      if (conversation.id !== id) return conversation;
      updated = { ...conversation, state, updatedAt: new Date().toISOString() };
      return updated;
    }),
  );
  return updated;
}

export async function attachConversationEscalation(id: string, decisionId: string, reason: string): Promise<MarketplaceConversation | null> {
  let updated: MarketplaceConversation | null = null;
  await mutateRecordsFile(CONVERSATIONS_FILE, normalizeMarketplaceConversationRecord, (records) =>
    records.map((conversation) => {
      if (conversation.id !== id) return conversation;
      updated = { ...conversation, state: "needs-human", escalation: { decisionId, reason }, updatedAt: new Date().toISOString() };
      return updated;
    }),
  );
  return updated;
}

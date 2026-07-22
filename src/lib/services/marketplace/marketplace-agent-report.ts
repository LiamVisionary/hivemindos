import {
  MARKETPLACE_REPORT_FENCE,
  MARKETPLACE_RESEARCH_FENCE,
  type MarketplaceAgentReport,
  type MarketplaceReportCatalogItem,
  type MarketplaceReportConversation,
  type MarketplaceReportEscalation,
  type MarketplaceResearchResult,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Parsers for the fenced-JSON contracts marketplace agents end their replies
 * with. Strict by design: a session without a parseable report is a safe
 * no-op (the caller raises needs-attention), never a guess. The LAST fenced
 * block wins — agents sometimes restate the contract before filling it.
 */

function extractFencedJson(text: string, fenceTag: string): unknown | null {
  if (!text) return null;
  const pattern = new RegExp("```json[ \\t]+" + fenceTag + "[ \\t]*\\r?\\n([\\s\\S]*?)```", "g");
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = pattern.exec(text)) !== null) last = match[1];
  if (last === null) return null;
  try {
    return JSON.parse(last.trim());
  } catch {
    return null;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeReportConversation(raw: unknown): MarketplaceReportConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = asString(record.id);
  if (!id) return null;
  const messages: MarketplaceReportConversation["messages"] = [];
  if (Array.isArray(record.messages)) {
    for (const item of record.messages) {
      if (!item || typeof item !== "object") continue;
      const message = item as Record<string, unknown>;
      const from = message.from === "buyer" || message.from === "agent" ? message.from : null;
      const text = typeof message.text === "string" ? message.text : "";
      if (!from || !text.trim()) continue;
      messages.push({
        ...(asString(message.id) ? { id: asString(message.id) } : {}),
        ...(asString(message.at) ? { at: asString(message.at) } : {}),
        from,
        text,
      });
    }
  }
  return {
    id,
    ...(asString(record.listingExternalId) ? { listingExternalId: asString(record.listingExternalId) } : {}),
    listingTitle: asString(record.listingTitle),
    buyerName: asString(record.buyerName) || "Buyer",
    messages,
  };
}

function normalizeEscalation(raw: unknown): MarketplaceReportEscalation | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const conversationId = asString(record.conversationId);
  const question = asString(record.question);
  if (!conversationId || !question) return null;
  return {
    conversationId,
    reason: asString(record.reason) || "Escalated by the agent",
    question,
    ...(asOptionalNumber(record.offerUsd) !== undefined ? { offerUsd: asOptionalNumber(record.offerUsd) } : {}),
    ...(asString(record.draftReply) ? { draftReply: asString(record.draftReply) } : {}),
  };
}

function normalizeCatalogItem(raw: unknown): MarketplaceReportCatalogItem | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const externalId = asString(record.externalId);
  const title = asString(record.title);
  if (!externalId || !title) return null;
  return {
    externalId,
    ...(asString(record.url) ? { url: asString(record.url) } : {}),
    title,
    ...(asOptionalNumber(record.priceUsd) !== undefined ? { priceUsd: asOptionalNumber(record.priceUsd) } : {}),
    state: record.state === "sold" || record.state === "ended" ? record.state : "active",
  };
}

/**
 * Parse a MARKETPLACE_REPORT block out of an agent task result. Returns null
 * when no parseable block exists — callers must treat that as "session told
 * us nothing", not as an empty result.
 */
export function parseMarketplaceAgentReport(text: string): MarketplaceAgentReport | null {
  const parsed = extractFencedJson(text, MARKETPLACE_REPORT_FENCE);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const sessionHealth =
    record.sessionHealth === "ok" || record.sessionHealth === "logged-out" || record.sessionHealth === "blocked"
      ? record.sessionHealth
      : "error";
  const conversations = Array.isArray(record.conversations)
    ? record.conversations.map(normalizeReportConversation).filter((item): item is MarketplaceReportConversation => item !== null)
    : [];
  const replies: MarketplaceAgentReport["replies"] = [];
  if (Array.isArray(record.replies)) {
    for (const item of record.replies) {
      if (!item || typeof item !== "object") continue;
      const reply = item as Record<string, unknown>;
      const conversationId = asString(reply.conversationId);
      const replyText = typeof reply.text === "string" ? reply.text : "";
      if (!conversationId || !replyText.trim()) continue;
      replies.push({ conversationId, text: replyText, ...(asString(reply.at) ? { at: asString(reply.at) } : {}) });
    }
  }
  const escalations = Array.isArray(record.escalations)
    ? record.escalations.map(normalizeEscalation).filter((item): item is MarketplaceReportEscalation => item !== null)
    : [];
  const catalog = Array.isArray(record.catalog)
    ? record.catalog.map(normalizeCatalogItem).filter((item): item is MarketplaceReportCatalogItem => item !== null)
    : undefined;
  const posted = record.postedListing as Record<string, unknown> | undefined;
  const postedListing =
    posted && typeof posted === "object" && asString(posted.externalId) && asString(posted.url)
      ? { externalId: asString(posted.externalId), url: asString(posted.url) }
      : undefined;
  return {
    conversations,
    replies,
    escalations,
    ...(catalog ? { catalog } : {}),
    ...(postedListing ? { postedListing } : {}),
    sessionHealth,
    ...(asString(record.note) ? { note: asString(record.note) } : {}),
  };
}

/** Parse a RESEARCH_RESULT block. Null on any structural problem — the job fails cleanly instead of storing junk. */
export function parseResearchResultBlock(text: string): MarketplaceResearchResult | null {
  const parsed = extractFencedJson(text, MARKETPLACE_RESEARCH_FENCE);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const suggested = asOptionalNumber(record.suggestedPriceUsd);
  if (suggested === undefined || suggested < 0) return null;
  let range: [number, number] = [suggested, suggested];
  if (Array.isArray(record.priceRangeUsd) && record.priceRangeUsd.length === 2) {
    const low = asOptionalNumber(record.priceRangeUsd[0]);
    const high = asOptionalNumber(record.priceRangeUsd[1]);
    if (low !== undefined && high !== undefined && low >= 0 && high >= low) range = [low, high];
  }
  const comps: MarketplaceResearchResult["comps"] = [];
  if (Array.isArray(record.comps)) {
    for (const item of record.comps) {
      if (!item || typeof item !== "object") continue;
      const comp = item as Record<string, unknown>;
      const title = asString(comp.title);
      const priceUsd = asOptionalNumber(comp.priceUsd);
      if (!title || priceUsd === undefined || priceUsd < 0) continue;
      comps.push({
        title,
        priceUsd,
        ...(asString(comp.url) ? { url: asString(comp.url) } : {}),
        source: asString(comp.source) || "web",
      });
    }
  }
  const confidence = record.confidence === "high" || record.confidence === "low" ? record.confidence : "medium";
  return {
    suggestedPriceUsd: suggested,
    priceRangeUsd: range,
    comps,
    confidence,
    rationale: asString(record.rationale),
  };
}

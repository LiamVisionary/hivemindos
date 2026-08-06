import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeReasoningTrail, type ReasoningTrail } from "@/lib/types/reasoning-trail";
import {
  mutateRecordsFile,
  readRecordsFile,
  resolveMarketplaceStorage,
} from "@/lib/services/marketplace/marketplace-store-io";
import { addMarketplaceDirective } from "@/lib/services/marketplace/marketplace-store";
import {
  MARKETPLACE_DECISION_KINDS,
  type MarketplaceDecision,
  type MarketplaceDecisionKind,
  type MarketplaceDecisionStatus,
} from "@/lib/services/marketplace/marketplace-types";

/**
 * Marketplace decisions — the human approval queue. Vault-replicated so the
 * approval cards render on whichever machine the human is using. Rendered
 * through the shared ApprovalReviewCard by mapping into SpendApprovalView
 * (the ZHC work-approval precedent) — records here never touch the wallet
 * spend-approvals file.
 */

const DECISIONS_FILE = "decisions.json";

function isDecisionKind(value: unknown): value is MarketplaceDecisionKind {
  return typeof value === "string" && (MARKETPLACE_DECISION_KINDS as readonly string[]).includes(value);
}

const FALLBACK_TRAIL: ReasoningTrail = {
  headline: "This needs a human decision.",
  summary: "The marketplace agent paused for a human review.",
  whyNow: "The request crossed a review boundary.",
  evidence: [],
};

export function normalizeMarketplaceDecisionRecord(raw: unknown): MarketplaceDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const accountId = typeof record.accountId === "string" ? record.accountId.trim() : "";
  if (!id || !accountId || !isDecisionKind(record.kind)) return null;
  const status: MarketplaceDecisionStatus =
    record.status === "approved" || record.status === "denied" || record.status === "ignored" || record.status === "expired"
      ? record.status
      : "pending";
  const preview =
    record.preview && typeof record.preview === "object" && typeof (record.preview as Record<string, unknown>).title === "string"
      ? (record.preview as MarketplaceDecision["preview"])
      : undefined;
  return {
    id,
    kind: record.kind,
    accountId,
    ...(typeof record.listingId === "string" && record.listingId.trim() ? { listingId: record.listingId.trim() } : {}),
    ...(typeof record.conversationId === "string" && record.conversationId.trim() ? { conversationId: record.conversationId.trim() } : {}),
    status,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Marketplace decision",
    summary: typeof record.summary === "string" ? record.summary : "",
    explanation: normalizeReasoningTrail(record.explanation) ?? FALLBACK_TRAIL,
    ...(preview ? { preview } : {}),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
    ...(typeof record.decidedAt === "string" ? { decidedAt: record.decidedAt } : {}),
    ...(typeof record.decisionNote === "string" && record.decisionNote.trim() ? { decisionNote: record.decisionNote.trim() } : {}),
    ...(typeof record.capturedDirectiveId === "string" && record.capturedDirectiveId.trim()
      ? { capturedDirectiveId: record.capturedDirectiveId.trim() }
      : {}),
  };
}

export async function listMarketplaceDecisions(filter?: { status?: MarketplaceDecisionStatus; accountId?: string }): Promise<MarketplaceDecision[]> {
  const storage = resolveMarketplaceStorage(DECISIONS_FILE);
  const records = await readRecordsFile(storage.file, normalizeMarketplaceDecisionRecord);
  return records
    .filter((decision) => (filter?.status ? decision.status === filter.status : true))
    .filter((decision) => (filter?.accountId ? decision.accountId === filter.accountId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getMarketplaceDecision(id: string): Promise<MarketplaceDecision | null> {
  const decisions = await listMarketplaceDecisions();
  return decisions.find((decision) => decision.id === id) ?? null;
}

export type EnqueueMarketplaceDecisionInput = {
  kind: MarketplaceDecisionKind;
  accountId: string;
  listingId?: string;
  conversationId?: string;
  title: string;
  summary: string;
  explanation: ReasoningTrail;
  preview?: MarketplaceDecision["preview"];
};

export async function enqueueMarketplaceDecision(input: EnqueueMarketplaceDecisionInput): Promise<MarketplaceDecision> {
  const decision: MarketplaceDecision = {
    id: `mdec_${randomUUID()}`,
    kind: input.kind,
    accountId: input.accountId,
    ...(input.listingId?.trim() ? { listingId: input.listingId.trim() } : {}),
    ...(input.conversationId?.trim() ? { conversationId: input.conversationId.trim() } : {}),
    status: "pending",
    title: input.title.trim() || "Marketplace decision",
    summary: input.summary.trim(),
    explanation: normalizeReasoningTrail(input.explanation) ?? FALLBACK_TRAIL,
    ...(input.preview ? { preview: input.preview } : {}),
    createdAt: new Date().toISOString(),
  };
  await mutateRecordsFile(DECISIONS_FILE, normalizeMarketplaceDecisionRecord, (decisions) => [...decisions, decision]);
  return decision;
}

export type DecideMarketplaceDecisionResult = {
  decision: MarketplaceDecision;
  /** Set when the note was captured as a standing directive. */
  directiveId?: string;
};

/**
 * Remove a pending card without accepting or rejecting its proposed action.
 * The ignored record stays durable as a suppression tombstone so the monitor
 * can keep the same conversation from creating another card later.
 */
export async function ignoreMarketplaceDecision(id: string): Promise<MarketplaceDecision | null> {
  let updated: MarketplaceDecision | null = null;
  await mutateRecordsFile(DECISIONS_FILE, normalizeMarketplaceDecisionRecord, (decisions) =>
    decisions.map((record) => {
      if (record.id !== id) return record;
      if (record.status === "ignored") {
        updated = record;
        return record;
      }
      if (record.status !== "pending") {
        throw new Error(`Decision ${id} is already ${record.status}.`);
      }
      updated = {
        ...record,
        status: "ignored",
        decidedAt: new Date().toISOString(),
      };
      return updated;
    }),
  );
  return updated;
}

/**
 * Record the human's call. The free-text note rides back to the agent via
 * marketplaceDecisionAnswer; with makeDirective it ALSO becomes a standing
 * directive injected into every future dispatch ("ignore low offers like
 * this from now on").
 */
export async function decideMarketplaceDecision(
  id: string,
  decision: "approved" | "denied",
  note?: string,
  makeDirective?: boolean,
): Promise<DecideMarketplaceDecisionResult | null> {
  const trimmedNote = note?.trim() ?? "";
  const existing = await getMarketplaceDecision(id);
  if (!existing) return null;
  if (existing.status !== "pending") throw new Error(`Decision ${id} is already ${existing.status}.`);
  if (existing.kind === "buyer-escalation" && decision === "approved" && !trimmedNote) {
    throw new Error("A buyer decision needs the exact answer to send before it can be approved.");
  }
  let directiveId: string | undefined;
  if (makeDirective && trimmedNote) {
    const directive = await addMarketplaceDirective({
      text: trimmedNote,
      scope: "account",
      accountId: existing.accountId,
      source: "decision-note",
      decisionRef: id,
    });
    directiveId = directive.id;
  }
  let updated: MarketplaceDecision | null = null;
  await mutateRecordsFile(DECISIONS_FILE, normalizeMarketplaceDecisionRecord, (decisions) =>
    decisions.map((record) => {
      if (record.id !== id) return record;
      if (record.status !== "pending") {
        throw new Error(`Decision ${id} is already ${record.status}.`);
      }
      updated = {
        ...record,
        status: decision,
        decidedAt: new Date().toISOString(),
        ...(trimmedNote ? { decisionNote: trimmedNote } : {}),
        ...(directiveId ? { capturedDirectiveId: directiveId } : {}),
      };
      return updated;
    }),
  );
  if (!updated) return null;
  return { decision: updated, ...(directiveId ? { directiveId } : {}) };
}

/**
 * The text handed back to the agent with the human's call — mirrors
 * workApprovalDecisionAnswer: restates the decision, carries the note, and
 * re-asserts the gate.
 */
export function marketplaceDecisionAnswer(decision: MarketplaceDecision, verdict: "approved" | "denied", note?: string): string {
  const lines = [
    `Human decision on "${decision.title}": ${verdict === "approved" ? "APPROVED" : "REJECTED"}.`,
  ];
  if (note?.trim()) {
    lines.push(decision.kind === "buyer-escalation" && verdict === "approved"
      ? `Send this exact answer to the buyer: ${note.trim()}`
      : `Human note: ${note.trim()}`);
  }
  if (verdict === "approved" && decision.kind === "new-listing") {
    lines.push("Proceed with exactly the approved title, price, description, and photos — no changes.");
  }
  if (verdict === "denied") {
    lines.push("Do not proceed with this action. Apply the note (if any) to how you handle similar situations.");
  }
  return lines.join("\n");
}

/** Housekeeping: pending decisions older than maxAgeMs flip to expired. */
export async function expireStaleMarketplaceDecisions(maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  let expired = 0;
  await mutateRecordsFile(DECISIONS_FILE, normalizeMarketplaceDecisionRecord, (decisions) =>
    decisions.map((decision) => {
      if (decision.status !== "pending") return decision;
      const createdMs = Date.parse(decision.createdAt);
      if (!Number.isFinite(createdMs) || createdMs >= cutoff) return decision;
      expired++;
      return { ...decision, status: "expired" as const, decidedAt: new Date().toISOString() };
    }),
  );
  return expired;
}

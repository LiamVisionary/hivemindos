import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import type { AgentSpendCapAsset } from "@/lib/types/agent-wallet";
import type { SpendKind } from "@/lib/services/wallet/spend-ledger";

/**
 * Human-in-the-loop escalation queue. When a spend exceeds an agent's approval
 * threshold (and is not already covered by a granted approval), governance
 * enqueues a pending request here instead of executing. A human approves it from
 * the dashboard, the agent retries, and the grant is consumed exactly once.
 */

export type SpendApprovalStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

export type SpendApprovalRequest = {
  id: string;
  agentId: string;
  agentName?: string;
  companyId?: string;
  kind: SpendKind;
  asset: AgentSpendCapAsset;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  reason: string;
  status: SpendApprovalStatus;
  createdAt: string;
  createdAtMs: number;
  expiresAtMs: number;
  decidedAt?: string;
  decidedBy?: string;
};

export const SPEND_APPROVALS_PATH = path.join(homedir(), ".hivemindos", "spend-approvals.json");

const MAX_RECORDS = 1_000;
/** A pending request that nobody acts on expires after this long. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1_000;
/** An approved grant must be used within this long, then it goes stale. */
const APPROVED_TTL_MS = 60 * 60 * 1_000;
/** Amount match tolerance for consuming a grant (covers rounding). */
const AMOUNT_EPSILON = 0.0001;

async function readRaw(): Promise<SpendApprovalRequest[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(SPEND_APPROVALS_PATH, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SpendApprovalRequest[]) : [];
  } catch {
    return [];
  }
}

function expireStale(records: SpendApprovalRequest[], now: number): SpendApprovalRequest[] {
  return records.map((record) => {
    if (record.status === "pending" && now > record.expiresAtMs) {
      return { ...record, status: "expired" as const };
    }
    if (record.status === "approved" && record.decidedAt) {
      const decidedMs = Date.parse(record.decidedAt);
      if (Number.isFinite(decidedMs) && now > decidedMs + APPROVED_TTL_MS) {
        return { ...record, status: "expired" as const };
      }
    }
    return record;
  });
}

async function writeRaw(records: SpendApprovalRequest[]): Promise<void> {
  await fs.mkdir(path.dirname(SPEND_APPROVALS_PATH), { recursive: true, mode: 0o700 });
  await fs.writeFile(SPEND_APPROVALS_PATH, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), { mode: 0o600 });
}

export async function readApprovals(): Promise<SpendApprovalRequest[]> {
  const now = Date.now();
  const records = expireStale(await readRaw(), now);
  return records;
}

function matchesGrant(
  record: SpendApprovalRequest,
  agentId: string,
  asset: AgentSpendCapAsset,
  amountUsd: number,
): boolean {
  return record.agentId === agentId
    && record.asset === asset
    && amountUsd <= record.amountUsd + AMOUNT_EPSILON;
}

/**
 * Find an equivalent still-actionable request so retrying agents reuse one row
 * rather than stacking duplicate pending escalations.
 */
function findReusable(
  records: SpendApprovalRequest[],
  agentId: string,
  kind: SpendKind,
  asset: AgentSpendCapAsset,
  amountUsd: number,
  target?: string,
): SpendApprovalRequest | undefined {
  return records.find((record) => (
    (record.status === "pending" || record.status === "approved")
    && record.agentId === agentId
    && record.kind === kind
    && record.asset === asset
    && Math.abs(record.amountUsd - amountUsd) <= AMOUNT_EPSILON
    && (record.target ?? "") === (target ?? "")
  ));
}

export type EnqueueApprovalInput = {
  agentId: string;
  agentName?: string;
  companyId?: string;
  kind: SpendKind;
  asset: AgentSpendCapAsset;
  amountUsd: number;
  assetAmount?: number;
  target?: string;
  reason: string;
};

export async function enqueueApproval(input: EnqueueApprovalInput): Promise<SpendApprovalRequest> {
  const now = Date.now();
  const records = expireStale(await readRaw(), now);
  const existing = findReusable(records, input.agentId, input.kind, input.asset, input.amountUsd, input.target);
  if (existing) {
    await writeRaw(records);
    return existing;
  }
  const record: SpendApprovalRequest = {
    id: randomUUID(),
    agentId: input.agentId,
    agentName: input.agentName,
    companyId: input.companyId,
    kind: input.kind,
    asset: input.asset,
    amountUsd: input.amountUsd,
    assetAmount: input.assetAmount,
    target: input.target,
    reason: input.reason,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAtMs: now + PENDING_TTL_MS,
  };
  records.push(record);
  await writeRaw(records);
  return record;
}

export async function listApprovals(filter?: {
  status?: SpendApprovalStatus;
  agentId?: string;
  companyId?: string;
}): Promise<SpendApprovalRequest[]> {
  const records = await readApprovals();
  await writeRaw(records); // persist any lazy expirations
  return records
    .filter((record) => (filter?.status ? record.status === filter.status : true))
    .filter((record) => (filter?.agentId ? record.agentId === filter.agentId : true))
    .filter((record) => (filter?.companyId ? record.companyId === filter.companyId : true))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export async function decideApproval(
  id: string,
  decision: "approved" | "denied",
  decidedBy?: string,
): Promise<SpendApprovalRequest | null> {
  const now = Date.now();
  const records = expireStale(await readRaw(), now);
  const record = records.find((entry) => entry.id === id);
  if (!record) return null;
  if (record.status !== "pending") {
    // Only pending requests can be decided; surface current state unchanged.
    await writeRaw(records);
    return record;
  }
  record.status = decision;
  record.decidedAt = new Date(now).toISOString();
  record.decidedBy = decidedBy;
  await writeRaw(records);
  return record;
}

/**
 * Atomically consume a granted approval for this exact agent/asset/amount.
 * Returns the consumed grant, or null when none is available. The matched grant
 * is flipped to "consumed" so it can authorise only a single spend.
 */
export async function consumeApproval(input: {
  agentId: string;
  asset: AgentSpendCapAsset;
  amountUsd: number;
  token?: string;
}): Promise<SpendApprovalRequest | null> {
  const now = Date.now();
  const records = expireStale(await readRaw(), now);
  const grant = records.find((record) => (
    record.status === "approved"
    && (input.token ? record.id === input.token : true)
    && matchesGrant(record, input.agentId, input.asset, input.amountUsd)
  ));
  if (!grant) {
    await writeRaw(records);
    return null;
  }
  grant.status = "consumed";
  await writeRaw(records);
  return grant;
}

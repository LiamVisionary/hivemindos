import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";
import type { AgentSpendCapAsset } from "@/lib/types/agent-wallet";

/**
 * Unified, cross-rail spend ledger. Every executed agent payment (x402, wallet
 * send, Veil private transfer) is appended here so cumulative budgets and
 * company rollups can be enforced against a single source of truth. The legacy
 * per-rail x402-spend-log.json is left intact for back-compat.
 */

export type SpendKind = "x402" | "x402-private" | "send" | "veil-transfer" | "trade" | "platform-fee";

export type SpendLedgerRecord = {
  id: string;
  agentId: string;
  companyId?: string;
  kind: SpendKind;
  asset: AgentSpendCapAsset;
  /** USD value of the spend; 0 when no USD quote is available (e.g. a raw ETH send). */
  amountUsd: number;
  /** Raw asset amount when the spend is denominated in a non-USD asset. */
  assetAmount?: number;
  /** Short, non-secret destination label (URL origin or truncated address). */
  target?: string;
  status: "executed" | "failed";
  /** Approval request id that authorised this spend, when it required escalation. */
  approvalId?: string;
  /** Public chain transaction hash when the spend executed on-chain. */
  transactionHash?: string;
  createdAt: string;
  createdAtMs: number;
};

export const SPEND_LEDGER_PATH = path.join(homedir(), ".hivemindos", "spend-ledger.json");

const MAX_RECORDS = 5_000;
export const ROLLING_DAY_MS = 24 * 60 * 60 * 1_000;
export const ROLLING_MONTH_MS = 30 * ROLLING_DAY_MS;

export async function readSpendLedger(): Promise<SpendLedgerRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(SPEND_LEDGER_PATH, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SpendLedgerRecord[]) : [];
  } catch {
    return [];
  }
}

export async function appendSpend(
  input: Omit<SpendLedgerRecord, "id" | "createdAt" | "createdAtMs"> & { createdAtMs?: number },
): Promise<SpendLedgerRecord> {
  const createdAtMs = input.createdAtMs ?? Date.now();
  const record: SpendLedgerRecord = {
    ...input,
    id: randomUUID(),
    createdAtMs,
    createdAt: new Date(createdAtMs).toISOString(),
  };
  await fs.mkdir(path.dirname(SPEND_LEDGER_PATH), { recursive: true, mode: 0o700 });
  const records = await readSpendLedger();
  records.push(record);
  await fs.writeFile(SPEND_LEDGER_PATH, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), { mode: 0o600 });
  return record;
}

function sumUsd(records: SpendLedgerRecord[], predicate: (record: SpendLedgerRecord) => boolean, sinceMs: number): number {
  let total = 0;
  for (const record of records) {
    if (record.status !== "executed") continue;
    if (record.createdAtMs < sinceMs) continue;
    if (!predicate(record)) continue;
    total += Number(record.amountUsd) || 0;
  }
  return Math.round(total * 100) / 100;
}

export async function sumAgentSpendUsdSince(agentId: string, sinceMs: number, records?: SpendLedgerRecord[]): Promise<number> {
  const ledger = records ?? (await readSpendLedger());
  return sumUsd(ledger, (record) => record.agentId === agentId, sinceMs);
}

export async function sumCompanySpendUsdSince(companyId: string, sinceMs: number, records?: SpendLedgerRecord[]): Promise<number> {
  if (!companyId) return 0;
  const ledger = records ?? (await readSpendLedger());
  return sumUsd(ledger, (record) => record.companyId === companyId, sinceMs);
}

export function shortTarget(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.slice(0, 80);
  }
}

import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { homedir } from "@/lib/home-dir";

/**
 * Unified, cross-rail spend ledger. Every executed agent payment (x402, wallet
 * send, Veil private transfer) is appended here so cumulative budgets and
 * company rollups can be enforced against a single source of truth. The legacy
 * per-rail x402-spend-log.json is left intact for back-compat.
 */

export type SpendKind = "x402" | "x402-private" | "send" | "veil-transfer" | "trade" | "platform-fee" | "api";

export type SpendLedgerRecord = {
  id: string;
  agentId: string;
  companyId?: string;
  kind: SpendKind;
  asset: string;
  /** USD value of the spend; 0 when no USD quote is available (e.g. a raw ETH send). */
  amountUsd: number;
  /** Raw asset amount when the spend is denominated in a non-USD asset. */
  assetAmount?: number;
  /** Short, non-secret destination label (URL origin or truncated address). */
  target?: string;
  status: "executed" | "failed";
  /** Approval request id that authorised this spend, when it required escalation. */
  approvalId?: string;
  /** Stable source key for retry-safe bridges such as observed company API usage. */
  idempotencyKey?: string;
  /** Public chain transaction hash when the spend executed on-chain. */
  transactionHash?: string;
  /** For a "trade" (DEX swap): the tokens + human amounts on each leg, so the
   *  activity feed can show "Sold X HIVE → Y USDC" instead of a bare "USDC swap". */
  swap?: { sellToken: string; sellAmount: number; buyToken: string; buyAmount: number };
  createdAt: string;
  createdAtMs: number;
};

export const SPEND_LEDGER_PATH = path.join(homedir(), ".hivemindos", "spend-ledger.json");

const MAX_RECORDS = 5_000;
export const ROLLING_DAY_MS = 24 * 60 * 60 * 1_000;
export const ROLLING_MONTH_MS = 30 * ROLLING_DAY_MS;

/**
 * Thrown when the spend ledger is present but unparseable. Returning [] on this
 * used to be a money-safety hole in both directions: a budget check would see
 * zero historical spend (i.e. treat the budget as unlimited), and the next
 * appendSpend would persist only its one record — destroying the entire spend
 * history. We fail closed instead: reads throw, so budget checks block the spend
 * and appendSpend refuses to overwrite the ledger until it is repaired.
 */
export class SpendLedgerCorruptError extends Error {
  // Explicit fields (no constructor parameter properties): the hermetic suites
  // import this via Node's strip-only TS, which rejects parameter-property syntax.
  readonly file: string;
  constructor(file: string) {
    super(
      `[spend-ledger] refusing to read a corrupt spend ledger at ${file}. Spend history was NOT wiped; ` +
        `budget checks fail closed (block) until it is repaired.`,
    );
    this.name = "SpendLedgerCorruptError";
    this.file = file;
  }
}

export async function readSpendLedger(): Promise<SpendLedgerRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(SPEND_LEDGER_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new SpendLedgerCorruptError(SPEND_LEDGER_PATH);
  }
  const trimmed = text.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    console.error(
      `[spend-ledger] CORRUPT spend ledger at ${SPEND_LEDGER_PATH} — budget checks fail closed until repaired:`,
      error,
    );
    throw new SpendLedgerCorruptError(SPEND_LEDGER_PATH);
  }
  return Array.isArray(parsed) ? (parsed as SpendLedgerRecord[]) : [];
}

/** Serializes appends within a process so two concurrent spends can't interleave
 *  their read-modify-write and drop each other's records. Mirrors company-runs. */
let spendLedgerWriteQueue: Promise<unknown> = Promise.resolve();
function enqueueSpendLedgerWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = spendLedgerWriteQueue.then(fn, fn);
  spendLedgerWriteQueue = next.catch(() => undefined);
  return next;
}

export async function appendSpend(
  input: Omit<SpendLedgerRecord, "id" | "createdAt" | "createdAtMs"> & { createdAtMs?: number },
): Promise<SpendLedgerRecord> {
  return (await appendSpendRecord(input)).record;
}

async function appendSpendRecord(
  input: Omit<SpendLedgerRecord, "id" | "createdAt" | "createdAtMs"> & { createdAtMs?: number },
  idempotencyKey?: string,
): Promise<{ record: SpendLedgerRecord; duplicate: boolean }> {
  const createdAtMs = input.createdAtMs ?? Date.now();
  return enqueueSpendLedgerWrite(async () => {
    await fs.mkdir(path.dirname(SPEND_LEDGER_PATH), { recursive: true, mode: 0o700 });
    // readSpendLedger throws on a corrupt file → abort rather than overwrite (wipe) history.
    const records = await readSpendLedger();
    if (idempotencyKey) {
      const existing = records.find((entry) => entry.idempotencyKey === idempotencyKey);
      if (existing) return { record: existing, duplicate: true };
    }
    const record: SpendLedgerRecord = {
      ...input,
      idempotencyKey: idempotencyKey || input.idempotencyKey,
      id: randomUUID(),
      createdAtMs,
      createdAt: new Date(createdAtMs).toISOString(),
    };
    records.push(record);
    // Atomic tmp+rename so a concurrent reader never sees a torn half-written file.
    const tmp = `${SPEND_LEDGER_PATH}.${process.pid}.${createdAtMs}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), { mode: 0o600 });
    await fs.rename(tmp, SPEND_LEDGER_PATH);
    return { record, duplicate: false };
  });
}

/** Append one executed spend exactly once across retries from a metered source. */
export async function appendSpendIdempotent(
  input: Omit<SpendLedgerRecord, "id" | "createdAt" | "createdAtMs" | "idempotencyKey"> & { createdAtMs?: number },
  idempotencyKey: string,
): Promise<{ record: SpendLedgerRecord; duplicate: boolean }> {
  const key = idempotencyKey.trim();
  if (!key) throw new Error("A spend-ledger idempotency key is required.");
  return appendSpendRecord(input, key);
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

export async function sumCompanyMemberSpendUsdSince(
  companyId: string,
  agentId: string,
  sinceMs: number,
  records?: SpendLedgerRecord[],
): Promise<number> {
  if (!companyId || !agentId) return 0;
  const ledger = records ?? (await readSpendLedger());
  return sumUsd(ledger, (record) => record.companyId === companyId && record.agentId === agentId, sinceMs);
}

export async function sumCompanyKindSpendUsdSince(
  companyId: string,
  kind: SpendKind,
  sinceMs: number,
  records?: SpendLedgerRecord[],
): Promise<number> {
  if (!companyId) return 0;
  const ledger = records ?? (await readSpendLedger());
  return sumUsd(ledger, (record) => record.companyId === companyId && record.kind === kind, sinceMs);
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

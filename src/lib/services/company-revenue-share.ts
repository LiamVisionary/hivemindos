import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { homedir } from "@/lib/home-dir";
import { appendCompanyMemory } from "@/lib/services/company-memory";
import { getCompany } from "@/lib/services/companies-store";
import { getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import {
  collectTradingPlatformFee,
  quoteTradingPlatformFee,
  type PlatformFeeCollection,
  type PlatformFeeQuote,
} from "@/lib/services/wallet/platform-fees";
import type {
  CompanyRevenueEventSource,
  CompanyRevenueFeeSnapshot,
  CompanyRevenueFeeStatus,
  CompanyRevenueEventStatus,
  CompanyRevenueRecord,
  CompanyRevenueRollup,
} from "@/lib/types/company-revenue";

export type {
  CompanyRevenueEventSource,
  CompanyRevenueFeeSnapshot,
  CompanyRevenueFeeStatus,
  CompanyRevenueEventStatus,
  CompanyRevenueRecord,
  CompanyRevenueRollup,
} from "@/lib/types/company-revenue";

export const COMPANY_REVENUE_LEDGER_PATH = path.join(homedir(), ".hivemindos", "company-revenue-ledger.json");
export const COMPANY_REVENUE_FEE_CONFIRMATION = "COLLECT_COMPANY_REVENUE_FEE";
export const DEFAULT_COMPANY_REVENUE_NETWORK = "eip155:8453";

export type RecordCompanyRevenueInput = {
  companyId: string;
  amountUsd: number;
  source?: CompanyRevenueEventSource | string;
  externalId?: string;
  customerLabel?: string;
  description?: string;
  receivedAt?: string;
  network?: string;
  collectFee?: boolean;
  collectingAgentId?: string;
  confirmation?: string;
};

export type RecordCompanyRevenueResult = {
  record: CompanyRevenueRecord;
  rollup: CompanyRevenueRollup;
  duplicate: boolean;
  feeError?: string;
};

const MAX_RECORDS = 10_000;
const MAX_TEXT_CHARS = 240;
const REVENUE_SOURCES: CompanyRevenueEventSource[] = ["manual", "stripe", "invoice", "x402", "marketplace", "other"];

export async function readCompanyRevenueLedger(): Promise<CompanyRevenueRecord[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(COMPANY_REVENUE_LEDGER_PATH, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeRecord).filter(Boolean) as CompanyRevenueRecord[] : [];
  } catch {
    return [];
  }
}

export async function listCompanyRevenueRecords(companyId: string): Promise<CompanyRevenueRecord[]> {
  const id = cleanText(companyId, 120);
  if (!id) return [];
  return (await readCompanyRevenueLedger())
    .filter((record) => record.companyId === id)
    .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
}

export async function companyRevenueRollup(companyId: string, records?: CompanyRevenueRecord[]): Promise<CompanyRevenueRollup> {
  const id = cleanText(companyId, 120) ?? "";
  if (!id) return emptyRevenueRollup("");
  const scoped = (records ?? await listCompanyRevenueRecords(id)).filter((record) => record.companyId === id);
  let totalRevenueUsd = 0;
  let shareQuotedUsd = 0;
  let shareCollectedUsd = 0;
  let sharePendingUsd = 0;
  let shareFailedUsd = 0;
  let shareUnavailableUsd = 0;
  let lastRevenueMs = 0;

  for (const record of scoped) {
    totalRevenueUsd += record.amountUsd;
    const feeAmount = record.fee.amountUsd;
    if (record.fee.status === "collected") shareCollectedUsd += feeAmount;
    else if (record.fee.status === "failed") shareFailedUsd += feeAmount;
    else if (record.fee.status === "unavailable") shareUnavailableUsd += feeAmount;
    else if (record.fee.status === "quoted") sharePendingUsd += feeAmount;
    if (record.fee.status !== "unavailable") shareQuotedUsd += feeAmount;
    lastRevenueMs = Math.max(lastRevenueMs, Date.parse(record.receivedAt) || record.recordedAtMs);
  }

  return {
    companyId: id,
    eventCount: scoped.length,
    totalRevenueUsd: roundUsd(totalRevenueUsd),
    shareQuotedUsd: roundUsd(shareQuotedUsd),
    shareCollectedUsd: roundUsd(shareCollectedUsd),
    sharePendingUsd: roundUsd(sharePendingUsd),
    shareFailedUsd: roundUsd(shareFailedUsd),
    shareUnavailableUsd: roundUsd(shareUnavailableUsd),
    lastRevenueAt: lastRevenueMs > 0 ? new Date(lastRevenueMs).toISOString() : undefined,
  };
}

export async function quoteCompanyRevenueShare(input: {
  amountUsd: number;
  network?: string;
}): Promise<CompanyRevenueFeeSnapshot> {
  const amountUsd = normalizedAmount(input.amountUsd);
  const network = cleanText(input.network, 80) || DEFAULT_COMPANY_REVENUE_NETWORK;
  const quote = await quoteTradingPlatformFee({ source: "company-revenue", network, amountUsd });
  return feeSnapshotFromQuote(quote);
}

export async function recordCompanyRevenue(input: RecordCompanyRevenueInput): Promise<RecordCompanyRevenueResult> {
  const normalized = normalizeInput(input);
  const company = await getCompany(normalized.companyId);
  if (!company) throw new Error("Company not found.");
  assertFeeCollectionConfirmed(normalized);

  const records = await readCompanyRevenueLedger();
  const duplicate = findDuplicate(records, normalized);
  if (duplicate) {
    if (normalized.collectFee && duplicate.fee.status !== "collected") {
      const updated = await collectFeeForExistingRecord(records, duplicate, normalized);
      return {
        record: updated.record,
        rollup: await companyRevenueRollup(normalized.companyId, updated.records),
        duplicate: true,
        feeError: updated.feeError,
      };
    }
    return {
      record: duplicate,
      rollup: await companyRevenueRollup(normalized.companyId, records),
      duplicate: true,
    };
  }

  const fee = await quoteCompanyRevenueShare({ amountUsd: normalized.amountUsd, network: normalized.network });
  let record: CompanyRevenueRecord = {
    id: randomUUID(),
    companyId: normalized.companyId,
    amountUsd: normalized.amountUsd,
    source: normalized.source,
    externalId: normalized.externalId,
    customerLabel: normalized.customerLabel,
    description: normalized.description,
    receivedAt: normalized.receivedAt,
    recordedAt: new Date().toISOString(),
    recordedAtMs: Date.now(),
    status: statusForFee(fee),
    fee,
    collectingAgentId: normalized.collectingAgentId,
  };

  let feeError: string | undefined;
  if (normalized.collectFee) {
    const collected = await collectCompanyRevenueFee(record, normalized.collectingAgentId, normalized.confirmation)
      .catch((error) => {
        feeError = error instanceof Error ? error.message : "Company revenue share collection failed.";
        return null;
      });
    if (collected) record = applyCollectedFee(record, collected);
    else record = applyFailedFee(record, feeError);
  }

  records.push(record);
  await writeCompanyRevenueLedger(records);
  await appendCompanyMemory(normalized.companyId, {
    kind: "note",
    title: record.status === "fee-collected"
      ? `Revenue recorded and share collected: ${formatUsd(record.amountUsd)}`
      : `Revenue recorded: ${formatUsd(record.amountUsd)}`,
    detail: [
      `Source: ${record.source}`,
      `HivemindOS share: ${formatUsd(record.fee.amountUsd)} ${record.fee.status}`,
      feeError ? `Fee error: ${feeError}` : null,
      record.description,
    ].filter(Boolean).join(" — "),
  }).catch(() => undefined);

  return {
    record,
    rollup: await companyRevenueRollup(normalized.companyId, records),
    duplicate: false,
    feeError,
  };
}

export async function collectCompanyRevenueFeeForEvent(input: {
  eventId: string;
  collectingAgentId: string;
  confirmation?: string;
}): Promise<RecordCompanyRevenueResult> {
  const id = cleanText(input.eventId, 120);
  if (!id) throw new Error("eventId is required.");
  const records = await readCompanyRevenueLedger();
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error("Revenue event not found.");
  const updated = await collectFeeForExistingRecord(records, record, {
    ...record,
    network: record.fee.network,
    collectFee: true,
    collectingAgentId: cleanText(input.collectingAgentId, 160),
    confirmation: input.confirmation,
  });
  return {
    record: updated.record,
    rollup: await companyRevenueRollup(record.companyId, updated.records),
    duplicate: false,
    feeError: updated.feeError,
  };
}

async function collectFeeForExistingRecord(
  records: CompanyRevenueRecord[],
  record: CompanyRevenueRecord,
  input: NormalizedRevenueInput,
): Promise<{ record: CompanyRevenueRecord; records: CompanyRevenueRecord[]; feeError?: string }> {
  assertFeeCollectionConfirmed(input);
  let next = record;
  let feeError: string | undefined;
  const collected = await collectCompanyRevenueFee(record, input.collectingAgentId, input.confirmation)
    .catch((error) => {
      feeError = error instanceof Error ? error.message : "Company revenue share collection failed.";
      return null;
    });
  next = collected ? applyCollectedFee(record, collected) : applyFailedFee(record, feeError);
  const updatedRecords = records.map((item) => item.id === record.id ? next : item);
  await writeCompanyRevenueLedger(updatedRecords);
  return { record: next, records: updatedRecords, feeError };
}

function assertFeeCollectionConfirmed(input: Pick<NormalizedRevenueInput, "collectFee" | "confirmation">): void {
  if (input.collectFee && input.confirmation !== COMPANY_REVENUE_FEE_CONFIRMATION) {
    throw new Error(`Type ${COMPANY_REVENUE_FEE_CONFIRMATION} to collect the company revenue share.`);
  }
}

async function collectCompanyRevenueFee(
  record: CompanyRevenueRecord,
  collectingAgentId?: string,
  confirmation?: string,
): Promise<PlatformFeeCollection> {
  if (confirmation !== COMPANY_REVENUE_FEE_CONFIRMATION) {
    throw new Error(`Type ${COMPANY_REVENUE_FEE_CONFIRMATION} to collect the company revenue share.`);
  }
  const agentId = cleanText(collectingAgentId, 160);
  if (!agentId) throw new Error("collectingAgentId is required to collect the company revenue share.");
  const wallet = await getWalletSecret(agentId);
  if (!wallet) throw new Error("No local wallet exists for the collecting agent.");
  const collected = await collectTradingPlatformFee({
    agentId,
    network: wallet.info.network,
    secret: wallet.secret,
    fromAddress: wallet.info.address,
    amountUsd: record.amountUsd,
    source: "company-revenue",
    companyId: record.companyId,
  });
  if (!collected) throw new Error("Company revenue share policy is disabled.");
  return collected;
}

async function writeCompanyRevenueLedger(records: CompanyRevenueRecord[]): Promise<void> {
  await fs.mkdir(path.dirname(COMPANY_REVENUE_LEDGER_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${COMPANY_REVENUE_LEDGER_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), { mode: 0o600 });
  await fs.rename(tmp, COMPANY_REVENUE_LEDGER_PATH);
}

function feeSnapshotFromQuote(quote: PlatformFeeQuote): CompanyRevenueFeeSnapshot {
  return {
    status: quote.enabled && quote.configured && quote.amountUsd > 0 ? "quoted" : "unavailable",
    enabled: quote.enabled,
    configured: quote.configured,
    network: quote.network,
    amountUsd: quote.amountUsd,
    basisPoints: quote.basisPoints,
    minFeeUsd: quote.minFeeUsd,
    maxFeeUsd: quote.maxFeeUsd,
    assetSymbol: quote.assetSymbol,
    recipient: quote.recipient,
    recipientKey: quote.recipientKey,
    reason: quote.reason,
  };
}

function statusForFee(fee: CompanyRevenueFeeSnapshot): CompanyRevenueEventStatus {
  if (fee.status === "quoted") return "fee-pending";
  return "fee-unavailable";
}

function applyCollectedFee(record: CompanyRevenueRecord, collected: PlatformFeeCollection): CompanyRevenueRecord {
  return {
    ...record,
    collectingAgentId: record.collectingAgentId,
    status: "fee-collected",
    fee: {
      ...feeSnapshotFromQuote(collected),
      status: "collected",
      signature: collected.signature,
      collectedAt: new Date().toISOString(),
    },
  };
}

function applyFailedFee(record: CompanyRevenueRecord, reason?: string): CompanyRevenueRecord {
  return {
    ...record,
    status: "fee-failed",
    fee: {
      ...record.fee,
      status: "failed",
      reason: reason || record.fee.reason || "Company revenue share collection failed.",
    },
  };
}

type NormalizedRevenueInput = {
  companyId: string;
  amountUsd: number;
  source: CompanyRevenueEventSource;
  receivedAt: string;
  externalId?: string;
  customerLabel?: string;
  description?: string;
  network?: string;
  collectFee?: boolean;
  collectingAgentId?: string;
  confirmation?: string;
};

function emptyRevenueRollup(companyId: string): CompanyRevenueRollup {
  return {
    companyId,
    eventCount: 0,
    totalRevenueUsd: 0,
    shareQuotedUsd: 0,
    shareCollectedUsd: 0,
    sharePendingUsd: 0,
    shareFailedUsd: 0,
    shareUnavailableUsd: 0,
  };
}

function normalizeInput(input: RecordCompanyRevenueInput): NormalizedRevenueInput {
  const companyId = cleanText(input.companyId, 120);
  if (!companyId) throw new Error("companyId is required.");
  const amountUsd = normalizedAmount(input.amountUsd);
  if (amountUsd <= 0) throw new Error("amountUsd must be greater than zero.");
  return {
    companyId,
    amountUsd,
    source: normalizeSource(input.source),
    externalId: cleanText(input.externalId, 180),
    customerLabel: cleanText(input.customerLabel, 120),
    description: cleanText(input.description, MAX_TEXT_CHARS),
    receivedAt: normalizeDate(input.receivedAt),
    network: cleanText(input.network, 80) || DEFAULT_COMPANY_REVENUE_NETWORK,
    collectFee: input.collectFee === true,
    collectingAgentId: cleanText(input.collectingAgentId, 160),
    confirmation: cleanText(input.confirmation, 80),
  };
}

function normalizeRecord(value: unknown): CompanyRevenueRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CompanyRevenueRecord>;
  const id = cleanText(raw.id, 120);
  const companyId = cleanText(raw.companyId, 120);
  const amountUsd = normalizedAmount(raw.amountUsd);
  if (!id || !companyId || amountUsd <= 0 || !raw.fee) return null;
  return {
    id,
    companyId,
    amountUsd,
    source: normalizeSource(raw.source),
    externalId: cleanText(raw.externalId, 180),
    customerLabel: cleanText(raw.customerLabel, 120),
    description: cleanText(raw.description, MAX_TEXT_CHARS),
    receivedAt: normalizeDate(raw.receivedAt),
    recordedAt: normalizeDate(raw.recordedAt),
    recordedAtMs: Number.isFinite(raw.recordedAtMs) ? Number(raw.recordedAtMs) : Date.parse(normalizeDate(raw.recordedAt)),
    status: normalizeStatus(raw.status),
    fee: normalizeFee(raw.fee),
    collectingAgentId: cleanText(raw.collectingAgentId, 160),
  };
}

function normalizeFee(value: CompanyRevenueFeeSnapshot): CompanyRevenueFeeSnapshot {
  return {
    status: normalizeFeeStatus(value.status),
    enabled: value.enabled === true,
    configured: value.configured === true,
    network: cleanText(value.network, 80) || DEFAULT_COMPANY_REVENUE_NETWORK,
    amountUsd: normalizedAmount(value.amountUsd),
    basisPoints: nonNegativeNumber(value.basisPoints),
    minFeeUsd: nonNegativeNumber(value.minFeeUsd),
    maxFeeUsd: value.maxFeeUsd == null ? undefined : nonNegativeNumber(value.maxFeeUsd),
    assetSymbol: value.assetSymbol === "USDG" ? "USDG" : "USDC",
    recipient: cleanText(value.recipient, 120),
    recipientKey: cleanText(value.recipientKey, 80),
    signature: cleanText(value.signature, 180),
    reason: cleanText(value.reason, MAX_TEXT_CHARS),
    collectedAt: value.collectedAt ? normalizeDate(value.collectedAt) : undefined,
  };
}

function findDuplicate(records: CompanyRevenueRecord[], input: NormalizedRevenueInput): CompanyRevenueRecord | undefined {
  if (!input.externalId) return undefined;
  return records.find((record) => (
    record.companyId === input.companyId &&
    record.source === input.source &&
    record.externalId === input.externalId
  ));
}

function normalizeSource(value: unknown): CompanyRevenueEventSource {
  return typeof value === "string" && (REVENUE_SOURCES as string[]).includes(value)
    ? value as CompanyRevenueEventSource
    : "manual";
}

function normalizeStatus(value: unknown): CompanyRevenueEventStatus {
  return value === "fee-pending" || value === "fee-collected" || value === "fee-unavailable" || value === "fee-failed"
    ? value
    : "recorded";
}

function normalizeFeeStatus(value: unknown): CompanyRevenueFeeStatus {
  return value === "collected" || value === "unavailable" || value === "failed" ? value : "quoted";
}

function cleanText(value: unknown, max = MAX_TEXT_CHARS): string | undefined {
  const text = typeof value === "string" ? value.replaceAll("\0", "").trim() : "";
  return text ? text.slice(0, max) : undefined;
}

function normalizedAmount(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return roundUsd(number);
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeDate(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function roundUsd(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatUsd(value: number): string {
  return `$${roundUsd(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

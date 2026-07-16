#!/usr/bin/env node
// Contract coverage for Zero Human Company API/integration usage limits.
// The service is exercised against an isolated HOME so the real company usage
// ledger is never read or mutated.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-api-limits-"));
process.env.HOME = tempHome;

const {
  COMPANY_API_USAGE_PATH,
  CompanyApiUsageLedgerCorruptError,
  buildCompanyApiUsageSnapshot,
  consumeCompanyApiUsage,
  evaluateCompanyApiUsage,
  recordCompanyApiUsage,
  readCompanyApiUsage,
} = await import("../src/lib/services/company-api-usage.ts");
const { appendSpendIdempotent, readSpendLedger } = await import("../src/lib/services/wallet/spend-ledger.ts");

const NOW = Date.parse("2026-07-14T18:00:00.000Z");
const company = {
  id: "co-limits",
  name: "Guarded Company",
  frozen: false,
  integrationLimits: [
    {
      id: "google-cloud:all",
      providerKey: "google-cloud",
      dailyRequestLimit: 3,
      monthlyRequestLimit: 8,
      dailySpendLimitUsd: 2,
      monthlySpendLimitUsd: 5,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    },
  ],
};

const records = [
  {
    id: "usage-1",
    companyId: company.id,
    providerKey: "google-cloud",
    operationId: "places-text-search",
    requestCount: 2,
    amountUsd: 1.25,
    status: "reserved",
    source: "test",
    createdAt: "2026-07-14T12:00:00.000Z",
    createdAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
  },
  {
    id: "usage-2",
    companyId: company.id,
    providerKey: "google-cloud",
    operationId: "places-photo",
    requestCount: 4,
    amountUsd: 2.5,
    status: "reserved",
    source: "test",
    createdAt: "2026-07-01T12:00:00.000Z",
    createdAtMs: Date.parse("2026-07-01T12:00:00.000Z"),
  },
  {
    id: "usage-other-company",
    companyId: "co-other",
    providerKey: "google-cloud",
    requestCount: 999,
    amountUsd: 999,
    status: "reserved",
    source: "test",
    createdAt: "2026-07-14T12:00:00.000Z",
    createdAtMs: Date.parse("2026-07-14T12:00:00.000Z"),
  },
];

const allowed = evaluateCompanyApiUsage(
  company,
  { providerKey: "google-cloud", operationId: "places-details", requestCount: 1, amountUsd: 0.5 },
  records,
  NOW,
);
assert.equal(allowed.decision, "allow", "usage below every configured limit is allowed");
assert.equal(allowed.usage.dailyRequests, 2);
assert.equal(allowed.usage.monthlyRequests, 6);

const requestBlocked = evaluateCompanyApiUsage(
  company,
  { providerKey: "google-cloud", requestCount: 2, amountUsd: 0 },
  records,
  NOW,
);
assert.equal(requestBlocked.decision, "block", "the daily request limit blocks before execution");
assert.match(requestBlocked.reason, /daily request limit/i);

const spendBlocked = evaluateCompanyApiUsage(
  company,
  { providerKey: "google-cloud", requestCount: 1, amountUsd: 1 },
  records,
  NOW,
);
assert.equal(spendBlocked.decision, "block", "the daily spend limit blocks before execution");
assert.match(spendBlocked.reason, /daily spend limit/i);

const frozen = evaluateCompanyApiUsage(
  { ...company, frozen: true },
  { providerKey: "google-cloud", requestCount: 1, amountUsd: 0 },
  records,
  NOW,
);
assert.equal(frozen.decision, "block", "the company kill switch also blocks integration usage");

const snapshot = buildCompanyApiUsageSnapshot(company.id, records, company.integrationLimits, NOW);
assert.equal(snapshot.dailyRequests, 2);
assert.equal(snapshot.monthlyRequests, 6);
assert.equal(snapshot.monthlySpendUsd, 3.75);
assert.equal(snapshot.series.length, 30, "the chart always receives a complete 30-day UTC series");
assert.equal(snapshot.byProvider.length, 1);
assert.equal(snapshot.byProvider[0].providerKey, "google-cloud");
assert.equal(snapshot.byProvider[0].monthlyRequests, 6);

const first = await consumeCompanyApiUsage(
  company,
  {
    providerKey: "google-cloud",
    operationId: "places-details",
    requestCount: 1,
    amountUsd: 0.25,
    source: "test-consume",
    idempotencyKey: "consume-once",
  },
  { now: () => NOW },
);
assert.equal(first.decision, "allow");
assert.equal(first.duplicate, false);

const duplicate = await consumeCompanyApiUsage(
  company,
  {
    providerKey: "google-cloud",
    operationId: "places-details",
    requestCount: 1,
    amountUsd: 0.25,
    source: "test-consume",
    idempotencyKey: "consume-once",
  },
  { now: () => NOW },
);
assert.equal(duplicate.decision, "allow");
assert.equal(duplicate.duplicate, true, "retries with the same idempotency key do not double count");
assert.equal((await readCompanyApiUsage()).length, 1);
await assert.rejects(
  consumeCompanyApiUsage(
    company,
    {
      providerKey: "google-cloud",
      operationId: "places-details",
      requestCount: 2,
      amountUsd: 0.25,
      source: "test-consume",
      idempotencyKey: "consume-once",
    },
    { now: () => NOW },
  ),
  /idempotency key was already used for different API usage/i,
  "an idempotency key cannot be replayed with a different request count",
);

const observed = await recordCompanyApiUsage(
  company.id,
  {
    providerKey: "google-cloud",
    operationId: "read-provider-api",
    requestCount: 7,
    amountUsd: 0.42,
    source: "external-meter",
    idempotencyKey: "observed-once",
  },
  { now: () => NOW },
);
assert.equal(observed.duplicate, false);
assert.equal(observed.record.status, "observed", "external meters append observed usage without pretending it was a preflight reservation");
const observedDuplicate = await recordCompanyApiUsage(
  company.id,
  {
    providerKey: "google-cloud",
    operationId: "read-provider-api",
    requestCount: 7,
    amountUsd: 0.42,
    source: "external-meter",
    idempotencyKey: "observed-once",
  },
  { now: () => NOW },
);
assert.equal(observedDuplicate.duplicate, true);
assert.equal((await readCompanyApiUsage()).length, 2, "observed retries do not double count");

const spendInput = {
  agentId: "system:api-meter",
  companyId: company.id,
  kind: "api",
  asset: "USD",
  amountUsd: observed.record.amountUsd,
  target: "google-cloud:read-provider-api",
  status: "executed",
  createdAtMs: NOW,
};
const treasuryFirst = await appendSpendIdempotent(spendInput, `company-api-usage:${observed.record.id}`);
const treasuryDuplicate = await appendSpendIdempotent(spendInput, `company-api-usage:${observed.record.id}`);
assert.equal(treasuryFirst.duplicate, false);
assert.equal(treasuryDuplicate.duplicate, true, "an observed cost reaches Treasury exactly once across retries");
assert.equal((await readSpendLedger()).length, 1);

await writeFile(COMPANY_API_USAGE_PATH, "{ corrupt json ]");
const corruptBytes = await readFile(COMPANY_API_USAGE_PATH, "utf8");
await assert.rejects(
  consumeCompanyApiUsage(
    company,
    { providerKey: "google-cloud", requestCount: 1, amountUsd: 0, source: "test-corrupt" },
    { now: () => NOW },
  ),
  CompanyApiUsageLedgerCorruptError,
  "a corrupt usage ledger must fail closed",
);
assert.equal(await readFile(COMPANY_API_USAGE_PATH, "utf8"), corruptBytes, "corrupt history is never overwritten");

await rm(tempHome, { recursive: true, force: true });
console.log("test-company-api-limits: OK");

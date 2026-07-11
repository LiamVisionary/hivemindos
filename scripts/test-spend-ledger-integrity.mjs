#!/usr/bin/env node
// Hermetic coverage for the money-safety guards on the spend ledger + approval
// grants (the audit flagged both as untested):
// - a corrupt spend ledger fails closed: reads throw and appendSpend refuses to
//   overwrite (wipe) history, instead of reading as zero spend / unlimited budget
// - concurrent appends are serialized, so none are silently dropped
// - an approval grant is scoped to the exact agent + asset + KIND + TARGET the
//   human approved, so it can't be consumed by a different spend
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-spend-integrity-"));
process.env.HOME = tempHome; // redirect ~/.hivemindos BEFORE the modules resolve their paths

const { readSpendLedger, appendSpend, SpendLedgerCorruptError, SPEND_LEDGER_PATH } = await import(
  "../src/lib/services/wallet/spend-ledger.ts"
);
const { consumeApproval, SPEND_APPROVALS_PATH } = await import("../src/lib/services/wallet/spend-approvals.ts");

try {
  // ── spend ledger: missing → empty, append works, concurrent appends don't drop ──
  assert.deepEqual(await readSpendLedger(), [], "a missing ledger reads as an empty history");
  await appendSpend({ agentId: "a1", kind: "x402", asset: "USDC", amountUsd: 5, status: "executed" });
  assert.equal((await readSpendLedger()).length, 1, "an append lands");

  await Promise.all([
    appendSpend({ agentId: "a1", kind: "x402", asset: "USDC", amountUsd: 1, status: "executed" }),
    appendSpend({ agentId: "a1", kind: "x402", asset: "USDC", amountUsd: 2, status: "executed" }),
    appendSpend({ agentId: "a1", kind: "x402", asset: "USDC", amountUsd: 3, status: "executed" }),
  ]);
  assert.equal((await readSpendLedger()).length, 4, "concurrent appends are serialized, none dropped");

  // ── spend ledger: corrupt file fails closed and is not wiped ──
  await writeFile(SPEND_LEDGER_PATH, "{ not valid json ]");
  const corruptBytes = await readFile(SPEND_LEDGER_PATH, "utf8");
  await assert.rejects(
    readSpendLedger(),
    (error) => error instanceof SpendLedgerCorruptError,
    "a corrupt ledger throws instead of reading as zero spend (unlimited budget)",
  );
  await assert.rejects(
    appendSpend({ agentId: "a1", kind: "x402", asset: "USDC", amountUsd: 9, status: "executed" }),
    (error) => error instanceof SpendLedgerCorruptError,
    "appendSpend refuses to overwrite a corrupt ledger",
  );
  assert.equal(await readFile(SPEND_LEDGER_PATH, "utf8"), corruptBytes, "the corrupt ledger is left intact, not wiped");

  // ── approval grants are scoped to the exact approved action (agent+asset+kind+target) ──
  const now = Date.now();
  const grant = {
    id: "grant-firecrawl-40",
    agentId: "a1",
    kind: "x402",
    asset: "USDC",
    amountUsd: 40,
    target: "firecrawl",
    reason: "Firecrawl top-up",
    status: "approved",
    createdAt: new Date(now).toISOString(),
    createdAtMs: now,
    expiresAtMs: now + 60 * 60 * 1000,
    decidedAt: new Date(now).toISOString(),
  };
  await writeFile(SPEND_APPROVALS_PATH, JSON.stringify([grant], null, 2));

  assert.equal(
    await consumeApproval({ agentId: "a1", asset: "USDC", amountUsd: 40, kind: "api", target: "firecrawl" }),
    null,
    "a grant for kind x402 is not consumed by a kind api spend",
  );
  assert.equal(
    await consumeApproval({ agentId: "a1", asset: "USDC", amountUsd: 40, kind: "x402", target: "somewhere-else" }),
    null,
    "a grant for target firecrawl is not consumed by a spend to a different target",
  );
  const consumed = await consumeApproval({ agentId: "a1", asset: "USDC", amountUsd: 40, kind: "x402", target: "firecrawl" });
  assert.ok(consumed && consumed.id === "grant-firecrawl-40", "the exact approved action consumes the grant");
  assert.equal(
    await consumeApproval({ agentId: "a1", asset: "USDC", amountUsd: 40, kind: "x402", target: "firecrawl" }),
    null,
    "a consumed grant cannot be reused",
  );

  console.log("spend ledger + approval grant integrity suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);

#!/usr/bin/env node
// Hermetic coverage for the revenue-IN rail bridging:
// - settled x402 seller receipts sweep into the company revenue ledger
//   with externalId idempotency (re-sweeps never double-count)
// - bridged revenue moves apexGoal.current through the existing
//   recordCompanyRevenue → updateCompanyMetric composition
// - ineligible receipts (no company, dev-bypass, failed settlement) are skipped
// - the Stripe checkout webhook records company revenue idempotently and
//   fails closed on bad signatures
// - both Stripe webhook routes stay exempt from the dashboard proxy gate
import { register } from "node:module";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-revenue-rail-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-revenue-rail-vault-"));

process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS = "0";
process.env.HIVEMINDOS_PLATFORM_FEE_POLICY_URL = "disabled";
delete process.env.HIVEMINDOS_COMPANY_STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;

const { PAID_AGENT_RECEIPT_PATH } = await import("../src/lib/services/paid-agent-gateway.ts");
const {
  receiptRevenueEligibility,
  syncPaidAgentReceiptsToCompanyRevenue,
} = await import("../src/lib/services/company-revenue-bridge.ts");
const { listCompanyRevenueRecords } = await import("../src/lib/services/company-revenue-share.ts");
const { getCompany, upsertCompany } = await import("../src/lib/services/companies-store.ts");

try {
  const company = await upsertCompany({
    name: "Rail Co",
    members: [{ agentId: "hermes-alpha", roleInCompany: "Queen" }],
    apexGoal: { title: "Reach $1k", metric: "revenue", target: "1000", unit: "currency" },
  });

  const receipt = (overrides) => ({
    id: `pag_${Math.random().toString(36).slice(2)}`,
    createdAt: "2026-07-15T12:00:00.000Z",
    slug: "maps-audit",
    kind: "agent-call",
    agentId: "paid-agent-maps-audit",
    agentName: "Maps Audit",
    runtime: "hivemind-os",
    provider: "lm-studio",
    model: "qwen",
    priceUsd: 40,
    network: "eip155:8453",
    settlement: { success: true, transaction: "0xabc", payer: "0x9999999999999999999999999999999999999999", network: "eip155:8453" },
    durationMs: 1200,
    inputChars: 100,
    outputChars: 400,
    ...overrides,
  });

  const receipts = [
    receipt({ id: "pag_agent_call", companyId: company.id }),
    receipt({ id: "pag_no_company" }),
    receipt({ id: "pag_dev_bypass", companyId: company.id, settlement: { success: true, transaction: "dev-bypass" } }),
    receipt({ id: "pag_failed", companyId: company.id, settlement: { success: false, errorReason: "settle_failed" } }),
    receipt({
      id: "pago_offer",
      companyId: company.id,
      kind: "company-offer",
      slug: "rail-co-starter",
      productKey: "starter",
      priceUsd: 100,
      customerContact: "buyer@example.com",
    }),
    receipt({ id: "pag_ghost_company", companyId: "no-such-company" }),
  ];
  await mkdir(dirname(PAID_AGENT_RECEIPT_PATH), { recursive: true });
  await writeFile(
    PAID_AGENT_RECEIPT_PATH,
    `${receipts.map((entry) => JSON.stringify(entry)).join("\n")}\nnot-json\n`,
    "utf8",
  );

  assert.equal(receiptRevenueEligibility(receipts[0]).eligible, true);
  assert.equal(receiptRevenueEligibility(receipts[2]).reason, "dev-bypass");
  assert.equal(receiptRevenueEligibility(receipts[3]).reason, "settlement-failed");

  const sweep = await syncPaidAgentReceiptsToCompanyRevenue();
  assert.equal(sweep.scanned, 6, "corrupt jsonl lines are ignored, valid ones scanned");
  assert.equal(sweep.recorded, 2, "one agent-call + one offer receipt recorded");
  assert.equal(sweep.skipped, 3, "no-company, dev-bypass, failed settlement skipped");
  assert.equal(sweep.failed, 1, "ghost-company receipt fails without killing the sweep");
  assert.equal(sweep.duplicates, 0);

  const records = await listCompanyRevenueRecords(company.id);
  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map((entry) => entry.externalId).sort(),
    ["pag_agent_call", "pago_offer"],
    "receipt ids are the externalId idempotency keys",
  );
  assert.ok(records.every((entry) => entry.source === "x402"));
  const offerRecord = records.find((entry) => entry.externalId === "pago_offer");
  assert.equal(offerRecord.amountUsd, 100);
  assert.equal(offerRecord.customerLabel, "buyer@example.com");

  // The bridge moved the apex needle: $140 recorded against the $1k goal.
  const bridged = await getCompany(company.id);
  assert.equal(bridged.apexGoal.current, "140");
  assert.equal(bridged.apexGoal.progress, 14);

  // Idempotency: a second sweep records nothing new.
  const resweep = await syncPaidAgentReceiptsToCompanyRevenue();
  assert.equal(resweep.recorded, 0);
  assert.equal(resweep.duplicates, 2);
  assert.equal((await listCompanyRevenueRecords(company.id)).length, 2);

  // ── Stripe checkout webhook ──
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const webhookRoute = await import("../src/app/api/company-revenue/stripe-webhook/route.ts");
  const stripePost = (body, { sign = true, secret = "whsec_test" } = {}) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    return webhookRoute.POST(new Request("http://localhost/api/company-revenue/stripe-webhook", {
      method: "POST",
      headers: sign ? { "stripe-signature": `t=${timestamp},v1=${signature}` } : {},
      body,
    }));
  };
  const checkoutEvent = JSON.stringify({
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 2500,
        client_reference_id: company.id,
        customer_details: { email: "customer@example.com" },
      },
    },
  });

  const unsigned = await stripePost(checkoutEvent, { sign: false });
  assert.equal(unsigned.status, 401, "missing/forged signatures fail closed");
  const forged = await stripePost(checkoutEvent, { secret: "whsec_wrong" });
  assert.equal(forged.status, 401);

  const recorded = await (await stripePost(checkoutEvent)).json();
  assert.equal(recorded.ok, true);
  assert.equal(recorded.recorded, true);
  const replay = await (await stripePost(checkoutEvent)).json();
  assert.equal(replay.duplicate, true, "Stripe retries dedupe on session id");

  const stripeRecords = await listCompanyRevenueRecords(company.id);
  assert.equal(stripeRecords.length, 3);
  const stripeRecord = stripeRecords.find((entry) => entry.source === "stripe");
  assert.equal(stripeRecord.amountUsd, 25);
  assert.equal(stripeRecord.externalId, "cs_test_1");
  assert.equal(stripeRecord.customerLabel, "customer@example.com");
  assert.equal((await getCompany(company.id)).apexGoal.current, "165", "stripe revenue moves the apex needle too");

  const unpaid = await (await stripePost(JSON.stringify({
    id: "evt_2",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_2", payment_status: "unpaid", amount_total: 900, client_reference_id: company.id } },
  }))).json();
  assert.equal(unpaid.ignored, true, "unpaid sessions are ignored");

  const otherEvent = await (await stripePost(JSON.stringify({ id: "evt_3", type: "invoice.paid" }))).json();
  assert.equal(otherEvent.ignored, true);

  // metadata.companyId also maps a payment link to its company.
  const metadataEvent = await (await stripePost(JSON.stringify({
    id: "evt_4",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_3",
        payment_status: "paid",
        amount_total: 1000,
        metadata: { companyId: company.id, description: "Payment link sale" },
      },
    },
  }))).json();
  assert.equal(metadataEvent.recorded, true);

  // ── Static wiring guards ──
  const [proxySource, managedWebhookSource] = await Promise.all([
    readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/managed-agent/billing/stripe-webhook/route.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(proxySource.includes('"/api/company-revenue/stripe-webhook"'), "company webhook is proxy-exempt");
  assert.ok(proxySource.includes('"/api/managed-agent/billing/stripe-webhook"'), "managed webhook is proxy-exempt");
  assert.ok(managedWebhookSource.includes("verifyStripeWebhookSignature"), "managed webhook uses the shared signature helper");

  console.log("company revenue rail suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);

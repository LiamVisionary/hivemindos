#!/usr/bin/env node
// Hermetic coverage for company product offers as x402 seller endpoints:
// - publishing a catalog product assigns a stable, unique seller slug
// - the public offer payload serves the CATALOG price (server-side authority)
// - purchases write receipts.jsonl entries attributed to the company
// - dev-bypass purchases move no money and therefore record NO revenue
// - unpublish keeps the slug so republish restores the same buyer URL
// - rail status reflects seller gate + published offers + stripe secret
//
// Purchases run through the dev-bypass path on purpose: the real x402
// verify/settle path talks to a facilitator (network), which the static
// test:paid-agent-gateway assertions cover instead.
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-offers-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-offers-vault-"));

process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
// Seller gateway: local dev seller mode with the dev bypass enabled.
process.env.HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED = "true";
process.env.HIVEMINDOS_PAID_AGENT_SELLER_MODE = "development";
process.env.HIVEMINDOS_PAID_AGENT_DEV_BYPASS = "true";
process.env.HIVEMINDOS_PAID_AGENT_PAY_TO = "0x2222222222222222222222222222222222222222";
process.env.HIVEMINDOS_PAID_AGENT_FACILITATOR_URL = "https://x402.org/facilitator";
delete process.env.HIVEMINDOS_PAID_AGENT_COMPANY_ID;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.HIVEMINDOS_COMPANY_STRIPE_WEBHOOK_SECRET;
// External-revenue fee posture: same hermetic block as test-company-revenue-share.
process.env.HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS = "0";
process.env.HIVEMINDOS_PLATFORM_FEE_POLICY_URL = "disabled";

const {
  companyOfferGatewayStatus,
  getCompanyOfferBySlug,
  listPublishedCompanyOffers,
  publishCompanyProductOffer,
  unpublishCompanyProductOffer,
} = await import("../src/lib/services/company-offer-gateway.ts");
const { PAID_AGENT_RECEIPT_PATH } = await import("../src/lib/services/paid-agent-gateway.ts");
const { companyRevenueRailStatus } = await import("../src/lib/services/company-revenue-bridge.ts");
const { readCompanyRevenueLedger } = await import("../src/lib/services/company-revenue-share.ts");
const { getCompany, setCompanyProducts, upsertCompany } = await import("../src/lib/services/companies-store.ts");
const offerRoute = await import("../src/app/api/paid-agents/offers/[slug]/route.ts");
const offersIndexRoute = await import("../src/app/api/paid-agents/offers/route.ts");

try {
  const company = await upsertCompany({
    name: "Maps Agency",
    members: [{ agentId: "hermes-alpha", roleInCompany: "Queen" }],
    apexGoal: { title: "Reach $10k", metric: "revenue", target: "10000", unit: "currency" },
  });
  await setCompanyProducts(company.id, {
    items: [
      { key: "starter-launch", name: "Starter Launch", amountUsd: 500, description: "One local launch package" },
      { key: "free-consult", name: "Free Consult", amountUsd: 0 },
    ],
  });

  // Zero-priced products cannot become paid offers.
  await assert.rejects(
    () => publishCompanyProductOffer(company.id, "free-consult"),
    /Zero-priced/,
  );

  const { offer } = await publishCompanyProductOffer(company.id, "starter-launch");
  assert.equal(offer.slug, "maps-agency-starter-launch", "slug derives from company name + product key");
  assert.equal(offer.priceUsd, 500);
  assert.equal((await listPublishedCompanyOffers()).length, 1);

  // Publication survives a plain catalog save (the normalizer must keep x402Offer).
  const afterSave = await setCompanyProducts(company.id, {
    items: (await getCompany(company.id)).products.items.map((item) => ({ ...item })),
  });
  assert.equal(afterSave.products.items[0].x402Offer?.published, true, "catalog saves keep publication state");

  // Slug collisions across companies get a numeric suffix.
  const rival = await upsertCompany({
    name: "Maps Agency",
    members: [{ agentId: "hermes-beta", roleInCompany: "Queen" }],
  });
  await setCompanyProducts(rival.id, {
    items: [{ key: "starter-launch", name: "Starter Launch", amountUsd: 300 }],
  });
  const { offer: rivalOffer } = await publishCompanyProductOffer(rival.id, "starter-launch");
  assert.equal(rivalOffer.slug, "maps-agency-starter-launch-2", "colliding slugs are suffixed");

  // Public GET serves the catalog price — pricing authority is server-side.
  const infoResponse = await offerRoute.GET(
    new Request(`http://localhost/api/paid-agents/offers/${offer.slug}`),
    { params: Promise.resolve({ slug: offer.slug }) },
  );
  assert.equal(infoResponse.status, 200);
  const info = await infoResponse.json();
  assert.equal(info.offer.priceUsd, 500);
  assert.equal(info.offer.product.key, "starter-launch");
  assert.equal(info.offer.endpoint, `/api/paid-agents/offers/${offer.slug}`);

  const index = await (await offersIndexRoute.GET()).json();
  assert.equal(index.enabled, true);
  assert.equal(index.configured, true, "dev seller mode with payTo + non-CDP facilitator is configured");
  assert.equal(index.offers.length, 2);

  // Purchase through the dev bypass: order + receipt, but NO revenue (no money moved).
  const purchaseResponse = await offerRoute.POST(
    new Request(`http://localhost/api/paid-agents/offers/${offer.slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hivemindos-paid-agent-dev-bypass": offer.slug,
      },
      body: JSON.stringify({ contact: "buyer@example.com", note: "Please start next week." }),
    }),
    { params: Promise.resolve({ slug: offer.slug }) },
  );
  assert.equal(purchaseResponse.status, 200);
  const purchase = await purchaseResponse.json();
  assert.equal(purchase.ok, true);
  assert.equal(purchase.order.paidUsd, 500);
  assert.match(purchase.order.id, /^pago_/);

  const receiptLines = (await readFile(PAID_AGENT_RECEIPT_PATH, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(receiptLines.length, 1);
  assert.equal(receiptLines[0].kind, "company-offer");
  assert.equal(receiptLines[0].companyId, company.id);
  assert.equal(receiptLines[0].productKey, "starter-launch");
  assert.equal(receiptLines[0].customerContact, "buyer@example.com");
  assert.equal(receiptLines[0].settlement.transaction, "dev-bypass");

  assert.deepEqual(await readCompanyRevenueLedger(), [], "dev-bypass purchases record no revenue");
  const afterPurchase = await getCompany(company.id);
  assert.equal(afterPurchase.apexGoal.current ?? undefined, undefined, "apex metric untouched by dev-bypass");

  // Rail status: x402 connected (gate on + payment configured + live offer), stripe off.
  const rail = await companyRevenueRailStatus(company.id);
  assert.equal(rail.x402.connected, true);
  assert.equal(rail.x402.publishedOffers, 1);
  assert.equal(rail.stripe.connected, false);
  assert.equal(rail.connected, true);

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const railWithStripe = await companyRevenueRailStatus(company.id);
  assert.equal(railWithStripe.stripe.connected, true);
  delete process.env.STRIPE_WEBHOOK_SECRET;

  // Unpublish keeps the slug; the buyer URL 404s until republish restores it.
  await unpublishCompanyProductOffer(company.id, "starter-launch");
  assert.equal(await getCompanyOfferBySlug(offer.slug), null);
  const goneResponse = await offerRoute.POST(
    new Request(`http://localhost/api/paid-agents/offers/${offer.slug}`, {
      method: "POST",
      headers: { "x-hivemindos-paid-agent-dev-bypass": offer.slug },
      body: "{}",
    }),
    { params: Promise.resolve({ slug: offer.slug }) },
  );
  assert.equal(goneResponse.status, 404);
  const railUnpublished = await companyRevenueRailStatus(company.id);
  assert.equal(railUnpublished.x402.connected, false);
  assert.equal(railUnpublished.x402.detail, "no published offers");

  const { offer: republished } = await publishCompanyProductOffer(company.id, "starter-launch");
  assert.equal(republished.slug, offer.slug, "republish restores the original slug");

  // Seller gate: disabling the gateway takes every offer offline with a 404.
  process.env.HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED = "false";
  const disabledResponse = await offerRoute.POST(
    new Request(`http://localhost/api/paid-agents/offers/${offer.slug}`, {
      method: "POST",
      headers: { "x-hivemindos-paid-agent-dev-bypass": offer.slug },
      body: "{}",
    }),
    { params: Promise.resolve({ slug: offer.slug }) },
  );
  assert.equal(disabledResponse.status, 404);
  process.env.HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED = "true";

  console.log("company offer gateway suite passed");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  await rm(vaultPath, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);

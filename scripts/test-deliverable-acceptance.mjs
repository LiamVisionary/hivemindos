#!/usr/bin/env node
// Hermetic coverage for the Deliverable Acceptance system — the platform-wide gate
// that stops any Zero Human Company from shipping a placeholder/wireframe outward
// deliverable. Anchored to the real 2026-07-07 failure: a restaurant preview that
// shipped to a live prospect with 3 fake "menu" items ("Menu / offer clarity" …),
// no prices, an empty menu category, and a single generic stock hero.
//
// Covers: (1) the typed contracts reject that skeleton (HTML + JSON config shapes)
// and pass a real menu; (2) the orchestrator fails closed on affirmative rejection
// only (unfetchable/reserved/absent → never blocks); (3) the loop-runner emits a
// hard-fail receipt that blocks completion, exactly like the live-URL gate.
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { evaluateArtifactAcceptance, contractsForArtifact } = await import(
  "../src/lib/services/deliverables/acceptance-contracts.ts"
);
const { evaluateDeliverableAcceptance, summarizeAcceptanceViolations } = await import(
  "../src/lib/services/deliverables/deliverable-acceptance.ts"
);
const { runLoopGates, loopCompletionBlock } = await import("../src/lib/services/loops/index.ts");

const PREVIEW_URL = "https://preview.liamvisionary.com/p/giuseppe-s-ristorante-pizzeria";

// ── fixtures: mirror the real restaurant-experience template markup ──────────
// The degraded (Giuseppe) render: 3 wireframe "dishes", no prices, empty 2nd cat.
const GIUSEPPE_HTML = `<!doctype html><html><head><title>Giuseppe's Preview</title></head><body>
<div class="preview variant-local">
<section class="hero"><div class="wrap grid"><div><h1>A cleaner site for local diners choosing fast.</h1></div>
<div class="card photo-card"><img src="https://images.unsplash.com/photo-1517248135467" alt="x"/><div class="photo-caption"><h3>Tonight</h3></div></div></div></section>
<section class="feature-strip"><div class="wrap feature-grid"><div class="feature"><b>Local-trust lead</b><p>x</p></div></div></section>
<section class="section dark" id="menu"><div class="wrap"><div class="sec-label">Local menu</div><h2>Menu cards that scan quickly.</h2>
<p class="lede">A polished launch-ready menu preview with 3 featured items organized for fast mobile scanning.</p>
<div class="menu">
<div class="cat"><h3>Featured plates</h3>
<div class="dish"><b>Menu / offer clarity</b><strong></strong><p>Make the most important food, drink, or visit information obvious on mobile.</p></div>
<div class="dish"><b>Hours + location path</b><strong></strong><p>Put directions, hours, phone, and trust cues above the fold.</p></div>
<div class="dish"><b>Booking / order CTA</b><strong></strong><p>Create one clear next step instead of burying the conversion path.</p></div>
</div>
<div class="cat"><h3>Guests are looking for</h3></div>
</div></div></section></div></body></html>`;

// A real, launch-ready render: 8 priced dishes across two filled categories.
const RICH_HTML = `<!doctype html><html><head><title>Giuseppe's</title></head><body>
<div class="preview variant-local">
<section class="hero"><div class="wrap grid"><div><h1>Wood-fired pizza in Sarasota.</h1></div>
<div class="card photo-card"><img src="https://cdn.example.net/hero.webp" alt="x"/></div></div></section>
<section class="feature-strip"><div class="wrap feature-grid"><div class="feature"><b>x</b><p>y</p></div></div></section>
<section class="section dark" id="menu"><div class="wrap"><h2>Menu</h2>
<div class="menu">
<div class="cat"><h3>Featured plates</h3>
<div class="dish with-img"><img src="a.webp"/><b>Margherita Pizza</b><strong>$16</strong><p>San Marzano, mozzarella, basil.</p></div>
<div class="dish"><b>Rigatoni Bolognese</b><strong>$19</strong><p>Slow beef ragu.</p></div>
<div class="dish"><b>Caprese</b><strong>$12</strong><p>Tomato, mozzarella, basil.</p></div>
<div class="dish"><b>Tiramisu</b><strong>$9</strong><p>Espresso, mascarpone.</p></div>
</div>
<div class="cat"><h3>Guests are looking for</h3>
<div class="dish"><b>Lasagna</b><strong>$18</strong><p>Layered pasta.</p></div>
<div class="dish"><b>Calzone</b><strong>$15</strong><p>Folded pizza.</p></div>
<div class="dish"><b>Chianti</b><strong>$11</strong><p>By the glass.</p></div>
<div class="dish"><b>Cannoli</b><strong>$8</strong><p>Ricotta, chocolate.</p></div>
</div>
</div></div></section></div></body></html>`;

// Giuseppe's ACTUAL stored R2 config shape (business_profile.menu_entries).
const GIUSEPPE_JSON = JSON.stringify({
  template_slug: "restaurant-experience",
  business_name: "Giuseppe's Ristorante & Pizzeria",
  business_profile: {
    image_urls: ["https://images.unsplash.com/photo-1517248135467"],
    menu_entries: [
      { name: "Menu / offer clarity", description: "…", price: "" },
      { name: "Hours + location path", description: "…", price: "" },
      { name: "Booking / order CTA", description: "…", price: "" },
    ],
  },
});

const htmlContent = (body) => ({ body, contentType: "text/html; charset=utf-8", status: 200 });
const codes = (verdict) => verdict.violations.map((v) => v.code).sort();

// ── 1. contracts reject the placeholder render (HTML) ────────────────────────
{
  const v = evaluateArtifactAcceptance({ url: PREVIEW_URL }, htmlContent(GIUSEPPE_HTML));
  assert.equal(v.status, "fail", "Giuseppe HTML must FAIL acceptance");
  const c = codes(v);
  assert(c.includes("menu-items-unpriced"), `expected menu-items-unpriced, got ${c}`);
  assert(c.includes("menu-placeholder-labels"), `expected menu-placeholder-labels, got ${c}`);
  assert(c.includes("empty-menu-category"), `expected empty-menu-category, got ${c}`);
}

// ── 2. contracts pass a real, priced menu ────────────────────────────────────
{
  const v = evaluateArtifactAcceptance({ url: PREVIEW_URL }, htmlContent(RICH_HTML));
  assert.equal(v.status, "pass", `rich HTML must PASS, got ${v.status} (${codes(v)})`);
  assert(v.signals.some((s) => /priced menu item/.test(s)), `expected a priced-items signal, got ${v.signals}`);
}

// ── 3. contracts reject the placeholder config (JSON path) ───────────────────
{
  const v = evaluateArtifactAcceptance({ url: PREVIEW_URL }, { body: GIUSEPPE_JSON, contentType: "application/json" });
  assert.equal(v.status, "fail", "Giuseppe JSON config must FAIL acceptance");
  assert(codes(v).includes("menu-items-unpriced"), `JSON path should flag unpriced menu, got ${codes(v)}`);
}

// ── 4. a non-restaurant substantial page is NOT a false failure ──────────────
{
  const generic = `<!doctype html><html><body><main><h1>Sarasota House Painters</h1>
  <p>${"Interior and exterior painting for Sarasota homes. Licensed, insured, free estimates. ".repeat(6)}</p>
  <a href="tel:+19415550100">Call for a quote</a></main></body></html>`;
  const v = evaluateArtifactAcceptance({ url: "https://preview.liamvisionary.com/p/sarasota-house-painters" }, htmlContent(generic));
  assert.notEqual(v.status, "fail", `a real non-restaurant page must not FAIL, got ${v.status} (${codes(v)})`);
}

// ── 5. generic web-page contract catches lorem-ipsum + near-empty ────────────
{
  const lorem = evaluateArtifactAcceptance({ url: "https://acme.pages.dev/" }, htmlContent("<html><body><h1>lorem ipsum dolor sit amet</h1></body></html>"));
  assert.equal(lorem.status, "fail", "lorem-ipsum page must FAIL");
  assert(codes(lorem).includes("lorem-ipsum"), `expected lorem-ipsum, got ${codes(lorem)}`);
}

// ── 6. outreach-email contract catches unfilled merge fields ─────────────────
{
  const v = evaluateArtifactAcceptance({ kindLabel: "Outreach email" }, { body: "Hi {{first_name}}, I built you a site." });
  assert.equal(v.status, "fail", "email with an unfilled merge field must FAIL");
  assert(codes(v).includes("unfilled-merge-field"), `expected unfilled-merge-field, got ${codes(v)}`);
}

// ── 7. orchestrator: fail closed on affirmative rejection only ───────────────
{
  const fetchGiuseppe = async ({ url }) => (url === PREVIEW_URL ? htmlContent(GIUSEPPE_HTML) : null);
  const result = await evaluateDeliverableAcceptance({
    output: `Done — the preview is live at ${PREVIEW_URL} and ready to send.`,
    fetchContent: fetchGiuseppe,
  });
  assert.equal(result.violations.length, 1, "the claimed preview must produce exactly one violation");
  assert.equal(result.violations[0].url, PREVIEW_URL);
  assert(/menu/.test(summarizeAcceptanceViolations(result.violations)), "summary should describe the menu problem");

  // Unfetchable content abstains — NEVER a false block.
  const thrown = await evaluateDeliverableAcceptance({
    output: `Preview live at ${PREVIEW_URL}`,
    fetchContent: async () => { throw new Error("network down"); },
  });
  assert.equal(thrown.violations.length, 0, "a fetch failure must not block");

  // No fetcher → no-op (kill-switch).
  const off = await evaluateDeliverableAcceptance({ output: `Preview live at ${PREVIEW_URL}` });
  assert.equal(off.checked.length, 0, "no fetcher → nothing checked");

  // Reserved/mock URLs are never even fetched.
  let fetchedReserved = false;
  const reserved = await evaluateDeliverableAcceptance({
    output: "Preview live at https://example.com/p/foo",
    fetchContent: async () => { fetchedReserved = true; return htmlContent(GIUSEPPE_HTML); },
  });
  assert.equal(reserved.checked.length, 0, "reserved/mock URL must not be checked");
  assert.equal(fetchedReserved, false, "reserved/mock URL must not be fetched");
}

// ── 8. loop-runner integration: a placeholder deliverable HARD-fails ─────────
{
  const output = `Shipped the site. Preview is live at ${PREVIEW_URL}`;
  const fetchGiuseppe = async ({ url }) => (url === PREVIEW_URL ? htmlContent(GIUSEPPE_HTML) : null);
  const { receipts } = await runLoopGates({ output, fetchContent: fetchGiuseppe, now: 1_800_000_000_000 });
  const receipt = receipts.find((r) => r.gateId === "deliverable-acceptance");
  assert(receipt, "a deliverable-acceptance receipt must be emitted");
  assert.equal(receipt.status, "failed", "the placeholder deliverable must fail");
  assert.equal(receipt.metadata?.hardFail, true, "the failure must be a HARD fail (blocks completion)");
  // …and that hard-fail actually blocks completion via the engine.
  const block = loopCompletionBlock(undefined, receipts);
  assert(block, "a hard-fail acceptance receipt must block completion");
}

// ── 9. loop-runner integration: a real deliverable passes cleanly ────────────
{
  const output = `Shipped the site. Preview is live at ${PREVIEW_URL}`;
  const fetchRich = async ({ url }) => (url === PREVIEW_URL ? htmlContent(RICH_HTML) : null);
  const { receipts } = await runLoopGates({ output, fetchContent: fetchRich, now: 1_800_000_000_000 });
  const receipt = receipts.find((r) => r.gateId === "deliverable-acceptance");
  assert(receipt, "a deliverable-acceptance receipt must be emitted for a checked deliverable");
  assert.equal(receipt.status, "passed", "a real menu must pass acceptance");
  assert.notEqual(receipt.metadata?.hardFail, true, "a passing acceptance receipt is not a hard-fail");
}

// ── 10. sanity: the contract registry actually governs a preview URL ─────────
{
  assert(contractsForArtifact({ url: PREVIEW_URL }).some((c) => c.id === "restaurant-website-preview"),
    "the restaurant contract must govern a /p/ preview URL");
}

// ── 11. FALSE-POSITIVE guards: real but modest deliverables must PASS ─────────
{
  // A genuine small/tasting priced menu (no menu-too-thin, no missing-imagery block).
  const smallMenu = `<!doctype html><html><body><div class="preview variant-local">
  <section class="section dark" id="menu"><div class="wrap"><h2>Menu</h2>
  <div class="menu"><div class="cat"><h3>Tasting menu</h3>
  <div class="dish"><b>Chef's Tasting</b><strong>$85</strong><p>Seven seasonal courses.</p></div>
  <div class="dish"><b>Wine Pairing</b><strong>$45</strong><p>Five pours.</p></div>
  </div></div></div></section></div></body></html>`;
  const v1 = evaluateArtifactAcceptance({ url: PREVIEW_URL }, htmlContent(smallMenu));
  assert.notEqual(v1.status, "fail", `a real small priced menu must not FAIL, got ${v1.status} (${codes(v1)})`);

  // An 8-item priced menu where ONE dish name happens to match the wireframe regex
  // ("Above The Fold Fizz") must still PASS — minority, not a placeholder menu.
  const oddName = `<div class="preview variant-local"><section class="section dark" id="menu"><div class="wrap"><h2>Menu</h2>
  <div class="menu"><div class="cat"><h3>Plates</h3>
  ${["Margherita","Rigatoni","Caprese","Above The Fold Fizz"].map((n, i) => `<div class="dish"><b>${n}</b><strong>$${12 + i}</strong><p>desc</p></div>`).join("")}
  </div><div class="cat"><h3>More</h3>
  ${["Lasagna","Calzone","Chianti","Cannoli"].map((n, i) => `<div class="dish"><b>${n}</b><strong>$${8 + i}</strong><p>desc</p></div>`).join("")}
  </div></div></div></section></div>`;
  const v2 = evaluateArtifactAcceptance({ url: PREVIEW_URL }, htmlContent(oddName));
  assert.equal(v2.status, "pass", `one wireframe-ish name among 8 priced dishes must PASS, got ${v2.status} (${codes(v2)})`);

  // A minimal image/CTA splash (little prose, but real media) must not FAIL near-empty.
  const splash = `<!doctype html><html><body><main><img src="hero.jpg" alt="brand"/><h1>Acme Co</h1><a href="/enter">Enter</a></main></body></html>`;
  const v3 = evaluateArtifactAcceptance({ url: "https://acme.pages.dev/" }, htmlContent(splash));
  assert.notEqual(v3.status, "fail", `an image-driven minimal splash must not FAIL, got ${v3.status} (${codes(v3)})`);
}

// ── 12. coverage: a preview on a deploy host (fly.dev) IS checked ─────────────
{
  const flyUrl = "https://giuseppes.fly.dev/p/giuseppe";
  const result = await evaluateDeliverableAcceptance({
    output: `Preview live at ${flyUrl}`,
    fetchContent: async ({ url }) => (url === flyUrl ? htmlContent(GIUSEPPE_HTML) : null),
  });
  assert.equal(result.violations.length, 1, "a placeholder preview on a deploy host must be caught");
}

// ── 13. transactional pages are NOT content-judged (no false findings) ───────
{
  let fetched = false;
  const result = await evaluateDeliverableAcceptance({
    output: "Payment confirmed at https://sarasota-demo-pipeline.hivemindos.workers.dev/paid?lead=x",
    fetchContent: async () => { fetched = true; return htmlContent("<html><body><h1>Payment received</h1></body></html>"); },
  });
  assert.equal(result.checked.length, 0, "a /paid transactional page must not be content-judged");
  assert.equal(fetched, false, "a /paid transactional page must not even be fetched");
}

console.log("deliverable-acceptance: all assertions passed");

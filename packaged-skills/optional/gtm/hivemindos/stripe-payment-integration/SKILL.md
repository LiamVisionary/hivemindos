---
name: stripe-payment-integration
description: Use when integrating Stripe payments without the SDK — creating Checkout Sessions server-side, verifying webhooks by HMAC signature, fulfilling paid orders idempotently, or provisioning products/prices/webhooks via the Stripe REST API. Also covers the reality of "separate billing" (one account = shared payouts; separation is by metadata or a second account), detecting a live vs test key, and what a Stripe "management API key" actually is. Triggers include "add Stripe checkout", "Stripe webhook", "create Stripe products/prices", "separate Stripe billing", "charge a custom amount".
---

# Stripe Payment Integration (no SDK, raw REST)

Everything here uses plain `fetch` against `https://api.stripe.com/v1/...` with `Authorization: Bearer <secret_key>` and `application/x-www-form-urlencoded` bodies — no `stripe` npm dependency, which keeps bundles lean and works identically on Node and edge runtimes. Verified against live Stripe.

## Key facts to get right first

- **A Stripe "secret key" is the only credential you need.** A key labelled `STRIPE_MANAGEMENT_API_KEY` is, in practice, just an ordinary secret key for ONE account — there is no separate "management" API. Confirm which account it belongs to with `GET /v1/account` (returns `id` `acct_…`, `email`, `display_name`).
- **Live vs test:** the key prefix decides it (`sk_live_`/`rk_live_` vs `sk_test_`). Detect it without printing the key: `case "${k:0:8}" in sk_live*|rk_live*) echo live;; sk_test*) echo test;; esac`. A live key means real money — test the flow with a test key or accept a real small charge; creating a *session* never charges anyone.
- **"Separate billing" reality:** within ONE Stripe account, balance and payouts are shared — you cannot split payouts. Real separation = a **second account under the same login** (created manually in the dashboard account switcher; the API cannot create a standalone account). If reusing one account, separate the *reporting* with product `metadata[brand]=X` + a dedicated webhook + session metadata. (Programmatic sub-accounts require Stripe **Connect** + a platform key — a different product.)

## Create a Checkout Session (server-side)

```ts
const secret = process.env.PORTFOLIO_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || "";
if (!secret) return json({ error: "Stripe not configured", governance: "fail-closed" }, 503); // fail CLOSED

const p = new URLSearchParams();
p.set("mode", "payment");
p.set("line_items[0][quantity]", "1");
if (pkg.stripePriceId) {
  p.set("line_items[0][price]", pkg.stripePriceId);          // pre-made price
} else {                                                      // OR bill an arbitrary custom amount:
  p.set("line_items[0][price_data][currency]", pkg.currency || "usd");
  p.set("line_items[0][price_data][unit_amount]", String(Math.round(pkg.amountUsd * 100)));
  p.set("line_items[0][price_data][product_data][name]", `${clientName} — ${pkg.name}`);
}
p.set("success_url", `${base}/offer/${slug}?paid=1&session_id={CHECKOUT_SESSION_ID}`); // literal placeholder
p.set("cancel_url", `${base}/offer/${slug}?cancelled=1`);
p.set("client_reference_id", slug);
for (const [k, v] of Object.entries({ slug, packageKey, amountUsd: String(pkg.amountUsd) })) {
  p.set(`metadata[${k}]`, v);                     // on the session
  p.set(`payment_intent_data[metadata][${k}]`, v); // AND on the PaymentIntent, so it survives to the charge
}
const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: p,
});
const data = await res.json().catch(() => ({}));
if (!res.ok || !data.url) return json({ error: data.error?.message || "stripe failed" }, 502);
return json({ url: data.url }); // client sets window.location.href = url
```

Inline `price_data` is the key to **agent-driven custom bills** — no product/price needs to exist for an arbitrary amount.

## Verify the webhook (HMAC) — the part people get wrong

Read the RAW body (do not let the framework JSON-parse it first), then:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
function verify(rawBody: string, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map(x => x.split("=") as [string, string]));
  const t = parts.t, sig = parts.v1;
  if (!t || !sig || !/^\d+$/.test(t)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;      // REPLAY WINDOW — do not skip
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(new Uint8Array(a), new Uint8Array(b)); // constant-time
}
```

On the edge runtime, swap `node:crypto` for WebCrypto `crypto.subtle` HMAC. Missing `STRIPE_WEBHOOK_SECRET` → return 503 (fail closed), bad signature → 401.

## Fulfill idempotently

Act only on `event.type === "checkout.session.completed"` AND `session.payment_status === "paid"`. **Dedupe on `session.id`** (Stripe retries deliveries) using a durable marker (`SET offer:paid:<session.id> NX`) — the first delivery fulfills, retries no-op. Read attribution from `session.metadata`. Always return 200 to Stripe once fulfillment is recorded (even if a downstream notify/report fails), so Stripe doesn't retry-storm; wrap side effects in try/catch.

## Provision products / prices / webhook via the API (run-once)

Products/prices are OPTIONAL if you use inline `price_data`; create them only for stable price ids or hosted payment links.

```bash
STRIPE="curl -s -u $KEY:"   # basic auth, key as user, empty password
$STRIPE https://api.stripe.com/v1/products -d name='Growth build' -d 'metadata[brand]=portfolio'
$STRIPE https://api.stripe.com/v1/prices -d product=prod_… -d currency=usd -d unit_amount=350000
$STRIPE https://api.stripe.com/v1/webhook_endpoints \
  -d url=https://<host>/api/offer/webhook \
  -d 'enabled_events[]=checkout.session.completed' \
  -d 'enabled_events[]=payment_intent.succeeded'
# → response .secret is whsec_… — set it as the webhook secret env var (printed ONCE; never commit it)
```

Register the webhook AFTER the receiving route is deployed at a stable public URL. Setting the secret in the host env usually needs a fresh deploy to take effect — trigger one and re-test `bad-signature → 401` (not 503).

## Safety

- Fail closed everywhere a key/secret is missing.
- Never print, log, or commit the secret key or `whsec_`; write them straight to the host env / shared secret store.
- Verify which account a key belongs to (`GET /v1/account`) before creating live objects.
- A green "session created" is not proof of fulfillment — only a verified paid webhook is.

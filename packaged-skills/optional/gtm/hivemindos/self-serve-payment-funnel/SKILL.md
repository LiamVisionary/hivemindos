---
name: self-serve-payment-funnel
description: Use when a user wants to build a self-serve "offer / checkout / preview" funnel — a per-client page that shows a deliverable preview, presents custom packages/bills, and lets the buyer pay (Stripe) or book a call (Cal.com), all created dynamically by agents through an authorized API. Triggers include "build a payment funnel", "self-serve checkout page", "per-client offer page", "sell a deliverable", "preview-to-paid pipeline", "let my agents send custom bills/packages", or generalizing a per-lead demo page into a reusable product.
---

# Self-Serve Payment Funnel

Build a generalized, agent-drivable funnel: an authorized API creates a per-client "offer" (a deliverable preview + custom packages + a booking link); a public `/offer/<slug>` page renders it in the host site's own design; the buyer pays via Stripe checkout or books a call; a signature-verified webhook fulfills exactly once and reports the sale. Works for ANY deliverable (a website, a doc, a service) because the offer content is data, not code.

Pair this with the `stripe-payment-integration` skill (checkout + webhook internals), `posthog-provisioning-and-query` (funnel tracking), and `pluggable-analytics-connect` (at-a-glance dashboards).

## Architecture (the reusable shape)

```
agent ──POST /api/offer (bearer)──▶ store an Offer keyed by slug
buyer  ──GET  /offer/<slug>──────▶ on-brand page: preview + packages + pay/book CTAs
buyer  ──POST /api/offer/checkout▶ create Stripe Checkout Session ▶ redirect to Stripe
Stripe ──POST /api/offer/webhook─▶ HMAC-verified, idempotent fulfill ▶ notify + report revenue
```

Five decisions, each with a default:
- **Where it lives** — put it IN the host site if that site already runs server routes (Next.js on Render/Vercel, a real Node server). This keeps the page on-brand and same-origin. A separate Cloudflare Worker is the alternative when many *non-site* deliverables reuse one funnel service.
- **Store** — offers must persist. Default **Upstash Redis** (REST client, works on any serverless/Node host). Cloudflare KV if you're on Workers.
- **Payments** — Stripe Checkout Sessions, server-side. Support BOTH a pre-made price id AND inline `price_data` so agents can bill arbitrary custom amounts with no pre-created price. (See `stripe-payment-integration`.)
- **Booking** — a hosted Cal.com deep-link is the safe default (real availability, zero calendar code). An embedded real-slots stepper is an opt-in upgrade. NEVER ship a fake/deterministic calendar.
- **Deploy** — additive: `/offer/[slug]` + `/api/offer/*` are new routes not linked from any existing page, so shipping them doesn't change the host site.

## The Offer data model

Persist one JSON record per slug. Keep it fully configurable so an agent creates any deliverable's offer in one call:

```ts
type Offer = {
  slug: string;                  // URL segment, unique key, [a-z0-9-]
  clientName: string;
  title: string;                 // rendered as PLAIN TEXT (strip tags — offers are agent-authored, not trusted HTML)
  subhead: string;
  preview: {                     // the deliverable preview
    type: "iframe-embed" | "link-card" | "image";  // agent picks — never auto-iframe an arbitrary URL
    url: string; posterUrl?: string; caption?: string;
  };
  packages: Array<{              // custom bills
    key: string; name: string; amountUsd: number; description: string;
    recommended?: boolean; stripePriceId?: string; currency?: string;  // omit stripePriceId → dynamic price_data
  }>;
  booking?: { calLink?: string; calEventTypeId?: number; durationMinutes?: number };
  branding?: { accent?: string; kicker?: string };  // per-offer accent/label overrides
  createdBy: string; createdAt: string; updatedAt: string;
  status: "draft" | "active" | "archived";
};
```

**Store keys (Redis):** `offer:rec:<slug>` → Offer JSON; `offer:metrics:<slug>` → a hash incremented with `HINCRBY` (views/checkoutStarts/paid/bookings — a hash avoids the read-modify-write race a counter embedded in the record would have); `offer:paid:<sessionId>` → set with `NX` for webhook idempotency.

**Degradation:** reads return null (page 404s cleanly) when the store env is absent; writes fail **closed** — throw so the API returns 503, never a silent no-op. The public page must never 500 on a missing store.

## Routes

- **`/offer/[slug]`** — server component. `generateMetadata` per slug with `robots:{index:false}` (private client links). `notFound()` on unknown/archived slug. Render the preview prominently: iframe when `type==="iframe-embed"`, else image/link card — and ALWAYS an "Open preview ↗" fallback, because most sites send `X-Frame-Options: DENY` and silently fail to frame. Package cards → a pay button (client) + optional "book first" link. Increment `views` via a fire-and-forget hook (`after()` in Next) so it doesn't block render.
- **`POST /api/offer`** — bearer-gated create/upsert (agents). Validate required fields FIRST (so bad input is 400 regardless of store state), then persist. Return `{ ok, offer, url }` so the agent gets the shareable link immediately. `GET /api/offer?slug=` reads it back (also gated — offers can carry private preview URLs).
- **`POST /api/offer/checkout`** — public; buyer's package choice → a Stripe Checkout Session → return its URL. (See `stripe-payment-integration`.)
- **`POST /api/offer/webhook`** — Stripe signature verification + idempotent fulfillment + notify + report. (See `stripe-payment-integration`.)

## Authorized agent API (so agents send custom bills)

Gate the authoring route with a bearer token from shared env, compared in **constant time** (HMAC both sides with a per-process random key, then `timingSafeEqual` — never `===`, which leaks length/prefix via timing). Fail closed: 503 when the token env is unset/too-short, 401 on missing/wrong bearer. An agent then does:

```
POST https://<host>/api/offer
Authorization: Bearer <PORTFOLIO_OFFER_API_TOKEN>
{ slug, clientName, title, subhead, preview:{type,url}, packages:[{key,name,amountUsd,description}], booking:{calLink} }
→ { ok:true, url:"https://<host>/offer/<slug>" }
```

Optional: an AI-normalization helper (`natural-language deliverable spec → structured Offer`) reusing whatever LLM the host already calls — but keep the core API a plain structured upsert so the default path never depends on an LLM.

## Store provisioning (Upstash Redis)

Create a database with the Upstash **Management API** (HTTP Basic `account-email:MANAGEMENT_KEY`; regional DBs are deprecated — create `region:"global"` with a `primary_region`):

```bash
curl -s -X POST https://api.upstash.com/v2/redis/database \
  -u "$UPSTASH_EMAIL:$UPSTASH_MANAGEMENT_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-offers","region":"global","primary_region":"us-east-1"}'
# response → { database_id, endpoint, rest_token, ... }
# UPSTASH_REDIS_REST_URL = https://<endpoint> ; UPSTASH_REDIS_REST_TOKEN = <rest_token>
```

App side: `import { Redis } from "@upstash/redis"` (pure JS, edge/Node-safe). Delete a test key with `POST {url}/del/<key>` + Bearer token.

## Deploy (know the real platform before you push)

VERIFY where the site actually runs before deploying — a README saying "Vercel" is not proof. `curl -sI https://<domain>` and read the origin headers (`x-render-origin-server: Render`, `x-vercel-id`, `cf-pages`) and whether a CDN (`server: cloudflare`) fronts it. Env vars go in the REAL host's settings, and deploy = push to the branch that host watches.

- **Render / Vercel / any Node host** — `runtime="nodejs"`; `node:crypto`, `Buffer`, `@upstash/redis` all work. Set env vars via the host's API with **surgical per-key upserts** (never a bulk replace — that can wipe existing vars). `NEXT_PUBLIC_*` vars are build-time; set them before the build.
- **Cloudflare Workers/Pages edge** — no `node:crypto`/`Buffer` unless `nodejs_compat`; adjust the webhook HMAC to WebCrypto.

## Correctness gotchas (each cost real debugging elsewhere)

- **Fail-closed on money/secrets.** No Stripe key → 503, not a broken session. No webhook secret → 503, not a silent accept.
- **Webhook idempotency on `session.id`** (Stripe retries) + a 300s replay-freshness window. See `stripe-payment-integration`.
- **iframe embeddability** — never auto-iframe an arbitrary URL; the agent declares `preview.type`, and there's always an open-in-new-tab fallback.
- **Don't inherit a fake booking calendar.** If the host already has a booking page with deterministic/hashed availability, do NOT reuse it — deep-link to real Cal.com instead.
- **Metadata carries attribution** on the checkout session (`slug`, `packageKey`, `amountUsd`) AND on `payment_intent_data[metadata]`, so the webhook can fulfill and report revenue.
- **Private links** — keep `/offer` out of nav and search indexes.

## Live-route QA gate (before calling it revenue-ready)

Local unit checks are not enough — hit the DEPLOYED public URL:
- `/offer/<unknown>` → 404
- `POST /api/offer` no-bearer → 401; bad body (bearer) → 400
- create an offer → `/offer/<slug>` → 200 and shows the price + preview CTA
- `POST /api/offer/checkout` → a `checkout.stripe.com` URL (`cs_live_`/`cs_test_`)
- `POST /api/offer/webhook` bad signature → 401 (or 503 before the secret is deployed)
- delete the test offer afterward.

## Build checklist

1. Store module + Offer type (Upstash Redis; HINCRBY metrics; NX paid marker; fail-closed writes, null-degrading reads).
2. Bearer-auth gate (constant-time compare).
3. `POST/GET /api/offer` (validate-then-persist).
4. `POST /api/offer/checkout` (see `stripe-payment-integration`).
5. `POST /api/offer/webhook` (see `stripe-payment-integration`).
6. `/offer/[slug]` page + client checkout button + view-ping, on-brand, iframe fallback.
7. Real Cal deep-link (not a fake calendar).
8. Provision store + Stripe + tracking; set host env surgically; deploy; run the live QA gate.

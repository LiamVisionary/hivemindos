---
name: square-billing-setup
description: Set up Square card billing (hosted Payment Links) end-to-end for a web store — create and correctly identify Square credentials (App ID vs access token, sandbox vs production), configure env vars and Vercel scopes, set product prices, wire webhooks, and verify with sandbox test cards or a real-card-and-refund. Use when someone says "set up Square", "Square checkout", "Square keys/token", "Pay by Card not showing", "Square UNAUTHORIZED", "sandbox test card 4111", "checkout failed", "Invalid phone/email on Square", or is wiring Square payments into a Next.js/Vercel storefront.
---

# Square Billing Setup (Hosted Payment Links)

How to stand up Square card checkout for a storefront **correctly the first time**, and how to diagnose it when it breaks. Written from a real, painful setup (a furniture storefront built on Next.js and Vercel) where every one of the gotchas below actually bit. The reference implementation shape referred to below: `lib/payments.ts`, `app/api/checkout/*`, `app/api/webhooks/square/route.ts`, a `scripts/square-setup.sh` helper, and a `deploy/SQUARE.md` runbook — adapt the paths to your own project.

## The integration model this covers

Server-side **hosted Payment Links** (`POST /v2/online-checkout/payment-links`). The app builds a checkout session from the live cart and redirects the buyer to a Square-hosted page (`checkout.square.site/...`). **No card data ever touches the app** (no PCI scope). It authenticates with the **access token alone** — the Square *Application ID* is **not used** by this flow (that's only for the client-side Web Payments SDK, which this model does not use).

The "Pay by Card" option is **env-gated**: the server advertises Square only when its credentials are present. In the reference implementation that gate is:
```ts
// lib/payments.ts
square: Boolean(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID)
```
So if either var is missing/empty in the environment serving the page, the buyer sees only fallback methods (Phone / Cash on Delivery) and **no card option**. "Configuring Square in the dashboard" is not enough — the running server must have the env vars.

## Credential taxonomy — the #1 source of pain

Square has several credential strings and they are **not interchangeable**. Getting these wrong causes ~every failure below.

| String | Prefix | What it is | Used by this flow? |
| --- | --- | --- | --- |
| Production Access Token | `EAAA…` (~64 chars) | Auth for **production** API (`connect.squareup.com`) | ✅ yes (prod) |
| Sandbox Access Token | `EAAA…` (~64 chars) | Auth for **sandbox** API (`connect.squareupsandbox.com`) | ✅ yes (sandbox) |
| Application ID | `sq0idp-…` (prod) / `sandbox-sq0idb-…` | Client-side app identifier | ❌ **NOT used** — do not put this in `SQUARE_ACCESS_TOKEN` |
| OAuth client secret | `sq0csp-…` | OAuth app secret | ❌ not this flow |
| Webhook signature key | opaque | HMAC key for webhook verification | ✅ (webhooks only) |

**Critical traps:**
- **`sq0idp-…` is an Application ID, not an access token.** Pasting it into `SQUARE_ACCESS_TOKEN` makes the gate pass (non-empty) but every Square API call returns `UNAUTHORIZED`. Access tokens start `EAAA…` and are ~64 chars.
- **Sandbox and production access tokens BOTH start `EAAA…`** — you cannot tell them apart by looking. A **production** token returns `UNAUTHORIZED` against the **sandbox** host, and vice-versa. This is the trap that eats hours: you grab "the token," it looks right, and it's the wrong *environment's* token.

### Where to get each token in the Square Developer Dashboard
`developer.squareup.com/apps` → open the application → **toggle the environment selector (top-left) to Sandbox or Production** → left nav **Credentials** → copy the **Access Token** for that environment. The dashboard defaults to **Production**, so the #1 mistake when someone asks for "the sandbox token" is handing back the production one because they never flipped the toggle.

### Identify an unknown token (do this before trusting any token)
Test it against **both** hosts — the one it authenticates on tells you its environment; the location it returns confirms the account:
```bash
# production host
curl -s https://connect.squareup.com/v2/locations \
  -H "Square-Version: 2026-05-20" -H "Authorization: Bearer $TOK" | jq '.locations[]|{id,name,status} // .errors'
# sandbox host
curl -s https://connect.squareupsandbox.com/v2/locations \
  -H "Square-Version: 2026-05-20" -H "Authorization: Bearer $TOK" | jq '.locations[]|{id,name,status} // .errors'
```
`UNAUTHORIZED` on one host + a real location list on the other = you now know exactly which environment (and which account) the token belongs to. **Everything except the token is derivable from the token** — you never need to hunt for the location ID by hand.

## Environment variables

| Var | Secret? | Notes |
| --- | --- | --- |
| `SQUARE_ACCESS_TOKEN` | **yes** | `EAAA…`, environment-matched (see above) |
| `SQUARE_LOCATION_ID` | no | derive via `GET /v2/locations`. Sandbox default-test-account location ≠ production business location |
| `SQUARE_ENVIRONMENT` | no | `production` → `connect.squareup.com`; anything else → sandbox host. Must match the token's environment |
| `SQUARE_VERSION` | no | optional, defaults to a pinned `Square-Version` in code |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | **yes** | shown only once at subscription creation |
| `SQUARE_WEBHOOK_URL` | no | must match the subscription's `notification_url` **exactly** |

Example locations (placeholders — yours will differ, always derive from the token): production `LXXXXXXXXXXXX`, sandbox default-test-account `LYYYYYYYYYYYY`.

**Golden rule:** `SQUARE_ENVIRONMENT` and `SQUARE_ACCESS_TOKEN` must be the **same environment**. `production` + a sandbox token → `UNAUTHORIZED`; `sandbox` + a production token → `UNAUTHORIZED`.

## Deployment on Vercel — the traps that wasted the most time

1. **Env vars bind at BUILD time.** Adding/changing a var does **nothing** to an existing deployment. You must **redeploy** after any env change. The currently-live build reads the vars that existed when *it* built.
2. **Scopes are separate: Production vs Preview vs Development.** A **Preview** deployment does **not** see Production-scoped vars. Convention: Production scope = production creds (`SQUARE_ENVIRONMENT=production`); Preview scope = sandbox creds (`SQUARE_ENVIRONMENT=sandbox`) so branch/preview deploys hit the sandbox. If the card tile is missing on a preview URL, its scope probably lacks the vars.
3. **Combined-scope removal trap.** If a var is attached to `Production, Preview` as one entry, `vercel env rm NAME preview` can remove it from **both** environments — this silently wiped a production token during a "just change preview" edit. Keep each environment's value as a **separate** entry; overwrite one scope with `--force`, e.g. `printf '%s' "$VAL" | vercel env add NAME preview --force`.
4. **Sensitive vars are write-only.** `vercel env pull` returns **empty** for sensitive vars, so you can't verify them from the CLI. Add non-secret values (`SQUARE_ENVIRONMENT`, `SQUARE_LOCATION_ID`) with `--no-sensitive` so they're readable/verifiable; keep the token `--sensitive`.
5. **Preview URLs sit behind Vercel deployment protection** → `curl` gets a `302`. Verify runtime behavior in a **logged-in browser**, not curl. `vercel env ls` and `vercel inspect <url>` are your read-only truth for scopes/timestamps.

Fastest safe path: use `scripts/square-setup.sh <production|sandbox> [notify_url]` — it sets the core vars in the right scope, creates the webhook, and stores the signature key (shown once). Prereqs: `vercel login` + `vercel link`. It prompts for the token hidden (never on disk/in chat).

**Never accept a secret token through chat** (it gets logged). Have the human paste it via the setup script's hidden prompt, or `pbpaste > file` after copying, then read the file and delete it. Verify the token against the API *before* redeploying so you don't burn a build on a wrong token.

## Setting prices / products

- **Base catalog** lives in code (`data/products.ts`): id, name, price (whole dollars), image, etc.
- **Live overrides** (price, hide, out-of-stock, badges, featured rank) are DB patches merged in `lib/catalog.ts` via the admin API — these take effect **without a redeploy** (`revalidateTag`). Note: a **preview** deployment may have **no DB access** (DB creds are Production-scoped), so on preview you see only the in-code base prices; add/change items in `data/products.ts` and redeploy for preview.
- The Payment Link is built **dynamically from the cart** — every line item plus shipping and tax are sent as order line items so the amount charged **equals exactly what the buyer saw**. (Example: `$25` flat shipping, free over `$500`, `6%` state tax.) Change prices in the catalog, not in Square.

## Webhooks

- Create the subscription first — the **signature key is returned only once** (retrieving the subscription later does not return it; rotate to get a fresh one).
- Verification HMACs `notificationUrl + rawBody` with the signature key. `SQUARE_WEBHOOK_URL` must equal the subscription's `notification_url` **exactly** (even a trailing slash rejects every event).
- Sandbox webhooks need a **public** URL (a Vercel preview host), not localhost.
- Until the key is deployed, the webhook route returns `400` on events — expected, not a failure.

## Testing

**Sandbox** (`SQUARE_ENVIRONMENT=sandbox` + sandbox token + sandbox location):
- Success card: `4111 1111 1111 1111`, CVV `111`, any **future** expiry, any **valid** ZIP.
- Decline triggers: CVV `911`, ZIP `99999`, expiry `01/40`, card `4000000000000002`.
- Square rule: **sandbox rejects real cards; production rejects test cards.** `4111…` will always decline on production.

**Production** (when you can't easily get a sandbox token, or want to prove the real path):
- Add a **$1 test item** to the catalog and give it free shipping (guard the free-ship on the test item's id so real products are unaffected), so the charge is ~$1 not ~$27.
- Pay with a **real card**, confirm the success page + the charge in the Square dashboard, then **refund it**. One real transaction validates the exact path customers use.
- **Never enter card details on someone's behalf** — hand off the link; the human enters their own card.

**Verify the gate + the redirect:** the "Pay by Card" tile should appear, and "Continue to Payment" should land on `checkout.square.site/...` (production) or the sandbox equivalent. Reaching the Square page proves link creation (token + location) works; the decline/approve is separate.

## The `pre_populated_data` email/phone gotcha (real bug — fix pattern below)

Square **hard-rejects the entire payment link** if `pre_populated_data.buyer_email` or `buyer_phone_number` fails its validation — even though those fields only *pre-fill* Square's form. Symptoms: `Square checkout failed: Invalid phone number.` (phone must be **E.164**, e.g. `+19415551234`; `9415551234` is rejected) or `Invalid email address.` (reserved domains like `example.com` rejected). A real customer typing `(941) 555-1234` would be blocked from paying.

Fix (in the checkout/payments module): normalize the phone to E.164 best-effort, and if Square still rejects the pre-fill, **retry once without `pre_populated_data`** so a bad email/phone can never block checkout. Pattern:
```ts
function toE164(raw){ const d=(raw||"").replace(/\D/g,""); if(d.length===10)return`+1${d}`; if(d.length===11&&d[0]==="1")return`+${d}`; return undefined; }
// build payload with/without pre_populated_data; POST with prefill=true;
// if !res.ok and error mentions email/phone → POST again with prefill=false.
```

## Failure → cause quick table

| Symptom | Likely cause |
| --- | --- |
| No "Pay by Card" tile at all | `SQUARE_ACCESS_TOKEN` or `SQUARE_LOCATION_ID` empty in the serving env; or vars set but **not redeployed**; or wrong Vercel scope (viewing a preview, vars only in production scope) |
| `Square checkout failed: This request could not be authorized` (`UNAUTHORIZED`) | Token is the wrong **type** (`sq0idp-` App ID) or wrong **environment** (prod token on sandbox host or vice-versa) — `SQUARE_ENVIRONMENT` and token mismatch |
| Reached Square page, card declined ("your order didn't go through") | On **production** with a test card, or on sandbox with a decline-trigger value (CVV `911`/ZIP `99999`) |
| `Invalid phone number` / `Invalid email address` | `pre_populated_data` validation — apply the E.164 + retry-without-prefill fix |
| Webhook events all rejected (`400`) | `SQUARE_WEBHOOK_URL` ≠ subscription `notification_url`, or signature key missing/not deployed |

## Setup checklist

1. Decide sandbox vs production for this environment; grab the **matching** access token (flip the dashboard toggle!).
2. `curl /v2/locations` on both hosts to confirm the token's environment + its location id.
3. Set `SQUARE_ACCESS_TOKEN` (sensitive), `SQUARE_LOCATION_ID` + `SQUARE_ENVIRONMENT` (non-sensitive) in the **correct Vercel scope**.
4. Create the webhook subscription; store `SQUARE_WEBHOOK_SIGNATURE_KEY` + `SQUARE_WEBHOOK_URL`.
5. **Redeploy** (vars bind at build).
6. Verify the tile shows and checkout reaches the Square page (logged-in browser, not curl).
7. Run a test payment (sandbox `4111…` or production real-card + refund).
8. Set/adjust prices in the catalog (base `data/products.ts` or live overrides), not in Square.

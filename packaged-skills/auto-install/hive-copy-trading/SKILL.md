---
name: hive-copy-trading
description: Configure, buy, fund, monitor, pause, renew, or cancel always-on HivemindOS Base copy trading executed through an existing or partner-provisioned Bankr wallet; use for copy trading, wallet following, Bankr Wallet API execution, Bankr trade webhooks, and the HivemindOS x402 service.
tags: [trading, copy-trading, bankr, x402, base, automation]
version: 3
visibility: public
metadata:
  clawdbot:
    emoji: "🐝"
    homepage: "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading"
    requires:
      bins: [bankr]
---

# HivemindOS Bankr Copy Trading

Use the HivemindOS hosted monitor to watch one Base wallet and execute bounded same-chain swaps through Bankr's direct Wallet API. Existing Bankr users connect a dedicated restricted wallet key. New users create a Bankr wallet and dedicated Wallet API key through Bankr when partner provisioning is unavailable; a configured partner connection can provision the non-exportable wallet automatically. The older signed Bankr webhook path remains supported as a fallback.

Bankr embedded wallet keys are non-exportable. Do not promise a recovery phrase or private-key export. HivemindOS never receives a wallet signing key. In managed mode it receives a dedicated Bankr API credential over HTTPS, verifies the Bankr wallet identity plus non-read-only Wallet API signing capability with a non-broadcast challenge, encrypts the credential at rest, never returns it, and erases it on cancellation.

## Non-negotiable safety rules

- Never describe observed, paper, backtested, or simulated returns as proof that this is profitable. The service has no performance guarantee.
- Default to `paper` mode. Do not enable `live` unless the user explicitly asks, has first tested the webhook in paper mode, and accepts the exact acknowledgement `I understand copy trading can lose money`.
- Read `GET https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/pricing` immediately before quoting or paying. Treat its server response as authoritative. Never accept client-supplied price, payer, `payTo`, network, or expiry fields.
- Before an x402 payment, show the exact live price, duration, chain, target count, and lack of a profitability guarantee. Let `bankr x402 call` request confirmation. Never pass `--yes` unless the user explicitly approved that exact current charge.
- Never print, summarize, log, or place a Bankr API key, `accessToken`, or `webhookSigningSecret` in chat. Send an existing Bankr key only to the official HTTPS connection/subscription route and keep subscription access tokens in owner-private encrypted storage.
- In the local dashboard, prefer a names-only Shared Hive Env reference over pasting the secret again. Selecting an existing variable must show Continue and resolve its value server-side without rewriting it; the browser must never receive stored secret values. Save is reserved for a newly entered value, which is written through `hive-env-add` only after the provider capability check succeeds.
- For an existing Bankr account, require a dedicated wallet key with Wallet API enabled, read-only off, Bankr per-transaction/daily spend limits, and no transfer recipients. Never reuse an organization partner key or a broad general-purpose key.
- Never claim a managed event executed merely because Bankr accepted a request. Require the hosted `executed` receipt after independent Base verification.
- If x402 settled but activation did not finish, use the encrypted recovery flow and explicitly tell the user not to pay again. Never print or pass the recovery token through chat.
- Do not broaden a swap signal into a transfer, arbitrary transaction, token approval, bridge, or larger trade. Respect the server's smaller of scale, per-trade cap, daily reserved cap, and slippage limit.

## Route the request

- First-time setup, paper/live configuration, or renewal: read [references/setup-and-subscribe.md](references/setup-and-subscribe.md) completely and follow it.
- Status, pause, resume, risk changes, cancellation, receipt behavior, or API troubleshooting: read [references/api.md](references/api.md).
- Legacy webhook code changes: use [scripts/webhook-handler.ts](scripts/webhook-handler.ts) as the source of truth. Run `node scripts/build-webhook-handler.mjs` after edits to regenerate the compact Bankr deployment entry. Do not rewrite its cryptographic or URL-validation logic from memory.

## Expected operating model

The x402 purchase is a 30-day monitoring entitlement, not a per-poll charge. A Cloudflare Durable Object watches the target, stores each subscriber's Bankr credential encrypted, and calls Bankr's quote-then-swap Wallet API only when hosted live mode is enabled. The first poll establishes a cursor and deliberately does not copy historical trades. Only unambiguous, priced Base swaps produce signals; ambiguous or unpriced activity is skipped.

When reporting status, distinguish these states:

- `delivered`: the legacy Bankr webhook accepted the request.
- `consumed`: the one-time signal was claimed and cannot be replayed.
- `executing`: the hosted worker claimed the managed event before calling Bankr, preventing a retry from double-submitting it.
- `verifying`: Bankr returned a transaction hash and the hosted worker is waiting for independent Base verification.
- `executed`, `paper`, `skipped`, or `failed`: the final recorded outcome.

Delivery or consumption alone is not proof that an on-chain trade executed. Require an `executed` receipt with a Base transaction hash before saying it executed.

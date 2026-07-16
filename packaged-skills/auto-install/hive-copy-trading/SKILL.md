---
name: hive-copy-trading
description: Configure, fund, monitor, pause, or cancel always-on HivemindOS Base copy trading executed by a user-owned Bankr wallet with a direct fee only after each verified live copied trade.
tags: [trading, copy-trading, bankr, base, automation]
version: 4
visibility: public
metadata:
  clawdbot:
    emoji: "🐝"
    homepage: "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading"
    requires:
      bins: [bankr]
---

# HivemindOS Bankr Copy Trading

Use the hosted HivemindOS monitor to watch one Base wallet and execute bounded same-chain swaps through Bankr's direct Wallet API. Bankr holds the user's wallet and non-exportable signing key. HivemindOS receives only a dedicated restricted Bankr API credential over HTTPS, verifies its wallet and signing capability, encrypts it at rest, never returns it, and erases it when the monitor is canceled.

There is no subscription or upfront x402 payment. A new monitor gets one eligible paper event within seven days, then pauses for review. Live mode charges 0.5% of the independently verified copied-trade notional, with a $0.02 minimum and $0.50 maximum, directly in Base USDC from the Bankr execution wallet. Paper, skipped, and failed trades cost $0. Always read the hosted pricing response because the server policy is authoritative.

## Install inside Bankr

Bankr can install this directory directly from GitHub. Ask Bankr:

```text
install the hive-copy-trading skill from https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading
```

In Bankr Settings → Env Vars, save the dedicated Wallet API key as `HIVEMIND_COPY_TRADING_WALLET_KEY`. Bankr's agent sees only the name; [scripts/monitor-client.mjs](scripts/monitor-client.mjs) reads the value inside `execute_cli`, keeps monitor access tokens in a private mode-600 state file, and never prints either credential. The hosted Durable Object remains always on after the Bankr chat or app closes.

## Non-negotiable safety rules

- Never describe observed, paper, backtested, or simulated returns as proof that this is profitable. The service has no performance guarantee.
- Default to `paper`. Do not enable `live` until at least one paper event completes and the user accepts both exact acknowledgements: `I understand copy trading can lose money` and `I authorize HivemindOS to charge the published fee after each verified live copied trade`.
- Read `GET https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/pricing` immediately before quoting fees or requesting live consent. Never accept client-supplied pricing, fee recipient, payer, network, or expiry fields.
- Never print, summarize, log, or place a Bankr API key or monitor `accessToken` in chat. In HivemindOS, use a names-only Shared Hive Env reference; the browser must never receive a stored secret value.
- Require a dedicated Bankr key with Wallet API enabled, read-only off, conservative Bankr spend limits, and the pricing response's official Base fee recipient as its only allowed EVM transfer recipient. Never use an organization partner key or broad general-purpose key.
- Never claim a managed event executed because Bankr accepted a request. Require the hosted `executed` result after independent Base verification. Require `fee.status = collected` before saying the service fee settled.
- A copied swap and its fee are separate transactions. If execution, fee submission, or fee verification becomes uncertain, report that the monitor paused. Never retry an ambiguous submission.
- Do not broaden a copy signal into a transfer, approval, bridge, arbitrary transaction, or larger trade. Respect the smaller of scale, per-trade cap, daily reserved cap, and slippage limit.

## Route the request

- First-time setup or paper/live configuration: read [references/setup-and-subscribe.md](references/setup-and-subscribe.md) completely.
- Status, pause, resume, risk changes, cancellation, fee receipts, or API troubleshooting: read [references/api.md](references/api.md).
- Legacy self-hosted webhook changes only: use [scripts/webhook-handler.ts](scripts/webhook-handler.ts) as source, then run `node scripts/build-webhook-handler.mjs`. Managed Bankr monitors do not need this webhook.

## Expected operating model

A Cloudflare Durable Object establishes a cursor, monitors new Base swaps, and calls Bankr quote-then-swap only for eligible live events. It deliberately does not copy history. New monitors start in paper mode. Live execution remains bounded by HivemindOS risk policy and the Bankr key's own limits.

Interpret status precisely:

- `paper`: simulated event; no swap and no fee.
- `executing`: the event was claimed before Bankr was called; it is not retried automatically.
- `verifying`: Bankr returned a swap hash and HivemindOS is independently verifying it on Base.
- `executed`: the copied Base swap is verified; a per-trade fee may now be submitted.
- fee `pending`, `charging`, or `verifying`: fee settlement is still in progress.
- fee `collected`: the exact Base USDC amount, Bankr sender, and official recipient were independently verified.
- fee `uncertain` or `verification_failed`: the monitor is paused and must not place another copied trade.

An event, a successful copied trade, a collected fee, and profitability are four different claims. Never collapse them.

---
name: hive-copy-trading
description: Configure, fund, monitor, pause, or cancel always-on HivemindOS Base copy trading executed and paid directly by a user-owned Bankr wallet.
tags: [trading, copy-trading, bankr, base, automation]
version: 5
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

There is no card subscription or x402 payer step. Bankr pays a $1 Base USDC usage minimum when the monitor activates and every 30 days while it remains active. That $1 becomes fee credit. Each independently verified copied trade incurs an uncapped 0.5% of actual copied notional; remaining credit is applied first and Bankr sends only any excess. The minimum executed copy is $5. Paper, skipped, and failed trades cost $0, though optional paper monitoring still requires the same usage period. Always read the hosted pricing response because the server policy is authoritative.

## Install inside Bankr

Bankr can install this directory directly from GitHub. Ask Bankr:

```text
install the hive-copy-trading skill from https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading
```

In Bankr Settings → Env Vars, save the dedicated Wallet API key as `HIVEMIND_COPY_TRADING_WALLET_KEY`. Bankr's agent sees only the name; [scripts/monitor-client.mjs](scripts/monitor-client.mjs) reads the value inside `execute_cli`, keeps monitor access tokens in a private mode-600 state file, and never prints either credential. The hosted Durable Object remains always on after the Bankr chat or app closes.

## Non-negotiable safety rules

- Never describe observed, paper, backtested, or simulated returns as proof that this is profitable. The service has no performance guarantee.
- A new monitor may start `live` immediately; do not impose a paper-event wait. Before activation, show the current server policy and obtain both exact acknowledgements: `I understand copy trading can lose money` and `I authorize HivemindOS to charge the published $1 usage minimum and uncapped 0.5% fee on each verified live copied trade`.
- Read `GET https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/pricing` immediately before quoting fees or requesting live consent. Never accept client-supplied pricing, fee recipient, payer, network, or expiry fields.
- Never print, summarize, log, or place a Bankr API key or monitor `accessToken` in chat. In HivemindOS, use a names-only Shared Hive Env reference; the browser must never receive a stored secret value.
- Require a dedicated Bankr key with Wallet API enabled, read-only off, conservative Bankr spend limits, and the pricing response's official Base fee recipient as its only allowed EVM transfer recipient. Never use an organization partner key or broad general-purpose key.
- Never claim a managed event executed because Bankr accepted a request. Require the hosted `executed` result after independent Base verification. Require `fee.status = collected` before saying the service fee settled.
- The usage minimum, a copied swap, and any excess fee are separate transactions. If execution, payment submission, or verification becomes uncertain, report that the monitor paused. Never retry an ambiguous submission.
- Do not broaden a copy signal into a transfer, approval, bridge, arbitrary transaction, or larger trade. Respect the smaller of scale, per-trade cap, daily reserved cap, and slippage limit.

## Route the request

- First-time setup or paper/live configuration: read [references/setup-and-subscribe.md](references/setup-and-subscribe.md) completely.
- Status, pause, resume, risk changes, cancellation, fee receipts, or API troubleshooting: read [references/api.md](references/api.md).
- Legacy self-hosted webhook changes only: use [scripts/webhook-handler.ts](scripts/webhook-handler.ts) as source, then run `node scripts/build-webhook-handler.mjs`. Managed Bankr monitors do not need this webhook.

## Expected operating model

A Cloudflare Durable Object establishes a cursor, monitors new Base swaps, and calls Bankr quote-then-swap only for eligible live events. It deliberately does not copy history. New monitors activate live after the $1 payment is independently verified. Live execution remains bounded by HivemindOS risk policy and the Bankr key's own limits.

Interpret status precisely:

- `paper`: simulated event; no swap and no fee.
- `executing`: the event was claimed before Bankr was called; it is not retried automatically.
- `verifying`: Bankr returned a swap hash and HivemindOS is independently verifying it on Base.
- usage `pending`, `charging`, or `verifying`: the $1 usage payment has not yet activated the period.
- usage `collected`: the payment is independently verified and its remaining balance is fee credit.
- `executed`: the copied Base swap is verified; its gross 0.5% fee can now use credit and any excess may be submitted.
- fee `included`: the fee was fully covered by usage credit.
- fee `pending`, `charging`, or `verifying`: an excess fee settlement is still in progress.
- fee `collected`: the exact Base USDC amount, Bankr sender, and official recipient were independently verified.
- fee `uncertain` or `verification_failed`: the monitor is paused and must not place another copied trade.

An event, a successful copied trade, a collected fee, and profitability are four different claims. Never collapse them.

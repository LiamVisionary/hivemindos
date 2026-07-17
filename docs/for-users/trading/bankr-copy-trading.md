---
title: "Bankr Copy Trading"
---

# Bankr Copy Trading

HivemindOS can monitor a Base wallet around the clock and execute bounded copies from your Bankr wallet. The hosted monitor stays online when your desktop is closed. Existing Bankr users connect a dedicated restricted Wallet API key; new users can create a wallet directly with Bankr and connect its dedicated key.

Copy trading can lose money. Past wallet history, paper results, backtests, or simulations do not prove that future copies will be profitable. Fees, slippage, latency, liquidity, and your starting point all change the result. HivemindOS makes no performance guarantee.

## Price and activation

There is no card subscription and no separate x402 payer wallet.

- Bankr pays a **$1 Base USDC usage minimum** when a monitor activates and every 30 days while it stays active.
- The $1 becomes fee credit. It is not added on top of the percentage fees.
- Each successful copied trade costs an **uncapped 0.5% of its actual verified copied notional**.
- Remaining credit is used first; Bankr sends only any excess fee.
- The minimum executed copy is **$5**. Skipped and failed trades cost $0.

For example, a verified $1,000 copy has a $5 gross fee. If the full $1 credit remains, HivemindOS applies it and Bankr sends $4. A $100 copy has a $0.50 gross fee and can be fully covered by the credit. A monitor with no trades still costs the $1 usage minimum for that active period.

The hosted pricing response is authoritative and is shown again before consent. Existing monitors that already accepted older direct-fee or prepaid terms keep those terms instead of being silently migrated.

## How setup works

1. Choose or create a Bankr wallet. The wizard automatically selects an existing Shared Hive Env Bankr variable when one is available.
2. Continue verifies a selected variable server-side without exposing or rewriting its value. The pencil lets you enter a new value; Save verifies it before writing it through Shared Hive Env.
3. The wallet check proves EVM identity and Wallet API signing access without broadcasting a transaction, then shows its Base USDC balance.
4. Fund at least $1 Base USDC for activation plus enough USDC for the copied trades you want to permit. Bankr sponsors Base gas.
5. Choose the target wallet, per-trade cap, UTC daily cap, copy percentage, and maximum slippage.
6. Review the exact risk and fee terms. After both acknowledgements, Bankr submits the $1 payment and HivemindOS independently verifies it on Base. The live monitor activates automatically after settlement.

There is no forced paper-signal wait. Optional paper mode remains available for classification testing, but it uses the same paid usage period and is not proof of profitability.

## Safe Bankr access

Use a dedicated `bk_usr` key with Wallet API enabled, read-only off, conservative Bankr spend limits, and only the published HivemindOS fee wallet in its EVM recipient allowlist. An LLM-only or read-only key cannot execute copies.

Bankr embedded wallet signing keys are non-exportable, so HivemindOS does not show or store a recovery phrase. HivemindOS stores only the dedicated Bankr API credential encrypted in hosted infrastructure and erases it when the monitor is canceled. Your normal Bankr account recovery remains the wallet recovery path.

## What happens on each trade

The first scan establishes a cursor, so older transactions are not copied. For each eligible new target swap, the hosted service applies scale and hard risk limits, asks Bankr for a quote, enforces slippage and the USD ceiling, then submits the copy. A transaction hash alone is not treated as success: HivemindOS verifies the matching Base swap from the configured Bankr wallet before recording it as executed.

Only then does the service calculate 0.5% of actual verified notional. It atomically uses remaining period credit. If credit covers the gross fee, no second payment is sent. Otherwise Bankr sends the exact excess in Base USDC, and HivemindOS verifies token, amount, sender, recipient, and successful settlement independently.

Many users following the same target can share one hosted watcher, while each monitor keeps separate Bankr credentials, limits, usage credit, daily reservations, and outcomes. One Bankr wallet can run up to three active target monitors.

## Share verified performance

Each monitor can publish a separate read-only performance link for a Bankr app or public dashboard. The feed comes from HivemindOS's verified copied-execution ledger, not the Bankr wallet's raw transfers. It includes copied notional, usage credit, excess fees, execution hashes, weighted-average realized PnL, current-mark unrealized PnL, and open positions when the service can prove the required cost basis and prices.

If the monitor starts with token inventory the service did not observe, or a current price is unavailable, affected PnL fields remain unavailable instead of being shown as zero or profit. The feed excludes deposits, withdrawals, self-transfers, and unrelated trades. It is copy-execution performance, not whole-wallet accounting, and it remains subject to the no-performance-guarantee warning.

Use **Publish performance** on the monitor card, then copy the URL into the Bankr app. **Rotate link** invalidates the old URL and creates a new one. **Revoke** disables public access, and canceling the monitor revokes its link automatically. The public link never exposes the private monitor credential.

## Ask an agent to set it up

The bundled `hive-copy-trading` skill contains the existing-wallet, optional partner-provisioning, direct Bankr payment, funding, secret-handling, management, cancellation, and legacy workflow. For example:

> Set up live Base copy trading for this wallet through Bankr. Copy 10%, cap each copy at $100 and each UTC day at $500, with 0.75% maximum slippage. Show me the current hosted price and ask for the required acknowledgements before charging anything.

Inside Bankr, ask:

> install the hive-copy-trading skill from https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading

Save the dedicated Wallet API key in Bankr Settings → Env Vars as `HIVEMIND_COPY_TRADING_WALLET_KEY`. The helper keeps the monitor credential in a private file. Bankr performs the wallet calls; HivemindOS hosts the always-on target watcher.

## Status guide

| Status | Meaning |
|---|---|
| Usage pending, charging, or verifying | The $1 period payment has not activated yet. |
| Usage collected | The $1 payment is independently verified and its remaining amount is fee credit. |
| Executing | The copy was claimed before Bankr was called; it is not automatically retried. |
| Verifying | Bankr returned a swap hash and HivemindOS is checking it on Base. |
| Executed | The matching Base swap is verified. |
| Fee included | The trade's gross fee was fully covered by usage credit. |
| Fee charging or verifying | Bankr submitted an excess fee that is still settling. |
| Fee collected | The exact excess Base USDC payment was independently verified. |
| Uncertain or verification failed | The monitor paused to avoid a duplicate or unsafe transaction. |
| Skipped or failed | No matching copied trade completed, so the percentage fee is $0. |

An event, a copied trade, a collected payment, and profitability are four different claims.

## Built-in boundaries

- Base only, with up to three active target monitors per Bankr wallet.
- New swaps only; no historical backfill.
- Ambiguous, failed, unpriced, multi-asset, or sub-$5 copies are skipped.
- Server-enforced scale, per-trade, UTC daily, slippage, and signal-count limits.
- At most one unsettled live execution and excess fee per monitor.
- Ambiguous submissions pause without automatic retry.
- Pause, resume, risk changes, optional mode changes, and cancellation use the private monitor credential.
- Paused monitors do not begin a new paid period. Resuming inside a funded period is immediate; resuming after expiry starts the next $1 period.
- Activation uses a stable idempotency key, so retrying a timed-out start cannot create a second monitor credential.

See the [Bankr documentation](https://docs.bankr.bot/) for Bankr account and API-key setup.

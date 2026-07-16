---
title: "Bankr Copy Trading"
---

# Bankr Copy Trading

HivemindOS can monitor one wallet on Base around the clock and execute carefully bounded copies from a separate Bankr wallet. The hosted monitor stays online when your desktop is closed. Existing Bankr users can connect a dedicated restricted wallet key. New users can create the wallet directly with Bankr and connect its dedicated key; partner provisioning creates it automatically when that service is available.

Copy trading is risky. A profitable simulation, backtest, or past wallet history does not prove that future copies will make money. Fees, slippage, delay, liquidity, and the point where you start following can all change the result. HivemindOS makes no performance guarantee.

## How it works

1. You choose the Base wallet to follow and set a per-trade cap, UTC daily cap, copy percentage, and maximum slippage.
2. Your agent checks the current hosted offer. If the offer is unavailable or still marked coming soon, setup stops without a payment.
3. An x402 USDC payment starts a 30-day monitor for that one target. The price and payment recipient come from the hosted service, not from your desktop or a request body.
4. New, unambiguous Base swaps become short-lived managed events. Paper events are recorded without a transaction. Once live mode is enabled, the hosted worker quotes and executes through Bankr's Wallet API, then independently verifies the resulting Base transaction. The first scan only establishes a starting point, so historical transactions are not copied.

Many subscribers following the same target share one hosted watcher, while each subscriber keeps separate Bankr credentials, limits, daily reservations, and outcomes.

## Connect an existing Bankr key

The setup checks Shared Hive Env first. If a Bankr variable is already configured, its variable name is selected automatically; the stored secret value never has to be loaded into the browser. Open the selector to search all saved variable names, or use the pencil segment to enter a replacement value. **Continue** verifies a selected variable without rewriting it. **Save** appears only for a newly entered value, verifies that it belongs to an EVM wallet and can sign through Wallet API without broadcasting a transaction, then stores it through the normal Shared Hive Env flow. A successful check advances to the limits step.

An LLM-only or read-only Bankr key is not enough for copy trading. Use a dedicated key with Wallet API enabled, read-only off, and conservative limits at Bankr.

If you do not have a Bankr wallet yet, choose **Create a Bankr wallet**. When hosted partner provisioning is available, activation creates the non-exportable wallet automatically. Otherwise the wizard opens Bankr's account and API-key setup, then returns to the same verified Shared Hive Env connection step. The option never stays disabled merely because partner access is unavailable.

## Start in paper mode

Paper mode is the default and cannot submit a transaction. Use it first to observe enough new trades to judge latency, skipped signals, fees, slippage, and results after costs.

Live mode has a separate hosted availability switch. Enabling it requires all of the following:

- a paper-mode trial;
- the exact acknowledgement that copy trading can lose money;
- a dedicated Bankr wallet key with Wallet API enabled, read-only off, and conservative Bankr spend limits;
- enough Base funds for the bounded swaps and gas;
- explicit approval of the current paid offer.

Live receipts are not accepted merely because they contain a transaction hash. The hosted service checks that the Base transaction is a successful matching swap from the configured Bankr wallet, follows the copied trade, uses the expected assets, and stays inside the server-issued spend ceiling.

After at least one new paper-mode event is recorded, **Manage mode & limits** lets you tighten the caps and enter the exact loss acknowledgement before enabling live mode. The hosted service independently enforces the paper-trial requirement, the global live switch, and every limit; changing local UI state cannot bypass them.

## Ask an agent to set it up

The bundled `hive-copy-trading` skill contains the complete existing-wallet, partner-provisioning, x402 purchase, funding, secret-handling, management, renewal, cancellation, and legacy webhook workflow. For example:

> Set up Base copy trading for this wallet through Bankr. Use paper mode, copy 10%, cap each signal at $3 and each UTC day at $15, with 0.75% maximum slippage.

The agent will check the current price before asking for payment approval. It should never paste the Bankr API key or subscription access token into chat, and it should never skip payment confirmation unless you approved that exact current charge.

Bankr embedded wallets do not expose recovery phrases or private keys. That is why the setup shows the Bankr deposit address and a funding action instead of a seed-phrase step. If you connect an existing Bankr wallet, your normal Bankr account recovery remains the recovery path.

See the [Bankr documentation](https://docs.bankr.bot/) for Bankr CLI and webhook prerequisites.

## What the statuses mean

| Status | Meaning |
|---|---|
| Delivered | The legacy Bankr webhook accepted the signed request. |
| Consumed | The short-lived signal was claimed once and cannot be replayed. |
| Executing | The hosted worker claimed a managed event before calling Bankr, preventing a retry from submitting it twice. |
| Verifying | Bankr returned a hash and the hosted worker is independently checking the Base swap. |
| Paper | Bankr recorded a no-transaction paper outcome. |
| Executed | The hosted service verified the reported Base swap against the signal. |
| Skipped or failed | Bankr did not submit a matching trade. |

Delivered or consumed does not mean a trade executed, and executed does not mean the trade was profitable.

## Built-in boundaries

- Base only, one watched target per 30-day subscription.
- New swaps only; no historical backfill.
- Ambiguous, failed, unpriced, or multi-asset activity is skipped.
- One-time managed event claims; the legacy webhook path also uses short-lived HMAC-signed delivery and one-time outcome capabilities.
- Server-enforced scale, per-trade, daily, slippage, and signal-count limits.
- Pause, resume, risk update, renewal, and cancellation through the private subscription credential.
- If payment succeeds but wallet provisioning or subscription activation is interrupted, HivemindOS stores only an encrypted recovery token and retries the free recovery route. It does not ask you to pay again.
- HivemindOS never receives a Bankr wallet signing key. Managed mode stores only a dedicated Bankr API credential encrypted in hosted infrastructure and erases it on cancellation.

Treat the paper period as measurement, not marketing evidence. Move to live only if your own after-cost results and loss tolerance justify it.

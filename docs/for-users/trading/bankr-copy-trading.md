---
title: "Bankr Copy Trading"
---

# Bankr Copy Trading

HivemindOS can monitor one wallet on Base around the clock and execute carefully bounded copies from a separate Bankr wallet. The hosted monitor stays online when your desktop is closed. Existing Bankr users can connect a dedicated restricted wallet key. New users can create the wallet directly with Bankr and connect its dedicated key; partner provisioning creates it automatically when that service is available.

Copy trading is risky. A profitable simulation, backtest, or past wallet history does not prove that future copies will make money. Fees, slippage, delay, liquidity, and the point where you start following can all change the result. HivemindOS makes no performance guarantee.

## How it works

1. You choose the Base wallet to follow and set a per-trade cap, UTC daily cap, copy percentage, and maximum slippage.
2. The monitor starts in a free seven-day paper trial. It records the first eligible new trade without moving funds or charging a fee, then pauses so you can review the result.
3. If you enable live mode, the hosted worker quotes and executes eligible swaps through Bankr's Wallet API, then independently verifies the resulting Base transaction. The first scan only establishes a starting point, so historical transactions are not copied.
4. After a copied trade verifies, Bankr sends the published service fee directly from the same Bankr wallet in Base USDC. There is no subscription, separate payer wallet, or upfront x402 payment. Paper, skipped, failed, and unverified trades cost $0.

The current hosted fee is **0.5% of verified copied-trade notional**, with a **$0.02 minimum** and **$0.50 maximum**. The hosted pricing response is authoritative and is shown again before live consent. Many users following the same target share one hosted watcher, while each monitor keeps separate Bankr credentials, limits, daily reservations, and outcomes. One Bankr wallet can run up to three active monitors.

## Connect an existing Bankr key

The setup checks Shared Hive Env first. If a Bankr variable is already configured, its variable name is selected automatically; the stored secret value never has to be loaded into the browser. Open the selector to search all saved variable names, or use the pencil segment to enter a replacement value. **Continue** verifies a selected variable without rewriting it. **Save** appears only for a newly entered value, verifies that it belongs to an EVM wallet and can sign through Wallet API without broadcasting a transaction, then stores it through the normal Shared Hive Env flow. A successful check advances to the limits step.

An LLM-only or read-only Bankr key is not enough for copy trading. Use a dedicated key with Wallet API enabled, read-only off, and conservative limits at Bankr.

If you do not have a Bankr wallet yet, choose **Create a Bankr wallet**. When hosted partner provisioning is available, activation creates the non-exportable wallet automatically. Otherwise the wizard opens Bankr's account and API-key setup, then returns to the same verified Shared Hive Env connection step. The option never stays disabled merely because partner access is unavailable.

## Start in paper mode

Paper mode is the default and cannot submit a transaction. The monitor records one eligible new event and pauses. Use that result to inspect classification and latency before accepting live risk; it is not evidence that the target is profitable.

Live mode has a separate hosted availability switch. Enabling it requires all of the following:

- a paper-mode trial;
- the exact acknowledgement that copy trading can lose money;
- a dedicated Bankr wallet key with Wallet API enabled, read-only off, and conservative Bankr spend limits;
- enough Base assets for the bounded swaps and enough Base USDC for the post-verification fee;
- explicit approval of the current published fee policy.

Live receipts are not accepted merely because they contain a transaction hash. The hosted service checks that the Base transaction is a successful matching swap from the configured Bankr wallet, follows the copied trade, uses the expected assets, and stays inside the server-issued spend ceiling.

After the paper event is recorded, **Manage mode & limits** lets you tighten the caps and accept both the exact loss acknowledgement and the exact direct-fee acknowledgement before enabling live mode. Enabling live reactivates the paused monitor. The hosted service independently enforces the paper requirement, current fee policy, global live switch, and every limit; changing local UI state cannot bypass them.

## Ask an agent to set it up

The bundled `hive-copy-trading` skill contains the complete existing-wallet, partner-provisioning, paper trial, direct Bankr fee, funding, secret-handling, management, cancellation, and legacy webhook workflow. For example:

> Set up Base copy trading for this wallet through Bankr. Use paper mode, copy 10%, cap each signal at $3 and each UTC day at $15, with 0.75% maximum slippage.

The agent checks current hosted pricing before asking for live consent. It should never paste the Bankr API key or monitor access token into chat, and it must not enable live mode without both exact acknowledgements.

Inside Bankr, ask the agent:

> install the hive-copy-trading skill from https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/hive-copy-trading

Then save the dedicated Wallet API key in Bankr Settings → Env Vars as `HIVEMIND_COPY_TRADING_WALLET_KEY`. The skill's helper keeps the monitor credential in a private file and can start, inspect, pause, resume, enable live, or cancel the hosted monitor from Bankr chat. Bankr runs the wallet calls; HivemindOS still hosts the always-on target watcher.

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
| Fee pending, charging, or verifying | The copied trade verified, but its separate Base USDC fee has not yet been confirmed. |
| Fee collected | The exact fee token, amount, Bankr sender, and official recipient were independently verified. |
| Fee uncertain or verification failed | The monitor paused and will not submit another copied trade until the issue is reviewed. |
| Skipped or failed | Bankr did not submit a matching trade. |

Delivered or consumed does not mean a trade executed, and executed does not mean the trade was profitable.

## Built-in boundaries

- Base only, up to three active target monitors per Bankr wallet.
- New swaps only; no historical backfill.
- Ambiguous, failed, unpriced, or multi-asset activity is skipped.
- One-time managed event claims; the legacy webhook path also uses short-lived HMAC-signed delivery and one-time outcome capabilities.
- Server-enforced scale, per-trade, daily, slippage, and signal-count limits.
- At most one unsettled live execution and fee per monitor. Ambiguous execution or fee submission pauses without retrying.
- Pause, resume, risk update, mode change, and cancellation through the private monitor credential.
- Activation uses a stable idempotency key, so retrying a failed start cannot create a second monitor credential.
- HivemindOS never receives a Bankr wallet signing key. Managed mode stores only a dedicated Bankr API credential encrypted in hosted infrastructure and erases it on cancellation.

Treat the paper period as measurement, not marketing evidence. Move to live only if your own after-cost results and loss tolerance justify it.

---
title: "Trading"
---

# Trading

HivemindOS gives you and your agents one place to **move money and trade** — crypto,
stocks, options, and prediction research — through wallets you control, with limits and confirmations on every action.

Whether you do it yourself or hand it to an agent, the same rules apply: a wallet
with spending limits, a clear preview of exactly what's about to happen, and your
confirmation before anything executes. Nothing moves silently.

<div class="docGrid">
  <section class="docCard">
    <h3>Crypto</h3>
    <p>Swap tokens, send USDC or Robinhood Chain USDG, make a private transfer, pay an API, trade Hyperliquid spot or perps, and use Bankr for prediction markets, NFTs, token launches, bridges, or recurring buys.</p>
    <a href="crypto.html">What you can do with crypto</a>
  </section>
  <section class="docCard">
    <h3>Bankr Copy Trading</h3>
    <p>Keep a hosted Base-wallet monitor online, start safely in paper mode, and explicitly promote a verified Bankr execution wallet to live trading under hard limits.</p>
    <a href="bankr-copy-trading.html">Set up Bankr copy trading</a>
  </section>
  <section class="docCard">
    <h3>Concentrated Liquidity</h3>
    <p>Inspect a real Base Uniswap v3 position and run an explainable, always-on shadow range manager that never signs or submits a transaction.</p>
    <a href="concentrated-liquidity.html">Manage a Uniswap v3 range</a>
  </section>
  <section class="docCard">
    <h3>Hyperliquid</h3>
    <p>Trade spot or perps from a local EVM wallet, manage orders, leverage, margin, transfers, withdrawals, and TWAPs, and keep everything inside wallet limits.</p>
    <a href="hyperliquid.html">Trade on Hyperliquid</a>
  </section>
  <section class="docCard">
    <h3>Nansen Intelligence</h3>
    <p>Ask agents for read-only token, wallet, DeFi positions, Smart Money holdings, token-holder, token-screener, Hyperliquid, complex-template, CEX-health, market-scout, or Nansen Agent research before deciding what to do.</p>
    <a href="nansen-intelligence.html">Research with Nansen</a>
  </section>
  <section class="docCard">
    <h3>Quant Research</h3>
    <p>Run a reviewed quant research request from the Trade tab through lagged Rust backtests, independent Python validation, and fail-closed robustness gates.</p>
    <a href="../features/quant-research.html">Review the quant research workflow</a>
  </section>
  <section class="docCard">
    <h3>Stocks</h3>
    <p>Buy and sell through Alpaca paper/live brokerage or a dedicated Robinhood Agentic account, or trade tokenized stocks on Solana and Robinhood Chain. Includes governed previews and portfolio context.</p>
    <a href="stocks.html">Trade stocks</a>
  </section>
  <section class="docCard">
    <h3>Prediction Markets</h3>
    <p>Search active Polymarket markets, inspect public odds and depth, simulate paper fills, analyze a public trader sample, and model weather buckets without granting the app live-order authority.</p>
    <a href="prediction-markets.html">Research prediction markets</a>
  </section>
  <section class="docCard">
    <h3>On-chain Options</h3>
    <p>Browse, write, buy, cancel, exercise, settle, redeem, and reclaim Plume's TSLA and AMD covered calls and cash-secured puts on Robinhood Chain testnet. Mainnet remains locked while its registry and independent audit are pending.</p>
    <a href="https://www.plume.trade/docs">Read the Plume protocol docs</a>
  </section>
  <section class="docCard">
    <h3>Ways to Trade</h3>
    <p>Do it from the Trade tab, just ask an agent in chat ("buy $25 of AAPL"), or let your coding tools trade on your behalf — all with the same confirmations.</p>
    <a href="agent-access.html">Where you can trade</a>
  </section>
  <section class="docCard">
    <h3>Safety & Limits</h3>
    <p>Spending caps, daily and monthly limits, a one-switch freeze, approval steps for bigger amounts, and a personal-wallet rule that never lets anything auto-spend.</p>
    <a href="governance.html">How your money stays safe</a>
  </section>
</div>

## What you can trade or research

| You can… | Using |
|---|---|
| Swap one token for another | Built-in swaps (Base, Robinhood Chain, and Solana) or Bankr |
| Follow new Base swaps through an always-on hosted monitor | HivemindOS copy-trading service + Bankr execution wallet |
| Monitor and model a Base Uniswap v3 LP range | Concentrated Liquidity shadow manager |
| Send USDC or USDG to someone | Your wallet |
| Send privately | Veil (shielded transfer) |
| Pay a pay-per-use API | x402 |
| Research token, wallet, DeFi positions, Smart Money holdings, token-holder, token-screener, Hyperliquid, related-wallet, and CEX-health context | Nansen |
| Run a reviewed quant research request and inspect its local report and manifest | Quant Research Swarm (research-only; no order path) |
| Bridge / move across chains | Bankr |
| Trade Hyperliquid spot or perps with your wallet | Local Hyperliquid |
| Carry crypto practice targets between venues | Shared practice book + Hyperliquid replay |
| Trade perps through a provider | Bankr → Hyperliquid |
| Research live prediction-market odds, paper fills, trader samples, and weather buckets | Native Prediction desk |
| Prepare a live prediction-market order | Governed Bankr → Polymarket capability rail |
| Buy or sell NFTs | Bankr |
| Launch your own token | Bankr |
| Set up recurring/limit orders | Bankr automations |
| Buy & sell stocks | Alpaca (paper or live), Robinhood Agentic Trading MCP, tokenized xStocks, or Robinhood Chain Stock Tokens |
| Trade and manage fully collateralized stock options | Plume on Robinhood Chain testnet (TSLA and AMD covered calls and cash-secured puts) |

## Two kinds of wallet

- **Your own (personal) wallet** — you trade with it directly, and it **never
  auto-spends**: every action asks for your confirmation first. In the Trade tab a
  personal wallet does swaps and receiving; sending is handled in the Wallets screen.
- **An agent's wallet** — set up with spending limits and budgets so an agent can act
  within the rules you give it. This is what unlocks the full set (perps, prediction
  markets, automations, and so on).

## How a trade works

The execution-mode control stays visible in the Trade header:

- **Research-only** lets you build a thesis and review a plan. It never simulates an
  order or sends one to a venue.
- **Paper** is the beginner default. Approved plans fill inside HivemindOS's separate
  virtual portfolio, starting with virtual cash. No wallet or brokerage order is sent.
- **Live** can reach a governed execution rail, but only after the plan passes the
  live risk policy and you explicitly approve it. Live checks fail closed when quote
  age, slippage, account policy, or portfolio exposure is required but unknown.

Every built-in crypto-swap or stock-ticket order follows the same **Trade Plans**
lifecycle:

1. **Stage** — choose the asset and amount. Market orders are the simple default;
   optional stock limit, stop, stop-limit, and time-in-force fields stay under
   **Advanced order**.
2. **Review** — the plan persists on the server and shows mode, account, venue,
   before/after exposure, quote age, estimated fees, slippage, evidence, missing
   context, and every risk check.
3. **Approve or reject** — research approval records the decision only; paper approval
   creates a virtual fill; live approval unlocks that exact reviewed request for the
   governed ticket. Changing the asset, side, type, or amount requires a fresh plan.
4. **Audit and reconcile** — submission, fill, failure, snapshot, and reconciliation
   events remain visible under **Activity**. Approval by itself never moves funds.

Other specialist surfaces such as Hyperliquid, Plume options, prediction research,
and liquidity shadow management retain their existing rail-specific previews and
confirmations. They do not silently inherit authority from a stock or swap Trade Plan.

## The beginner-first workspace

The Trade route is organized into six destinations:

- **Trade** keeps the familiar asset ticket, positions, and recent activity.
- **Research** provides one asset search across crypto and stocks plus durable theses,
  conviction, catalysts, invalidation conditions, and review dates.
- **Portfolio** combines observed account snapshots with the separate paper simulator.
  Historical snapshots preserve market value, available cost basis, unrealized P&L,
  provider, custody, health, and last-sync context.
- **Plans** is the persistent review queue. Leaving the page does not dismiss a plan.
- **Activity** combines execution activity with plan, policy, simulator, snapshot, and
  reconciliation audit events.
- **Automations** keeps mode and snapshot cadence simple. Read-only exchange data,
  Interactive Brokers paper discovery, account overrides, and numeric risk policy are
  collapsed as advanced settings.

Manual reconciliation compares a provider observation with HivemindOS's tracked
quantity and records the difference without editing the provider account. The initial
exchange and Interactive Brokers connector packs are deliberately read-only/paper-only:
they provide health, public market data, or portfolio discovery, but cannot submit
orders.

For Plume options, the preview also shows the pinned market contract, collateral or
premium amount, testnet network, and an action-specific confirmation. Writing a call
locks one stock token per option. Writing a put locks the strike value in testnet
USDG. The app can approve the exact required testnet token amount, then simulates the
option call before the local wallet signs it. The same screen manages offer
cancellation, buy-to-close, American exercise, oracle-bound expiry settlement,
holder redemption, and writer collateral reclaim.

## Good to know

- Crypto actions that run through **Bankr** use Bankr's own trading wallet, not the
  wallet you selected — the app tells you when that's the case.
- **Local Hyperliquid** uses the selected wallet's own Hyperliquid account. Official
  HivemindOS builds ask for builder-fee approval once, then attach the builder code
  automatically to eligible orders.
- **Shared crypto practice** is local target state, not shared custody. It can capture
  Alpaca paper crypto positions and prepare a Hyperliquid replay plan, but the actual
  Hyperliquid orders still spend from the selected wallet after confirmation.
- **Prediction practice** is read-only plus paper execution. The native desk never
  signs or submits a CLOB order. Any live order stays in the existing governed
  provider rail and remains subject to venue eligibility.
- **Concentrated Liquidity is shadow-only.** It reads a Base Uniswap v3 position NFT
  and can keep a virtual range centered as the market moves, but it cannot approve
  tokens, remove liquidity, mint a replacement position, or submit a transaction.
- Ordinary wallet sends carry no HivemindOS platform fee. Current hosted-policy rates
  are 0.20% for DEX swaps, 0.10% for supported live stock/tokenized-stock execution,
  and 0.50% for ordinary paid x402 or private-payment execution, with a $0.01 minimum
  and $10 maximum where a fee applies. The fee is shown before confirmation and uses a
  separate USDC or USDG transaction. Live brokerage orders pre-authorize that transfer
  before submission and settle it only after broker acceptance; rejected orders and
  paper trades do not collect it.
- **Stock trading** defaults to a free **paper** (practice) account so you can try it
  with no real money; live trading is something you opt into.
- **Plume execution is testnet-only.** It uses faucet-issued test assets, requires a
  local EVM signer and an acknowledgement that you are outside Plume's restricted
  jurisdictions (United States, Canada, United Kingdom, and Switzerland), and adds
  no HivemindOS platform fee. Mainnet does not reuse the testnet addresses and stays
  fail-closed until Plume publishes the canonical mainnet registry and completed
  independent audit for review.
- One thing that doesn't fully work today: a **standalone "bridge X to another chain"**
  through Bankr is broken on Bankr's side. Bridging still happens automatically when
  it's part of something bigger (like funding a Hyperliquid trade). See
  [Crypto](crypto.html) for the workaround.

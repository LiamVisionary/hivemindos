---
title: "Trading"
---

# Trading

HivemindOS gives you and your agents one place to **move money and trade** — crypto
and stocks — through wallets you control, with limits and confirmations on every action.

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
    <h3>Stocks</h3>
    <p>Buy and sell through Alpaca paper/live brokerage or a dedicated Robinhood Agentic account, or trade tokenized stocks on Solana and Robinhood Chain. Includes governed previews and portfolio context.</p>
    <a href="stocks.html">Trade stocks</a>
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
| Send USDC or USDG to someone | Your wallet |
| Send privately | Veil (shielded transfer) |
| Pay a pay-per-use API | x402 |
| Research token, wallet, DeFi positions, Smart Money holdings, token-holder, token-screener, Hyperliquid, related-wallet, and CEX-health context | Nansen |
| Bridge / move across chains | Bankr |
| Trade Hyperliquid spot or perps with your wallet | Local Hyperliquid |
| Carry crypto practice targets between venues | Shared practice book + Hyperliquid replay |
| Trade perps through a provider | Bankr → Hyperliquid |
| Bet on prediction markets | Bankr → Polymarket |
| Buy or sell NFTs | Bankr |
| Launch your own token | Bankr |
| Set up recurring/limit orders | Bankr automations |
| Buy & sell stocks | Alpaca (paper or live), Robinhood Agentic Trading MCP, tokenized xStocks, or Robinhood Chain Stock Tokens |

## Two kinds of wallet

- **Your own (personal) wallet** — you trade with it directly, and it **never
  auto-spends**: every action asks for your confirmation first. In the Trade tab a
  personal wallet does swaps and receiving; sending is handled in the Wallets screen.
- **An agent's wallet** — set up with spending limits and budgets so an agent can act
  within the rules you give it. This is what unlocks the full set (perps, prediction
  markets, automations, and so on).

## How a trade works

1. **Pick what you want** — choose an action (or just describe it to an agent).
2. **See the preview** — before anything runs, you get a plain-English summary: what,
   how much, to where, on which network, and any warnings.
3. **Confirm** — only then does it execute, and only if it's within your wallet's
   limits.

## Good to know

- Crypto actions that run through **Bankr** use Bankr's own trading wallet, not the
  wallet you selected — the app tells you when that's the case.
- **Local Hyperliquid** uses the selected wallet's own Hyperliquid account. Official
  HivemindOS builds ask for builder-fee approval once, then attach the builder code
  automatically to eligible orders.
- **Shared crypto practice** is local target state, not shared custody. It can capture
  Alpaca paper crypto positions and prepare a Hyperliquid replay plan, but the actual
  Hyperliquid orders still spend from the selected wallet after confirmation.
- Ordinary wallet sends carry no HivemindOS platform fee. Current hosted-policy rates
  are 0.20% for DEX swaps, 0.10% for supported live stock/tokenized-stock execution,
  and 0.50% for ordinary paid x402 or private-payment execution, with a $0.01 minimum
  and $10 maximum where a fee applies. The fee is shown before confirmation and uses a
  separate USDC or USDG transaction. Live brokerage orders pre-authorize that transfer
  before submission and settle it only after broker acceptance; rejected orders and
  paper trades do not collect it.
- **Stock trading** defaults to a free **paper** (practice) account so you can try it
  with no real money; live trading is something you opt into.
- One thing that doesn't fully work today: a **standalone "bridge X to another chain"**
  through Bankr is broken on Bankr's side. Bridging still happens automatically when
  it's part of something bigger (like funding a Hyperliquid trade). See
  [Crypto](crypto.html) for the workaround.

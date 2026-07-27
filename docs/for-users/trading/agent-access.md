---
title: "Ways to Trade"
---

# Ways to Trade

There are three ways to do any of this — and they all follow the same rules, with the
same preview-and-confirm step. Use whichever fits the moment.

## 1. The Trade tab

The simplest way: open the **Trade** tab in the dashboard.

- Switch between **Crypto** and **Stocks** at the top.
- Pick which wallet you're acting as — your own, an agent's, or the Bankr trading
  wallet.
- Choose an action, review the preview, and confirm.

A **personal wallet** shows a focused set (swaps and receiving; sending is in the
Wallets screen), because personal wallets are deliberately kept to manual, confirm-each
actions. An **agent wallet** shows the full menu.

## 2. Just ask an agent in chat

Talk to an agent in plain English and it sets up the trade for you:

- *"swap $50 USDC to ETH"*
- *"send 1 USDC to 0x7F31…"*
- *"send 1 USDG from my Robinhood wallet to 0x7F31…"*
- *"quote a $25 ETH long on Hyperliquid"*
- *"buy $25 of HYPE spot on Hyperliquid"*
- *"cancel my open BTC order on Hyperliquid"*
- *"close my SOL short reduce-only"*
- *"move $10 from spot to perps on Hyperliquid"*
- *"withdraw $10 USDC from Hyperliquid"*
- *"buy $25 of AAPL"* / *"sell my AAPL"*

The agent shows you exactly what it's about to do — the amount, the destination, the
network — and waits for you to confirm before it runs. You can also tell an agent to act
on **your own** wallet ("send X from my wallet"); it works, but it will always ask you
to confirm first and never moves money on its own.

## 3. From your coding tools

If you use agents in tools like **Claude Code, Codex, Gemini, OpenClaw, Hermes, or
Aeon**, HivemindOS gives those agents the same trading abilities — sending stablecoins,
swapping, quoting and placing Hyperliquid spot/perp orders, managing Hyperliquid
orders, transfers, withdrawals, margin, and leverage, and buying/selling stocks — through
your connected wallets. They run under the exact same limits and confirmations, so an
agent in your terminal can't do anything your dashboard agent couldn't.

## Always the same promise

No matter which way you trade:

- You see a clear preview before anything happens.
- You confirm explicitly — for bigger amounts, that can include an approval step.
- Hyperliquid builder-fee approval, order confirmation, cancel confirmation, account changes, transfers, withdrawals, and TWAPs each use their own confirmation step.
- Official HivemindOS Hyperliquid orders attach the builder code automatically after approval; you do not need to paste a code into chat.
- Everything stays within the spending limits set on the wallet.

More on those protections in [Safety & Limits](governance.html).

---
title: "Safety & Limits"
---

# Safety & Limits

Every trade and transfer goes through the same set of checks before it can run. You set
the rules once on a wallet, and they're enforced on every action — whether you do it
yourself or an agent does it for you.

## The checks, before anything moves

1. **Freeze switch** — if you've frozen a company, all of its agents' actions stop
   immediately, in every direction. This is your big red button.
2. **Per-action limits** — caps on how much a single action (or a single trade) can be.
   Anything over the cap is refused.
3. **Daily & monthly limits** — rolling totals across everything a wallet spends, so
   activity can't snowball past what you allow.
4. **Approval for bigger amounts** — anything above your "needs approval" threshold
   pauses and waits for a yes before it goes through.

Money coming **in** (a sale) and **practice** (paper) trades don't count against your
spending limits — but the freeze switch still stops them if a company is frozen.

## You always confirm

Before a real action runs, you get a plain-English review — what it is, how much, to
where, on which network, and any warnings — and you confirm it. In the Trade tab that's
the **Review → Confirm** step; in chat, the agent shows you the details and you reply to
confirm. Nothing executes silently.

## Personal wallets never auto-spend

Your own (personal) wallet is held to the strictest rule: it **never** spends on its
own. Every send, swap, or payment from it needs your explicit confirmation, every time —
even if you asked an agent to do it. Hands-off automation is reserved for agent wallets
you've deliberately set up with limits.

## Extra Hyperliquid protections

Hyperliquid perps add market risk, so HivemindOS adds a few visible checkpoints:

- You get a quote before placing a local Hyperliquid order.
- Builder-fee approval is separate from order confirmation.
- The official HivemindOS builder fee is shown before the trade.
- Reduce-only trades are available for closing or shrinking a position.
- Max trade limits apply before a new position can open or grow.
- The freeze switch still stops agents from trading.

HivemindOS can enforce the wallet rules, but it cannot prevent normal perp risks like
liquidation, funding payments, slippage, or fast market moves. Keep position size inside
what you are willing to actively manage.

## Agents within their limits

An agent wallet you've configured with spending turned on **can** act without pinging
you for every little thing — as long as it stays inside the rules you gave it (spending
on, the right network and amount, within caps and budgets). The moment something is
bigger than allowed, off-policy, or unusual, it stops and asks.

## Everything is logged

Each completed action is recorded in **Wallets · Activity** — what it was, how much,
and where it went — so you always have a clear history of what happened.

---

Set these limits per wallet in the **Wallets** screen. For what each action does, see
[Crypto](crypto.html) and [Stocks](stocks.html).

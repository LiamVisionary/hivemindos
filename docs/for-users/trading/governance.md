---
title: "Safety & Limits"
---

# Safety & Limits

Every trade and transfer goes through the same set of checks before it can run. You set
the rules once on a wallet, and they're enforced on every action — whether you do it
yourself or an agent does it for you.

## The checks, before anything moves

1. **Company-task freeze switch** — if you've frozen a company, actions performed for
   its active Work Board tasks stop immediately. The same agent's personal, product,
   and unrelated work is not treated as company work.
2. **Per-action limits** — caps on how much a single action (or a single trade) can be.
   Anything over the cap is refused.
3. **Daily & monthly limits** — rolling totals across everything a wallet spends, so
   activity can't snowball past what you allow.
4. **Approval for bigger amounts** — anything above your "needs approval" threshold
   pauses and waits for a yes before it goes through.

Money coming **in** (a sale) and **practice** (paper) trades don't count against your
spending limits. A company freeze also stops them when they belong to an active company task.

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

Hyperliquid spot/perp trading and account actions can change real exchange state, so
HivemindOS adds a few visible checkpoints:

- You get a quote before placing a local Hyperliquid order.
- Builder-fee approval, order confirmation, cancel confirmation, account changes,
  transfers, withdrawals, and TWAPs each use their own confirmation step.
- The official HivemindOS builder fee is shown before the trade.
- After builder-fee approval, official HivemindOS orders attach the builder code
  automatically when a fill is eligible.
- Reduce-only trades are available for closing or shrinking a position.
- Max trade and max payment limits apply before a new position can open, grow, or move
  funds.
- A company freeze stops trades attached to an active company Work Board task; company membership alone does not stop unrelated trades.

HivemindOS can enforce the wallet rules, but it cannot prevent normal market risks like
liquidation, funding payments, slippage, or fast price moves. Keep position size inside
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

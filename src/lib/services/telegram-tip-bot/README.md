# Telegram $HIVE Tip Bot

Custodial group tipping for $HIVE on Base. Tips move instantly inside a local
ledger (`~/.hivemindos/telegram-tip-bot.json`); only deposits and withdrawals
touch the chain. Runs inside the HivemindOS Next server — no extra process, no
new dependencies (raw Telegram Bot API over fetch, viem for Base).

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`), copy the token.
2. In @BotFather, run `/setprivacy` → **Disable** for the bot so `/tip` replies
   work in groups (with privacy on, the bot still sees commands but reply
   targets can be missing).
3. Add to the shared hive env (`~/.hivemindos/.env`) — names only, never commit values:
   - `TELEGRAM_TIP_BOT_TOKEN` (falls back to `TELEGRAM_BOT_TOKEN`)
   - `TELEGRAM_TIP_BOT_ADMIN_IDS` — comma-separated numeric Telegram user ids
4. Start it: `POST /api/telegram-tip-bot` with `{"action":"start"}`.
   `GET /api/telegram-tip-bot` reports runner status, liabilities vs treasury, and queues.
5. Add the bot to your group and fund the treasury (see custody modes).

## Commands

| Command | Where | What |
|---|---|---|
| `/tip 10` (as a reply) or `/tip 10 @name` | group/DM | instant ledger tip; unknown `@name` gets a claim link |
| `/balance` | anywhere | balance + pending claim count |
| `/linkwallet 0x…` | anywhere | register the wallet you deposit from (required; max 5) |
| `/deposit` | anywhere | treasury address + rules |
| `/withdraw 25 0x…` | DM only | queued on-chain send, DM'd tx link |
| `/leaderboard [week]` | group | top tippers/receivers in that chat |
| `/pause` `/resume` `/approve <id>` `/reject <id>` `/botstats` | admin | controls + solvency check |

## Custody modes (withdrawals)

- **`treasury` (default):** a dedicated wallet generated into the encrypted
  local vault (`wallet-vault.json`, agent id `telegram-tip-bot:treasury`).
  Needs a small ETH float on Base for gas.
- **`bankr` (gasless):** set `TELEGRAM_TIP_BOT_WITHDRAWAL_PROVIDER=bankr` with
  `BANKR_API_KEY` set (Wallet API enabled, not read-only). The Bankr wallet
  becomes the treasury — deposits go to it, withdrawals go out via
  `POST /wallet/transfer`, gas-sponsored on Base. Recommended hardening: put a
  recipient allowlist off, but set daily/per-tx USD limits on the key.

Tips themselves are always off-chain, so they're "gasless" in both modes. A
fully non-custodial flow (each tipper signs every tip) is intentionally not
implemented — the claim-link + linked-wallet model is the standard middle
ground. If you outgrow custodial, the ledger gives you exact per-user balances
to migrate from.

## How money moves

- **Deposits:** send HIVE on Base from a **linked** wallet to the treasury.
  The indexer scans `Transfer` logs up to the **finalized** block (no reorg
  credit) and credits idempotently on `txHash:logIndex`. Transfers from
  unlinked wallets are not credited automatically (they show up as treasury
  surplus in `/botstats`).
- **Tips:** atomic ledger debit/credit, raw bigint strings, never floats.
- **Claim links:** tipping an unknown `@name` escrows the amount and posts a
  `t.me/<bot>?start=claim_…` button. Unclaimed tips auto-refund after
  `TELEGRAM_TIP_BOT_CLAIM_TTL_HOURS` (default 168 = 7 days).
- **Withdrawals:** debit immediately, queue, send with 3 retries, refund on
  final failure or admin rejection.

## Guardrails

- `TELEGRAM_TIP_BOT_MAX_WITHDRAWAL` — hard cap per request (human units, e.g. `5000`).
- `TELEGRAM_TIP_BOT_REVIEW_THRESHOLD` — withdrawals at/above this wait for
  admin `/approve` and DM all admins.
- `/pause` freezes tips and withdrawals; deposits still credit.
- `/botstats` compares treasury HIVE against total liabilities (balances +
  open escrow + queued withdrawals) and flags shortfall.
- Identity anchors on Telegram **numeric user id**; usernames are only an
  index and follow renames.
- You are holding user funds: keep the hot treasury thin (sweep excess to a
  cold wallet) and remember custodial tipping can carry compliance exposure.

## Tests

```
node --test scripts/test-telegram-tip-bot.mjs
```

Covers tip atomicity, claim lifecycle/expiry, deposit idempotency, withdrawal
review/refund flows, leaderboard windows, and the liabilities invariant.

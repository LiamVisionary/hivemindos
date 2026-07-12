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
| `/leaderboard [week]` | group | rich-table top tippers/receivers in that chat |
| `/bounty create <title> \| reward <amount> \| due <date optional>` | group/DM | lock a creator reward into a community bounty |
| `/bounties` | group/DM | rich-table active bounty board |
| `/bounty <id>` | group/DM | bounty detail, pot, submissions, and status |
| `/boost <id> <amount>` | group/DM | debit your internal balance and lock it into the bounty escrow |
| `/submit <id> <url or note>` | group/DM | submit work for admin review |
| `/accept <id> @user` `/refund <id> [dispute]` | admin | pay a winner, refund escrow, or mark a dispute |
| `/pause` `/resume` `/approve <id>` `/reject <id>` `/botstats` `/bountystats` | admin | controls + solvency/checks |

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
  The indexer scans `Transfer` logs up to head minus
  `TELEGRAM_TIP_BOT_CONFIRMATIONS` blocks (default 15 ≈ 30s on Base — full
  finality lags 15-25 min, which is unusable deposit UX; raise the knob if
  you ever take deposits big enough to care about deep reorgs) and credits
  idempotently on `txHash:logIndex`. Transfers from unlinked wallets are not
  credited automatically (they show up as treasury surplus in `/botstats`).
- **Tips:** atomic ledger debit/credit, raw bigint strings, never floats.
- **Claim links:** tipping an unknown `@name` escrows the amount and posts a
  `t.me/<bot>?start=claim_…` button. Unclaimed tips auto-refund after
  `TELEGRAM_TIP_BOT_CLAIM_TTL_HOURS` (default 168 = 7 days).
- **Bounties:** `/bounty create` debits the creator reward into the local
  ledger escrow. `/boost` debits boosters into the same escrow. `/accept`
  credits the full pot to the selected winner's internal balance; withdrawals
  still use the normal Base/Bankr rails. `/refund` returns the creator reward
  and each active boost exactly by ledger entry. Due-date expiry uses the same
  refund path.
- **Withdrawals:** debit immediately, queue, send with 3 retries, refund on
  final failure or admin rejection.

## Community bounties and alpha rooms

Bounties are v0 off-chain escrow, not on-chain smart-contract escrow. The
treasury must remain solvent for all user balances, open claims, queued
withdrawals, and active bounty pots; `/botstats` includes bounty escrow in
liabilities. Admins are responsible for acceptance, refunds, and disputes at
launch. Marking a bounty disputed keeps escrow locked until an admin resolves
it by policy.

Use $HIVE-only access for community/alignment surfaces: governance signaling,
holder identity/status badges, curator eligibility, bounty boosting, and
early-access alpha rooms. Alpha rooms are early access and community status
channels, including zero-human company monetization workflows; they are not
permanent product lockouts. Paid product features should still have non-crypto
paths such as card, fiat subscriptions, Hivemind Cloud credits, or fiat-backed
plans.

## Telegram member tags

When the bot is an admin with Telegram's member-tag permission, it keeps one
visible tag per regular member in group/supergroup chats it has seen. Tags are
presentation only; access checks must still read the staking contract or bot
ledger directly.

Resolution order:

- Stable default: highest HIVE staking tier from the member's linked wallets,
  rendered as `Hive Builder`, `Hive Curator`, `Hive Visionary`, etc.
- Recent leaderboard overlay: top Honey collectors receive `Honey #1` through
  the configured top limit.
- Recent bounty overlay: top bounty earners receive `Bounty #1` through the
  configured top limit.
- If a staking tier and leaderboard rank both apply, the tag is compacted to
  forms such as `Builder H#1` or `Curator B#1` to stay under Telegram's
  16-character limit.

Defaults: member tags are enabled, top 5 users are tagged, leaderboard windows
use the last 7 days, and the sync loop runs every 30 minutes. Optional shared
env knobs:

- `TELEGRAM_TIP_BOT_MEMBER_TAGS=false` disables tag sync.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_CHAT_IDS=-100...` adds explicit target chats.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_TOKEN` can point tag writes at a separate
  admin bot token. If unset, the runner can fall back to
  `HIVEMINDOS_TELEGRAM_MEMBER_TAG_BOT_TOKEN` or
  `SWARM_SOVEREIGN_TELEGRAM_BOT_TOKEN` when the primary tip bot lacks tag
  rights in a chat.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_TOP_LIMIT=5` changes the leaderboard cutoff.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_WINDOW_DAYS=7` changes the recent-rank window.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_SYNC_INTERVAL_MINUTES=30` changes cadence.
- `TELEGRAM_TIP_BOT_MEMBER_TAG_MAX_ACTIONS_PER_CYCLE=100` caps API writes.

`/leaderboard`, `/bounties`, and `/bountystats` render Claw-light themed PNG
cards first so Telegram can show the warm cream/terracotta palette exactly. If
image rendering or upload fails, the bot falls back to Telegram Bot API 10.1
`sendRichMessage` tables (`<table bordered striped>`), then simple HTML
`sendMessage` output.

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
review/refund flows, leaderboard windows, bounty lifecycle/refunds, rich-table
escaping, and the liabilities invariant.

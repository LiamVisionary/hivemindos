# HivemindOS Honey Ledger Worker

Cloudflare Worker + D1 ledger for official signed Honey usage receipts.

The Worker stores only privacy-safe metadata:

- anonymous workspace id
- agent id
- token count
- runtime/model label
- event id
- timestamp
- HMAC signature from a trusted HivemindOS runtime

It never receives prompts, responses, vault paths, local file paths, machine names, Tailnet IPs, or wallet secrets.

## Reward Pool Math

Bankr Doppler launches use a 1.2% swap fee. The creator receives 57% of that fee. HivemindOS allocates 5% of the creator share to the official Honey/HIVE reward pool:

```text
0.012 * 0.57 * 0.05 = 0.000342
```

That means the reward pool receives at most 0.0342% of trading volume value. Example: $48,150,000 of volume creates a $16,467.30 reward-pool budget. If HIVE is worth $0.01, that is 1,646,730 HIVE in the cumulative pool.

The ledger tracks the pool in micro-HIVE. Usage receipts mint Honey as a HIVE-denominated entitlement, but each receipt is clipped by the remaining pool. Therefore cumulative Honey emitted and HIVE exchanged cannot exceed the cumulative reward pool recorded in Cloudflare D1.

`POST /return-to-honey` reverses older ledger-only HIVE conversions back into available Honey so the dashboard can retire the confusing intermediate balance before real Bankr settlement.

## Free-tier setup

```bash
cd workers/honey-ledger
pnpm install
pnpm d1:create
```

Copy the returned `database_id` into `wrangler.toml`, then run:

```bash
pnpm d1:migrate:remote
pnpm wrangler secret put HONEY_LEDGER_SECRET
pnpm wrangler secret put HONEY_LEDGER_ADMIN_TOKEN
pnpm wrangler secret put HONEY_REWARD_BANKR_API_KEY
pnpm deploy
```

Existing deployments need the reward-pool migration once:

```bash
pnpm d1:migrate:reward-pool:remote
```

For local testing:

```bash
pnpm d1:migrate:local
pnpm dev
```

## App environment

The official ledger URL is safe for open-source clones to read:

```bash
HONEY_LEDGER_REMOTE_URL="https://hivemindos-honey-ledger.hivemindos.workers.dev"
HONEY_LEDGER_ISSUER_ID="hivemindos"
```

Normal open-source clones do not receive these secrets. They can opt in to the official ledger UI, but official Honey requires usage receipts signed by a trusted HivemindOS runtime/server.

Trusted official HivemindOS servers/runtimes may set a signer secret:

```bash
HONEY_LEDGER_SIGNING_SECRET="<same value as HONEY_LEDGER_SECRET>"
```

Never commit private values. Editing frontend Honey values does not affect conversion, because `/exchange` converts only the Honey balance stored in the official Cloudflare D1 ledger.

Only the operator uses `HONEY_LEDGER_ADMIN_TOKEN`, and only to add reward-pool funding events. Clone users do not need it.

Only the official worker should hold `HONEY_REWARD_BANKR_API_KEY`. It must be a funded Bankr treasury API key with Wallet API write access. Open-source clones claim Honey by sending their recipient Bankr wallet address to the official worker; they never receive or store the treasury key.

Forks that point `HONEY_LEDGER_REMOTE_URL` at a different backend are using a different economy. Their Honey is not official HivemindOS Honey unless it is stored in the official ledger.

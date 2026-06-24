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

## Managed HONEY Credits

Managed-agent credits use the same HONEY display unit, but they are a separate spend-only bucket on `agent_balances`:

- `available_honey_micro` is reward Honey and can be claimed to HIVE.
- `managed_honey_balance_micro` is service credit for HivemindOS-managed agents and cannot be claimed.

`POST /managed-billing/events` records managed credit and debit events. The endpoint is idempotent by `event_id` and optional `(workspace_id, idempotency_key)`, requires either `HONEY_BILLING_SECRET`/`HONEY_LEDGER_SECRET` HMAC or the admin bearer token, and refuses debits when the D1 balance is insufficient.

Funding rails such as Stripe, x402, Bankr, agent wallets, or HIVE should credit managed Honey only after their settlement proof is verified server-side. Browser requests must never be allowed to mint official managed Honey directly.

## Authentication & trust boundary

The official ledger is for the managed HivemindOS app only. It does not trust the
caller for identity — it trusts a server-side HMAC signature made with
`HONEY_LEDGER_SECRET`, which lives only in the official Cloudflare workers (the
compute gateway and this ledger) and is never shipped in the downloadable app.

Every state-mutating route is gated:

- `POST /receipts` — Honey minting. Requires a valid `HONEY_LEDGER_SECRET` HMAC
  signature. Produced server-side by the compute gateway after it proxies the real,
  Bankr-paid LLM call and reads the provider-returned token usage. Fails closed.
- `POST /observations` — also requires a valid signature; the previous unauthenticated
  form was a free-mint faucet and is closed. Minting now flows through `/receipts`.
- `POST /exchange`, `POST /return-to-honey`, `POST /claim-bankr-hive` — require a
  signed command. The signature binds `action`, `workspaceId`, `agentId`,
  `recipientAddress` and a single-use `eventId` nonce over an HMAC of
  `HONEY_LEDGER_SECRET`, with a 5-minute timestamp window. The nonce (table
  `command_nonces`) makes the irreversible Bankr transfer replay-proof. The app
  reaches these through the compute gateway's authenticated `/honey/*` endpoints; it
  never holds the secret or calls the ledger mutation routes directly.
- `POST /pool-events` — requires `HONEY_LEDGER_ADMIN_TOKEN` (operator only).
- `POST /managed-billing/events` — requires a billing HMAC signature or the admin token.

Bearer checks fail **closed**: if a route's expected secret is not configured on the
deployed worker, the route is denied (503), never opened. `GET /ledger` is a read
scoped to a caller-supplied `workspaceId` (a high-entropy local install secret); the
read token, when set, is an additional optional gate.

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
pnpm wrangler secret put HONEY_BILLING_SECRET
pnpm wrangler secret put HONEY_LEDGER_ADMIN_TOKEN
pnpm wrangler secret put HONEY_REWARD_BANKR_API_KEY
pnpm deploy
```

Existing deployments need the reward-pool migration once:

```bash
pnpm d1:migrate:reward-pool:remote
pnpm d1:migrate:managed-billing:remote
pnpm d1:migrate:command-nonces:remote
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

Managed billing signers may use a separate secret:

```bash
HONEY_BILLING_SIGNING_SECRET="<same value as HONEY_BILLING_SECRET>"
```

Never commit private values. Editing frontend Honey values does not affect conversion, because `/exchange` converts only the Honey balance stored in the official Cloudflare D1 ledger.

Only the operator uses `HONEY_LEDGER_ADMIN_TOKEN`, and only to add reward-pool funding events. Clone users do not need it.

Only the official worker should hold `HONEY_REWARD_BANKR_API_KEY`. It must be a funded Bankr treasury API key with Wallet API write access. The managed app claims Honey through the compute gateway, which authenticates the workspace by its Bankr LLM key, signs a claim command bound to the recipient address, and forwards it to this ledger; the app never receives or stores the treasury key or the signing secret.

Forks that want their own Honey economy run their own copy of this worker with their own `HONEY_LEDGER_SECRET`. They cannot mint, exchange, or claim against the official ledger — it accepts only commands signed by the official gateway's secret.

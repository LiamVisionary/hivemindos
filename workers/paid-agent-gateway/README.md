# HivemindOS Paid Agent Gateway Worker

Cloudflare Worker resource server for official HivemindOS x402 paid-agent calls.

Downloaded desktop apps should call this Worker through their local `/api/official-paid-agents/<slug>/chat/completions` proxy. The Worker owns the official payment requirements, verifies and settles x402, then forwards the already-paid request to a trusted upstream OpenAI-compatible chat-completions endpoint.

This keeps official commercial authority out of the downloadable app:

- official `payTo` lives in Worker secrets or dashboard vars
- facilitator credentials live in Worker secrets
- optional Base Builder Code attribution lives in Worker vars
- official Hyperliquid builder-code policy lives in Worker vars
- upstream provider/runtime credentials live in Worker secrets
- D1 stores official receipt metadata and idempotency keys
- the local app only knows the public Worker URL

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Worker health, configured agents, and missing key names |
| `GET /api/platform-fees/config` | Public official platform-fee policy for local wallet rails |
| `GET /api/hyperliquid/builder-policy` | Public official Hyperliquid builder-code policy |
| `GET /api/paid-agents/<slug>/chat/completions` | Non-secret paid-agent readiness |
| `POST /api/paid-agents/<slug>/chat/completions` | x402-protected OpenAI-compatible chat completion |

## Deploy

```bash
cd workers/paid-agent-gateway
pnpm install
pnpm d1:create
```

Copy the returned `database_id` into `wrangler.jsonc`, then run:

```bash
pnpm d1:migrate:remote
pnpm wrangler secret put HIVEMINDOS_PAID_AGENT_PAY_TO
pnpm wrangler secret put HIVEMINDOS_PAID_AGENT_UPSTREAM_URL
pnpm wrangler secret put HIVEMINDOS_PAID_AGENT_UPSTREAM_BEARER
pnpm deploy
```

The default Worker configuration is production-oriented: Base mainnet with the CDP facilitator. It fails closed until `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are installed as Worker secrets.

For testnet development, opt in explicitly:

```txt
HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true
```

When testnet mode is true and no explicit network/facilitator overrides are set, the Worker uses:

```txt
HIVEMINDOS_PAID_AGENT_NETWORK=eip155:84532
HIVEMINDOS_PAID_AGENT_FACILITATOR_URL=https://x402.org/facilitator
```

Production Base mainnet defaults are:

```txt
HIVEMINDOS_PAID_AGENT_NETWORK=eip155:8453
HIVEMINDOS_PAID_AGENT_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
HIVEMINDOS_PAID_AGENT_BUILDER_CODE=<base-builder-code>
```

`https://x402.org/facilitator` is testnet-only. Use the Coinbase CDP facilitator, or another production facilitator that supports Base mainnet, before switching `HIVEMINDOS_PAID_AGENT_NETWORK` to `eip155:8453`.

`HIVEMINDOS_PAID_AGENT_BUILDER_CODE` is optional. When set on Base mainnet, the Worker declares the x402 Builder Code extension so settled paid-agent calls can include seller-side onchain attribution. Builder Codes are public attribution identifiers, not secrets.

For the CDP facilitator, add the documented CDP API key pair as Worker secrets. The Worker uses `@coinbase/x402` to generate request-specific JWT auth headers for `/supported`, `/verify`, and `/settle`:

```bash
pnpm wrangler secret put CDP_API_KEY_ID
pnpm wrangler secret put CDP_API_KEY_SECRET
```

For non-CDP facilitators that use a static bearer token, add `HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER` instead.

## Platform Fee Policy

The Worker can also publish public official fee policy for locally signed wallet rails. The downloaded app reads this route by default instead of requiring every device to set fee recipients in local env:

```txt
GET /api/platform-fees/config
```

Configure the policy in Worker env/secrets:

```txt
HIVEMINDOS_PLATFORM_FEES_ENABLED=true
HIVEMINDOS_PLATFORM_FEE_BPS=100
HIVEMINDOS_PLATFORM_MIN_FEE_USD=0.01
HIVEMINDOS_PLATFORM_MAX_FEE_USD=
HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM=<base-or-evm-address>
HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA=<solana-address>
```

The endpoint returns only public data: fee terms, supported local rails, and recipient addresses. Current supported sources are local USDC sends, local DEX swaps, xStocks, live Alpaca fee collection, public x402, Veil private transfers, and Veil private x402. It does not make local wallet actions tamper-proof; strong official enforcement still needs hosted/proxy execution or provider-native fee support.

## Hyperliquid Builder Policy

The Worker publishes the official HivemindOS Hyperliquid builder-code policy for locally signed perp orders:

```txt
GET /api/hyperliquid/builder-policy
```

Configure the public policy in Worker vars/secrets after the official builder wallet has at least 100 USDC in Hyperliquid perps account value:

```txt
HIVEMINDOS_HYPERLIQUID_BUILDER_ENABLED=true
HIVEMINDOS_HYPERLIQUID_BUILDER_ADDRESS=<official-builder-evm-address>
HIVEMINDOS_HYPERLIQUID_BUILDER_FEE_TENTH_BPS=5
HIVEMINDOS_HYPERLIQUID_MAX_BUILDER_FEE_TENTH_BPS=5
HIVEMINDOS_HYPERLIQUID_TESTNET=false
HIVEMINDOS_HYPERLIQUID_API_URL=
```

The endpoint returns only public policy: builder address, fee, maximum approval fee, network, and optional API URL. Downloaded apps use this official endpoint by default. Self-hosted operators who want a different builder should fork/rebuild the app or point their own distribution at their own Worker/API; shared env in the official app is not the normal override path for official builder revenue.

## Upstream Runtime

`HIVEMINDOS_PAID_AGENT_UPSTREAM_URL` should point to a trusted server-side OpenAI-compatible endpoint, such as:

```txt
https://<hosted-hivemindos-runtime>/v1/chat/completions
https://<compute-gateway-worker>/v1/chat/completions
```

The Worker forwards the caller's OpenAI chat body after x402 verification. It does not forward payment headers to the upstream runtime.

## Downloaded App Configuration

Point the app at the Worker:

```txt
HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL=https://hivemindos-paid-agent-gateway.<account>.workers.dev
```

The open-source app currently ships with the official `https://hivemindos-paid-agent-gateway.hivemindos.workers.dev` Worker as its safe default. Use the env variable only when overriding that endpoint.

The app then calls:

```txt
POST /api/official-paid-agents/<slug>/chat/completions
```

That local route proxies x402 payment traffic to this Worker and contains no official `payTo`.

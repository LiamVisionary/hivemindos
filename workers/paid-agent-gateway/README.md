# HivemindOS Paid Agent Gateway Worker

Cloudflare Worker resource server for official HivemindOS x402 paid-agent calls.

Downloaded desktop apps should call this Worker through their local `/api/official-paid-agents/<slug>/chat/completions` proxy. The Worker owns the official payment requirements, verifies and settles x402, then forwards the already-paid request to a trusted upstream OpenAI-compatible chat-completions endpoint.

This keeps official commercial authority out of the downloadable app:

- official `payTo` lives in Worker secrets or dashboard vars
- facilitator credentials live in Worker secrets
- upstream provider/runtime credentials live in Worker secrets
- D1 stores official receipt metadata and idempotency keys
- the local app only knows the public Worker URL

## Routes

| Route | Purpose |
|---|---|
| `GET /health` | Worker health, configured agents, and missing key names |
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

For testnet development, the default config uses:

```txt
HIVEMINDOS_PAID_AGENT_NETWORK=eip155:84532
HIVEMINDOS_PAID_AGENT_FACILITATOR_URL=https://x402.org/facilitator
```

For production Base mainnet, change:

```txt
HIVEMINDOS_PAID_AGENT_NETWORK=eip155:8453
HIVEMINDOS_PAID_AGENT_FACILITATOR_URL=<production-facilitator-url>
```

If the facilitator requires auth, add:

```bash
pnpm wrangler secret put HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER
```

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

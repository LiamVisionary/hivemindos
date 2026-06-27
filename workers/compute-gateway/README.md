# HivemindOS Compute Gateway

Trusted compute path for official Honey rewards.

All official Honey comes from reward compute mode: point Hermes, OpenClaw, or any OpenAI-compatible client at this Worker instead of the model provider. (The ledger no longer accepts unsigned self-reported usage; this gateway is the trusted minter.) The runtime still receives normal OpenAI-compatible responses, while this Worker:

- calls the configured LLM provider server-side through Bankr/OpenRouter-compatible routing
- uses the caller's Bankr LLM key when provided, so their HIVE-funded Bankr credits pay for compute
- observes provider-returned token usage
- caps Honey REWARDS per workspace per day (past the cap the completion is still served — the caller pays Bankr for their own tokens — but no Honey is minted, so the cap never blocks chat)
- binds the workspace to its funding key on first mint (`workspace_owners`) so Honey redemption can be authorized later
- signs the Honey receipt with `HONEY_LEDGER_SECRET`
- submits it to the official Honey ledger

By default the public Worker does not use an operator Bankr key. Set `ALLOW_SHARED_BANKR_KEY=true` only for private/internal deployments.

## Managed no-BYOK compute

When `ALLOW_SHARED_BANKR_KEY=true` and the caller does not provide a Bankr LLM key, the gateway uses the operator's Bankr key as a managed provider rail. In that mode it requires spend-only managed HONEY credits:

1. Check the caller's managed Honey balance in the Honey ledger before calling the provider.
2. Call Bankr LLM server-side with the operator key.
3. Read provider usage from the upstream response.
4. Submit a signed managed Honey debit to `/managed-billing/events`.

Managed Honey debits use `HONEY_BILLING_SECRET` when present, otherwise `HONEY_LEDGER_SECRET`. Pricing is controlled by:

```txt
MANAGED_HONEY_CREDITS_PER_USD=100
MANAGED_AGENT_MARKUP_BPS=5000
MANAGED_AGENT_USD_PER_1K_TOKENS=0.01
```

These managed credits are not reward Honey and cannot be claimed to HIVE.

## Reward compute setup

Use this worker as an OpenAI-compatible base URL:

```txt
OPENAI_BASE_URL=https://hivemindos-compute-gateway.hivemindos.workers.dev/v1
OPENAI_API_KEY=hive-v1.<workspace-id>.<bankr-llm-key>
```

The simple reward key format is:

```txt
hive-v1.<workspace-id>.<bankr-llm-key>
```

For per-agent accounting, use:

```txt
hive-v1.<workspace-id>.<agent-id>.<bankr-llm-key>
```

If a runtime supports custom headers, it may also send:

- `Authorization: Bearer <bankr-llm-key>`
- `X-Hivemind-Workspace-Id: <workspace-id>`
- `X-Hivemind-Agent-Id: <agent-id>`

The worker also supports:

- `POST /v1/chat/completions`
- `GET /v1/models`

Requests are forwarded to Bankr with `stream: false` so usage can be verified before the response is returned. If the client asks for streaming, the worker returns OpenAI-style SSE chunks after the verified upstream response is complete.

## Honey redemption

The app never holds `HONEY_LEDGER_SECRET`, so it cannot call the ledger's signed value-moving routes directly. It calls this gateway, which authenticates the workspace by its Bankr LLM key and signs the command server-side:

- `POST /honey/exchange` — convert available Honey to HIVE balance
- `POST /honey/return` — reverse ledger-only HIVE back to Honey
- `POST /honey/claim` — claim Honey to a Bankr HIVE address (body: `{ recipientAddress, agentId? }`)

Authenticate with the same reward key used for compute (`Authorization: Bearer hive-v1.<workspace-id>.<bankr-llm-key>`). The gateway verifies that `SHA-256(bankr-llm-key)` matches the `workspace_owners` binding recorded when that workspace first earned Honey, then signs the command (binding action, workspace, agent, recipient address, a single-use nonce and timestamp) and forwards it to the ledger. A key that does not own the workspace is rejected (403).

## Deploy

```bash
cd workers/compute-gateway
pnpm install
pnpm d1:create
```

Copy the returned `database_id` into `wrangler.toml`, then:

```bash
pnpm d1:migrate:remote
pnpm wrangler secret put BANKR_LLM_KEY
pnpm wrangler secret put HONEY_LEDGER_SECRET
pnpm wrangler secret put HONEY_BILLING_SECRET
pnpm deploy
```

Existing deployments need the workspace-owners migration once:

```bash
pnpm d1:migrate:workspace-owners:remote
```

`BANKR_MANAGEMENT_KEY` can be used instead of `BANKR_LLM_KEY` if that key has Bankr LLM Gateway access.

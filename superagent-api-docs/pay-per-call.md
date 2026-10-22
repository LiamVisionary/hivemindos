# Pay Per Call With x402

> https://hivemindos.app/superagent-api/docs/pay-per-call · Markdown version: https://hivemindos.app/superagent-api/docs/pay-per-call.md

# Pay per call with x402

An agent with an x402 wallet on Base can use the SuperAgent API without an account or API key. It pays for one call at a time in USDC, and only when the call succeeds. It can also pay once for an account and get an API key holding the credits.

## Make a call

Send the operation's input as the body:

```http
POST https://api.hivemindos.app/v1/x402/svg-studio/svgs.generate
Content-Type: application/json

{ "prompt": "Minimal flat bee logo, black and honey-yellow" }
```

1. The first answer is HTTP 402 with a `Payment-Required` header, priced from your input. If the input is wrong, you get HTTP 400 instead, before any payment is asked for.
2. Show the person the exact amount and get their approval. Then send the same request again with `Payment-Signature`. Any x402 v2 client does this step for you.
3. The call runs. On success the payment settles and you get the result, with an `x402` block holding the receipt id and transaction. On failure you get `x402.charged: false` and the payment is never taken, so you can try the same payment again.

Sending the same signed payment again within 30 minutes returns the same answer. The call does not run twice and you are not charged twice.

## What you can buy

`GET https://api.hivemindos.app/v1/x402` lists every operation for sale, with its price, address, an example input and the input's schema. No key is needed. Today it covers:

| Service | Operations |
|---|---|
| Hive Research | Token research at Scout, Swarm or Superbrain depth |
| Token Autopsy | Standard and panel token reports |
| Wallet Risk | A risk snapshot of a wallet |
| Reddit VOC | Snapshot and deep voice-of-customer reports |
| Swarm | Quick and Theater scenario runs |
| X Studio | Style skills and engagement audits of an X account |
| MiroShark | Crowd simulations |
| Testnet faucet | Testnet gas and test stablecoins |
| Media Studio | Images and video |
| Photo Keyworder | Keywords, title and description for a photo |
| SVG Studio | Vectorize, generate, edit and animate SVGs |
| Lead-gen data | Find local businesses, and enrich them |

A call costs what the same operation costs an account with no HIVE stake. The price comes from the service when you call, so it is never out of date.

## Collect a background result

Research, reports, swarms, simulations and media run in the background. Their answer includes `followUp.apiKey`, an API key that can use only that service and can never move funds. Store it like any secret and use it to read the result:

```http
POST https://api.hivemindos.app/v1/services/token-autopsy/invoke
Authorization: Bearer <followUp.apiKey>
Idempotency-Key: <unique>
Content-Type: application/json

{ "operationId": "reports.get", "pathParameters": { "reportId": "<the id in the first answer>" } }
```

If a call uses less than it was priced at, the difference stays on the same key as Agent Credits.

## Buy an account instead

Sites, agents, workflows, databases, wallets, trading, subscriptions and connected accounts keep running or belong to an account, so they are not sold per call. Buy an account for those:

```http
POST https://api.hivemindos.app/v1/x402/accounts
Content-Type: application/json

{ "amountUsd": 5 }
```

After the same 402 and `Payment-Signature` steps, you get an API key holding that many Agent Credits (500 per dollar, from $1 to $500) for every service. Save it as `HIVEMINDOS_API_KEY`. It can never move funds. Manage the account later in the [console](https://hivemindos.app/superagent-api/console/).

## Private tiers

The same routes work under `https://api.hivemindos.app/v1/private/x402` and `https://api.hivemindos.app/v1/confidential/x402`, where only operations that meet the tier are sold. See [privacy tiers](privacy.html).

## Rules for agents

- A 402 answer is a price, not permission. Ask the person to approve the exact amount before a wallet signs.
- Never send a wallet's private key or recovery phrase to HivemindOS. The payment is a signature the wallet makes itself.
- HivemindOS sets the recipient, network, asset and price on its server. Do not try to change them.

## Find it in the x402 Bazaar

Every route describes its input and output for the Coinbase x402 Bazaar, so agents that search the Bazaar can find it. A route appears there after its first paid call.

## Related

- [Agent setup](agent-setup.html)
- [Connect with MCP](mcp.html)
- [API reference](reference.html)

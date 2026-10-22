# Private And Confidential Access

> https://hivemindos.app/superagent-api/docs/privacy · Markdown version: https://hivemindos.app/superagent-api/docs/privacy.md

# Private and confidential access

The SuperAgent API has three base URLs. They are the same API with the same paths; each offers only what meets its privacy level.

- Fine with any model or service? Use `/v1`.
- What you send must never reach a service that keeps it? Use `/v1/private`.
- Models must also run in hardware that proves what it runs? Use `/v1/confidential`.

| Tier | Base URL | Remote MCP | What it offers |
|---|---|---|---|
| Standard | `https://api.hivemindos.app/v1` | `https://api.hivemindos.app/mcp` | Every model and service. Providers may keep what you send under their own terms. |
| Private | `https://api.hivemindos.app/v1/private` | `https://api.hivemindos.app/v1/private/mcp` | Only models and services that keep nothing you send. |
| Confidential | `https://api.hivemindos.app/v1/confidential` | `https://api.hivemindos.app/v1/confidential/mcp` | Private, and models run in attested hardware that proves what it runs on every request. |

Swap `/v1` for the tier's base in any path: `/v1/private/services/cloud-superbrain/invoke` is the private version of `/v1/services/cloud-superbrain/invoke`.

## What each tier includes

The catalog, capabilities, actions, MCP tools and OpenAPI document under a tier's base list only what that tier includes, so read them from the base you will call:

```http
GET https://api.hivemindos.app/v1/private/catalog
```

Each capability's `privacy` field shows the strictest tier it serves.

| Included in | Examples |
|---|---|
| Every tier | Your account, projects, API keys, usage, files, connections, managed databases, analytics, app hosting, wallets, trading, swaps, bridge quotes, runs, approvals, webhooks, and model lists. Memory writes, reads, keyword search and recall. Chat (`managed-models`) and Memory Answer, with only the models that meet the tier. |
| Private and standard | Semantic Recall and memory index rebuilds, which use HivemindOS's own models, and media generation, which in the private tier offers only the private media models. |
| Standard only | Web search and research, X, email, social publishing, lead data, managed agents, request classification, and plain-language routing and planning. Each sends what you give it to a service that may keep it. |

Memory saved in the standard tier can also leave HivemindOS: recall's `rerank: true` and Memory Answer's Turbo ordering send the question and standard-tier memory text to a third-party model provider (OpenRouter), under its own terms. Memories saved in the private or confidential tier are never sent. See [managed memory](memory.html#search-and-answer).

Hive Compute serves every tier. Under the private and confidential bases it runs only on hosts with fresh verified hardware attestation, whatever the request's own `privacy` setting says.

In the confidential tier:

- **Chat and Memory Answer** use only models that run in an attested enclave, checked on every request. A reply without that check is discarded and not charged.
- **Memory Answer** has no default reader, because the default is private but not attested. Name one from `memory.models` under the confidential base as `model`.
- **Memories** are never sent to an embedding model. Recall finds them by keyword, so Semantic Recall is refused with `409`.
- **Media** models are listed and jobs can be read, but nothing is generated: no media model runs in attested hardware yet.

## Models

Every model in the managed catalog has a `privacy_level`: `standard`, `private` or `confidential`. Under a tier's base, `managed-models` `models.list` returns only models that meet it, and a chat naming any other model is refused before anything is charged.

- `private`: the provider publishes that it keeps no prompts or replies, or HivemindOS runs the model.
- `confidential`: also runs in an enclave whose attestation is checked on every request. The provider names these models with a `:private` suffix.
- `standard`: every other model.

Media generation follows the same rule: under the private base, the media catalog and `/media/models` list only private media models.

Memory Answer lets you choose its reader the same way. See [managed memory](memory.html#choose-who-reads-the-answer).

## Pin a key to a tier

A key created under a tier's base URL is pinned to that tier. You can also set `privacy` when you create a key:

```ts
const privateKey = await hive.apiKeys.create(
  {
    label: "Private memory worker",
    scopes: ["services:read", "services:invoke"],
    allowedServices: ["cloud-superbrain"],
    privacy: "private",
  },
  { idempotencyKey: "private-memory-worker-v1" },
);
```

A pinned key works only in its tier or a stricter one, whatever base URL it calls. Child keys keep the pin and cannot loosen it. Keys report their tier in `privacy`.

You can also send `X-HivemindOS-Privacy: private` or `X-HivemindOS-Privacy: confidential` on any request. The strictest of the base URL, the header and the key's pin applies. Nothing can loosen a tier.

## When something is refused

An operation below the request's tier is refused with `403` before anything runs or is charged:

```json
{
  "ok": false,
  "code": "privacy_tier",
  "privacy": "private",
  "operationPrivacy": "standard",
  "error": "This operation is not available in the private tier: what it is given would reach a service that does not meet it. Use it through /v1, with a key that is not pinned to a tier."
}
```

In the private tiers, name managed operations by `operationId`. A raw service path that is not a published operation cannot be checked, so it is refused.

## What HivemindOS keeps

- A reply from a private model is kept for 15 minutes, so a retry with the same idempotency key, or a recovery lookup, can still collect it after a dropped connection. Then the words are deleted and only the billing record stays. A later retry is told the reply is gone; it never runs the model or charges again.
- What you ask HivemindOS to store is kept as usual: memories, files, database records, and saved run results.
- A memory keeps the strictest tier it was written in. Memory Answer reads it only with a reader that meets that tier.
- A run keeps the tier it was created in. An idempotency key used in one tier cannot be reused in another.

## Related

- [Authentication and API keys](authentication.html)
- [Managed memory](memory.html)
- [Service catalog](services.html)

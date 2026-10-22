# SuperAgent API Reference

> https://hivemindos.app/superagent-api/docs/reference · Markdown version: https://hivemindos.app/superagent-api/docs/reference.md

# SuperAgent API reference

The complete map of scopes, endpoints, headers, and limit selectors. For your first call, start with the [quickstart](./).

The [OpenAPI 3.1 document](https://api.hivemindos.app/openapi.json) is the source of truth for request and response shapes, and can generate clients, validators, and API explorers.

```text
Base URL: https://api.hivemindos.app/v1
MCP URL: https://api.hivemindos.app/mcp
Authentication: Authorization: Bearer hmos_live_...
Content type: application/json
```

Database archive parts and downloads use `application/zip` instead of JSON.

## Public endpoints

| Method | URL | Purpose |
|---|---|---|
| `GET` | `https://api.hivemindos.app/health` | Service and API-version health. |
| `GET` | `https://api.hivemindos.app/openapi.json` | OpenAPI 3.1 contract. |
| `POST` | `https://api.hivemindos.app/mcp` | Authenticated Streamable HTTP MCP transport. Requires `services:read` and `actions.list`. |
| `GET` | `/pricing` | Server-owned price and availability catalog. Optional `service` query: `platform-api`, `managed-wallets`, `managed-trading`, `universal-swaps`, `managed-agents`, or `managed-workflows`. |
| `GET` | `/catalog?q=<words>` | Search every operation by what it does. Each result has its inspect URL and invoke template. |
| `GET` or `POST` | `/inspect/{serviceId}/{operationId}` | One operation's contract, its price before you call it, how to buy it per call, and its health. `POST {"input": {...}}` prices that input. Runs and charges nothing. |
| `GET` | `/feed.xml` | Atom feed of new services and pay-per-call offers. |
| `GET` | `https://api.hivemindos.app/.well-known/api-catalog` | RFC 9727 linkset: the API, its OpenAPI, docs, status and MCP. |
| `GET` | `https://api.hivemindos.app/.well-known/x402` | Every operation sold per call over x402. |

The health and OpenAPI documents are also available under `/v1`. Pricing is public and never accepts client-supplied prices.

### What a call costs before you make it

`price.kind` from `/inspect` is one of:

- `free`: the service charges nothing for it.
- `maximum`: the most it can cost, in `credits` and `usd`, for the example or the input you sent. It may cost less.
- `quote`: the service prices it with a free quote first; `quoteOperation` names it.
- `metered`: the service charges what the work cost after it runs, so nothing can say beforehand.
- `unavailable`: the price could not be read just now.

Send `maxCredits` in an invoke body (or the `X-HivemindOS-Max-Credits` header) to hold a call to a ceiling. It runs only when its price is known up front to fit; otherwise it is refused with HTTP 409 and nothing is charged: `price_above_maximum` (with `priceCredits`) or `price_not_known_up_front`. A key's `creditsPerCall` limit does the same for every call it makes, and the lower of the two decides. See [limits](limits.html#most-one-call-may-cost).

## Scopes

| Scope | Allows |
|---|---|
| `services:read` | List managed services visible to the key. |
| `services:invoke` | Invoke an allowed generic managed service. |
| `credits:read` | Read the account's HivemindOS credit balance. |
| `credits:write` | Buy Agent Credits for the authenticated account through x402. |
| `projects:read` | List and read projects visible to the key. |
| `projects:write` | Create, update, and archive projects. |
| `usage:read` | Read project request and charged-credit summaries. |
| `audit:read` | Read project request audit events. |
| `files:read` | List and download project files. |
| `files:write` | Upload and delete project files. |
| `connections:read` | Read protected connection metadata. |
| `connections:write` | Create, rotate, disable, and delete protected connections. |
| `databases:read` | Read database status, structure, records, transfers, and archives. |
| `databases:write` | Provision or change database data and manage portable copies. |
| `wallets:read` | List wallets, read one wallet, and read balances. List swap tokens, read swaps, build unsigned swaps for your own wallet, and follow their fills. |
| `wallets:create` | Create a managed wallet. |
| `wallets:sign` | Quote and execute approved message signatures. |
| `wallets:transact` | Quote and execute wallet sends and swaps, including universal swaps from HivemindOS wallets. |
| `trading:read` | Read managed trading positions. |
| `trading:execute` | Quote and submit managed spot trades. |
| `runs:read` | List and read durable service runs. |
| `runs:write` | Create and cancel durable service runs. |
| `approvals:read` | List approvals visible to the account. |
| `approvals:write` | Approve or reject actions and administer wallet policy. |
| `artifacts:read` | List and download authenticated run artifacts. |
| `webhooks:read` | List webhooks manageable by the key. |
| `webhooks:write` | Create and disable webhooks. |
| `api_keys:manage` | Create narrower child keys and list or revoke the current key and descendants. |

## Endpoint map

Paths are relative to the API base. **Idem** means an `Idempotency-Key` header is required. **Limit operation** is the selector used in API-key [limits](limits.html).

### API keys, services, and credits

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /api-keys` | `api_keys:manage` | No | `apiKeys.list` |
| `POST /api-keys` | First-key credit token or `api_keys:manage` | Yes | `apiKeys.create` |
| `DELETE /api-keys/{id}` | `api_keys:manage` | Yes | `apiKeys.revoke` |
| `PATCH /api-keys/{id}` | `api_keys:manage`, or the console | Yes | `apiKeys.update` |
| `GET /requests/outcome?idempotencyKey=` | Any key, for its own requests | No | `requests.outcome.read` |
| `GET /services` | `services:read` | No | `services.list` |
| `GET /capabilities` | `services:read` | No | `capabilities.list` |
| `GET /capabilities/{serviceId}` | `services:read` and service access | No | `capabilities.list` |
| `GET /actions` | `services:read` | No | `actions.list` |
| `POST /services/{serviceId}/invoke` | `services:invoke` and service access | Yes | `services.invoke`, `services.invoke.<serviceId>` |
| `GET /credits/balance` | `credits:read` | No | `credits.balance.read` |
| `POST /credits/x402/top-up` | `credits:write` | Yes | `credits.x402.topUp` |

A registered managed operation also applies `services.invoke.<serviceId>.<operationId>`. Successful invocation responses include `serviceId`, `operationId`, upstream `status`, `result`, and the exact `chargedCredits` reported by the owning service.

`PATCH /api-keys/{id}` pauses a key (`{"paused": true}`), resumes it (`{"paused": false}`), or changes its `limits` (a selector or field set to `null` is removed; the rest stays). A paused key, and every key made from it, is refused with HTTP 403 and `code: api_key_paused` until it is resumed. A key may pause itself or a key made from it; only a key above it, or the account in the console, may resume it or change its limits, and limits stay within every key above it. A revoked key cannot be changed.

### When an answer never arrived

`GET /requests/outcome?idempotencyKey=<the key you sent>` reads what became of that request, without running or charging anything:

| `state` | What to do |
|---|---|
| `none` | Nothing is running or kept under that key. Send it again with the same `Idempotency-Key`: what a service already did under it is not done twice. |
| `in_progress` | It is still running. Wait and check again; never resend it with a new key. |
| `completed` | It finished. Send it again with the same key and body to get the stored answer, charged nothing. `chargedCredits` says what it cost. |
| `interrupted` | It stopped before its result was recorded and may have been charged. Look for it in `GET /usage` before sending the work again with a new key. |

### Projects, usage, files, and connections

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /projects` | `projects:read` | No | `projects.list` |
| `POST /projects` | `projects:write` | Yes | `projects.create` |
| `GET /projects/{projectId}` | `projects:read` | No | `projects.read` |
| `PATCH /projects/{projectId}` | `projects:write` | Yes | `projects.update` |
| `DELETE /projects/{projectId}` | `projects:write` | Yes | `projects.archive` |
| `GET /usage` | `usage:read` | No | `usage.read` |
| `GET /audit-events` | `audit:read` | No | `auditEvents.list` |
| `GET /files` | `files:read` | No | `files.list` |
| `POST /files` | `files:write` | Yes | `files.create` |
| `GET /files/{fileId}` | `files:read` | No | `files.read` |
| `DELETE /files/{fileId}` | `files:write` | Yes | `files.delete` |
| `GET /connections` | `connections:read` | No | `connections.list` |
| `POST /connections` | `connections:write` | Yes | `connections.create` |
| `GET /connections/{connectionId}` | `connections:read` | No | `connections.read` |
| `PATCH /connections/{connectionId}` | `connections:write` | Yes | `connections.update` |
| `DELETE /connections/{connectionId}` | `connections:write` | Yes | `connections.delete` |

### Managed databases

All database endpoints also require service access to `hivemind-database`.

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /databases/account` | `databases:read` | No | `databases.account.read` |
| `POST /databases/account` | `databases:write` | Yes | `databases.account.provision` |
| `DELETE /databases/account` | `databases:write` | Yes | `databases.account.deprovision` |
| `POST /databases/query` | `databases:read` | No | `databases.query` |
| `POST /databases/actions` | `databases:write` | Yes | `databases.actions` |
| `POST /databases/transfers` | `databases:write` | Yes | `databases.transfers.create` |
| `PUT /databases/transfers/{transferId}/parts/{partNumber}` | `databases:write` | Yes | `databases.transfers.part.upload` |
| `POST /databases/transfers/{transferId}/complete` | `databases:write` | Yes | `databases.transfers.complete` |
| `GET /databases/transfers/{transferId}/archive` | `databases:read` | No | `databases.transfers.archive` |
| `GET /databases/transfers/{transferId}` | `databases:read` | No | `databases.transfers.read` |
| `DELETE /databases/transfers/{transferId}` | `databases:write` | Yes | `databases.transfers.cancel` |

### Managed wallets and trading

Wallet endpoints require service access to `managed-wallets`. Trading endpoints require service access to `managed-trading`.

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /wallets` | `wallets:read` | No | `wallets.list` |
| `POST /wallets` | `wallets:create` | Yes | `wallets.create` |
| `GET /wallets/{walletId}` | `wallets:read` | No | `wallets.read` |
| `GET /wallets/{walletId}/balances` | `wallets:read` | No | `wallets.balances.read` |
| `PATCH /wallets/{walletId}/policy` | `approvals:write` | Yes | `wallets.policy.update` |
| `POST /wallets/{walletId}/transactions/quote` | `wallets:transact` | Yes | `wallets.transactions.quote` |
| `POST /wallets/{walletId}/transactions` | `wallets:transact` | Yes | `wallets.transactions.create` |
| `GET /wallets/{walletId}/transactions` | `wallets:read` | No | `wallets.transactions.list` |
| `GET /wallets/{walletId}/transactions/{transactionId}` | `wallets:read` | No | `wallets.transactions.read` |
| `POST /wallets/{walletId}/signatures/quote` | `wallets:sign` | Yes | `wallets.signatures.quote` |
| `POST /wallets/{walletId}/signatures` | `wallets:sign` | Yes | `wallets.signatures.create` |
| `POST /trading/quotes` | `trading:execute` | Yes | `trading.quotes.create` |
| `POST /trading/orders` | `trading:execute` | Yes | `trading.orders.create` |
| `GET /trading/orders` | `trading:read` | No | `trading.orders.list` |
| `GET /trading/orders/{orderId}` | `trading:read` | No | `trading.orders.read` |
| `GET /trading/positions` | `trading:read` | No | `trading.positions.list` |

### Universal swaps

Swap endpoints require service access to `universal-swaps`. See [universal swaps](wallets-trading.html#universal-swaps) for the flows.

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /swaps/tokens` | `wallets:read` | No | `swaps.tokens.list` |
| `POST /swaps/quote` | `wallets:transact` | Yes | `swaps.quote` |
| `POST /swaps` | `wallets:transact` | Yes | `swaps.execute` |
| `GET /swaps` | `wallets:read` | No | `swaps.list` |
| `GET /swaps/{swapId}` | `wallets:read` | No | `swaps.read` |
| `POST /swaps/prepare` | `wallets:read` | No | `swaps.prepare` |
| `GET /swaps/routes/{routeId}` | `wallets:read` | No | `swaps.routes.read` |

### Runs, approvals, artifacts, and webhooks

Run and artifact reads also require service access to the resource's source service.

| Method and path | Scope | Idem | Limit operation |
|---|---|:---:|---|
| `GET /runs` | `runs:read` | No | `runs.list` |
| `POST /runs` | `runs:write` and service access | Yes | `runs.create`, `runs.create.<serviceId>` |
| `GET /runs/{runId}` | `runs:read` | No | `runs.read` |
| `POST /runs/{runId}/cancel` | `runs:write` | Yes | `runs.cancel` |
| `GET /approvals` | `approvals:read` | No | `approvals.list` |
| `POST /approvals/service-actions` | `approvals:write` and service access | Yes | `approvals.create` |
| `POST /approvals/{approvalId}` | `approvals:write` | Yes | `approvals.decide` |
| `GET /artifacts` | `artifacts:read` | No | `artifacts.list` |
| `GET /artifacts/{artifactId}/content` | `artifacts:read` | No | `artifacts.content.read` |
| `GET /webhooks` | `webhooks:read` | No | `webhooks.list` |
| `POST /webhooks` | `webhooks:write` | Yes | `webhooks.create` |
| `PATCH /webhooks/{webhookId}` | `webhooks:write` | Yes | `webhooks.update` |
| `POST /webhooks/{webhookId}/rotate-secret` | `webhooks:write` | Yes | `webhooks.rotate` |
| `DELETE /webhooks/{webhookId}` | `webhooks:write` | Yes | `webhooks.disable` |
| `GET /webhook-deliveries` | `webhooks:read` | No | `webhookDeliveries.list` |
| `POST /webhook-deliveries/{deliveryId}/replay` | `webhooks:write` | Yes | `webhookDeliveries.replay` |

## Limit operation ids

The wildcard `*` matches every authenticated operation. The complete static set is:

```text
services.list
capabilities.list
actions.list
services.invoke
credits.balance.read
credits.x402.topUp
projects.list
projects.create
projects.read
projects.update
projects.archive
usage.read
auditEvents.list
files.list
files.create
files.read
files.delete
connections.list
connections.create
connections.read
connections.update
connections.delete
apiKeys.list
apiKeys.create
apiKeys.revoke
apiKeys.update
requests.outcome.read
databases.account.read
databases.account.provision
databases.account.deprovision
databases.query
databases.actions
databases.transfers.create
databases.transfers.part.upload
databases.transfers.complete
databases.transfers.archive
databases.transfers.read
databases.transfers.cancel
wallets.list
wallets.create
wallets.read
wallets.balances.read
wallets.policy.update
wallets.transactions.quote
wallets.transactions.create
wallets.transactions.list
wallets.transactions.read
wallets.signatures.quote
wallets.signatures.create
trading.quotes.create
trading.orders.create
trading.orders.list
trading.orders.read
trading.positions.list
swaps.tokens.list
swaps.quote
swaps.prepare
swaps.execute
swaps.list
swaps.read
swaps.routes.read
runs.list
runs.create
runs.read
runs.cancel
approvals.list
approvals.create
approvals.decide
artifacts.list
artifacts.content.read
webhooks.list
webhooks.create
webhooks.update
webhooks.rotate
webhooks.disable
webhookDeliveries.list
webhookDeliveries.replay
```

For every service id and registered operation, these selectors are also valid:

```text
services.invoke.<serviceId>
runs.create.<serviceId>
services.invoke.<serviceId>.<operationId>
runs.create.<serviceId>.<operationId>
```

The SDK exports the expanded list as `HIVEMINDOS_PLATFORM_OPERATION_IDS`, and the five operations that accept `creditsPerDay` as `HIVEMINDOS_PLATFORM_CREDIT_METERED_OPERATION_IDS`.

## Request headers

| Header | When to send |
|---|---|
| `Authorization: Bearer <key>` | Every authenticated request. |
| `Content-Type: application/json` | JSON request bodies. |
| `Content-Type: application/zip` | A database transfer part. |
| `Content-Type: <media-type>` | A managed file upload. |
| `Content-Length` | A database transfer part or file upload. |
| `Idempotency-Key` | Every endpoint marked `Yes` above. |
| `X-HivemindOS-Project` | Select an active project with an account-level key. |
| `X-HivemindOS-End-User` | Act for one of your app's end users. See [projects and isolation](projects-security.html#act-for-one-of-your-apps-users). |
| `X-File-Name` | Required customer-visible file name for a file upload. |
| `X-Content-Sha256` | Optional expected file checksum. |
| `X-HivemindOS-File-Purpose` | Optional project-defined file purpose. |
| `X-HivemindOS-Credit-Token` | Only while bootstrapping the first API key. |
| `X-HivemindOS-Max-Credits` | Optional on an invoke: the most this call may cost, in Agent Credits. Same as `maxCredits` in the body. |
| `Payment-Signature` | x402 v2 signed payment on the retry after an HTTP 402 challenge. Normally added by an x402-aware client. |
| `X-PAYMENT` | Legacy x402 payment header for compatible clients. |
| `X402-Version` | Optional x402 protocol-version hint. |

## Response headers

| Header | Meaning |
|---|---|
| `Idempotent-Replayed: true` | This successful response came from an earlier request with the same key and input. |
| `Retry-After` | Seconds before the exhausted API-key window or capacity may be available, or, on a managed-service `503` or `429`, how long the service asked you to wait. |
| `Deprecation` | This operation is deprecated. See the [deprecation policy](#deprecation-policy). |
| `Sunset` | When a deprecated operation stops working. |
| `X-HivemindOS-Limit-Operation` | Exact operation id reported with HTTP 429. |
| `X-HivemindOS-Credits-Charged` | Authoritative managed-service charge when the operation reports one. |
| `X-HivemindOS-Upstream-Request-Id` | Safe managed-service request correlation id when available. |
| `X-Content-Sha256` | SHA-256 checksum for a database archive download. |
| `X-HivemindOS-Archive-Public-Key` | Provenance key supplied with a database archive download. |
| `X-HivemindOS-Event` | Webhook event name. |
| `X-HivemindOS-Signature` | Timestamp and HMAC for a webhook delivery. |
| `Payment-Required` | Base64-encoded x402 v2 payment requirements on HTTP 402. |
| `Payment-Response` | x402 settlement result after a successful payment. |
| `X-HivemindOS-Paid-Agent-Receipt` | HivemindOS Agent Credit purchase receipt id. |

## x402 Agent Credit top-up

Send `{ "amountUsd": 5 }` to `POST /credits/x402/top-up` with an API key that has `credits:write`, an `Idempotency-Key`, and access to `credits.x402.topUp`. Amounts may be $5 to $500 with no more than two decimal places.

The first request returns HTTP 402 and `Payment-Required`. An x402 v2 client signs the exact Base payment and retries the same request with `Payment-Signature` and the same idempotency key. A successful response includes `creditedUsd`, `creditedCredits`, `receiptId`, and the updated `credits` balance.

The route never accepts a recipient, network, asset, price, credit token, or alternate account in its body. Those values are fixed and verified by HivemindOS, and the payment settles to the same official HivemindOS revenue wallet used by the other managed x402 services.

## SDK constants and helpers

```ts
import {
  HIVEMINDOS_PLATFORM_API_BASE_URL,
  HIVEMINDOS_PLATFORM_API_VERSION,
  HIVEMINDOS_SUPERAGENT_MCP_URL,
  HIVEMINDOS_PLATFORM_SCOPES,
  HIVEMINDOS_PLATFORM_SERVICE_IDS,
  HIVEMINDOS_PLATFORM_OPERATION_IDS,
  HIVEMINDOS_PLATFORM_CREDIT_METERED_OPERATION_IDS,
  HIVEMINDOS_DATABASE_CONFIRMATIONS,
  HivemindOSClient,
  createHivemindOSApiKey,
  hivemindOSRunCreateOperationId,
  hivemindOSServiceInvocationOperationId,
} from "@hivemindos/sdk";
```

The SDK returns the same `{ ok: true, ... }` or `{ ok: false, error, ... }` envelopes as the HTTPS API. It does not throw on an ordinary API failure, so check `ok` before using the result.

## Deprecation policy

New operations and response fields can be added at any time, so ignore fields you do not know. Before an operation is removed or changed incompatibly:

- It is marked deprecated in the public changelog, with what to use instead, at least 30 days before it stops working.
- Responses from it carry a `Deprecation` header, and a `Sunset` header with the date it stops working, for that whole period.
- It keeps working until the `Sunset` date.

Watch for the `Deprecation` header in your logs, so a removal never comes as a surprise.

## Related

- [Quickstart](./)
- [Authentication](authentication.html) and [limits](limits.html)
- [Runs, webhooks, and errors](runs-webhooks.html)

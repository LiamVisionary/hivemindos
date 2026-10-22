# Per-endpoint limits

> https://hivemindos.app/superagent-api/docs/limits · Markdown version: https://hivemindos.app/superagent-api/docs/limits.md

Limits stop one key or worker from using more than you intended. For each endpoint you can cap requests per minute, hour, or day, how many run at once, and, for selected money operations, Agent Credits spent per day.

Limits are fixed when the key is created. To change them, create a replacement key.

## Set limits on a key

```ts
const result = await hive.apiKeys.create(
  {
    label: "Bounded worker",
    scopes: [
      "services:read",
      "services:invoke",
      "wallets:read",
      "wallets:transact",
    ],
    allowedServices: ["hive-research", "managed-wallets"],
    limits: {
      "*": {
        requestsPerHour: 2_000,
        maxConcurrent: 20,
      },
      "services.invoke": {
        requestsPerMinute: 120,
      },
      "services.invoke.hive-research": {
        requestsPerMinute: 30,
        maxConcurrent: 3,
      },
      "services.invoke.hive-research.analyses.create": {
        requestsPerDay: 250,
      },
      "services.invoke.cloud-superbrain.memory.answer": {
        requestsPerMinute: 10,
        requestsPerDay: 500,
      },
      "wallets.transactions.create": {
        requestsPerDay: 10,
        creditsPerDay: 25,
      },
      "credits.x402.topUp": {
        requestsPerDay: 4,
      },
    },
  },
  { idempotencyKey: "bounded-worker-v1" },
);
```

## Limit fields

| Field | Meaning | Accepted maximum |
|---|---|---:|
| `requestsPerMinute` | Requests during a fixed minute window. | 60,000 |
| `requestsPerHour` | Requests during a fixed hour window. | 1,000,000 |
| `requestsPerDay` | Requests during a fixed UTC day. | 10,000,000 |
| `maxConcurrent` | Requests for the selector that may be in progress at once. | 1,000 |
| `creditsPerDay` | Agent Credits the selector may spend during a fixed UTC day. | 1,000,000,000 |
| `creditsPerCall` | The most one call may cost, in Agent Credits. See [the most one call may cost](#most-one-call-may-cost). | 1,000,000,000 |

- Request and concurrency values must be positive integers. `creditsPerDay` must be positive with at most three decimal places. `creditsPerCall` may be 0 (free calls only) or more, with at most three decimal places.
- A key may define at most 128 selectors.
- The maximums are validation ceilings, not default quotas. An omitted field adds no limit, but account balance, plan allowance, service availability, wallet policy, and ancestor-key limits still apply.
- Concurrent capacity stays in use until the response finishes, including a streamed one. Always consume or cancel response bodies.

## Limit selectors

The `limits` object is keyed by operation id:

| Selector | Applies to |
|---|---|
| `*` | Every authenticated SuperAgent API operation. |
| A static operation such as `databases.actions` | Only that endpoint operation. |
| `services.invoke` | Every direct managed-service invocation. |
| `services.invoke.<serviceId>` | Direct invocation of one managed service. |
| `services.invoke.<serviceId>.<operationId>` | One exact registered capability invoked directly. |
| `runs.create` | Every durable run creation. |
| `runs.create.<serviceId>` | Run creation for one managed service. |
| `runs.create.<serviceId>.<operationId>` | One exact registered capability created as a run. |

Every matching selector applies, and the request is rejected as soon as any one is used up. For `hive-research` operation `analyses.create`, the API checks `*`, `services.invoke`, `services.invoke.hive-research`, and `services.invoke.hive-research.analyses.create`. Likewise, `services.invoke.cloud-superbrain.memory.answer` limits memory answers alone, while `services.invoke.cloud-superbrain` caps every Cloud Superbrain operation.

The SDK exports every accepted operation id as `HIVEMINDOS_PLATFORM_OPERATION_IDS`; they are also in the [endpoint reference](reference.html#limit-operation-ids).

## Daily credit limits

`creditsPerDay` can be set on `*` or on any operation. A new key gets 2,000 a day on `*` unless it names its own `*` limits.

- The operations the API bills itself hold their whole quoted charge against the limit before they start, and only the final charge counts: `wallets.create`, `wallets.transactions.create`, `wallets.signatures.create`, `trading.orders.create` and `swaps.execute`.
- Every other call is checked before it runs against what the key has already spent today, and its charge is counted after it answers. The last call before the limit can therefore finish past it by at most its own charge.

A key's credit limit does not add credits and does not replace wallet policy. A request must pass the key limit, have enough account credits, and satisfy the wallet's own rules.

`credits.x402.topUp` accepts request and concurrency limits but not `creditsPerDay`, because it buys credits rather than spending them. The unsigned HTTP 402 challenge does not use up a request slot; the first signed payment attempt does, and an idempotent replay of a completed top-up does not.

## The most one call may cost

`creditsPerCall` holds every call a key makes to a ceiling, and `maxCredits` in an invoke body (or the `X-HivemindOS-Max-Credits` header) does the same for one call. The lower of the two decides. A call runs only when its price is known before it starts and fits:

- An operation with a published maximum (most operations sold per call, and those whose service lists one) runs if that maximum fits. Otherwise it is refused with HTTP 409, `code: price_above_maximum`, and its `priceCredits`.
- A free operation always runs, even under 0.
- An operation priced only after it runs (a model reply, a metered lookup) is refused with HTTP 409 and `code: price_not_known_up_front`. One priced by a free quote says which quote operation to ask first.

Nothing is charged for a refused call, and it never reaches the service. `GET /inspect/{serviceId}/{operationId}` shows any operation's price before you call it, keyless and free.

## Pause a key

`PATCH /api-keys/{id}` with `{"paused": true}` stops a key, and every key made from it, without revoking it: each call is refused with HTTP 403 and `code: api_key_paused`, which names the paused key. `{"paused": false}` resumes it, with its limits, scopes and expiry as they were. A key may pause itself or a key made from it; only a key above it, or the account in the console on hivemindos.app, may resume it. The same route changes a key's `limits` in place, merged into what it has, and never past a key above it.

## Child keys and ancestor limits

Every key above a child still applies its limits. If a root key allows 1,000 requests per hour and its child allows 100, the child gets 100. A child cannot set a covering limit higher than an ancestor's, and leaving a limit out does not bypass the parent. Revoking or expiring any ancestor invalidates the child.

Use this to set organization-wide ceilings on the root key and smaller budgets on each worker.

## Handle HTTP 429

When a key hits a request, concurrency, or daily-credit limit, the API returns HTTP 429:

```json
{
  "ok": false,
  "code": "rate_limit_exceeded",
  "error": "This API key has reached its request limit for this operation.",
  "operationId": "services.invoke.hive-research",
  "metric": "requestsPerMinute",
  "retryAfterSeconds": 18
}
```

With these headers:

```http
Retry-After: 18
X-HivemindOS-Limit-Operation: services.invoke.hive-research
```

Pause that workload for at least `retryAfterSeconds`. Queueing work in your backend is usually better than having every caller retry. Another operation may still have capacity, but do not route around a deliberate key-wide or ancestor limit.

```ts
const result = await hive.services.invokeOperation(
  "hive-research",
  "analyses.create",
  { question: "..." },
  { idempotencyKey: jobId },
);

if (!result.ok && result.code === "rate_limit_exceeded") {
  await queueForLater(jobId, result.retryAfterSeconds ?? 60);
}
```

## Related

- [Authentication and delegation](authentication.html)
- [Endpoint reference](reference.html)

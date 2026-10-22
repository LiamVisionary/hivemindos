# Authentication and API keys

> https://hivemindos.app/superagent-api/docs/authentication · Markdown version: https://hivemindos.app/superagent-api/docs/authentication.md

An API key lets your backend call HivemindOS for one account. Keep it on your server, give it only the access its job needs, and replace it if it is ever exposed.

The safe default: one key per app or worker, allowed only the services and actions it needs, with limits, and with approval power kept on a different key.

## Authenticate requests

Send the key as a bearer token:

```bash
curl https://api.hivemindos.app/v1/services \
  --header "Authorization: Bearer $HIVEMINDOS_API_KEY"
```

Never put the key in a URL or request body. A browser or mobile client should call your backend, which then calls HivemindOS.

The remote MCP at `https://api.hivemindos.app/mcp` uses the same key. See [MCP](mcp.html).

## Create the first key

The quickest way is the [console](https://hivemindos.app/superagent-api/console/#keys) or [agent setup](agent-setup.html). To do it through the API, use an existing HivemindOS credit token once. This is the only request that accepts `X-HivemindOS-Credit-Token` instead of a bearer key.

```bash
curl https://api.hivemindos.app/v1/api-keys \
  --request POST \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: backend-root-key-v1" \
  --header "X-HivemindOS-Credit-Token: $HIVEMINDOS_CREDIT_TOKEN" \
  --data '{
    "label": "Backend root",
    "scopes": [
      "services:read",
      "services:invoke",
      "credits:read",
      "api_keys:manage"
    ],
    "allowedServices": ["hive-research", "managed-workflows"],
    "allowedOperations": [
      "actions.list",
      "services.invoke.hive-research.analyses.create",
      "runs.create.hive-research.analyses.create"
    ],
    "expiresAt": "2027-01-01T00:00:00.000Z"
  }'
```

The response includes `secret`, an `hmos_live_...` value returned only this once. Save it in your secret manager right away. Later listings show only a prefix and metadata.

## Key expiry

Keys expire by default. Leave out `expiresAt` and a key lasts 30 days:

| How the key was made | Without `expiresAt` | With `expiresAt` |
|---|---|---|
| From a credit token | 30 days, renewed by use: each authenticated request moves the expiry to 30 days from then. Repeating the same create request (same idempotency key and input) also renews it, even after it expired. | Fixed at that time. |
| From another key | 30 days, fixed, and never later than its parent. | Fixed at that time, and never later than its parent. |

- A chosen `expiresAt` is never moved, and it can be at most 365 days away.
- A key that can move funds or approve (`wallets:sign`, `wallets:transact`, `approvals:write`, or `trading:execute`) can be given at most 90 days.
- Each key reports `expiresAt`. An expired key answers `401`; so do all its descendants, since a child never outlives its parent. Rotate before the date (see [below](#rotate-or-revoke-a-key)), or keep using a renewing key.

## What decides a key's access

A request must pass all four checks:

1. **Scopes**: which kinds of actions the key may perform. See the [scope list](reference.html#scopes).
2. **Service access**: which managed services it may reach.
3. **Operation access**: which exact capabilities and endpoints it may call.
4. **Limits**: how often or how much it may use each operation. See [per-endpoint limits](limits.html).

## Choose service access

Use one of these fields when creating a key, not both:

| Field | Meaning |
|---|---|
| `allowedServices` | The key can reach only the listed service ids. The safest default for production. |
| `excludedServices` | Every service available at creation except these. Saved as an explicit allowlist, so services added later stay excluded. |
| Neither field | The key inherits its parent's service boundary. A root key without a boundary may use any service its scopes permit, including ones added later. |

An empty `allowedServices` array blocks every managed service but still permits non-service operations covered by the key's scopes.

Database, wallet, and trading routes follow the same boundary through `hivemind-database`, `managed-wallets`, and `managed-trading`.

## Choose operation access

Use `allowedOperations` to allow only exact capabilities and endpoints, or `excludedOperations` to remove some from the parent's boundary. Do not send both.

```json
{
  "allowedOperations": [
    "capabilities.list",
    "services.invoke.hive-research.analyses.create",
    "runs.create.hive-research.analyses.create",
    "runs.read"
  ]
}
```

- Operation access is fixed when the key is created. New capabilities added later do not become reachable on their own.
- An aggregate selector such as `services.invoke.hive-research` covers all of that service's registered operations. An exact selector such as `services.invoke.hive-research.analyses.create` covers one.
- Include the supporting operations a workflow needs. A worker that permanently deletes managed memory needs `services.invoke.cloud-superbrain.memory.delete` together with `approvals.create` and `approvals.decide`. A key that revokes itself also needs `apiKeys.revoke`. Supporting operations do not widen the key's service boundary.

A project-bound key is permanently restricted to one project, and so are all its children. See [projects and isolation](projects-security.html).

## Use idempotency keys

Every mutation and spending action requires `Idempotency-Key`. Use a stable id for one logical action, such as your order or job id:

```http
Idempotency-Key: order_01J6M1Q64NQH8S1QKC9D7G3V3T
```

- 8–200 characters: letters, digits, colons, periods, underscores, and hyphens.
- The same key with the same input returns the stored result. The same key with different input returns HTTP 409.
- Keys are isolated per API key, so two sibling keys can use the same external job id safely.

## Give each responsibility its own key

- A catalog key with only read scopes.
- One worker key per service or workload.
- A funding key with `credits:read` and `credits:write`, restricted to `credits.balance.read` and `credits.x402.topUp`.
- A wallet execution key without approval authority.
- A reviewer key with `approvals:write` but no wallet or trading execution scope.
- A key-management key kept away from ordinary workers.

A compromised component then cannot reach unrelated services or approve the action it proposed.

A funding key decides who may ask your x402 payer to buy Agent Credits. It cannot choose the revenue wallet or credit another account. Keep the payer's signer in a separate secret store and have your user approve each payment before signing.

## Delegate narrower child keys

A key with `api_keys:manage` can create a child key with `POST /api-keys`, authenticated with the parent's bearer key:

```ts
const workerKey = await hive.apiKeys.create(
  {
    label: "Research worker",
    scopes: ["services:read", "services:invoke", "runs:read", "runs:write"],
    allowedServices: ["hive-research"],
    allowedOperations: [
      "capabilities.list",
      "services.invoke.hive-research.analyses.create",
      "runs.create.hive-research.analyses.create",
      "runs.read",
    ],
    expiresAt: "2026-12-01T00:00:00.000Z",
    limits: {
      "services.invoke.hive-research": {
        requestsPerMinute: 20,
        maxConcurrent: 2,
      },
    },
  },
  { idempotencyKey: "research-worker-2026-12" },
);
```

A child key can only be narrower than every key above it:

- Its scopes, services, and operations must all be covered by its ancestors.
- A project-bound key cannot change projects or create an account-level child.
- Its expiry cannot be later than the earliest ancestor expiry.
- It keeps its ancestors' privacy tier and cannot loosen it. See [privacy tiers](privacy.html).
- It keeps its ancestors' end user, if one is bound, and cannot name another. See [act for one of your app's users](projects-security.html#act-for-one-of-your-apps-users).
- Its limits cannot exceed an ancestor's covering limit, and every ancestor limit still applies.
- Delegation is limited to eight levels.

Revoking or expiring a key invalidates all its descendants. A key with `api_keys:manage` can list and revoke only itself and its descendants, never a sibling branch.

## Rotate or revoke a key

1. Create a new child key with the same or narrower policy.
2. Add it to your secret manager.
3. Move traffic to the new key and confirm requests succeed.
4. Revoke the old key with `DELETE /api-keys/{id}` and a unique idempotency key.

Revocation is immediate. It also stops webhooks created under that key from receiving new events.

## Related

- [Per-endpoint limits](limits.html)
- [Projects and isolation](projects-security.html)
- [Scope and endpoint reference](reference.html)

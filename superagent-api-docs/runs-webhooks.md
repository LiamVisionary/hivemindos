# Runs, artifacts, webhooks, and errors

> https://hivemindos.app/superagent-api/docs/runs-webhooks · Markdown version: https://hivemindos.app/superagent-api/docs/runs-webhooks.md

Use a **direct call** when your app can wait for the answer. Use a **run** when work may continue after the request ends; its result is saved as an **artifact**. Use a **webhook** when HivemindOS should tell your app that something changed.

## Durable runs

Create a run with `runs:write` and access to the service:

```ts
const created = await hive.runs.create(
  {
    serviceId: "hive-research",
    operationId: "analyses.create",
    input: { question: "Create an evidence map for this decision." },
  },
  { idempotencyKey: "evidence-map-run-001" },
);

if (!created.ok) throw new Error(created.error);
console.log(created.run.id, created.run.status);
```

Creating a run returns HTTP 202 with status `queued`. HivemindOS then records `running`, `succeeded`, or `failed`. Read runs with `runs.list()` or `runs.get(id)`. Only a `queued` run can be cancelled.

A run records its `serviceId` and operation id; `status`, `progress`, `output`, and a customer-safe `error`; maximum and charged credits when the run owns that accounting; and creation and update times.

A key can only read runs for services it is allowed to use. Direct calls and runs have separate [limit selectors](limits.html#limit-selectors).

## Download result artifacts

A successful JSON run result is also saved as an authenticated `result.json` artifact, up to 25 MB. A deployment without managed artifact storage keeps smaller results only.

```ts
const listed = await hive.artifacts.list(runId);
if (!listed.ok) throw new Error(listed.error);

for (const artifact of listed.artifacts) {
  const response = await fetch(artifact.downloadUrl, {
    headers: {
      Authorization: `Bearer ${process.env.HIVEMINDOS_API_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`);
  const result = await response.json();
}
```

Downloads need `artifacts:read`, account ownership, and access to the run's service. Download URLs are not public links.

## Create a signed webhook

A webhook needs `webhooks:write`, a public HTTPS URL, at least one event name, and an idempotency key.

```ts
const created = await hive.webhooks.create(
  {
    url: "https://example.com/webhooks/hivemindos",
    events: [
      "run.succeeded",
      "run.failed",
      "approval.created",
      "approval.approved",
      "approval.rejected",
      "wallet.transaction.broadcast",
      "trade.submitted",
    ],
  },
  { idempotencyKey: "example-webhook-v1" },
);

if (!created.ok) throw new Error(created.error);
saveSecret(created.signingSecret);
```

- The signing secret begins with `hmos_whsec_`. It is returned only on creation (or a replay of the same creation request), never in later listings.
- Use `"*"` to receive every event allowed by the webhook's service boundary, which it inherits from the creating key.
- Revoking or expiring that key or an ancestor stops new deliveries. A key can list or disable only webhooks created by itself or its descendants.
- URLs must be public HTTPS without embedded credentials or a custom port. Redirects are not followed.
- `webhooks.update()` changes the URL, events, status, or a narrower service boundary. `webhooks.rotateSecret()` issues a new signing secret, returned once.

### Replay failed deliveries

Failed deliveries retry with increasing delays, up to eight attempts. After fixing your endpoint, replay them:

```ts
const failed = await hive.webhooks.deliveries({ status: "failed", limit: 50 });
if (!failed.ok) throw new Error(failed.error);

for (const delivery of failed.deliveries) {
  await hive.webhooks.replayDelivery(delivery.id, {
    idempotencyKey: `replay-${delivery.id}`,
  });
}
```

## Event format

```http
X-HivemindOS-Event: run.succeeded
X-HivemindOS-Delivery: delivery_...
X-HivemindOS-Signature: t=1787551200,v1=<hex-hmac>
Content-Type: application/json
```

```json
{
  "id": "event_...",
  "type": "run.succeeded",
  "serviceId": "hive-research",
  "createdAt": "2026-08-24T12:00:00.000Z",
  "data": {
    "run": {}
  }
}
```

Current events:

- `run.started`, `run.succeeded`, and `run.failed`
- `approval.created`, `approval.approved`, and `approval.rejected`
- `wallet.created`, `wallet.policy.updated`, and `wallet.signature.created`
- `wallet.transaction.broadcast` and `trade.submitted`

Accept new event names and added data fields without failing.

## Verify a signature

Compute HMAC-SHA256 over `<timestamp>.<raw-request-body>` with the signing secret, compare in constant time, and reject stale timestamps before acting on the event.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyHivemindOSWebhook(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const values = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=", 2)),
  );

  const timestamp = Number(values.t);
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(nowSeconds - timestamp) > 300) return false;

  const expected = Buffer.from(
    createHmac("sha256", secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex"),
    "hex",
  );
  const received = Buffer.from(values.v1 ?? "", "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}
```

Verify the raw bytes exactly as received; re-serialized JSON will not match. Then deduplicate on the event `id`, queue the work, and return a 2xx response quickly.

## Error envelope

Every JSON error has `ok: false` and a customer-safe `error`. Some add fields that tell your app what to do next.

| HTTP | Meaning | What to do |
|---:|---|---|
| 400 | The request shape or value is invalid. | Fix the request; do not repeat it unchanged. |
| 401 | The key is invalid, revoked, or expired. | Stop using it and rotate credentials. |
| 402 | The HivemindOS credit balance or managed database allowance is insufficient. | Ask the account owner to top up, activate an eligible plan, or reduce usage. |
| 403 | The key scope, service boundary, delegated authority, approval, or wallet policy rejects the action. | Use a suitably restricted key or change the account-owned policy through its normal review path. |
| 404 | The route or account-owned resource was not found. | Check the id and the key's service boundary. |
| 409 | The state, confirmation, quote, approval, or idempotency key conflicts with the request. | Read the current resource. Use a fresh quote or idempotency key only for a genuinely new action. |
| 410 | A downloadable database archive expired. | Start a new download copy. |
| 413 | The request or upload part is too large. | Reduce or split the input within the documented limits. |
| 424 | Required managed-service setup is incomplete. | Ask the account owner to finish setup first. |
| 429 | An API-key limit was reached. | Wait for `retryAfterSeconds` and respect `Retry-After`. See [limits](limits.html#handle-http-429). |
| 500 | Something failed inside HivemindOS. | Keep the same idempotency key and retry with bounded backoff when the action is safe to repeat. |
| 502, 503, 504 | A managed service failed, was unavailable, or did not answer in time. See [managed service calls](#managed-service-calls). | Retry with the same idempotency key, after `Retry-After` when present. |

A few `code` values worth handling on their own:

| `code` | HTTP | Meaning |
|---|---:|---|
| `scope_not_supported` | 403 | The service cannot keep a project or end user apart, so it refuses a project-bound key or a project or end-user request. See [projects and isolation](projects-security.html#which-services-keep-a-project-or-user-apart). |
| `approval_requires_another_principal` | 403 | The approval came from the key that asked for it or from a key in its family. |
| `approval_consumed` | 409 | The approval was already used, or is being used by a request still in flight. Ask for a new approval for a new action. |

### Managed service calls

A call through `POST /services/{serviceId}/invoke` reports the service's own answer in a stable envelope:

```json
{
  "ok": false,
  "serviceId": "hive-research",
  "operationId": "analyses.create",
  "status": 503,
  "upstreamStatus": 503,
  "code": "upstream_unavailable",
  "error": "The service is busy. Try again shortly.",
  "retryAfterSeconds": 30,
  "chargedCredits": 0,
  "result": {}
}
```

`status` is the HTTP status of this response; `upstreamStatus` is the status the service itself returned.

| HTTP | `code` | Meaning | What to do |
|---:|---|---|---|
| 200 | none | The service succeeded. | Use `result`. |
| 4xx | `upstream_rejected`, `payment_required` (402), `rate_limited` (429) | The service refused this input. Its status is passed through. | Fix the request; do not repeat it unchanged. |
| 502 | `upstream_error` | The service failed or answered in a way HivemindOS could not use. | Retry with the same idempotency key and bounded backoff. |
| 503 | `upstream_unavailable` | The service is temporarily unavailable. | Retry after `Retry-After`. |
| 504 | `upstream_timeout` | The service did not answer in time: 60 seconds for most operations, 120 seconds for compute, media, research, and swarm work, 45 seconds for a Memory Answer, and 5 minutes for a streamed reply. | Retry with the same idempotency key. |

When the service says how long to wait, the response carries `Retry-After` and `retryAfterSeconds`. Retrying with the same idempotency key and input is safe: a failed call is not stored, so the retry runs again, and the service is handed the same idempotency key as the first time, so work it already started is not started twice. A retry sent while the first call is still running gets `409`. For a timed-out action that moves money or sends something, you can also read the resource or run first, since the service may have finished after HivemindOS stopped waiting.

### Approvals

An approval for a managed action must come from the account owner or from a key outside the requesting key's family: not the requesting key, a key it created, the key that created it, or a sibling. Keep your reviewer key under a separate root key.

Each approval is spent once. The first call that presents it claims it; a second call gets `409` with `approval_consumed`. If the service refuses the input (a 4xx), the approval is given back and can be used again with corrected input.

## Related

- [Per-endpoint limits](limits.html)
- [Usage and audit events](usage-audit.html)
- [OpenAPI contract](https://api.hivemindos.app/openapi.json)

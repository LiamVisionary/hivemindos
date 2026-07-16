# Hosted API and operating rules

Base URL: `https://hivemindos-copy-trading-gateway.hivemindos.workers.dev`

## Free routes

### `GET /health`

Returns dark-launch, live-mode, Durable Object monitoring, managed Bankr execution, partner-provisioning availability, and required-secret configuration status. A healthy Worker can still report `enabled: false`.

### `POST /v1/bankr/verify`

Verifies an existing `bk_usr` key against Bankr `GET /wallet/me`, then requires a unique non-broadcast `personal_sign` proof so LLM-only and read-only keys fail during setup. It returns only the EVM wallet identity and does not store the key or signature. Use it before payment. Never log the request body.

### `GET /v1/pricing`

The authoritative commercial offer. When disabled it returns 503 and `comingSoon: true`. Never infer availability from source code.

## Paid route

### `POST /v1/subscriptions`

An x402 USDC payment buys one 30-day Base target monitor. See `setup-and-subscribe.md` for the body and payment workflow. The settled payer becomes the subscription owner; caller-supplied payer and commercial fields are rejected.

## Authenticated management

Use the `manageUrl` returned at purchase with header:

```text
Authorization: Bearer <accessToken>
```

### Status

`GET <manageUrl>` returns the subscription, conservative UTC-day reservations, and the 20 latest event outcomes.

### Pause or resume

```http
PATCH <manageUrl>
Content-Type: application/json
Authorization: Bearer <accessToken>

{"status":"paused"}
```

Paused subscriptions do not emit or consume new signals. Resume with `{"status":"active"}` before expiry.

### Change risk settings

Patch any supported subset:

```json
{
  "maxTradeUsd": 3,
  "maxDailyUsd": 15,
  "scalePercent": 10,
  "maxSlippageBps": 75
}
```

Switching to live also requires at least one recorded paper result, the exact `riskAcknowledgement`, and the hosted live feature to be enabled. The managed worker enforces all three conditions before it uses Bankr's direct quote-then-swap Wallet API. Bankr's own per-transaction and rolling daily spend limits remain an independent final guard.

### Cancel

`DELETE <manageUrl>` stops monitoring and erases the hosted Bankr credential. For a partner-provisioned wallet, the service also attempts to revoke that specific Bankr key. For an existing user-owned Bankr key, tell the user to revoke it in Bankr as defense in depth. Cancellation does not imply a refund for the current paid period. Delete the private local credential only after the hosted cancellation succeeds.

## Event and receipt semantics

Managed Wallet API execution:

1. The Worker atomically consumes the pending event and writes `executing` before calling Bankr. A crash cannot cause an automatic retry and duplicate swap.
2. It derives the human sell amount from the source amount and the server-owned USD ceiling, quotes through `/wallet/swap-quote`, and requotes lower if Bankr's current USD value exceeds the cap.
3. It enforces the stricter of Bankr's minimum buy amount and the subscription slippage floor, then calls `/wallet/swap`.
4. A returned hash is `verifying`, not executed. The next alarms independently classify the Base transaction from the configured Bankr wallet before recording `executed`.

Legacy webhook execution:

1. It verifies `x-hivemind-signature` as HMAC-SHA256 over `<unix-seconds>.<raw-body>` with a five-minute window.
2. It validates the exact hosted origin, target, event ID, action path, payload bounds, and expiry.
3. It exchanges a one-time consume token. A second exchange returns 409 and cannot enqueue another agent prompt.
4. It returns a bounded Bankr prompt containing only validated Base addresses, transaction hash, USD/slippage ceilings, and a one-time receipt capability.
5. Bankr may post `executed`, `paper`, `skipped`, or `failed`. `executed` is accepted only for live signals after the hosted service verifies the Base transaction is a successful, matching swap from the configured Bankr wallet, uses the signaled assets, follows the source trade, and stays inside the server-issued USD ceiling.

Interpret status precisely:

- `pending`: queued for signed delivery
- `delivered`: Bankr returned a successful webhook response
- `consumed`: one-time execution prompt was claimed
- `failed`: delivery exhausted retries
- `expired`: signal was not consumed inside its short expiry
- receipt `executed`: the hosted service verified Bankr's reported transaction against the Base swap and signal limits

Webhook delivery, event consumption, and a profitable trade are three different claims. Never collapse them.

## Failure handling

- 401: wrong/missing bearer or event token; do not retry with guessed credentials.
- 409: replay, inactive/canceled subscription, invalid state transition, or paper-as-executed receipt.
- 410: expired signal; never execute it manually.
- 424: hosted settlement or encryption configuration is incomplete.
- 503 with `comingSoon`: product or live mode remains dark.
- 503 with `paymentSettled: true`: never pay again. The local app encrypts the returned recovery token, calls `POST /v1/subscriptions/recover`, and keeps retrying it on dashboard refresh until activation succeeds or the server declares the token terminally invalid.

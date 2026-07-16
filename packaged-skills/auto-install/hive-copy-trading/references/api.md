# Hosted API and operating rules

Base URL: `https://hivemindos-copy-trading-gateway.hivemindos.workers.dev`

## Public setup routes

- `GET /health` — monitoring, live-mode, managed Bankr execution, partner provisioning, fee-recipient configuration, and kill-switch status.
- `GET /v1/pricing` — authoritative direct fee policy, seven-day paper allowance, commercial cost coverage, and no-profit-guarantee statement.
- `POST /v1/bankr/verify` — checks a dedicated `bk_usr` key with `/wallet/me` plus a non-broadcast `personal_sign`; LLM-only and read-only keys fail during setup, and the route returns only EVM identity and fee policy.
- `POST /v1/monitors` — idempotently starts a paper monitor. This is ordinary HTTPS, not a paid x402 route.

## Authenticated monitor management

Use the returned `manageUrl` with `Authorization: Bearer <accessToken>`.

- `GET <manageUrl>` — monitor, conservative UTC-day reservations, and 20 recent event/fee outcomes.
- `PATCH <manageUrl>` — `status`, mode, or bounded risk settings.
- `DELETE <manageUrl>` — stop monitoring and erase the hosted Bankr credential. Partner-provisioned credentials are also revoked when Bankr confirms revocation; owners of existing keys should revoke them in Bankr as defense in depth.

Pause with `{"status":"paused"}` and resume with `{"status":"active"}`. Change risk settings with any supported subset of `maxTradeUsd`, `maxDailyUsd`, `scalePercent`, and `maxSlippageBps`.

Switching to live requires a paper result, the global live gate, and both exact acknowledgement strings documented in setup. Per-trade monitors do not renew. Existing legacy prepaid monitors remain prepaid through their original expiry and receive no additional per-trade charge.

## Verified execution and fee state machine

1. The Worker writes `executing` before calling Bankr. It never automatically retries an ambiguous swap submission.
2. It quotes with `/wallet/swap-quote`, enforces the USD and slippage ceilings, then calls `/wallet/swap`.
3. A returned swap hash becomes `verifying`. Blockscout must independently prove the exact Bankr wallet moved the signaled assets within the server limit before the event becomes `executed`.
4. Only then does the server calculate the published fee from the verified actual notional and atomically claim `fee.status = charging`.
5. It calls Bankr `/wallet/transfer` for exact Base USDC to the server-owned recipient. A returned hash becomes fee `verifying`.
6. Blockscout must independently match transaction success, Base USDC, exact amount, Bankr sender, and official recipient before fee `collected` and revenue recognition.
7. Unknown submission outcomes become fee `uncertain`; mismatches become `verification_failed`. Either state pauses the monitor and is never automatically retried. At most one live execution or unsettled fee may exist per monitor.

Paper, skipped, failed, and unverified trades have no service fee. A fee is not collected merely because Bankr accepted the transfer request.

## Failure handling

- 400: invalid or client-owned commercial input; fix the body rather than guessing.
- 401: wrong or missing bearer/key; never retry with guessed credentials.
- 409: replay, invalid state transition, missing paper result, or stale live consent.
- 410: expired signal; never execute it manually.
- 424: hosted encryption, fee-recipient, or optional partner provisioning is incomplete.
- 503 with `comingSoon`: product or live mode is disabled.

The legacy `POST /v1/subscriptions/recover` route exists only for already-settled historical x402 activations. If such a recovery is present, use the encrypted stored token and never pay again. New monitors never create a recovery payment token.

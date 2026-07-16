# Hosted API and operating rules

Base URL: `https://hivemindos-copy-trading-gateway.hivemindos.workers.dev`

## Public setup routes

- `GET /health` — monitoring, live-mode, managed Bankr execution, partner provisioning, fee-recipient configuration, and kill-switch status.
- `GET /v1/pricing` — authoritative rolling usage-minimum policy, uncapped percentage, cost coverage, and no-profit-guarantee statement.
- `POST /v1/bankr/verify` — checks a dedicated `bk_usr` key with `/wallet/me`, a non-broadcast `personal_sign`, and `/wallet/portfolio`; it returns EVM identity and Base USDC balance, never the key.
- `POST /v1/monitors` — idempotently starts a monitor. This is ordinary HTTPS, not a paid x402 route.

LLM-only and read-only keys fail during setup because managed execution requires restricted Wallet API signing access.

## Authenticated monitor management

Use the returned `manageUrl` with `Authorization: Bearer <accessToken>`.

- `GET <manageUrl>` — monitor, current usage period and fee credit, conservative UTC-day reservations, and 20 recent event/fee outcomes.
- `PATCH <manageUrl>` — active/paused status, optional paper/live mode, or bounded risk settings.
- `DELETE <manageUrl>` — stop monitoring and erase the hosted Bankr credential. Owners of existing keys should also revoke them in Bankr as defense in depth.

Pause with `{"status":"paused"}` and resume with `{"status":"active"}`. Change risk settings with a supported subset of `maxTradeUsd`, `maxDailyUsd`, `scalePercent`, and `maxSlippageBps`.

New monitors use `bankr-usage-minimum`. Already-consented `bankr-per-trade` monitors retain their original fee floor, cap, and paper gate; do not silently replace their commercial terms. Existing legacy prepaid monitors remain prepaid through their original expiry.

## Usage, execution, and fee state machines

1. The Worker claims the $1 period as `charging` before calling Bankr `/wallet/transfer`.
2. It checks the exact Base USDC balance before submission. A known insufficient-balance failure is safe to retry only after funding and an explicit resume.
3. A returned hash becomes usage `verifying`. Blockscout must independently match success, Base USDC, exact amount, Bankr sender, and official recipient before usage becomes `collected`, the monitor activates, and $1 of credit is available.
4. For a copied trade, the Worker writes `executing` before calling Bankr. It never automatically retries an ambiguous swap submission.
5. It quotes with `/wallet/swap-quote`, enforces USD and slippage ceilings, then calls `/wallet/swap`.
6. A returned swap hash becomes `verifying`. Blockscout must prove the matching swap from the Bankr wallet within the server limit before `executed`.
7. The server calculates an uncapped 0.5% from verified actual notional and atomically reserves remaining usage credit. If credit covers it, fee `included` is final and no second transfer is made.
8. Only an excess enters fee `charging`, then Bankr `/wallet/transfer`. The returned hash becomes fee `verifying`; exact on-chain verification is required before `collected` and revenue recognition.
9. Unknown excess-payment outcomes become fee `uncertain`; on-chain mismatches become `verification_failed`. Either pauses the monitor and is never automatically retried. At most one live execution or unsettled excess fee may exist per monitor.

Failed, skipped, and unverified trades have no percentage fee. The $1 usage minimum remains the cost of keeping that monitor active for the period. A payment is not collected merely because Bankr accepted the transfer request.

## Failure handling

- 400: invalid input, missing exact consent, or client-owned commercial fields.
- 401: wrong or missing bearer/key; never retry with guessed credentials.
- 402: the existing Bankr wallet does not yet have the $1 Base USDC activation minimum.
- 409: replay, invalid state transition, or stale consent.
- 410: expired signal; never execute it manually.
- 424: hosted encryption, fee recipient, or optional partner provisioning is incomplete.
- 503 with `comingSoon`: product or live mode is disabled.

The legacy `POST /v1/subscriptions/recover` route exists only for already-settled historical x402 activations. If such a recovery is present, use the encrypted stored token and never pay again. New monitors never create an x402 recovery payment token.

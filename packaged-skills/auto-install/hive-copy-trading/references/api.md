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

### Publish verified performance

`POST <manageUrl>/performance-share` creates a new read-only public capability URL. Creating another link rotates and immediately revokes the previous one. The response contains `publicUrl`, `schemaVersion`, `createdAt`, and `rotated`; it never returns the monitor bearer.

`DELETE <manageUrl>/performance-share` revokes the active link. Canceling the monitor revokes it automatically. Status exposes only `performanceShare.enabled`, `createdAt`, and `revokedAt`, never the link token.

From the packaged helper:

```bash
node scripts/monitor-client.mjs publish --id ctmon_...
node scripts/monitor-client.mjs unpublish --id ctmon_...
```

The helper reads the private mode-600 monitor state and prints only the newly issued public URL. Do not pass the management bearer to a Bankr app.

### Bankr app contract

A Bankr app should fetch the issued `publicUrl` from its server-side or scheduled script and render the returned feed. Do not scan the Bankr wallet or calculate copy-trading PnL from raw transfers.

- Require `authority: server-verified-copy-execution-ledger` and schema `2026-07-17`.
- Show `summary.verifiedCopiedTrades`, verified notional, fee credit, excess fees, usage minimums, realized/unrealized/gross/net PnL, and `openPositions` from the feed.
- Respect `summary.accounting.complete` and `summary.accounting.reasons`. Render `null` PnL as unavailable; never coerce it to zero.
- Link only the source, execution, and fee transaction hashes supplied by the feed.
- Label the result as copy-execution performance, not whole-wallet PnL. Preserve `performanceGuarantee: false`.
- Treat HTTP 404 as a rotated/revoked link and ask the owner for a new one. Do not ask for the monitor bearer.

Public read shape:

```text
GET /v1/public/monitors/<targetWallet>/<monitorId>/performance/<ctshare_token>
```

The response is `Cache-Control: no-store`. It contains no Bankr key, monitor access token, encrypted credential, or arbitrary wallet-transfer ledger.

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

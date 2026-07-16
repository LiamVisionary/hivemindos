# Setup and start a monitor

Complete this workflow in order. New monitors always start in paper mode.

## 1. Read hosted availability and fee policy

```bash
curl -fsS https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/health
curl -fsS https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/pricing
```

Stop if health is not configured or pricing does not report `pricingAuthority: server` and `clientOverridesAccepted: false`. Record the exact fee policy version, percentage, floor, cap, Base network, USDC asset, and official recipient. Do not reconstruct them from this file.

There is no subscription, renewal, x402 payment, or separate payment wallet. HivemindOS pays for its hosted monitor and collects the published fee from the user's Bankr execution wallet only after a live copied swap verifies.

## 2. Connect the Bankr wallet safely

Use an existing Bankr wallet or create one at `https://bankr.bot/api`. Bankr embedded wallet keys are non-exportable; never request or promise a recovery phrase.

Create a dedicated `bk_usr` key with:

- Wallet API enabled
- read-only off
- agent, LLM, and token-launch APIs off when Bankr exposes those toggles
- conservative per-transaction and daily Bankr spend limits
- the pricing response's official fee recipient as the only allowed EVM transfer recipient

The recipient allowlist does not redirect swaps: Bankr returns swap output to the same execution wallet. It permits only the separate, published Base USDC service-fee transfer.

In HivemindOS, choose an existing Shared Hive Env variable. Continue resolves and verifies it server-side without rewriting it. The pencil opens manual entry; Save is only for a new value and writes through `hive-env-add` after verification. For direct integrations, send the key only over HTTPS to `POST /v1/bankr/verify`. Verification checks EVM identity and a non-broadcast `personal_sign` capability proof. Never paste the key into chat, logs, screenshots, or a checked-in file.

Inside Bankr, add the key in Settings → Env Vars as `HIVEMIND_COPY_TRADING_WALLET_KEY`; do not paste it into chat. Bankr returns environment-variable names only, while the packaged `scripts/monitor-client.mjs` reads the value inside `execute_cli`.

If `GET /health` reports `partnerProvisioningConfigured: true`, the body may use `{ "kind": "provisioned" }`; HivemindOS then creates the Bankr wallet and a restricted key whose only allowed EVM recipient is the official fee wallet. If partner provisioning is unavailable, Bankr's normal self-serve wallet creation must remain usable.

## 3. Start the free paper monitor

Generate one stable idempotency key and reuse it if the request times out:

```json
{
  "activationIdempotencyKey": "ctstart_11111111-1111-4111-8111-111111111111",
  "targetWallet": "0xTARGET_ON_BASE",
  "bankrConnection": {
    "kind": "existing",
    "apiKey": "<dedicated-bk_usr-key>"
  },
  "mode": "paper",
  "maxTradeUsd": 5,
  "maxDailyUsd": 25,
  "scalePercent": 20,
  "maxSlippageBps": 100
}
```

POST it as ordinary HTTPS JSON to:

```text
https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/monitors
```

When the skill is installed inside Bankr, prefer its credential-safe helper instead of constructing a shell command containing the key:

```bash
node scripts/monitor-client.mjs start --target 0xTARGET_ON_BASE --max-trade 5 --max-daily 25 --scale 20 --slippage 100
```

The helper fetches current pricing, persists the idempotency key before the network call, retries the same activation safely, stores the returned access token in a mode-600 private state file, and prints only non-secret monitor details.

Do not add `price`, `priceUsd`, `payTo`, `payer`, `network`, `expiresAt`, `billingModel`, fee fields, or a client-selected fee recipient. The server rejects those authority overrides. Server bounds are $0.10–$100 per trade, $0.10–$500 per UTC day, 1–100% scale, and 10–500 bps slippage; the per-trade cap cannot exceed the daily cap.

Capture the response privately. Store `accessToken` in encrypted owner-private storage with file mode `600`; never put it in chat or source. Retain `monitorId`, `manageUrl`, target, Bankr wallet, and published billing object. The Bankr API key is encrypted by the hosted Worker and is not returned.

## 4. Verify paper behavior and fund

GET `manageUrl` with `Authorization: Bearer <accessToken>` and verify the target, Bankr wallet, risk caps, `billingModel: bankr-per-trade`, seven-day paper expiry, and `executionProvider: bankr-managed`.

The first poll creates a cursor and never copies older trades. Produce or wait for a new eligible target swap. A paper event must end as `receiptStatus: paper` with no execution or fee transaction. The free monitor then pauses automatically; enabling live with both acknowledgements reactivates it.

Fund the Bankr wallet with Base USDC for copied trades plus a small fee reserve. Bankr sponsors Base gas, so this flow does not require a separate ETH gas step.

## 5. Enable live only with explicit consent

Immediately re-read `/v1/pricing`, show the exact current fee, and obtain both acknowledgements. Then PATCH `manageUrl`:

```json
{
  "mode": "live",
  "riskAcknowledgement": "I understand copy trading can lose money",
  "feeAcknowledgement": "I authorize HivemindOS to charge the published fee after each verified live copied trade"
}
```

Live enablement fails until at least one paper event exists. Once enabled, the monitor has no subscription renewal. Pausing or canceling stops new copies; cancellation erases the hosted credential.

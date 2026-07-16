# Setup and subscribe

Complete this workflow in order. The service starts in paper mode unless the user explicitly requests live mode and completes the live gate.

## 1. Confirm prerequisites

Use an existing Bankr wallet, create one directly with Bankr, or use hosted partner provisioning. For an existing or self-created wallet, create a dedicated key at `https://bankr.bot/api` with Wallet API enabled, read-only off, no transfer recipients, and conservative Bankr spend limits. Never ask for or store a recovery phrase: Bankr embedded signing keys are non-exportable.

The Base wallet paying x402 is separate from the Bankr execution wallet. Confirm the payment wallet has enough Base USDC for the current price and Base ETH for gas.

Fetch the authoritative offer:

```bash
curl -fsS https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/pricing
```

Stop if the response is not successful, is `coming-soon`, or does not report `pricingAuthority: server` and `clientOverridesAccepted: false`. Do not reconstruct a price from this skill.

## 2. Choose the Bankr connection

Existing Bankr wallet:

```json
{
  "bankrConnection": {
    "kind": "existing",
    "apiKey": "<dedicated-bk_usr-key>"
  }
}
```

In the HivemindOS dashboard, use the Shared Hive Env selector first. It fetches variable names only and auto-selects a configured Bankr variable. Continue resolves and verifies that stored value server-side without rewriting it. The pencil switches to manual entry, where Save verifies a replacement before writing it through `hive-env-add`. For a direct hosted integration, verify the key without storing it by POSTing it to `/v1/bankr/verify`. Verification checks the EVM identity and a non-broadcast `personal_sign` capability proof, so LLM-only and read-only keys fail before payment. Confirm the returned EVM wallet is different from the wallet being followed. Do not print the key or include it in command history when a safer local UI or secret input is available.

Partner-provisioned wallet:

```json
{
  "bankrConnection": {
    "kind": "provisioned"
  }
}
```

Use this only when `GET /health` reports `partnerProvisioningConfigured: true`. The partner credential is server-only. The client must never supply or override it. HivemindOS requests a swap-only wallet key: Wallet API enabled, agent/LLM/token-launch APIs disabled, transfers blocked by an empty recipient allowlist.

When partner provisioning is unavailable, the **Create a Bankr wallet** choice must remain usable: send the user to `https://bankr.bot/api`, let Bankr create and recover the wallet, then continue through the existing-key verification flow. Do not describe missing partner access as blocking new-user setup.

The legacy signed webhook mode is still available for self-hosted or compatibility setups. Use the packaged webhook artifacts only for that explicit fallback; do not install a webhook for managed Wallet API execution.

## 3. Build the subscription body

Required fields for an existing Bankr connection:

```json
{
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

For provisioning, replace `bankrConnection` with:

```json
{
  "bankrConnection": { "kind": "provisioned" }
}
```

Server bounds are $0.10–$100 per trade, $0.10–$500 per UTC day, 1–100% scale, and 10–500 bps slippage. `maxTradeUsd` cannot exceed `maxDailyUsd`.

For live mode add:

```json
{
  "mode": "live",
  "riskAcknowledgement": "I understand copy trading can lose money"
}
```

Do not add `price`, `priceUsd`, `payTo`, `payer`, `network`, or `expiresAt`; they are rejected as attempted authority overrides.

## 4. Pay through Bankr x402

Show the user the exact offer from step 1 and state that it is a 30-day monitoring entitlement with no profitability guarantee. Then call:

```bash
bankr x402 call https://hivemindos-copy-trading-gateway.hivemindos.workers.dev/v1/subscriptions \
  -X POST \
  --max-payment 5 \
  --raw \
  -d '<SUBSCRIPTION_JSON>'
```

Do not use `--yes` unless the user explicitly approved the exact current charge. The CLI's `--max-payment` is a safety ceiling, not the price authority.

Capture the raw JSON privately. Never paste it into chat. It contains:

- `subscriptionId`
- `accessToken`
- `manageUrl`
- the Bankr execution wallet address and funding instructions

Store the access token encrypted in the HivemindOS local subscription vault, or in owner-private storage with file mode `600`. Never commit it or place it in a skill/reference file. The Bankr API key is encrypted by the hosted Worker and is not returned in the paid response.

## 5. Verify

Use the `manageUrl` with `Authorization: Bearer <accessToken>` and verify:

- status is `active`
- target and Bankr execution wallet match
- `executionProvider` is `bankr-managed`
- mode and every risk cap match
- today's usage starts at zero

The monitor's first poll only establishes a cursor. It will not copy older trades.

In paper mode, a new managed event should move directly to a `paper` receipt without a transaction. Live mode remains unavailable until the hosted health response says `liveEnabled: true`.

## Renewal

Read the private subscription file and include both `renewSubscriptionId` and `renewAccessToken` in the normal paid body. Use the same target Durable Object and normal x402 call. Renewal extends from the later of current expiry or now and preserves the existing credentials.

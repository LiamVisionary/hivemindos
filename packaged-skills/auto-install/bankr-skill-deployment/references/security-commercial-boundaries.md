# Security and Commercial Boundaries

Read this before any deployment that can trade, transfer, charge, grant paid access, or store credentials.

## Credential scopes are separate

| Store | Intended use | What may be shown |
| --- | --- | --- |
| HivemindOS Shared Hive Env | Local/fleet-wide user or provider credentials used by HivemindOS | Variable names and set/missing status only |
| Bankr agent Env Vars | Per-wallet secrets used by installed skills and Bankr agent tools | Names only after saving |
| Bankr x402 Env Vars | Per-service secrets used by x402 handlers | Names only after saving |
| External backend secret store | Hosted encrypted execution credentials and server policy secrets | Opaque credential ID/status only |

Do not silently copy values between stores. A HivemindOS UI may let the user select an existing Shared Hive Env name, but the browser must not receive the secret value. If a Bankr-installed skill needs the same capability, the user must save an appropriate variable in Bankr's separate Env Vars scope unless a documented secure broker performs that transfer.

Never read, print, summarize, log, or commit a secret value. Revoke a key immediately if it appears in chat, source, logs, or a screenshot.

## Existing Bankr wallet first

For a user who already has Bankr:

1. Use the existing Bankr account/wallet.
2. Create a dedicated restricted API key for the automation.
3. Enable Wallet API for deterministic wallet writes or Agent API only when agent reasoning/install jobs are required.
4. Disable read-only only for a key that genuinely needs writes.
5. Restrict IPs and recipients where the selected endpoint enforces them.
6. Fund only the Bankr execution wallet, with only the amount the automation needs.

Do not create a second HivemindOS custody wallet merely to route trades if Bankr can execute directly from the user's Bankr wallet. Do not promise a recovery phrase or export for a Bankr embedded wallet. Partner-provisioned Bankr wallets are a separate integration and must remain unavailable until the partner credential, terms, and API contract are confirmed.

## HivemindOS credential UI contract

When HivemindOS needs a Bankr credential:

- Present a guided wizard one step at a time.
- Preselect an existing suitable Shared Hive Env variable when available.
- The selector opens a searchable list of names, never values.
- A segmented pencil action switches from existing-variable selection to a new secret input.
- Existing selected variable: primary action says **Continue**.
- New variable: primary action says **Save**.
- Saving may perform a supported capability verification before the on-save callback continues.
- Keep the row compact and join segmented controls with a flat shared edge.

These are product integration rules, not a Bankr platform requirement.

## Wallet execution safety

Prefer direct Wallet API calls when the exact operation is known. Current Bankr access controls differ by endpoint:

- Reads still enforce IP allowlists.
- Writes require Wallet API enabled and a non-read-only key.
- Transfer recipients can be allowlisted.
- Swap output returns to the caller wallet and does not use the transfer recipient allowlist in the same way.
- Raw sign/submit paths may be blocked when Bankr cannot validate recipients.

Treat a returned transaction hash as a claim to verify. Before marking an operation complete, verify through an independent chain/RPC path:

- expected chain and successful receipt;
- expected sender and recipient;
- expected token contract and decimals;
- exact or bounded amount;
- transaction purpose and correlation/idempotency key;
- no earlier receipt already settled the same logical action.

Write an `executing` or equivalent claim record before calling Bankr. If submission or verification becomes ambiguous, pause the workflow and require review. Never retry blindly.

## Server-authoritative commerce

For official hosted HivemindOS services, the client is not a commercial authority. The hosted backend owns:

- price and fee calculation;
- revenue recipient;
- network and token;
- eligibility and entitlement;
- payment/transaction verification;
- replay window and idempotency;
- audit receipt.

Ignore client-supplied overrides even when they resemble the current policy. Shared Hive Env is for user/provider credentials, not for redirecting official revenue.

Choose the payment rail that matches the economic event:

- Request-time paid API: x402 is natural; the caller's Bankr wallet pays the endpoint.
- Successful-trade fee: calculate it server-side only after independently verified execution, then use an authorized direct wallet transfer and independently verify that transfer.
- Subscription: use only when recurring access itself is the product. Do not add upfront payment merely because x402 exists.

For a copied trade, a correct sequence is:

```text
claim event -> execute bounded swap -> independently verify swap
            -> calculate server fee -> transfer fee -> independently verify fee
```

Paper, skipped, and failed trades should not be described as billable successful trades unless the published policy explicitly says otherwise.

## User tasks versus company tasks

An agent's organizational membership is not enough to apply company spend restrictions. Require a validated active company task context before company wallet, budget, approval, or recipient policy applies. User-owned Bankr wallets and ordinary in-app copy trading remain governed by their own explicit risk and spend limits.

## Profitability language

Never infer profitability from:

- deployment success;
- a working Bankr skill;
- a successful paper event;
- a backtest;
- one or several successful transactions;
- gross return before fees, slippage, gas, taxes, and adverse selection.

State what the evidence supports. A system can be operationally correct and economically unprofitable.

# Wallets, Tokens, Honey, HIVE, And x402

Wallets give agents controlled money rails.

They can hold capped budgets, token balances, prepaid inference deposits, and paid-request paths. Honey and HIVE sit on top as optional reward and compute loops.

For the ecosystem-level plan behind Honey, HIVE, premium services, treasury reserves, and buybacks, see [Honey, HIVE, And Treasury](../monetization/honey-hive-treasury.html).

<figure class="imagePlate">
  <img src="../assets/img/diagrams/wallet-token-rails.jpg" alt="Generated wallet and token rails infographic with separate lanes for x402 paid APIs, UsePod prepaid runtime deposits, and Honey to Bankr HIVE claims.">
  <figcaption>Wallets, UsePod prepaid runtime deposits, and Honey/Bankr HIVE claims are separate rails. They have different trust and funding rules.</figcaption>
</figure>

## How It Works

- Wallet services live in `src/lib/services/wallet`.
- The unified crypto capability router lives in `src/lib/services/crypto-capability-router.ts`.
- Local wallet vault: `~/.hivemindos/wallet-vault.json`, encrypted by `~/.hivemindos/wallet-vault.key` or `HIVEMINDOS_WALLET_VAULT_KEY`.
- Wallet records can be mirrored into the shared vault through `src/lib/services/obsidian/wallet-ledger.ts`.
- Crypto rail readiness and routing are exposed through `/api/crypto/capabilities`.
- Base and Solana wallet creation and balance reads are exposed through `/api/wallet/create`, `/api/wallet/balance`, and `/api/wallet/send`.
- Local Honey ledger/cache is in `src/lib/services/wallet/honey-ledger.ts`.
- Wallet-vault backup and restore logic is in `src/lib/services/wallet/wallet-vault-backup.ts`.
- MoneyClaw account checks live in `src/lib/services/wallet/moneyclaw-client.ts`.
- Official Honey ledger worker lives in `workers/honey-ledger`.
- Reward compute gateway lives in `workers/compute-gateway`.
- Managed-agent billing lives in `src/lib/services/managed-agent-billing.ts` and `/api/managed-agent/billing`.

## What Wallets Can Do

- Create Base and Solana wallet secrets for agent-scoped token rails.
- Read native/token balances.
- Send USDC where configured, capped, and approved.
- Store, recover, and explicitly export local wallet secrets.
- Validate MoneyClaw keys.
- Track UsePod prepaid token deposit details and runtime balance/route metadata when UsePod returns it.
- Execute x402 paid requests through policy-aware helpers.
- Select and prepare the best available crypto rail for agent intents such as paid API calls, private transfers, Bankr trading, and LLM credit funding.
- Observe runtime usage and submit privacy-safe Honey metadata.
- Hold spend-only managed HONEY credits for no-BYOK managed agents.
- Exchange Honey for ledger HIVE, return legacy ledger HIVE back to Honey, or claim Bankr HIVE to a Base receiving address when the Bankr treasury rail is configured.

## Managed HONEY Credits

Managed agents use HONEY as the visible credit unit, but the ledger keeps two separate buckets:

- Reward Honey: earned from trusted or observed contribution usage and claimable to HIVE when the reward treasury is configured.
- Managed HONEY credits: funded service credits for HivemindOS-managed agents. These are spend-only and are not claimable to HIVE.

This prevents a funding/cash-out loop while still giving users one simple credit language.

The no-API-key flow is:

1. The app quotes a managed run through `/api/managed-agent/billing` using a server-side pricing matrix and markup.
2. The user funds managed HONEY through a verified rail such as Stripe Checkout, Stripe crypto payments, x402, Bankr, an agent wallet, or HIVE.
3. Funding credits are written only after provider-side settlement proof, such as a verified Stripe webhook.
4. Managed compute uses HivemindOS-held provider keys server-side.
5. The trusted runtime submits a signed debit to the Honey ledger based on verified usage.

The official ledger rejects browser-spoofed credits. `/managed-billing/events` in `workers/honey-ledger` requires either a HONEY billing HMAC signature or the operator admin token, dedupes idempotency keys, and refuses debits when the managed HONEY balance is insufficient.

## Crypto Capability Router

Agents should start with `/api/crypto/capabilities` when they need a money rail but do not need to force a provider. The router reports readiness for Bankr, x402, Veil Cash, MoneyClaw, and UsePod, then maps a natural intent to the best configured rail.

Supported intents:

- `status`
- `portfolio`
- `receive`
- `send`
- `private-transfer`
- `paid-api`
- `private-paid-api`
- `trade`
- `card-payment`
- `fund-llm-credits`

The router has three modes:

- `status`: return a capability map and provider readiness.
- `select`: choose a provider for an intent without side effects.
- `prepare`: return the existing provider endpoint, draft request body, missing readiness, approval requirement, and confirmation label.

It does not execute spending. Execution remains with the existing gated routes such as `/api/wallet/x402`, `/api/wallet/veil/x402`, `/api/wallet/veil/transfer`, `/api/wallet/send`, `/api/wallet/moneyclaw`, `/api/usepod/status`, `/api/usepod/deposit-transaction`, and `/api/bankr/llm-credits`, or with the Bankr skill/CLI for trades.

For external agents, setup also installs the `hivemind-mcp` stdio server. Its crypto tools proxy this same dashboard API:

- `crypto_capabilities`
- `select_crypto_rail`
- `prepare_crypto_action`

The dashboard app must be running for these API and MCP tools to work. An agent can use them from Codex, Claude, Hermes, or another runtime without the user actively chatting in the dashboard, but the local HivemindOS API still needs to be reachable and authenticated. If HivemindOS is not running, this router is not a standalone wallet daemon; agents should only use provider-specific CLIs or skills that are independently available.

Credential readiness is reported by key name and status only. The router must not print, store in notes, or return private keys, seed phrases, API keys, card details, wallet secrets, or raw env values. The separate wallet export action is an explicit user-initiated download path, not a capability-router behavior.

## Wallet And Token Rails

The Wallets tab treats each agent wallet as a set of payment rails:

- Local Base or Solana wallets hold capped test funds for direct sends and x402 requests.
- USDC sends enforce each agent's max-payment policy before signing.
- MoneyClaw keys can be saved per agent or shared across agents after the API key is validated.
- UsePod agents show a prepaid rail with deposit address, last balance, last route, model count, and test status from the runtime metadata.
- x402 requests use the local wallet policy, max-payment cap, and explicit confirmation text for risky sends.

Token-facing surfaces:

- Base and Solana addresses are treated as operational agent wallets, not user custody wallets.
- UsePod deposit addresses are shown as prepaid inference token rails when the selected agent uses the UsePod provider.
- Honey is tracked as usage-earned accounting. HIVE can be a ledger-only legacy balance or an actual Bankr transfer when the claim path is configured.
- x402 uses token/payment policy around requests instead of giving runtimes unrestricted wallet access.

## Wallet Vault Backup

HivemindOS stores local wallet key material under `~/.hivemindos/wallet-vault.json`, encrypted by `~/.hivemindos/wallet-vault.key` unless `HIVEMINDOS_WALLET_VAULT_KEY` is configured. The backup route keeps that local, but still recoverable:

- `GET /api/wallet/vault-backup` reports whether the vault, key material, encrypted backup, GPG, and recipient are available.
- `POST /api/wallet/vault-backup` refreshes or restores the encrypted backup.
- Backup placement prefers `HIVE_WALLET_VAULT_BACKUP_DIR`, then `HIVE_ENV_BACKUP_DIR`, then the configured secure notes folder.
- Recipients can come from `HIVE_WALLET_GPG_RECIPIENT`, `HIVE_ENV_GPG_RECIPIENT`, or public-key files in the secure folder.
- Restore requires local GPG and a supported backup format. The route does not silently invent missing key material.
- The backup file, normally `hive.wallet-vault.gpg`, contains the encrypted wallet vault plus the matching vault key material so user and agent wallets can be restored together on another trusted machine.
- The adjacent `hive.wallet-vault.md` note is metadata only; it lists wallet ids, addresses, networks, and backup paths, not plaintext wallet secrets.

## Wallet Secret Export

Wallet export is available for local-custody user wallets and agent wallets from the Wallets screen. Export requires dashboard authentication and the confirmation phrase `EXPORT_WALLET_SECRET`, then downloads a local text file instead of rendering the secret in the dashboard.

- `POST /api/wallet/export` returns the selected local wallet secret only after the explicit confirmation phrase.
- Recovery-phrase imports export the stored recovery phrase where HivemindOS still has that phrase; derived Solana records export their derived private key because that is the stored spendable secret.
- View-only browser/public-address wallets do not have local secrets and cannot be exported.

## Honey Paths

Reward pool math:

- Bankr Doppler launches use a 1.2% swap fee.
- The creator receives 57% of that fee.
- HivemindOS allocates 5% of the creator share to the official Honey/HIVE reward pool.
- The pool therefore receives at most 0.0342% of trading volume value, and Honey grants are clipped by remaining pool capacity.

Local observation:

- The dashboard reads supported runtime usage.
- It submits capped metadata without prompts, responses, files, wallet keys, local paths, machine names, or Tailnet IPs.

Trusted reward compute:

- `workers/compute-gateway` exposes an OpenAI-compatible endpoint.
- Requests are forwarded through Bankr/OpenRouter-compatible routing.
- Provider usage is read server-side.
- Receipts are signed and submitted to `workers/honey-ledger`.

Claiming:

- `POST /api/honey-ledger` with `action: "observe"` samples supported runtime usage and records Honey once per event.
- `action: "claim-bankr-hive"` transfers claimable HIVE through Bankr when `HIVE_TOKEN_ADDRESS` and `HONEY_REWARD_BANKR_API_KEY` are configured.
- `action: "return-hive-to-honey"` moves old ledger-only HIVE balances back to Honey so the visible claim rail stays honest.

## Main Code Paths

- `src/lib/services/wallet/**`
- `src/lib/services/crypto-capability-router.ts`
- `src/lib/services/shared-hive-env.ts`
- `src/app/api/crypto/capabilities/route.ts`
- `src/lib/services/obsidian/wallet-ledger.ts`
- `src/app/api/wallet/vault-backup/route.ts`
- `src/app/api/wallet/moneyclaw/route.ts`
- `src/app/api/wallet/**`
- `scripts/hivemind-mcp`
- `src/app/api/honey-ledger/route.ts`
- `src/app/api/runtime-usage/route.ts`
- `src/features/dashboard/hooks/use-wallet-files-controller.tsx`
- `src/components/wallet/**`
- `workers/honey-ledger`
- `workers/compute-gateway`

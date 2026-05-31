# Wallets, Tokens, Honey, HIVE, And x402

Wallets let agents hold controlled budgets, token balances, prepaid inference deposits, and paid-request rails. Honey and HIVE provide optional reward and compute loops on top of those wallet/token surfaces.

<figure class="imagePlate">
  <img src="../assets/img/diagrams/wallet-token-rails.jpg" alt="Generated wallet and token rails infographic with separate lanes for x402 paid APIs, UsePod prepaid runtime deposits, and Honey to Bankr HIVE claims.">
  <figcaption>Wallets, UsePod prepaid runtime deposits, and Honey/Bankr HIVE claims are separate rails with different trust and funding semantics.</figcaption>
</figure>

## How It Works

- Wallet services live in `src/lib/services/wallet`.
- Local wallet vault: `~/.hivemindos/wallet-vault`.
- Wallet records can be mirrored into the shared vault through `src/lib/services/obsidian/wallet-ledger.ts`.
- Base and Solana wallet creation and balance reads are exposed through `/api/wallet/create`, `/api/wallet/balance`, and `/api/wallet/send`.
- Local Honey ledger/cache is in `src/lib/services/wallet/honey-ledger.ts`.
- Wallet-vault backup and restore logic is in `src/lib/services/wallet/wallet-vault-backup.ts`.
- MoneyClaw account checks live in `src/lib/services/wallet/moneyclaw-client.ts`.
- Official Honey ledger worker lives in `workers/honey-ledger`.
- Reward compute gateway lives in `workers/compute-gateway`.

## Capabilities

- Create Base and Solana wallet secrets for agent-scoped token rails.
- Read native/token balances.
- Send USDC where configured, capped, and approved.
- Store and recover wallet backup status.
- Validate MoneyClaw keys.
- Track UsePod prepaid token deposit details and runtime balance/route metadata when UsePod returns it.
- Execute x402 paid requests through policy-aware helpers.
- Observe runtime usage and submit privacy-safe Honey metadata.
- Exchange Honey for ledger HIVE, return legacy ledger HIVE back to Honey, or claim Bankr HIVE to a Base receiving address when the Bankr treasury rail is configured.

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
- Honey is tracked as usage-earned accounting; HIVE can be ledger-only legacy balance or an actual Bankr transfer when the claim path is configured.
- x402 uses token/payment policy around requests instead of giving runtimes unrestricted wallet access.

## Wallet Vault Backup

HivemindOS stores local wallet key material under `~/.hivemindos/wallet-vault`. The backup route keeps that local-first but recoverable:

- `GET /api/wallet/vault-backup` reports whether the vault, key material, encrypted backup, GPG, and recipient are available.
- `POST /api/wallet/vault-backup` refreshes or restores the encrypted backup.
- Backup placement prefers `HIVE_WALLET_VAULT_BACKUP_DIR`, then `HIVE_ENV_BACKUP_DIR`, then the configured secure notes folder.
- Recipients can come from `HIVE_WALLET_GPG_RECIPIENT`, `HIVE_ENV_GPG_RECIPIENT`, or public-key files in the secure folder.
- Restore requires local GPG and a supported backup format; the route does not silently invent missing key material.

## Honey Paths

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
- `src/lib/services/obsidian/wallet-ledger.ts`
- `src/app/api/wallet/vault-backup/route.ts`
- `src/app/api/wallet/moneyclaw/route.ts`
- `src/app/api/wallet/**`
- `src/app/api/honey-ledger/route.ts`
- `src/app/api/runtime-usage/route.ts`
- `src/features/dashboard/hooks/use-wallet-files-controller.tsx`
- `src/components/wallet/**`
- `workers/honey-ledger`
- `workers/compute-gateway`

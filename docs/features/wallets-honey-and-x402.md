# Wallets, Honey, HIVE, And x402

Wallets let agents hold controlled budgets and use payment rails. Honey and HIVE provide optional reward and compute loops.

## How It Works

- Wallet services live in `src/lib/services/wallet`.
- Local wallet vault: `~/.hivemindos/wallet-vault`.
- Wallet records can be mirrored into the shared vault through `src/lib/services/obsidian/wallet-ledger.ts`.
- Local Honey ledger/cache is in `src/lib/services/wallet/honey-ledger.ts`.
- Official Honey ledger worker lives in `workers/honey-ledger`.
- Reward compute gateway lives in `workers/compute-gateway`.

## Capabilities

- Create Base and Solana wallet secrets.
- Read balances.
- Send USDC where configured and approved.
- Store and recover wallet backup status.
- Validate MoneyClaw keys.
- Track UsePod prepaid token deposit details and runtime balance/route metadata when UsePod returns it.
- Execute x402 paid requests through policy-aware helpers.
- Observe runtime usage and submit privacy-safe Honey metadata.
- Exchange Honey for HIVE through the configured ledger.

## Honey Paths

Local observation:

- The dashboard reads supported runtime usage.
- It submits capped metadata without prompts, responses, files, wallet keys, local paths, machine names, or Tailnet IPs.

Trusted reward compute:

- `workers/compute-gateway` exposes an OpenAI-compatible endpoint.
- Requests are forwarded through Bankr/OpenRouter-compatible routing.
- Provider usage is read server-side.
- Receipts are signed and submitted to `workers/honey-ledger`.

## Main Code Paths

- `src/lib/services/wallet/**`
- `src/lib/services/obsidian/wallet-ledger.ts`
- `src/app/api/wallet/**`
- `src/app/api/honey-ledger/route.ts`
- `src/app/api/runtime-usage/route.ts`
- `src/features/dashboard/hooks/use-wallet-files-controller.tsx`
- `src/components/wallet/**`
- `workers/honey-ledger`
- `workers/compute-gateway`

---
title: "Wallets, Tokens, Honey, HIVE, And x402"
---

# Wallets, Tokens, Honey, HIVE, And x402

Wallets give agents controlled money rails.

They can hold capped budgets, token balances, prepaid inference deposits, and paid-request paths. Honey and HIVE sit on top as optional reward and compute loops.

For the ecosystem-level plan behind Honey, HIVE, premium services, treasury reserves, and buybacks, see [Honey, HIVE, And Treasury](../../for-investors/honey-hive-treasury.html).

<figure class="imagePlate">
  <img src="../../assets/img/diagrams/wallet-token-rails.jpg" alt="Generated wallet and token rails infographic with separate lanes for x402 paid APIs, UsePod prepaid runtime deposits, and Honey to Bankr HIVE claims.">
  <figcaption>Wallets, UsePod prepaid runtime deposits, and Honey/Bankr HIVE claims are separate rails. They have different trust and funding rules.</figcaption>
</figure>

## How It Works

- Wallet services live in `src/lib/services/wallet`.
- The unified crypto capability router lives in `src/lib/services/crypto-capability-router.ts`.
- Local wallet vault: `~/.hivemindos/wallet-vault.json`, encrypted by `~/.hivemindos/wallet-vault.key` or `HIVEMINDOS_WALLET_VAULT_KEY`.
- Wallet records can be mirrored into the shared vault through `src/lib/services/obsidian/wallet-ledger.ts`.
- Crypto rail readiness and routing are exposed through `/api/crypto/capabilities`.
- Clear-signing reviews are exposed through `/api/crypto/clear-signing`.
- Local agent identity/listing records are exposed through `/api/crypto/agent-identity`.
- Crypto control reviews are exposed through `/api/crypto/risk-monitor`.
- Base, Robinhood Chain, and Solana wallet creation and balance reads are exposed through `/api/wallet/create`, `/api/wallet/balance`, and `/api/wallet/send`.
- Local Honey ledger/cache is in `src/lib/services/wallet/honey-ledger.ts`.
- Wallet-vault backup and restore logic is in `src/lib/services/wallet/wallet-vault-backup.ts`.
- MoneyClaw account checks live in `src/lib/services/wallet/moneyclaw-client.ts`.
- Official Honey ledger source lives in HivemindOS-controlled hosted-service infrastructure.
- Reward compute gateway source lives in HivemindOS-controlled hosted-service infrastructure.
- Managed-agent billing lives in `src/lib/services/managed-agent-billing.ts` and `/api/managed-agent/billing`.

## What Wallets Can Do

- Create Base, Robinhood Chain, and Solana wallet secrets for agent-scoped token rails.
- Read native/token balances.
- Send the wallet's dollar stablecoin where configured, capped, and approved: USDC on Base/Solana, or USDG on Robinhood Chain.
- Store, recover, and explicitly export local wallet secrets.
- Validate MoneyClaw keys.
- Track UsePod prepaid token deposit details and runtime balance/route metadata when UsePod returns it.
- Spend hosted HivemindOS credits on managed UsePod inference when an official hosted gateway is configured. The gateway holds the UsePod payer token server-side, preserves streaming responses, charges upstream UsePod spend plus the configured HivemindOS platform fee, and refunds any unused per-request reservation.
- Spend hosted HivemindOS credits on managed Nansen research when no `NANSEN_API_KEY` is configured. The official gateway holds the Nansen key server-side, charges the user's hosted credits, records a receipt, and returns a derived brief.
- Execute x402 paid requests through policy-aware helpers.
- Buy stocks from a prompt through Alpaca (a real brokerage, paper by default), on-chain tokenized xStocks (a USDC to xStock swap via Jupiter), or eligible Robinhood Chain Stock Tokens (a USDG swap through 0x on Robinhood Chain).
- Select and prepare the best available crypto rail for agent intents such as paid API calls, private transfers, Bankr trading, and LLM credit funding.
- Prepare crosschain swap, bridge, and payment intents through the same router, with Bankr as the active provider path and direct LI.FI/Open Intents adapters reserved as explicit future provider slots.
- Generate clear-signing reviews that show the action kind, endpoint, recipient, network, amount, cap, confirmation phrase, and blocking risks before execution.
- Register local agent identity records with wallet, ENS/ERC-8004 metadata, service endpoint, x402 endpoint, capabilities, and proofs.
- Run offline crypto risk checks over wallet policy, agent identity, required env-key presence, endpoint exposure, repo controls, DNS controls, and multisig posture.
- Observe runtime usage and submit privacy-safe Honey metadata.
- Hold spend-only managed HONEY credits for no-BYOK managed agents.
- Exchange Honey for ledger HIVE, return legacy ledger HIVE back to Honey, or claim Bankr HIVE to a Base receiving address when the Bankr treasury rail is configured.

## Managed HONEY Credits

Managed agents use HONEY as the visible credit unit, but the ledger keeps two separate buckets:

- Reward Honey: earned from trusted or observed contribution usage and claimable to HIVE when the reward treasury is configured.
- Managed HONEY credits: funded service credits for HivemindOS-managed agents. These are spend-only and are not claimable to HIVE.

This prevents a funding/cash-out loop while still giving users one simple credit language.

The current hosted paid agent default is **$0.001 per successful hosted chat completion**. That means:

| Usage | Cost |
| ---: | ---: |
| `1,000` messages | `$1` |
| `100,000` messages | `$100` |
| `1,000,000` messages | `$1,000` |

The no-API-key flow is:

1. The app quotes a managed run through `/api/managed-agent/billing` using a server-side pricing matrix and markup.
2. The user funds managed HONEY through a verified rail such as Stripe Checkout, Stripe crypto payments, x402, Bankr, an agent wallet, or HIVE.
3. Funding credits are written only after provider-side settlement proof, such as a verified Stripe webhook.
4. Managed compute uses HivemindOS-held provider keys server-side.
5. The trusted runtime submits a signed debit to the Honey ledger based on verified usage.

The official ledger rejects browser-spoofed credits. Its `/managed-billing/events` endpoint requires either a HONEY billing HMAC signature or the operator admin token, dedupes idempotency keys, and refuses debits when the managed HONEY balance is insufficient.

## Paid Agent x402 Gateway

HivemindOS can expose a curated agent as an OpenAI-compatible paid endpoint. For official monetized agents, this endpoint should run on HivemindOS-controlled hosted infrastructure, not inside the downloaded desktop app.

The current official default hosted paid agent charges **$0.001 per successful chat completion**. Self-hosted sellers can set their own `priceUsd`, but official HivemindOS pricing comes from the hosted endpoint, not from a local app setting.

- Downloaded apps should call `GET /api/official-paid-agents/<slug>/chat/completions` for official hosted-agent readiness and `POST /api/official-paid-agents/<slug>/chat/completions` for paid calls. This local route is only a buyer/proxy path to HivemindOS-hosted infrastructure.
- Self-hosted sellers can expose `GET /api/paid-agents/<slug>/chat/completions` for non-secret readiness, price, runtime, provider, model, and supported runtime/provider matrices.
- Self-hosted sellers can expose `POST /api/paid-agents/<slug>/chat/completions` as an OpenAI-style chat completion body that requires x402 payment before it calls the internal `/api/chat/agent-runtime` route.
- Successful calls settle x402 after the agent response is produced, return a `PAYMENT-RESPONSE` header, and append a local paid-agent receipt for operator accounting.
- Stream requests are accepted, but the gateway settles first and then returns a single completed Server-Sent Events response. This keeps settlement atomic for paid calls.

Official downloaded-app setup is intentionally light. Configure only the hosted base URL:

- `HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL=<https-hivemindos-hosted-base-url>`

The packaged default is the official Cloudflare Worker at `https://hivemindos-paid-agent-gateway.hivemindos.workers.dev`, so most downloaded apps do not need local configuration. The env variable is an override for staging, enterprise, or self-hosted official-compatible deployments.

The official client route requires a public HTTPS base URL by default and forwards only safe request metadata plus x402 payment/idempotency headers. It does not contain the official `payTo`, facilitator credentials, model provider keys, or HONEY/HIVE entitlement logic.

The official hosted paid-agent gateway exposes the same hosted seller route (`/api/paid-agents/<slug>/chat/completions`), verifies and settles x402 at the edge, writes receipt metadata, and forwards paid OpenAI-compatible chat bodies to a trusted upstream runtime URL. The downloaded app should point `HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL` at that hosted URL.

Base Builder Code attribution is optional for x402 calls on Base mainnet. Set a Builder Code only on the authoritative caller or seller infrastructure that should receive attribution:

- `HIVEMINDOS_X402_CLIENT_BUILDER_CODE=<base-builder-code>` adds client-side `s` attribution to compatible `/api/wallet/x402` payments made from the local wallet on `eip155:8453`.
- `HIVEMINDOS_PAID_AGENT_BUILDER_CODE=<base-builder-code>` adds seller-side `a` attribution to paid-agent 402 requirements on `eip155:8453`, including the hosted Worker.
- `HIVEMINDOS_X402_BUILDER_CODE=<base-builder-code>` is a shared fallback for deployments that intentionally want one code for both roles.

Builder Codes must be lowercase letters, digits, or underscores, 1-32 characters. They are public attribution identifiers, not secrets. The app ignores them on non-Base-mainnet networks.

Mainnet paid-agent revenue also needs a mainnet-capable facilitator. Paid-agent gateways default to Base mainnet with the CDP facilitator at `https://api.cdp.coinbase.com/platform/v2/x402` and require `CDP_API_KEY_ID` plus `CDP_API_KEY_SECRET`. Testnet mode is disabled by default; set `HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true` to opt into Base Sepolia with `https://x402.org/facilitator` for development. The CDP path uses `@coinbase/x402` to generate request-specific facilitator JWT auth headers.

Production setup is fail-closed. For a hosted or self-hosted seller gateway, configure:

- `HIVEMINDOS_PAID_AGENT_GATEWAY_ENABLED=true`
- `HIVEMINDOS_PAID_AGENT_SELLER_MODE=self-hosted`
- `HIVEMINDOS_PAID_AGENT_PAY_TO=<recipient-address>`
- Optional: `HIVEMINDOS_PAID_AGENT_TESTNET_MODE=true` for Base Sepolia development; leave unset or `false` for production Base mainnet
- Optional: `HIVEMINDOS_PAID_AGENT_FACILITATOR_URL=<x402-facilitator-url>` only when overriding the default CDP or testnet facilitator
- `CDP_API_KEY_ID=<cdp-api-key-id>` and `CDP_API_KEY_SECRET=<cdp-api-key-secret>` for the CDP facilitator
- `HIVEMINDOS_PAID_AGENT_FACILITATOR_BEARER=<facilitator-bearer>` for non-CDP facilitators that use a static bearer token
- `HIVEMINDOS_PAID_AGENT_PRICE_USD=<price-per-call>`
- Optional: `HIVEMINDOS_PAID_AGENT_BUILDER_CODE=<base-builder-code>`
- `HIVEMINDOS_PAID_AGENT_PROFILE_JSON=<json>` or `HIVEMINDOS_PAID_AGENT_PROFILE_PATH=<path-to-exported-profile>`

For multiple products, use `HIVEMINDOS_PAID_AGENT_CATALOG_JSON` or `HIVEMINDOS_PAID_AGENT_CATALOG_PATH` with entries containing `slug`, `description`, `priceUsd`, `payTo`, `facilitatorUrl`, optional `builderCode`, and a curated `agent` profile. The route never exposes provider tokens or wallet secrets.

Do not package an official `payTo` address into the downloadable app as the source of truth. A local app install is controlled by the user: they can edit env, config, app bundles, and local routes. If official revenue or feature access depends on the payment, the app must call a hosted HivemindOS resource server, or a HivemindOS backend must verify the x402 settlement against the expected official `payTo`, network, amount, and resource before granting server-side value. Local `self-hosted` seller mode is for operators who intentionally want to sell their own agent endpoint and receive payment to their own address.

If a user changes `HIVEMINDOS_OFFICIAL_PAID_AGENT_BASE_URL`, they are changing which hosted service their app talks to; that must not grant official HivemindOS cloud entitlement by itself. Official entitlements, quotas, receipts, HONEY credits, HIVE funding credits, and enterprise usage state must be issued by HivemindOS-controlled backend services after verified settlement.

Optional accounting:

- `HIVEMINDOS_PAID_AGENT_REWARD_HONEY_ENABLED=true` lets the trusted runtime submit reward-Honey usage observations for the agent's response.
- `HIVEMINDOS_PAID_AGENT_MIRROR_MANAGED_HONEY=true` mirrors each settled x402 call into managed HONEY as an equal credit/debit pair for operator reporting.
- HIVE can fund Bankr LLM credits or managed HONEY through the managed-agent billing rail; x402 remains the external per-call charge.

## Wallet-Paid HivemindOS Models

The model picker includes `HivemindOS Models` for users who want managed model calls without bringing provider API keys. It is a wallet-paid provider:

- The selected agent's persisted local x402 wallet pays each official hosted model call.
- The current official hosted default is **$0.001 per successful chat completion**.
- The app uses the same wallet Spend, max-payment, auto-use, network, and governance policy as other x402 paid requests.
- The local route is `POST /api/hivemindos/models/chat/completions`, with model ids `hivemindos/auto`, `hivemindos/fast`, `hivemindos/frontier`, and `hivemindos/research`.
- The route pays the official hosted paid-agent resource through `/api/official-paid-agents/<slug>/chat/completions`, then returns an OpenAI-compatible `chat.completion` response to the normal chat streamer.
- Users do not provide a model API key, provider key, or `payTo` address for official HivemindOS Models.

Optional staging, enterprise, or self-hosted official-compatible deployments can set `HIVEMINDOS_WALLET_PAID_MODEL_AGENT_SLUG=<slug>` to choose which hosted paid-agent product slug backs the picker. The slug selects a hosted resource; it does not define the recipient or price inside the downloaded app.

This is still a server-authoritative commercial flow. The downloaded app loads the user's encrypted local wallet only to sign the x402 payment under that wallet's policy. Official price, recipient, payment requirements, settlement, receipts, quotas, provider keys, and upstream model access stay in HivemindOS-controlled hosted infrastructure. A local app setting or request body cannot redirect official HivemindOS model revenue.

For one-click calls, the agent needs a local custody Base/Base Sepolia/Robinhood Chain/Solana wallet with Spend enabled, provider `x402`, enough accepted stablecoin and native gas, and Allow auto-use enabled under the wallet's cap. Personal user wallets do not auto-spend; they still require explicit payment confirmation. Robinhood Chain x402 payments only work when the paid endpoint explicitly accepts `eip155:4663`; otherwise HivemindOS reports that no matching payment option was available.

## Trading Platform Fees

The downloadable app cannot be the authority for official HivemindOS revenue: users can edit local config, patch local routes, or rebuild the app. For the official build, local wallet rails read public fee policy from HivemindOS-hosted infrastructure by default:

- `HIVEMINDOS_PLATFORM_FEE_POLICY_URL=https://hivemindos-paid-agent-gateway.hivemindos.workers.dev/api/platform-fees/config`

That hosted policy returns public terms such as fee basis points, minimum fee, supported rails, and recipient addresses. The current official local-wallet platform fee is **1% with a $0.01 minimum**. When a hosted policy has a recipient for the acting wallet network, supported local-wallet actions quote the fee before confirmation, then collect it as a separate stablecoin transfer after the main action succeeds. Today that includes local stablecoin sends, local DEX swaps, xStocks trades, Robinhood Chain Stock Token trades, live Alpaca stock orders, ordinary public x402 payments, Veil private transfers, and Veil private x402 payments. Fees use USDC on Base/Solana and USDG on Robinhood Chain. Paper trades, read-only checks, and x402 calls where no payment is required do not charge a platform fee. HivemindOS-hosted MiroShark proxy runs are also excluded from the separate local platform-fee transfer because their **$1.20 USDC** x402 price already includes the expected **$0.20** HivemindOS cut. The fee transfer, when one applies, is recorded in wallet activity as a platform-fee item so it remains visible to the user.

Zero Human Company revenue-share events are recorded through `/api/company-revenue` and shown in the company Treasury tab. They use the same visible collection rail, but the default company revenue share is **2% with a $0.01 minimum**. Recording revenue alone updates the company revenue ledger; collecting the HivemindOS share requires explicit confirmation and a selected company agent wallet. External revenue that never reports into HivemindOS, a hosted HivemindOS billing service, or a verifiable settlement rail is not automatically charged by the local app.

Simple examples:

| Action | Amount | Fee |
| --- | ---: | ---: |
| Wallet send, swap, stock, x402, or private payment | `$0.25` | `$0.01` minimum |
| Wallet send, swap, stock, x402, or private payment | `$100` | `$1.00` |
| HivemindOS-hosted MiroShark x402 simulation | `$1.20` | No extra local platform fee; `$0.20` proxy spread is included |
| Recorded Zero Human Company revenue | `$100` | `$2.00` |
| Recorded Zero Human Company revenue | `$1,000` | `$20.00` |

Self-hosted operators can override the hosted policy for their own install by setting `HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED` or local recipient variables. Fee-rate defaults alone keep using the hosted official policy:

- `HIVEMINDOS_TRADING_PLATFORM_FEES_ENABLED=true`
- `HIVEMINDOS_TRADING_PLATFORM_FEE_BPS=100` for a 1% fee
- `HIVEMINDOS_COMPANY_REVENUE_SHARE_BPS=200` for a 2% Zero Human Company revenue share
- `HIVEMINDOS_TRADING_PLATFORM_MIN_FEE_USD=0.01` for a minimum fee
- Optional: `HIVEMINDOS_TRADING_PLATFORM_MAX_FEE_USD=<max-fee>`
- `HIVEMINDOS_PLATFORM_FEE_RECIPIENT_EVM=<evm-address>` for Base and Robinhood Chain wallet sends, EVM DEX swaps, Robinhood Chain Stock Token swaps, live Alpaca fee collection, public x402, and Veil-backed private payments
- `HIVEMINDOS_PLATFORM_FEE_RECIPIENT_SOLANA=<solana-address>` for Solana DEX, xStocks swaps, and Solana x402 payments

Some Trading tab capabilities are not safely fee-able from the local app alone. Bankr actions and MoneyClaw card payments need a hosted/proxy fee path, provider-native partner fee support, or a contract-based settlement layer because the local app does not own a deterministic local-wallet settlement for those rails. Do not present local fee settings as official HivemindOS-wide revenue enforcement: a downloaded app is user-controlled and can be modified. Strong official enforcement must happen in hosted HivemindOS infrastructure or in a verifiable third-party settlement flow that checks recipient, network, amount, resource, and receipt server-side.

Runtime policy:

- Recommended public runtime: `hivemind-os`, because it can route to local OpenAI-compatible models, Bankr LLM, Venice, UsePod, OpenRouter, and Hive Fusion while keeping provider keys server-side.
- Allowed with curated profiles: `hermes` and `openclaw`, when the profile has a safe gateway and no unintended wallet/workspace tools.
- Internal by default: `codex`, `claude-code`, `opencode`, `openhands`, `aider`, `aeon`, and `evo`. Use these as managed HONEY jobs with explicit workspace/task scope rather than public per-call chat.

Shared vault access and agent wallet tools are off unless the paid-agent profile explicitly includes them. Do not place secrets, private wallet material, or local workspace paths in public paid-agent config.

## Crypto Capability Router

Agents should start with `/api/crypto/capabilities` when they need a money rail but do not need to force a provider. The router reports readiness for Bankr, local Hyperliquid, x402, Veil Cash, MoneyClaw, and UsePod, then maps a natural intent to the best configured rail.

Supported intents:

- `status`
- `portfolio`
- `receive`
- `send`
- `private-transfer`
- `paid-api`
- `private-paid-api`
- `trade`
- `crosschain-swap`
- `bridge`
- `crosschain-payment`
- `token-launch`
- `polymarket`
- `hyperliquid`
- `automation`
- `nft`
- `agent-job`
- `card-payment`
- `fund-llm-credits`

The router has three modes:

- `status`: return a capability map and provider readiness.
- `select`: choose a provider for an intent without side effects.
- `prepare`: return the existing provider endpoint, draft request body, missing readiness, approval requirement, confirmation label, clear-signing review, and crosschain plan when relevant.

It does not execute spending. Execution remains with the existing gated routes such as `/api/trading/hyperliquid`, `/api/wallet/x402`, `/api/wallet/veil/x402`, `/api/wallet/veil/transfer`, `/api/wallet/send`, `/api/wallet/moneyclaw`, `/api/usepod/status`, `/api/usepod/deposit-transaction`, and `/api/bankr/llm-credits`, or with the Bankr skill/CLI for provider-mediated trades.

Crosschain support is intent-first:

- `crosschain-swap`, `bridge`, and `crosschain-payment` prepare Bankr action drafts today.
- The crosschain plan returned by `prepare` keeps LI.FI and Open Intents as named provider slots, marked planned until direct adapters and approval gates are added.
- xStocks remain on the existing buy-stock rail because they require the verified Solana token allowlist rather than a generic bridge quote.

Clear signing is a review layer, not a signer:

- `/api/crypto/clear-signing` accepts an x402, send, private-transfer, Bankr action, crosschain intent, identity claim, or raw transaction draft.
- The response includes normalized counterparty, amount, network, cap, risks, side effects, confirmation text, and a fingerprint.
- Blocking risks such as invalid recipient format, cap mismatch, or x402 network mismatch should stop execution before any provider route is called.

Agent identity is local-first:

- `/api/crypto/agent-identity` stores local records under the HivemindOS home store with agent id, display name, handle, wallet address, ENS name, ERC-8004 entity id, service endpoint, x402 endpoint, capabilities, proofs, status, and fingerprint.
- These records make ENS/ERC-8004-style discovery a first-class HivemindOS concept before any onchain marketplace adapter is configured.
- Draft records may be useful internally, but published records should have at least one identity anchor and a service or x402 endpoint.

Risk monitoring is an offline control review:

- `/api/crypto/risk-monitor` evaluates supplied metadata for wallet caps, Veil auto-send caps, identity anchors, required env-key presence by key name only, public endpoint HTTPS, Tailnet exposure posture, repo controls, DNS controls, and multisig controls.
- It returns a score, severity, findings, and recommended actions. It does not scan secrets, print env values, or mutate infrastructure.

For external agents, setup also installs the `hivemind-mcp` stdio server. Its crypto tools proxy this same dashboard API:

- `crypto_capabilities`
- `select_crypto_rail`
- `prepare_crypto_action`
- `review_crypto_action`
- `hyperliquid_trade`
- `agent_crypto_identity`
- `crypto_risk_monitor`

The dashboard app must be running for these API and MCP tools to work. An agent can use them from Codex, Claude, Hermes, or another runtime without the user actively chatting in the dashboard, but the local HivemindOS API still needs to be reachable and authenticated. If HivemindOS is not running, this router is not a standalone wallet daemon; agents should only use provider-specific CLIs or skills that are independently available.

Credential readiness is reported by key name and status only. The router must not print, store in notes, or return private keys, seed phrases, API keys, card details, wallet secrets, or raw env values. The separate wallet export action is an explicit user-initiated download path, not a capability-router behavior.

## Wallet And Token Rails

The Wallets tab treats each agent wallet as a set of payment rails:

- Local Base, Robinhood Chain, or Solana wallets hold capped funds for direct sends, swaps, trades, and x402 requests.
- Stablecoin sends enforce each agent's max-payment policy before signing: USDC on Base/Solana, USDG on Robinhood Chain.
- MoneyClaw keys can be saved per agent or shared across agents after the API key is validated.
- UsePod agents show a prepaid rail with deposit address, last balance, last route, model count, and test status from the runtime metadata.
- x402 requests use the local wallet policy, max-payment cap, and explicit confirmation text for risky sends.
- When `HIVEMINDOS_X402_CLIENT_BUILDER_CODE` is set, compatible Base mainnet x402 endpoints can record the client Builder Code on settlement calldata.

Token-facing surfaces:

- Base, Robinhood Chain, and Solana addresses are treated as operational agent wallets, not user custody wallets.
- Robinhood Chain wallets can hold USDG, WETH, and official Stock Token contracts. Stock Token trades may still be blocked by upstream liquidity, eligibility, or legal restrictions; HivemindOS surfaces that block instead of routing around it.
- UsePod deposit addresses are shown as prepaid inference token rails when the selected agent uses the UsePod provider.
- Honey is tracked as usage-earned accounting. HIVE can be a ledger-only legacy balance or an actual Bankr transfer when the claim path is configured.
- x402 uses token/payment policy around requests instead of giving runtimes unrestricted wallet access.

## Trade Tab

> For the full, dedicated trading reference — every crypto rail, stock venue, agent/MCP access path, and the governance model — see the [Trading docs](../trading/). This section is the wallet-context summary.

The Trade tab is a dedicated action surface for buying, selling, and swapping. It is segmented into **Crypto** and **Stocks** and acts on a selected agent's governed wallet. It complements the Wallets tab, which stays focused on accounts, rails, balances, and governance.

- **Crypto** is capability-first: it reads `/api/crypto/capabilities` to show every supported action (swap/trade, Hyperliquid spot/perps, prediction markets, bridge, token launch, NFT, send, receive, private transfer, paid API, fund LLM credits) with live readiness, lets the user prepare an action to see the clear-signing review, and executes through the same hardened provider endpoints (`/api/trading/hyperliquid`, `/api/bankr/actions`, `/api/wallet/send`, `/api/wallet/x402`, `/api/wallet/veil/*`, and others). The capability router picks the configured provider, so users express intent rather than naming a rail.
- **Stocks** buys and sells through the unified trade rail below.

The tab lives under `src/features/dashboard/views/trade/` and is reachable from the left navigation shelf.

## Hyperliquid Trading

HivemindOS can trade Hyperliquid spot and perpetual futures from a local EVM wallet.
Local Hyperliquid uses the selected wallet's own Hyperliquid account and collateral,
while Bankr-mediated Hyperliquid uses Bankr's connected trading wallet. The app should
always show which source of funds is being used before you confirm.

In the Trade tab, local Hyperliquid supports spot and perp markets; long/short and
buy/sell direction; market, limit, trigger, and TWAP orders; slippage guards;
reduce-only closes; open-order management; leverage and isolated margin controls;
spot/perp transfers; USDC sends; spot sends; withdrawals; status refresh; quotes;
builder-fee approval; and action-specific confirmations.

Official HivemindOS builds charge a small Hyperliquid builder fee on eligible filled local
orders: **0.5 bps (0.005%)** of filled notional. The builder fee is approved separately
from an order, so a wallet that has not approved the current fee cannot trade until the
approval step is complete. After approval, HivemindOS attaches the builder code
automatically to eligible orders; users do not need to find or paste a builder code.

For the full user-facing guide, including fees, funding, liquidation risk, supported
markets, and agent behavior, see [Hyperliquid Trading](../trading/hyperliquid.html).

## Stock Trading (Alpaca And xStocks)

Agents and the Trade tab can buy and sell stocks through one unified trade rail with two venues:

- `alpaca`: a real, regulated US brokerage. Market orders go through the Alpaca Trading API. It defaults to paper (simulated) trading, and live trading is reachable only when the wallet sets `alpacaPaper` to false. Paper and live are SEPARATE Alpaca accounts with SEPARATE credentials, so they load from different shared-hive env names: paper reads `ALPACA_PAPER_API_KEY_ID` / `ALPACA_PAPER_API_SECRET_KEY` (falling back to the live names for backward compatibility), live reads `ALPACA_API_KEY_ID` / `ALPACA_API_SECRET_KEY`. Values are never stored in project files.
- `xstocks`: on-chain tokenized equities issued by Backed Finance. A buy swaps USDC into the verified xStock SPL token through Jupiter; a sell sizes the position from the current USDC price and swaps the xStock back into USDC (both legs ExactIn, which routes reliably for thin tokenized-equity pools where exact-out often has no route). Both are signed by the agent's existing local Solana wallet and require a Solana mainnet wallet plus a little SOL for fees and token-2022 account rent.

How it works:

- The rail lives in `src/lib/services/trading/buy-stock.ts` (`executeStockTrade`/`discoverStockTradeQuote`, with `executeBuyStock` kept as a buy-side wrapper).
- The verified mint allowlist lives in `src/lib/config/xstocks-tokens.ts`. xStock tickers resolve only through this allowlist, never live symbol search, because Solana carries many scam copycats reusing each `AAPLx`-style symbol. Every mint is Jupiter-verified and uses the official `Xs` vanity address prefix.
- Two entry points: the chat runtime handles natural requests such as `buy $25 of AAPL on xstocks` as a draft, confirm, execute card; the Trade tab calls `POST /api/trading` (`action: 'quote' | 'execute' | 'portfolio'`, `side: 'buy' | 'sell'`). The route resolves the acting agent's wallet server-side and never trusts a client-supplied policy. `GET /api/trading` reports per-mode venue readiness (separate `paper` and `live` Alpaca credential state) and trade-ready agents.
- A buy requires `CONFIRM_BUY`, a sell requires `CONFIRM_SELL`. Every trade honors a per-trade USD cap (`maxTradeUsd`, falling back to the per-payment cap). A buy passes the full spend-governance chokepoint (company kill switch, rolling daily/monthly budgets, approval escalation); a sell is an inflow, so only the company kill switch binds and it never debits rolling budgets.
- The Stocks screen has a **Paper-trading toggle** and a **portfolio panel**. The toggle flips the Alpaca account between paper (simulated) and live; paper orders run against `https://paper-api.alpaca.markets` and never buy the real stock. The portfolio panel reads `action: 'portfolio'` (Alpaca `/v2/account` + `/v2/positions`) for the selected mode and shows equity, cash, buying power, and open positions with unrealized P/L. The toggle can only force paper from the client — it can never escalate a paper-only agent to live: the server re-derives the effective mode from the persisted policy, so live is reachable only when the wallet opted in (`alpacaPaper:false`).
- Venue and mode are configured per agent in the Wallets tab: venue (Off, Alpaca, or xStocks), Alpaca paper vs live, and max per trade.

Safety:

- Alpaca defaults to paper. Live is opt-in per wallet, and the Stocks-screen toggle cannot move a paper-only agent to live.
- xStock trades resolve only verified mints and require a Solana mainnet wallet.
- `trade` activity is recorded in the spend ledger like every other rail.

Tests:

- `pnpm test:buy-stock` checks the xStocks allowlist invariants and live Jupiter routability.
- `pnpm e2e:buy-stock-alpaca` runs an Alpaca paper-order round-trip when keys are present.

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

- The official compute gateway exposes an OpenAI-compatible endpoint.
- Requests are forwarded through Bankr/OpenRouter-compatible routing.
- Provider usage is read server-side.
- Receipts are signed and submitted to the official Honey ledger.

Claiming:

- `POST /api/honey-ledger` with `action: "observe"` samples supported runtime usage and records Honey once per event.
- `action: "claim-bankr-hive"` transfers claimable HIVE through Bankr when `HIVE_TOKEN_ADDRESS` and `HONEY_REWARD_BANKR_API_KEY` are configured.
- `action: "return-hive-to-honey"` moves old ledger-only HIVE balances back to Honey so the visible claim rail stays honest.

## Main Code Paths

- `src/lib/services/wallet/**`
- `src/lib/services/trading/buy-stock.ts`
- `src/lib/config/xstocks-tokens.ts`
- `src/lib/services/crypto-capability-router.ts`
- `src/lib/services/crypto/**`
- `src/lib/services/shared-hive-env.ts`
- `src/app/api/crypto/capabilities/route.ts`
- `src/app/api/crypto/clear-signing/route.ts`
- `src/app/api/crypto/agent-identity/route.ts`
- `src/app/api/crypto/risk-monitor/route.ts`
- `src/lib/services/obsidian/wallet-ledger.ts`
- `src/app/api/trading/route.ts`
- `src/lib/services/trading/buy-stock.ts`
- `src/features/dashboard/views/trade/**`
- `src/app/api/wallet/vault-backup/route.ts`
- `src/app/api/wallet/moneyclaw/route.ts`
- `src/app/api/wallet/**`
- `scripts/hivemind-mcp`
- `src/app/api/honey-ledger/route.ts`
- `src/app/api/runtime-usage/route.ts`
- `src/features/dashboard/hooks/use-wallet-files-controller.tsx`
- `src/components/wallet/**`
- Official hosted Honey ledger endpoint
- Official hosted compute gateway endpoint

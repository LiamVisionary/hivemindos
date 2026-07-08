---
title: "Hive Compute"
---

# Hive Compute

Hive Compute adds marketplace-style inference routing to HivemindOS without
bundling the marketplace itself into the desktop app.

There are two separate paths:

- **Use marketplace inference:** choose a GPU-first route under the
  **HivemindOS** model provider. Routes such as Auto, Fast, and Deep try eligible
  Hive Compute workers first, then fall back to the matching OpenRouter-backed
  HivemindOS hosted model tier when marketplace capacity is not available.
- **Earn with spare GPU:** open the Hive Compute dashboard view and install the
  optional worker module. The worker connects to a compatible gateway, advertises
  local Ollama or LM Studio/OpenAI-compatible models, accepts assigned jobs,
  streams tokens back, and reports completion.

## Setup

Open **More → Hive Compute**.

The view checks:

- `HIVEMINDOS_HIVE_COMPUTE_GATEWAY_URL`
- `HIVEMINDOS_HIVE_COMPUTE_OPENAI_BASE_URL`
- `HIVEMINDOS_HIVE_COMPUTE_API_KEY`
- `HIVEMINDOS_HIVE_COMPUTE_WORKER_TOKEN`
- Node.js
- Ollama or an OpenAI-compatible local server such as LM Studio
- the local worker module under `~/.hivemindos/modules/hive-compute-worker`

For earning, install the worker module, install its dependencies, set the worker
token issued by the gateway, then run:

```sh
cd ~/.hivemindos/modules/hive-compute-worker
hive-env-run -- npm start
```

For LM Studio, run the local server on its OpenAI-compatible API and set:

```sh
HIVE_COMPUTE_LOCAL_ENGINE=openai
HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL=http://127.0.0.1:1234/v1
HIVE_COMPUTE_MODEL_MAP_JSON='{"hive-compute/auto":"<lm-studio-model-id>"}'
```

## HivemindOS Model Selection

The app does not expose Hive Compute as a separate model provider picker in the
main agent setup flow. Instead, the HivemindOS provider's **All models** catalog
blends GPU-first routes into the same list as hosted OpenRouter-backed models,
pins those routes first, and marks them with a **SALE** badge.

- **Auto** prefers the marketplace auto route, then falls back to the default
  OpenRouter-backed HivemindOS tier.
- **Fast** prefers low-latency marketplace workers, then falls back to the fast
  OpenRouter-backed HivemindOS tier.
- **Deep** prefers marketplace workers advertising larger models or context
  windows, then falls back to the deep OpenRouter-backed HivemindOS tier.

When no Hive Compute workers are live, these models are still selectable because
the hosted OpenRouter fallback remains available through the HivemindOS model
credits or wallet-paid rail.

## Hosted Marketplace Features

Official HivemindOS gateways can support:

- prepaid client balance with server-side reservation and exact settlement
- x402, USDC, card, or other deposit rails after a hosted settlement worker
  verifies payment
- open public listings for workers and key relays, priced in input/output token
  microunits and capped at centralized fallback prices
- bring-your-own-key relays where upstream keys stay in hosted gateway secrets
- centralized fallback for `auto` routing when no marketplace provider qualifies
- provider bonds, reputation scoring, failure quarantine, and canary accounting
- provider withdrawal requests tracked through hosted payout-worker states

These features are gateway capabilities. The desktop app can display status,
route requests, and install the worker module, but it cannot create official
balances, provider bonds, payout state, or platform-fee policy by editing local
configuration.

## Marketplace Boundary

The downloadable app is user-controlled, so it is not the authority for official
marketplace value.

Official matching, prepaid balances, x402/deposit crediting, payout, quotas,
receipts, fraud controls, provider bonds, reputation, platform fees, and
entitlements must be enforced by HivemindOS-controlled hosted infrastructure.
Self-hosted operators can point the app and worker at their own compatible
gateway, but that is a self-hosted marketplace, not official HivemindOS
settlement.

Workers receive prompt contents for jobs they accept. Use a gateway and allowlist
policy you trust, and do not expose secrets, private vault paths, wallets, or
unrestricted local tools to public marketplace jobs.

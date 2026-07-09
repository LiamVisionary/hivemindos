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
- **Earn with spare GPU:** open the Hive Compute dashboard view, press **Set up
  hosting**, then press **Go live** when the readiness checks pass. The worker
  connects to a compatible gateway, advertises local Ollama or LM Studio/OpenAI-
  compatible models, accepts assigned jobs, streams tokens back, and reports
  completion.

Fleet machine cards also include **Rent compute**. By default, that opens the
first-party Hive Compute host flow with the same primary action: **Set up
hosting** installs the worker, installs dependencies, discovers the local model
backend, saves safe hosting defaults, and opens an MPP session when the
configured gateway supports it. Legacy UsePod provider onboarding remains
available only for builds that enable
`NEXT_PUBLIC_HIVEMINDOS_USEPOD_COMPUTE_RENTALS_ENABLED`.

## Setup

Open **More → Hive Compute**.

The view checks:

- `HIVEMINDOS_HIVE_COMPUTE_GATEWAY_URL`
- `HIVEMINDOS_HIVE_COMPUTE_OPENAI_BASE_URL`
- `HIVEMINDOS_HIVE_COMPUTE_API_KEY`
- `HIVEMINDOS_HIVE_COMPUTE_WORKER_TOKEN`
- `HIVEMINDOS_HIVE_COMPUTE_MPP_POLICY_URL`
- `HIVEMINDOS_HIVE_COMPUTE_MPP_SESSION_TOKEN`
- `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`
- `HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_FILE` or
  `HIVEMINDOS_HIVE_COMPUTE_TEE_ATTESTATION_COMMAND`
- `HIVEMINDOS_HIVE_COMPUTE_TEE_ENCRYPTION_PUBLIC_KEY`
- `HIVEMINDOS_HIVE_COMPUTE_TEE_DECRYPTION_PRIVATE_KEY_FILE` or a sealed
  runtime payload key
- Node.js
- Ollama or an OpenAI-compatible local server such as LM Studio
- the local worker module under `~/.hivemindos/modules/hive-compute-worker`

For earning, set the worker token issued by the gateway, press **Set up
hosting**, then press **Go live** in the app. The setup action installs the
managed worker module, installs dependencies, writes the discovered model map,
and opens an MPP payment session when that rail is available. Advanced
diagnostics keeps the manual command, model backend details, TEE evidence, and
MPP session controls available without making them part of the normal path. The
manual equivalent is:

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

The host flow does not ask for arbitrary paths or model IDs in the primary UI.
It discovers LM Studio/OpenAI-compatible `/v1/models` and Ollama `/api/tags`
locally, then advertises the detected models and the built-in Auto/Fast/Deep
routes to the configured gateway.

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
- hardware-attested worker eligibility, verified-only routing, encrypted prompt
  delivery, and model-hash policy for TEE-capable infrastructure
- x402 per-call payments and MPP session payments for sustained inference
  streams, when the hosted gateway exposes those rails

These features are gateway capabilities. The desktop app can display status,
route requests, and install the worker module, but it cannot create official
balances, provider bonds, payout state, or platform-fee policy by editing local
configuration.

## Privacy And Payment Rails

Standard local workers receive the prompts for jobs they accept. Hardware
privacy requires more than a local switch: the gateway must verify a real TEE
attestation, bind routing to the expected model/code policy, and deliver prompts
through an encrypted path that only the attested runtime can decrypt. When
`HIVEMINDOS_HIVE_COMPUTE_TEE_REQUIRED` is enabled, the app requests
verified-only routing, but the gateway is still the authority that must enforce
the requirement.

TEE-capable workers advertise evidence through the generated worker protocol.
Set `HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested`, identify the TEE
provider with `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`, and provide either a quote
file or a command that emits fresh evidence. The worker sends evidence hashes
and challenge responses to the gateway, and can decrypt encrypted job payloads
when the enclave runtime provides the matching private key or sealed payload key.
Verified-only routing fails closed when no live worker has attestation evidence
and encrypted delivery capability.

x402 is the default per-call machine-payment rail for Hive Compute-compatible
paid requests. MPP is treated as a session rail for high-frequency inference:
it is off by default and becomes available when a hosted gateway publishes a
Stripe/Tempo-compatible MPP policy through
`HIVEMINDOS_HIVE_COMPUTE_MPP_POLICY_URL`.

When MPP is enabled, **Set up hosting** opens a short-lived machine-payment
session when the configured gateway can issue one. **Open MPP session** remains
available in Advanced diagnostics in the dashboard and Fleet host modal for
manual renewal or troubleshooting. The session token is stored under the managed
local worker module with restrictive file permissions, then attached to Hive
Compute requests and worker registration. Workers can require gateway payment
proofs with
`HIVEMINDOS_HIVE_COMPUTE_MPP_REQUIRE_SESSION=1`; jobs without an MPP session
proof are rejected locally before model execution.

## Marketplace Boundary

The downloadable app is user-controlled, so it is not the authority for official
marketplace value.

Official matching, prepaid balances, x402/deposit crediting, payout, quotas,
receipts, fraud controls, provider bonds, reputation, platform fees, and
entitlements must be enforced by HivemindOS-controlled hosted infrastructure.
Self-hosted operators can point the app and worker at their own compatible
gateway, but that is a self-hosted marketplace, not official HivemindOS
settlement.

Workers receive prompt contents for jobs they accept unless the gateway verifies
a confidential-compute path. Use a gateway and allowlist policy you trust, and
do not expose secrets, private vault paths, wallets, or unrestricted local tools
to public marketplace jobs.

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
configured gateway supports it.

## Marketplace Flow

Hive Compute is the HivemindOS marketplace for model inference.

For users, it feels like a normal model route:

1. Pick a HivemindOS model route such as Auto, Fast, Deep, or a live marketplace
   model.
2. Send a chat or agent request.
3. The hosted gateway checks prepaid balance or payment proof, picks an eligible
   worker, reserves the request cost, and streams the answer back in an
   OpenAI-compatible shape.
4. When the job finishes, the gateway settles the exact token usage, records a
   receipt, releases unused reserve, and updates the host's pending earnings.

For hosts, it is a way to earn from spare local capacity:

1. Load a model in Ollama, LM Studio, or another OpenAI-compatible local server.
2. Open **More → Hive Compute** or **Rent compute** from a Fleet machine card.
3. Press **Set up hosting**.
4. Press **Go live** once the checks pass.

Hosts stay in control of what they run. The app discovers local models, writes a
managed worker config, and connects the worker to the configured gateway. The
gateway handles matching, receipts, reserves, settlement, reputation, and payout
state. The local app does not pretend a user-editable setting can create
official marketplace balances or earnings.

When more than one local model is available, the host flow shows each model as a
chip. All discovered models are advertised by default. Tapping a chip disables
that model for marketplace listings while leaving it available for the host's
own local use. Hosts can also raise the max concurrency slot count above the
default of one when their machine can safely serve multiple jobs at the same
time.

The normal user path stays simple: pick the model and send the request. The
hosting path stays simple too: set up once, then go live when the local model
server is ready.

Adaptive model routes can also learn from local accepted-outcome records. When an operator or evaluator records a provider/model result with task type, acceptance, quality, cost, latency, privacy posture, and optional proof-pack linkage, those observations can adjust future routing beyond catalog metadata and transport health. This local evidence does not create official marketplace reputation or payout authority.

Hive Compute is designed as a public marketplace. Official gateway URLs,
listings, model metadata, and paid inference routes can be reachable from the
public internet. A host's local model server is not made public: the worker runs
beside the local model backend and opens an outbound connection to the gateway,
while LM Studio, Ollama, files, shells, wallets, and other local services stay
private unless the host exposes them separately. Tailnet-only gateways are still
possible for self-hosted or internal deployments, but they are not the default
marketplace model.

## What Hosts Rent Out

Hive Compute rents access to model inference served by the host machine. Buyers
do not rent raw machine access, shell access, files, or arbitrary local tools.
They send a model request to the gateway, the gateway assigns the job to an
eligible worker, and the worker calls the selected local model backend.

If a machine has multiple local models loaded, the host can advertise all of
them or only a selected subset. Each advertised model can appear as a direct
marketplace route, while the built-in Auto/Fast/Deep routes map to one of the
selected local models. A host can serve more than one model at the same time
when the configured concurrency slot count is above one and the local backend
can handle the parallel work.

Hive Compute also measures worker speed from completed jobs. The hosted gateway
tracks time to first token, completion latency, and output tokens per second for
each worker/model route, then rolls that into simple speed labels such as
**Fast**, **Balanced**, **Heavy**, or **Measuring**. These labels are based on
gateway-observed jobs, not self-reported host claims, so new routes may show as
measuring until enough samples complete.

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
locally, then lets the host choose which discovered models to advertise. The
worker sends the selected models, built-in Auto/Fast/Deep routes, and the
configured max concurrency slot count to the gateway.

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
- gateway-measured worker/model speed from completed jobs, including tokens per
  second and latency bands for marketplace listings
- bring-your-own-key relays where upstream keys stay in hosted gateway secrets
- centralized fallback for `auto` routing when no marketplace provider qualifies
- provider bonds, reputation scoring, failure quarantine, and canary accounting
- provider withdrawal requests tracked through hosted payout-worker states
- hardware-attested worker eligibility, verified-only routing, encrypted prompt
  delivery, encrypted output envelopes, and model-hash policy for TEE-capable
  infrastructure
- x402 per-call payments and MPP session payments for sustained inference
  streams, when the hosted gateway exposes those rails

These features are gateway capabilities. The desktop app can display status,
route requests, and install the worker module, but it cannot create official
balances, provider bonds, payout state, or platform-fee policy by editing local
configuration.

## Privacy And Payment Rails

Standard local workers receive the prompts and outputs for jobs they accept.
Hardware privacy requires more than a local switch: the gateway must verify a
real TEE attestation, bind routing to the expected model/code policy, and use
encrypted prompt and output paths that only the intended endpoints can decrypt.
When `HIVEMINDOS_HIVE_COMPUTE_TEE_REQUIRED` is enabled, the app requests
verified-only routing, but the gateway is still the authority that must enforce
the requirement. Hardware-only routing additionally requires server-side
attestation verification; local or dev attestation is not treated as hardware
privacy.

TEE-capable workers advertise evidence through the generated worker protocol.
Set `HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested`, identify the TEE
provider with `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`, and provide either a quote
file or a command that emits fresh evidence. The worker sends evidence hashes
and challenge responses to the gateway, and can decrypt encrypted job payloads
when the enclave runtime provides the matching private key or sealed payload key.
Verified-only routing fails closed when no live worker has attestation evidence
and encrypted delivery capability.

Encrypted prompt delivery protects the job payload on the hop from the gateway
to a verified worker. Output E2E encryption is opt-in: clients generate an
RSA-OAEP keypair, send the public key with
`X-HivemindOS-Compute-Output-Encryption: required` and
`X-HivemindOS-Compute-Output-Public-Key`, then decrypt response envelopes on
the client side. In that mode, workers send encrypted token and final-output
envelopes, the gateway forwards ciphertext, meters usage from worker-reported
token counts, signs receipts, and settles revenue without reading the answer.
The standard response path remains plaintext at the gateway for compatibility
with ordinary OpenAI-compatible clients.

### Output E2E For Clients

Use output E2E when the application calling Hive Compute can decrypt responses
itself. The normal OpenAI-compatible response body remains supported, but the
assistant message content is blank in output-encrypted mode; the encrypted
answer is carried in `hiveCompute.encryptedOutput`.

Request headers:

```http
X-HivemindOS-Compute-Verified-Only: true
X-HivemindOS-Compute-Output-Encryption: required
X-HivemindOS-Compute-Output-Public-Key: <RSA-OAEP SPKI public key>
```

Streaming clients receive encrypted token envelopes in
`choices[0].delta.encrypted_content`; non-streaming clients receive the final
envelope at `hiveCompute.encryptedOutput`. The gateway still returns the signed
receipt and token usage, but it should not see the decrypted answer.

Hardware-only private jobs can add:

```http
X-HivemindOS-Compute-Hardware-TEE-Required: true
```

That header fails closed unless an eligible worker has gateway-verified
hardware attestation. Dev or local attestation is accepted only for
compatibility testing and is not treated as hardware privacy.

### Hardware TEE For Hosts

Hosts should only advertise hardware privacy when the worker is actually
running in supported confidential-compute infrastructure. A hardware-private
worker needs:

- `HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested`
- a real hardware provider label in `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`
- a fresh quote/evidence file or command
- an enclave-held prompt decryption key
- gateway-side attestation verification or a server-owned verified evidence
  allowlist

If the gateway does not have a hardware verifier or verified evidence allowlist,
hardware-only requests are rejected even when a worker can pass dev
verified-only routing.

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

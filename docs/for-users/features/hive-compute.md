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

## Host Pricing

Hive Compute prices each advertised model separately. A small model and a large
model do not inherit one shared list price.

During setup, the app runs a short local benchmark for every selected model. It
measures prompt processing and output generation on the actual backend and
machine. Each model is warmed up first, then measured repeatedly; the median
prompt-processing and output-generation speeds are kept so one cold start or
slow request cannot distort the result. Ollama supplies its native prompt/output
timing counters; LM Studio and other OpenAI-compatible servers use separate
prompt-prefill and output-generation samples. Benchmark prompts contain fixed
synthetic text and do not use the user's chats, files, or vault.

The benchmark also manages memory conservatively. Before measuring a model, it
records whether that model is already resident. When measurement finishes—or
fails—it unloads only the LM Studio or Ollama instance that the benchmark caused
to load, waits for that cleanup, and only then starts the next model. Models that
were already loaded by the host stay loaded. Arbitrary OpenAI-compatible servers
do not expose one standard unload operation, so HivemindOS does not issue a
guessed destructive request to those runtimes.

Measuring several large models can take a few minutes. The host panel keeps the
benchmark action active during that work. If a development proxy drops the
original request while local inference is still running, the panel checks the
saved benchmark state and resumes automatically instead of reporting the proxy
timeout as a failed measurement. Do not start a second benchmark while that
recovery message is visible.

The primary pricing choice has two modes:

- **Automatic** — starts below the public hosted price for a comparable model.
  Exact known model families use a comparable-model reference; other models use
  a conservative size-and-architecture tier. A slower local benchmark can lower
  that ask further, but a fast benchmark never pushes it above the competitive
  ceiling. This keeps the default attractive to buyers instead of converting a
  desired hourly return into an uncompetitive token price.
- **Custom** — exact input price, output price, and optional minimum price per
  job for each model, shown right below the pricing toggle when Custom is
  selected. Hosts who believe a private, specialized, or fine-tuned model
  deserves a premium can ask for it here.

Pricing is gated on measurement. Until every selected model completes its
current benchmark, model cards say **Not priced yet**, dollar asks and earnings
projections stay hidden, the next required action is **Benchmark models**, and
**Go live** is not offered. After measurement, the app reveals Automatic and
Custom pricing, deducts the gateway's published platform fee, and shows the
host's projected net earnings at 10–30% utilization—not fabricated historical
earnings. Before the marketplace has enough demand history, the projection
adds the model-specific earning potential of the highest-value advertised models
that fit in the host's concurrent job slots. When concurrency is already at its
current maximum, advertising another model advances the maximum with it—for
example, **2/2** becomes **3/3**—so the new model adds its own measured earning
potential. If the host deliberately lowered concurrency, **1/2** becomes
**1/3** instead and the host can change the slider when ready. Older one-shot
benchmarks are treated as stale and must be rerun once, and every benchmark
expires after 30 days—hardware load and backend versions drift, so an old
measurement cannot keep pricing new jobs. A model that fails its benchmark is
excluded from advertising with a visible notice naming the model and reason,
instead of blocking the whole setup; fix the local backend and rebenchmark to
retry it. Obvious embedding-only models are excluded from chat hosting. Chat
jobs may include image inputs: the worker passes multimodal message content
through to vision-capable local models on both engines.

Beyond chat, Hive Compute uses one versioned workload protocol for **image,
video, audio, music, speech, 3D, embeddings, reranking, and namespaced custom
models**. Hosts publish a typed capability manifest instead of relying on one
hard-coded adapter per model. Every offering declares its task, model, accepted
MIME types, output MIME types, byte and unit limits, billing unit, price, and
mandatory privacy mode. Adding a model normally means adding a confidential
sidecar adapter and a manifest row rather than changing marketplace routing.

These workloads use asynchronous jobs. A renter discovers capabilities, creates
a draft, encrypts and uploads any inputs, submits the ciphertext-only job,
observes bounded progress, and may cancel it. Successful media jobs return an
encrypted artifact manifest; the renter streams the ciphertext, verifies its
size and SHA-256 digest, decrypts it locally, and then acknowledges deletion.
The gateway owns job state, artifact grants, metering, receipts, and settlement.
Artifact bodies use the `HIVEART1` binary wire format: an eight-byte version
marker followed by length-prefixed JSON metadata and raw AES-GCM ciphertext for
each ordered chunk. Chunk metadata binds the job, artifact, MIME type, sequence,
and final marker; the signed manifest binds the key, chunk count, total framed
bytes, and SHA-256 digest. This lets the renter decrypt large outputs as a
bounded stream without base64-expanding the media. Consumers should write the
decrypted stream to an atomic temporary destination and publish it only after
the stream closes successfully, because final whole-object verification occurs
at stream completion.

For large renter inputs, HivemindOS reads the source as a stream, encrypts each
chunk to one randomly generated AES-256-GCM content key, wraps that key to the
attested enclave's RSA key, and writes only the encrypted `HIVEART1` spool with
private file permissions. No plaintext temporary file is created. The spool is
deleted through its cleanup handle after the encrypted upload completes or when
preparation fails.

| Workload | Protocol shape | Typical billing units |
| --- | --- | --- |
| Chat and text generation | Encrypted streaming or final envelope | Input/output tokens |
| Image generation | Async encrypted artifact | Image, megapixel, artifact, GPU-second |
| Video generation | Async encrypted artifact with progress/cancel | Second, frame, artifact, GPU-second |
| Audio, music, and speech | Async encrypted artifact | Second, sample, artifact, GPU-second |
| 3D generation | Async encrypted artifact | Artifact, job, GPU-second |
| Embeddings and reranking | Async encrypted JSON/binary artifact | Job or GPU-second |
| Namespaced custom tasks | Manifest-defined encrypted artifact | Declared supported unit |

Capability support is still model- and host-specific: the capabilities response
is the authority for what is currently available. A generic protocol does not
claim that every host already has every adapter or model installed.

When the local backend reports model sizes, the host panel also warns when the
largest advertised models at the configured slot count cannot plausibly fit in
the machine's memory, so a host doesn't advertise a combination that would swap
or fail under load.

Projections also respect availability: **Idle only** and **Scheduled** hosting
project over the hours the machine actually accepts jobs, so switching away
from **Always** lowers the daily and monthly figures without changing the
active-hour rate. Once the machine has served paid jobs, the earnings view
leads with **actual** earnings—today, last 7 and 30 days, all-time, and a
per-model split—recorded locally from the gateway's earning receipts, with
projections kept clearly separate.

The generated worker registers the selected model IDs, exact asks, and local
benchmark receipt over its authenticated gateway connection. The official
gateway validates each listing against server-owned minimums and ceilings. It
rejects out-of-range listings, applies the server-owned platform fee, ranks
eligible routes using the request's actual quote plus measured performance and
provider reputation, and locks the selected price into the job and signed
receipt. Changing a host price affects future jobs only.

For multiple selected models, the built-in aliases are model-aware: **Auto**
uses the lowest-priced selected model, **Fast** uses the highest measured output
throughput, and **Deep** uses the largest identifiable model. Direct model IDs
always route to that exact advertised model.

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
them or only a selected subset. LM Studio (or another OpenAI-compatible
server) and Ollama can both serve at the same time: discovery merges every
reachable backend's models and the worker routes each job to that model's own
engine. Each advertised model can appear as a direct marketplace route, while
the built-in Auto/Fast/Deep routes map to one of the selected local models. A
host can serve more than one model at the same time when the configured
concurrency slot count is above one and the local backend can handle the
parallel work.

## Guardrails the Worker Enforces

Hosting guardrails are enforced by the worker itself before it accepts each
job—not just advertised to the gateway:

- **Run hosting when** — **Idle only** refuses jobs while the machine is in
  use, **Always** never gates on activity, and **Scheduled** only accepts jobs
  inside a local-time window you pick (an overnight window wraps past
  midnight).
- **Pause on battery** — refuses jobs while the machine reports it is running
  on battery power.
- **Yield to user activity** — refuses new jobs while someone is actively
  using the machine, without killing jobs already running.
- **Daily earnings cap** — once the local ledger shows the cap was reached for
  the day, new jobs are refused until the next day.
- **Concurrent job slots** — the worker refuses assignments beyond its slot
  count even if a gateway misbehaves.

A refusal tells the gateway to reroute the job elsewhere, and the worker's
heartbeat reports whether it is currently accepting work and why not. Battery
and user-activity detection are best-effort per platform; where a platform
cannot report them, those two guardrails never block and the worker reports
them as unsupported.

Hosting also survives restarts: if the worker process crashes it is restarted
automatically with backoff, and if the app itself restarts while hosting was
live, hosting resumes on boot. Stopping hosting from the dashboard records
that intent, so nothing resumes after a deliberate stop.

## Remote Quick-Host

Opening another fleet machine's host panel offers **remote quick-host**: the
worker module installs on that machine over Hivemind Link, and hosting starts
there with the models discovered over its collector, pinned to conservative
guardrails (idle-only, pause on battery, yield to user). The gateway URL and
worker token resolve from that machine's own shared environment — no
credentials leave the machine you're sitting at — and stopping uses only the
process id the start recorded. Remote quick-host advertises models without
exact per-model asks; run the benchmark on that machine's own HivemindOS for
exact pricing. macOS and Linux targets are supported.

Hive Compute also measures worker speed from completed jobs. The hosted gateway
tracks time to first token, completion latency, and output tokens per second for
each worker/model route, then rolls that into simple speed labels such as
**Fast**, **Balanced**, **Heavy**, or **Measuring**. The setup benchmark supplies
an initial performance estimate for a new listing; after enough paid jobs, the
gateway's own observations become the authoritative routing history. New routes
may therefore show as measuring until enough real samples complete.

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
- `HIVE_COMPUTE_WORKLOAD_MANIFEST_JSON`
- `HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_URL`
- `HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_TOKEN`
- `HIVE_COMPUTE_CONFIDENTIAL_SIDECAR_SIGNING_PUBLIC_KEY`
- Node.js
- Ollama or an OpenAI-compatible local server such as LM Studio
- the local worker module under `~/.hivemindos/modules/hive-compute-worker`

For earning, set the worker token issued by the gateway, press **Set up
hosting**, then press **Go live** in the app. The setup action installs the
managed worker module, installs dependencies, benchmarks the selected models,
writes their model map and per-model asks, and opens an MPP payment session when
that rail is available. **Benchmark models** reruns the synthetic benchmark
without starting the worker. Selecting **Custom** pricing exposes exact model asks right below the pricing toggle for
hosts who choose Custom pricing. Advanced diagnostics keeps the manual command,
model backend details, TEE evidence, and MPP session controls available without
making them part of the normal path. The manual equivalent is:

```sh
cd ~/.hivemindos/modules/hive-compute-worker
hive-env-run -- npm start
```

For LM Studio, run the local server on its OpenAI-compatible API and set:

```sh
HIVE_COMPUTE_LOCAL_ENGINE=openai
HIVE_COMPUTE_LOCAL_OPENAI_BASE_URL=http://127.0.0.1:1234/v1
HIVE_COMPUTE_MODEL_MAP_JSON='{"hive-compute/auto":"<lm-studio-model-id>"}'
HIVE_COMPUTE_MODEL_LISTINGS_JSON='[{"model":"hive-compute/auto","inputUsdMicroPerMTok":500000,"outputUsdMicroPerMTok":750000,"minimumJobUsdMicro":0}]'
```

The host flow does not ask for arbitrary paths or model IDs in the primary UI.
It discovers LM Studio/OpenAI-compatible `/v1/models` and Ollama `/api/tags`
locally, then lets the host choose which discovered models to advertise. The
worker sends the selected models, built-in Auto/Fast/Deep routes, and the
configured max concurrency slot count to the gateway. It also sends each
route's authenticated exact ask and optional local benchmark result. The
gateway can reject a route whose ask falls outside its published provider-price
bounds.

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

Official asynchronous Hive Compute workload jobs fail closed unless they have
hardware-enforced confidentiality and renter-only output encryption. The host's operating system,
worker process, logs, gateway, artifact store, and human operator receive only
ciphertext, bounded metadata, progress, usage, and signed manifests. The model
must necessarily process clear data inside an attested confidential-compute
boundary, but clear prompts and generated content must never be exposed to the
host machine outside that boundary. This guarantee requires a real hardware TEE,
gateway verification of fresh attestation, expected code/model binding, and a
confidential sidecar that holds decryption and completion-signing keys.

The OpenAI-compatible chat facade has a narrower compatibility boundary: its
generated answer is encrypted inside the confidential runtime directly to the
renter key, so the generating host and gateway cannot read the answer, but the
chat request body reaches the official gateway before the gateway encrypts it
for enclave delivery. Use the asynchronous workload protocol when inputs must
also remain opaque to the gateway.

TEE-capable workers advertise evidence through the generated worker protocol.
Set `HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested`, identify the TEE
provider with `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`, and provide either a quote
file or a command that emits fresh evidence. The worker sends evidence hashes
and challenge responses to the gateway, and can decrypt encrypted job payloads
when the enclave runtime provides the matching private key or sealed payload key.
Verified-only routing fails closed when no live worker has attestation evidence
and encrypted delivery capability.

Encrypted prompt delivery protects the job payload all the way into the
attested sidecar. Renter-only output encryption is mandatory on official routes:
clients generate an RSA-OAEP keypair, send the public key with
`X-HivemindOS-Compute-Output-Encryption: required` and
`X-HivemindOS-Compute-Output-Public-Key`, then decrypt response envelopes on
the client side. Workers send encrypted token, final-output, or artifact
envelopes; the gateway forwards or stores ciphertext, meters signed usage, and
settles revenue without reading the answer. The renter private key stays in the
local encrypted job-key vault until every output artifact is acknowledged and
deleted from gateway storage, then it is erased. It is never sent to the
gateway, worker, sidecar, or model host.

### Output E2E For Clients

The HivemindOS client creates and manages this keypair automatically. A custom
client must decrypt responses itself. The assistant message content is blank on
the wire; the encrypted answer is carried in `hiveCompute.encryptedOutput`.

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

Official requests also require:

```http
X-HivemindOS-Compute-Hardware-TEE-Required: true
```

The request fails closed unless an eligible worker has gateway-verified hardware
attestation. Dev or locally asserted attestation is not hardware privacy.

### Confidential verified models

The HivemindOS model selector places currently available confidential models
first and marks them **Confidential verified**. The label is not supplied by the
host. It appears only when the official gateway has accepted fresh hardware
attestation, verified the expected runtime and model image, bound the enclave
keys, and confirmed renter-only output encryption. The label disappears when
the attestation expires or the worker disconnects.

“Confidential verified” is deliberately narrower than “100% confidential.” It
describes verified execution state and the designed trust boundary; it cannot
promise that supported hardware has no unknown defect or side channel.

### Hardware TEE For Hosts

Hosts should only advertise hardware privacy when the worker is actually
running in supported confidential-compute infrastructure. A hardware-private
worker needs:

- `HIVEMINDOS_HIVE_COMPUTE_CONFIDENTIAL_MODE=tee-attested`
- a real hardware provider label in `HIVEMINDOS_HIVE_COMPUTE_TEE_PROVIDER`
- a fresh quote/evidence file or command
- an enclave-held prompt decryption key
- gateway-side verification of fresh evidence against the expected hardware,
  measured runtime, model, and enclave-held keys

If the gateway does not have a hardware verifier, hardware-only requests are
rejected even when a worker can pass dev verified-only routing. A static
evidence-hash allowlist is not proof of fresh hardware attestation and is not
accepted for the official renter-only tier.

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

Plaintext compatibility exists only for an explicitly self-hosted, non-official
gateway with `HIVE_COMPUTE_SELF_HOSTED_ALLOW_NONCONFIDENTIAL=1`. It must be
presented as non-confidential: the host can see prompts and outputs, and it must
never be used as an official marketplace privacy claim.

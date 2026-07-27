# Hive Compute Workload Protocol

## Product guarantee

Official generative artifact jobs use **renter-only confidential output**:

- plaintext input and output may exist only inside a gateway-verified hardware
  confidential-compute boundary and on the renter's machine;
- the host operator, host operating system, ordinary worker process, gateway,
  object store, marketplace database, logs, and payout systems receive
  ciphertext or non-sensitive accounting metadata only;
- the first output encryption happens inside the same measured boundary that
  runs the model, tokenizer, media codecs, and metering;
- only the renter owns the private output-decryption key.

This is the strongest technically honest interpretation of “the generating
machine must never see the content.” The physical CPU/GPU necessarily holds
model state while computing, but hardware confidential compute prevents the
host OS/operator from reading that protected memory. An ordinary local model
server cannot make this guarantee and is ineligible for official generative
artifact jobs.

## Trust boundary

Trusted for a renter-only job:

- renter-side key generation, encryption, verification, and decryption;
- the hardware TEE/confidential-GPU root of trust;
- a fresh remote-attestation verifier response that binds the exact measured
  runtime, model/weights, codecs, input-decryption key, output-signing key, job
  nonce, and expiry;
- server-owned authentication, quote limits, reserve accounting, settlement,
  and artifact authorization.

Not trusted with plaintext or commercial authority:

- the host operating system and machine owner;
- the generated host worker outside the confidential boundary;
- loopback services such as ordinary Ollama, LM Studio, LocalAI, or ComfyUI;
- the gateway Worker and Durable Objects;
- D1, R2, caches, logs, metrics, support tooling, and payout workers;
- client-supplied prices, usage, recipient policy, entitlement, or local state.

## Workloads

The protocol models an offering by capability, task, model, accepted input MIME
types, output MIME types, bounded parameters, maximum bytes/runtime, billing
unit, price, concurrency, and privacy tier. Standard capabilities include:

- image generation and editing;
- video generation and transformation;
- speech, audio, sound, and music generation;
- 3D model generation;
- embeddings and reranking;
- fixed custom inference adapters.

`custom` never means renter-provided shell, code, container, filesystem path,
or arbitrary URL execution. It is a provider-published, versioned adapter with
a bounded request schema and reviewed runtime image.

## Job lifecycle

1. The renter generates an ephemeral output key pair locally.
2. The gateway authenticates the renter, validates the workload request, picks
   a compatible offering, locks its unit price, and reserves the maximum cost.
3. The gateway creates a durable job and fresh single-use attestation nonce.
4. A worker is eligible only after the verifier binds fresh hardware evidence
   to the job, worker, measured runtime/model image, enclave encryption key,
   enclave usage-signing key, and renter output-key hash.
5. Input JSON and artifacts are encrypted to the attested enclave key. R2 holds
   only ciphertext.
6. The enclave decrypts inputs, runs inference and required codecs, then
   chunk-encrypts output to the renter key before any byte leaves protected
   memory.
7. The enclave uploads ciphertext directly with a short-lived job/worker/role
   scoped grant. Large artifacts use multipart uploads; media never travels as
   base64 in a WebSocket message.
8. The enclave signs a canonical manifest and usage statement bound to the job,
   nonce, evidence hash, renter key, artifact hashes, and billable units.
9. The gateway checks the signature, attestation bindings, object sizes/hashes,
   requested maximums, and exactly-once state transition before settlement.
10. The renter downloads ciphertext through an authenticated private route,
    verifies the manifest/hash, decrypts locally, and acknowledges receipt.
11. Acknowledgment deletes ciphertext immediately; expiry cleanup is a backstop.

Canonical async states are `draft`, `queued`, `assigned`, `running`,
`completed`, `failed`, `cancelled`, and `expired`. Progress is monotonic.
Cancellation and terminal transitions are idempotent. Durable alarms may run at
least once, so reserve release and settlement must also be exactly once.

## Encrypted artifact format

`hive-artifact-aes256gcm-v1` uses one random 256-bit content-encryption key per
artifact. The enclave wraps that key to the renter's RSA-OAEP SHA-256 public
key. Artifact bytes are divided into bounded chunks; each chunk uses a unique
AES-GCM nonce and domain-separated associated data containing protocol, job,
artifact, chunk sequence, and terminal marker.

The signed artifact manifest contains only:

- artifact id and safe media type;
- ciphertext byte count and SHA-256;
- wrapped content key and renter public-key hash;
- encryption algorithm, chunk size, and chunk count.

It contains no plaintext filename, prompt, generated caption, preview, URL, or
untrusted metadata. R2 keys are server-generated and never public.

## Metering and settlement

Chat retains exact input/output token settlement. Non-token workloads use
`billingUnit`, `billedUnits`, and `usdMicroPerUnit`. Supported unit families
include image, second, frame, megapixel, sample, artifact, job, and GPU-second.

The gateway can observe ciphertext bytes, artifact count, hashes, timestamps,
and state transitions. It cannot independently inspect encrypted semantic media
properties. Duration, frames, dimensions, mesh properties, or GPU time must
come from an attested signed usage statement and are capped by the renter's
reserved maximum. Bare host/worker counters never grant payout.

## Compatibility surfaces

- `/v1/jobs` is the canonical asynchronous API.
- OpenAI-compatible chat remains a streaming compatibility facade.
- OpenAI-compatible image generation may be reconstructed on the renter's
  machine after local decryption; the hosted gateway never returns plaintext
  `b64_json` for renter-only jobs.
- Image-v1 fields remain readable during migration, but new workloads never add
  modality-specific accounting columns.

## Fail-closed rules

Reject or cancel without running inference when any of these is missing or
invalid:

- renter output public key;
- hardware-verified attestation;
- fresh job nonce and verifier expiry;
- exact runtime/model/weights/codecs measurement policy;
- attestation-bound enclave encryption and usage-signing keys;
- confidential upload path;
- supported MIME/schema/size/runtime limits;
- matching artifact hashes and signed usage;
- exact recipient key hash and job-bound encryption metadata.

Dev/local attestation, self-reported provider labels, static evidence-hash
allowlists, host filesystem keys, host environment keys, ordinary local HTTP
backends, plaintext completion payloads, arbitrary output URLs, mixed
plaintext/ciphertext results, and replayed grants are never eligible for the
official renter-only tier.

## Deployment order

The private gateway migrations are additive and must run in numeric order.
Create the private artifact bucket and Durable Object binding before deploying
the workload-plane Worker. Do not deploy code that writes a new D1 column before
its migration is confirmed. After deploy, run adversarial ciphertext-only E2E
tests against a disposable verified confidential executor before admitting
paid marketplace traffic.

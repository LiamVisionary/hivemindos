# Hive Compute and testnet assets

> https://hivemindos.app/superagent-api/docs/compute-faucet · Markdown version: https://hivemindos.app/superagent-api/docs/compute-faucet.md

Use Hive Compute (`hive-compute`) when an agent needs hosted GPU work. Use the testnet faucet (`testnet-faucet`) when a developer needs test assets with no monetary value. Both use the account's Agent Credits and need no desktop session.

| If you need | Start with |
|---|---|
| A model response or generated image | [Managed inference](#run-managed-inference) |
| The best live GPU offer | [Marketplace search](#search-the-compute-marketplace) |
| Private GPU work with verified hardware | [Confidential workload](#run-a-confidential-asynchronous-workload) |
| A test wallet funded for development | [Testnet assets](#request-testnet-assets) |

Main compute operations: `marketplace.search`, `models.list`, `chat.create`, `images.create`, `jobs.create`, `artifacts.upload`, and `artifacts.get`. `marketplace.listings` and `marketplace.status` show live offers and capacity. Faucet operations: `assets.list`, `claims.create`, and `claims.get`. Read the full live set with `GET /capabilities/{serviceId}`.

Every successful call reports its exact charge in `chargedCredits`. Failed work releases its reservation.

## Search the compute marketplace

Search before running GPU work. The server resolves the privacy requirement, filters out ineligible hosts, works out each offer's maximum charge, and recommends an offer with a `listingId` you can pin on the execution call.

```ts
const capacity = await hive.services.invokeOperation(
  "hive-compute",
  "marketplace.search",
  undefined,
  {
    query: {
      modality: "chat",
      model: "hive-compute/auto",
      privacy: "auto",
      dataSensitivity: "public",
      estimatedInputTokens: 2_000,
      estimatedOutputTokens: 1_000,
    },
    idempotencyKey: "compute-search-public-chat-001",
  },
);

if (!capacity.ok || !capacity.result.available) {
  throw new Error("No eligible compute offer is live.");
}

console.log(capacity.result.privacy.resolved);
console.log(capacity.result.recommended.trust.label);
console.log(capacity.result.recommended.estimatedChargeCredits);
```

| `privacy` | Routing |
|---|---|
| `standard` | Includes compatible community hardware. The host may see inputs and outputs. |
| `confidential` | Requires fresh server-verified hardware attestation and renter-only output encryption. Never downgrades. |
| `auto` | Uses `dataSensitivity`: only `public` and `low` may resolve to Standard. Anything else resolves to Confidential. |

Through the [private or confidential base URL](privacy.html), Hive Compute always resolves to Confidential.

Attested hosts carry a `Confidential Verified` trust badge even on a Standard request. The signed completion receipt records both the request's privacy tier and the worker's trust tier.

Never send wallet secrets, passwords, API keys, private keys, or recovery phrases to a GPU worker in either tier.

## Run managed inference

Read the live model catalog first:

```ts
const models = await hive.services.invokeOperation(
  "hive-compute",
  "models.list",
  undefined,
  { idempotencyKey: "compute-models-2026-08-25" },
);
```

For public or low-sensitivity work, choose Standard and pin the recommended offer:

```ts
const completion = await hive.services.invokeOperation(
  "hive-compute",
  "chat.create",
  {
    model: "hive-compute/auto",
    messages: [{ role: "user", content: "Summarize this public benchmark." }],
    stream: false,
    hivemindos: {
      privacy: "standard",
      dataSensitivity: "public",
      listingId: capacity.result.recommended.listingId,
    },
  },
  { idempotencyKey: "risk-summary-001" },
);

if (!completion.ok) throw new Error(completion.error);
console.log(completion.chargedCredits);
console.log(completion.result);
```

For private work, keep an RSA-OAEP private key in your app and send only its SPKI PEM public key. A confidential request without this key, or without eligible attested capacity, fails without charge and never falls back to Standard:

```ts
const privateCompletion = await hive.services.invokeOperation(
  "hive-compute",
  "chat.create",
  {
    model: "hive-compute/auto",
    messages: [{ role: "user", content: privatePrompt }],
    stream: false,
    hivemindos: {
      privacy: "confidential",
      dataSensitivity: "confidential",
      outputPublicKey: process.env.COMPUTE_OUTPUT_PUBLIC_KEY_PEM!,
    },
  },
  { idempotencyKey: "private-summary-001" },
);
```

`images.create` generates images, supports the same encrypted-output option, and returns base64 image data in `result`:

```ts
const image = await hive.services.invokeOperation(
  "hive-compute",
  "images.create",
  {
    model: "hive-compute/image",
    prompt: "A clean studio product photograph",
    n: 1,
    response_format: "b64_json",
    hivemindos: { privacy: "standard", dataSensitivity: "public" },
  },
  { idempotencyKey: "product-image-001" },
);
```

Streaming is not available here, because the service reports one exact charge after completion. Use `stream: false` and read `chargedCredits`.

## Run a confidential asynchronous workload

Call `capabilities.list` first to read the live workload kinds, MIME types, limits, billing units, and eligible models. Then:

1. Call `jobs.create` with the workload descriptor and your output public key. Plaintext workload parameters are rejected.
2. Encrypt the input for the returned job and enclave key.
3. Upload the ciphertext as a [managed file](files-connections.html).
4. Attach that file with `artifacts.upload`.
5. Call `jobs.submit` with the encrypted payload and the same output public key.
6. Poll `jobs.get` until the job completes.
7. Download each encrypted result with `artifacts.get`, decrypt it locally, then call `artifacts.acknowledge` to remove it.

Create the draft:

```ts
type ComputeJobDraft = {
  id: string;
  worker: { encryptionKeySha256: string };
};

const created = await hive.services.invokeOperation<ComputeJobDraft>(
  "hive-compute",
  "jobs.create",
  {
    protocol: "hive-compute.workload.v1",
    kind: "video",
    task: "text-to-video",
    model: selectedModel,
    inputMimeTypes: ["application/octet-stream"],
    outputMimeTypes: ["video/mp4"],
    billingUnit: "second",
    requestedUnits: 1,
    outputPublicKey: process.env.COMPUTE_OUTPUT_PUBLIC_KEY_PEM!,
  },
  { idempotencyKey: "confidential-video-001" },
);

if (!created.ok) throw new Error(created.error);
```

Upload only ciphertext. `artifacts.upload` declares `requestFormat: "binary"`, takes exactly one managed file, and derives the ciphertext digest from that file's verified record:

```ts
const ciphertextFile = await hive.files.upload(
  {
    name: "job-input.enc",
    contentType: "application/octet-stream",
    bytes: ciphertextBytes,
  },
  { idempotencyKey: "confidential-video-input-001" },
);

if (!ciphertextFile.ok) throw new Error(ciphertextFile.error);

await hive.services.invokeOperation(
  "hive-compute",
  "artifacts.upload",
  {
    encryptedMimeType: "application/octet-stream",
    encryptionPublicKeySha256: created.result.worker.encryptionKeySha256,
    encryptedKey: wrappedContentKeyBase64,
    chunkSize: ciphertextBytes.byteLength,
    chunks: 1,
  },
  {
    pathParameters: {
      jobId: created.result.id,
      artifactId: `${created.result.id}.input.1`,
    },
    fileIds: [ciphertextFile.file.id],
    idempotencyKey: "confidential-video-artifact-001",
  },
);
```

`artifacts.get` returns encrypted bytes as a JSON envelope with `contentType`, `encoding: "base64"`, and `data`. Input files and returned artifacts are each limited to 25 MB per call.

## Request testnet assets

Testnet assets have no monetary value. Read `assets.list` right before a claim to get the supported network and asset pairs, amount, quota, and exact `priceCredits`:

```ts
const catalog = await hive.services.invokeOperation(
  "testnet-faucet",
  "assets.list",
  undefined,
  { idempotencyKey: "faucet-assets-2026-08-25" },
);
```

Create a claim with a pair from that list. The `idempotencyKey` inside the input identifies the faucet claim; the one in the options protects the outer invocation:

```ts
type FaucetClaimResult = {
  claim: { id: string; status: string };
};

const claim = await hive.services.invokeOperation<FaucetClaimResult>(
  "testnet-faucet",
  "claims.create",
  {
    network: selected.network,
    asset: selected.asset,
    recipient: testnetRecipient,
    idempotencyKey: "onboarding-wallet-001",
  },
  { idempotencyKey: "platform-onboarding-wallet-001" },
);

if (!claim.ok) throw new Error(claim.error);
console.log(claim.chargedCredits, claim.result.claim);
```

Retry an uncertain request with both original idempotency keys. Read the claim's state with `claims.get`:

```ts
const status = await hive.services.invokeOperation(
  "testnet-faucet",
  "claims.get",
  undefined,
  {
    pathParameters: { claimId: claim.result.claim.id },
    idempotencyKey: "claim-status-onboarding-wallet-001",
  },
);
```

Claims belong to the account behind the API key; another account cannot read one by guessing its id. Provider failures release the reservation, and a delivered claim returns the exact final charge.

## Connect an agent through MCP

The Hive Compute MCP server is a smaller alternative to the [full SuperAgent MCP](mcp.html) for agents that only need the GPU marketplace. It calls the same operations, with the same key permissions, limits, and credit balance.

```text
URL: https://compute-mcp.hivemindos.app/mcp
Authentication: Authorization: Bearer hmos_live_...
Transport: Streamable HTTP
```

| Tool | Purpose |
|---|---|
| `hive_compute_search` | Resolve privacy, search live offers, compare trust, and quote credits. |
| `hive_compute_chat` | Run non-streaming chat inference against the selected offer. |
| `hive_compute_image` | Generate images against the selected offer. |
| `hive_compute_job_create` | Create a Confidential Verified asynchronous workload draft. |
| `hive_compute_job_status` | Read asynchronous job status. |
| `hive_compute_job_cancel` | Cancel a job and release unused reservation. |

Give the agent the smallest key it needs: a search-only agent can be limited to `services.invoke.hive-compute.marketplace.search`, and a chat agent can add `services.invoke.hive-compute.chat.create` with its own request, daily, credit, and concurrency ceilings. Only use clients that can store a bearer key securely; clients that require OAuth for remote MCP are not supported yet.

## Create a tightly limited key

```ts
const issued = await createHivemindOSApiKey({
  creditToken: process.env.HIVEMINDOS_CREDIT_TOKEN!,
  label: "Compute and testnet backend",
  scopes: ["services:read", "services:invoke", "files:read", "files:write"],
  allowedServices: ["hive-compute", "testnet-faucet"],
  allowedOperations: [
    "capabilities.list",
    "services.invoke.hive-compute.marketplace.search",
    "services.invoke.hive-compute.marketplace.listings",
    "services.invoke.hive-compute.marketplace.status",
    "services.invoke.hive-compute.models.list",
    "services.invoke.hive-compute.chat.create",
    "services.invoke.hive-compute.images.create",
    "services.invoke.hive-compute.jobs.create",
    "services.invoke.hive-compute.jobs.get",
    "services.invoke.hive-compute.jobs.submit",
    "services.invoke.hive-compute.artifacts.upload",
    "services.invoke.hive-compute.artifacts.get",
    "services.invoke.hive-compute.artifacts.acknowledge",
    "services.invoke.testnet-faucet.assets.list",
    "services.invoke.testnet-faucet.claims.create",
    "services.invoke.testnet-faucet.claims.get",
  ],
  limits: {
    "services.invoke.hive-compute.marketplace.search": {
      requestsPerMinute: 60,
      maxConcurrent: 8,
    },
    "services.invoke.hive-compute.chat.create": {
      requestsPerMinute: 20,
      maxConcurrent: 4,
    },
    "services.invoke.testnet-faucet.claims.create": {
      requestsPerDay: 10,
      maxConcurrent: 1,
    },
  },
  idempotencyKey: "compute-testnet-key-v1",
});
```

Drop the file scopes and artifact operations when a key only needs chat, images, or faucet claims.

## Related

- [Per-endpoint limits](limits.html)
- [Usage and audit records](usage-audit.html)
- [Service catalog](services.html)

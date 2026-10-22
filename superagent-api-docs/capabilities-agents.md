# Capabilities, Agents, Workflows, And Mini Apps

> https://hivemindos.app/superagent-api/docs/capabilities-agents · Markdown version: https://hivemindos.app/superagent-api/docs/capabilities-agents.md

# Capabilities, agents, workflows, and mini apps

A **service** is a managed product area, such as research or memory. A **capability** is one action inside it, such as creating an analysis or recalling a memory.

1. List the capabilities your key can use.
2. Pick a stable operation id.
3. Call it now, or create a [durable run](runs-webhooks.html#durable-runs) for longer work.

## List capabilities

```ts
const response = await hive.services.capabilities();
if (!response.ok) throw new Error(response.error);

for (const capability of response.capabilities) {
  console.log(
    capability.serviceId,
    capability.id,
    capability.operationId,
    capability.approval,
  );
}
```

Filter to one service with `hive.services.capabilities("managed-agents")` or `GET /capabilities/{serviceId}`. Results only include what the key's service and operation boundary allows. The registry also marks work that is not currently available.

| Field | Meaning |
|---|---|
| `id` | Stable id within the service, such as `agents.create`. |
| `operationId` | Exact selector for direct invocation or a dedicated SuperAgent API route. |
| `runOperationId` | Exact background-run selector, or `null` for a dedicated route. |
| `method` and `path` | Reviewed managed-service contract and path parameters. |
| `mode` | `read`, `write`, or `execute`. |
| `idempotent` | Whether the operation requires a protected idempotent mutation. |
| `approval` | `never`, `policy`, or `always`. |
| `asynchronous` | Whether the service normally keeps working after accepting the request. |

## Call a capability

```ts
const result = await hive.services.invokeOperation(
  "hive-research",
  "analyses.create",
  { question: "Map the evidence for and against this decision." },
  { idempotencyKey: "analysis-decision-001" },
);
```

Pass path values separately:

```ts
const result = await hive.services.invokeOperation(
  "managed-agents",
  "agents.chat",
  { message: "Prepare today's operating brief." },
  {
    pathParameters: { agentId: "agent_..." },
    idempotencyKey: "agent-brief-2026-08-25",
  },
);
```

### Attach files

Capabilities with `requestFormat: "multipart"` take [managed files](files-connections.html) by id. Upload once, then attach the file to calls or runs:

```ts
await hive.services.invokeOperation(
  "distill",
  "runs.create",
  { skillName: "Customer interview analyst" },
  {
    fileIds: [uploaded.file.id],
    idempotencyKey: "distill-interviews-v1",
  },
);
```

The key needs `files:read`. One call can attach up to 40 files with a combined 25 MB limit.

Capabilities with `requestFormat: "binary"` take exactly one managed file. `hive-compute.artifacts.upload` uses this for encrypted workload input: the API takes the ciphertext digest from the managed file record and checks the encryption metadata before forwarding the bytes. It never accepts a caller-supplied digest.

## Create a protected action approval

Capabilities marked `approval: "always"` need a matching approval. The approval is bound to the service, operation, path parameters, query, input, managed files, and connection id, so approving one action cannot authorize changed input or a different credential.

```ts
const requested = await hive.approvals.createServiceAction(
  {
    serviceId: "app-hosting",
    operationId: "sites.publish",
    input: { siteId: "site_...", versionId: "version_..." },
  },
  { idempotencyKey: "approval-publish-version-17" },
);

if (!requested.ok) throw new Error(requested.error);

await reviewer.approvals.decide(
  requested.approval.id,
  "approve",
  { idempotencyKey: "decision-publish-version-17" },
);

const published = await hive.services.invokeOperation(
  "app-hosting",
  "sites.publish",
  { siteId: "site_...", versionId: "version_..." },
  {
    approvalId: requested.approval.id,
    idempotencyKey: "publish-version-17",
  },
);
```

An approval expires, can be rejected, and is used up by one successful matching action. Capabilities marked `policy` follow the service's account policy and may still ask for approval or confirmation.

## What the registry covers

- Persistent cloud agents, agent chat, app building, integrations, and governed computer actions through `managed-agents`.
- Scheduled, manual, and event-driven routines through `managed-workflows`.
- Research, multi-agent swarms, audience discovery, transcripts, skill distillation, market intelligence, and lead data.
- Managed model inference, media generation, photo analysis, GPU rentals, and Hive Compute jobs.
- Typed, evolving cloud memory through `cloud-superbrain`, and portable application data through `hivemind-database`.
- App hosting, bookings, social publishing, email, analytics, X operations, calendar access, and remote tool servers.
- Token research, wallet risk, bridge quotes, copy-trading monitors, managed wallets, and managed spot trading.

Every capability, including `hive-compute`, `testnet-faucet`, and managed mini-app backends, bills the same account's Agent Credits. Failed work releases its reservation, and completed work reports its exact charge in the result, response header, usage records, and audit records. Mini-app backends run without a desktop session and never copy their protected credentials into your product.

## Related

- [Managed memory](memory.html)
- [Hive Compute and testnet assets](compute-faucet.html)
- [Service catalog](services.html)
- [Endpoint reference](reference.html)

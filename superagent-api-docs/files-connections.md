# Files, connections, and integrations

> https://hivemindos.app/superagent-api/docs/files-connections · Markdown version: https://hivemindos.app/superagent-api/docs/files-connections.md

Upload a **file** when a managed service needs source material. Create a **connection** when a service needs another account or tool, without exposing that credential to your app's workers.

File lists show metadata, never file bytes. Connection lists show labels and field names, never secret values.

## Upload a file

```ts
const uploaded = await hive.files.upload(
  {
    name: "customer-brief.pdf",
    contentType: "application/pdf",
    bytes: new Uint8Array(await readFile("customer-brief.pdf")),
    purpose: "research-source",
  },
  { idempotencyKey: "customer-brief-pdf-v1" },
);
```

Files must be between 1 byte and 25 MB. The API calculates a SHA-256 checksum; pass a known one in `sha256` and the upload fails if it does not match.

List metadata with `files.list()`, download bytes with `files.download(id)`, and delete with `files.remove(id)`. A deleted file cannot be recreated by replaying its old idempotency key.

Over raw HTTP, send the bytes as the request body with these headers:

| Header | Use |
|---|---|
| `Content-Type` | File media type. |
| `Content-Length` | File size in bytes. |
| `X-File-Name` | Customer-visible file name. |
| `X-Content-Sha256` | Optional expected checksum. |
| `X-HivemindOS-File-Purpose` | Optional project-defined purpose. |
| `Idempotency-Key` | Stable identifier for one logical upload. |

## Store a connection

A connection protects the credential for an API, OAuth account, wallet, database, remote tool server, or custom integration.

```ts
const created = await hive.connections.create(
  {
    name: "Customer support source",
    kind: "api_key",
    serviceId: "hive-research",
    credentials: {
      apiKey: process.env.SUPPORT_SOURCE_KEY!,
    },
    metadata: {
      environment: "production",
      authMode: "header",
      credentialField: "apiKey",
      targetName: "x-customer-source-key",
    },
  },
  { idempotencyKey: "support-source-production-v1" },
);
```

The response returns only `credentialFields`, such as `["apiKey"]`, never the values. Updating `credentials` rotates the stored value; deleting the connection removes it.

`metadata` holds labels and the credential mapping, never secrets:

- `authMode`: `bearer`, `header`, or `body`.
- `credentialField`: which protected field to use.
- `targetName`: required for header and body modes. Reserved HivemindOS headers cannot be replaced.

## Use a connection

Pass the connection id when a capability needs it:

```ts
await hive.services.invokeOperation(
  "hive-research",
  "tier.get",
  undefined,
  {
    connectionId: created.connection.id,
    idempotencyKey: "connected-tier-check-001",
  },
);
```

HivemindOS supplies the credential to the operation and updates `lastVerifiedAt` after a successful response. The value is never returned.

- The caller needs `connections:read`, and the connection must be active.
- A connection bound to one service cannot be used with another.
- For capabilities marked `approval: "always"`, send the same `connectionId` in both the [approval request](capabilities-agents.html#create-a-protected-action-approval) and the call.

## Calendar and remote tool integrations

The `integration-broker` service connects Google Calendar and remote MCP servers without returning their OAuth or bearer credentials. Useful capability ids:

- `connections.list`
- `google.oauth.start`
- `google.calendar.events.create`
- `mcp.connections.create`
- `mcp.invoke`
- `connections.revoke`

`google.oauth.start` returns an authorization URL for the account owner; the provider completes the connection directly with HivemindOS. Calendar writes, new remote-tool connections, and revocations need an input-bound approval. Remote tool calls also follow the broker's method and confirmation policy.

## Keep credentials safe

- Create and rotate credentials from a narrow, project-bound key.
- Give workers `connections:read` only when they need connection metadata, and keep `connections:write` away from workloads that use the connected service.
- Pass a `connectionId` instead of retrieving and forwarding a credential yourself.
- When you retire an integration, delete the connection and revoke the provider-side grant.

## Related

- [Projects and isolation](projects-security.html)
- [Capability approvals](capabilities-agents.html#create-a-protected-action-approval)
- [Endpoint reference](reference.html)

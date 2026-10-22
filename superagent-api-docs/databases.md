# Managed Databases

> https://hivemindos.app/superagent-api/docs/databases · Markdown version: https://hivemindos.app/superagent-api/docs/databases.md

# Managed databases

Managed databases give your app a private place for structured records, such as customers, tasks, inventory, or saved results. The data belongs to the authenticated account and project.

Most apps need three steps: provision the workspace once, create a table, then read and change records.

## Before you start

Use a key with:

- `hivemind-database` in its service boundary;
- `databases:read` for status, structure, records, and transfer status; and
- `databases:write` for provisioning, changes, uploads, downloads, and cancellation.

Use the SDK's database methods; they keep access, confirmation, file-size, and workspace rules consistent.

## Check the account

```ts
const account = await hive.databases.account();
if (!account.ok) throw new Error(account.error);

console.log(account.active, account.tier, account.limits, account.usage);
```

This reports whether database access is active, the plan tier, current limits, this month's usage, and portability support. The returned limits are authoritative for that account.

## Provision the workspace

```ts
import { HIVEMINDOS_DATABASE_CONFIRMATIONS } from "@hivemindos/sdk";

const provisioned = await hive.databases.provision(
  { confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.provision },
  { idempotencyKey: "customer-database-provision-v1" },
);
```

If the account is not eligible or has reached a plan boundary, show the returned next action to the account owner. There is no plan-name or quota override.

## Create tables and records

Changes use `POST /databases/actions` with `databases:write`, an idempotency key, and the exact SDK confirmation for the action.

```ts
const database = await hive.databases.mutate(
  {
    action: "create-database",
    workspaceId: 7,
    name: "Customers",
    confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.createDatabase,
  },
  { idempotencyKey: "customers-database-v1" },
);

const record = await hive.databases.mutate(
  {
    action: "create-record",
    tableId: 42,
    fields: {
      company: "Example Co",
      active: true,
      score: 91,
    },
    confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.createRecord,
  },
  { idempotencyKey: "customer-record-example-co-v1" },
);
```

Put a unique business id in the idempotency key so a retried write returns the original result instead of a duplicate.

| Action | Required fields |
|---|---|
| `create-database` | `workspaceId`, `name`, `confirmation` |
| `create-table` | `databaseId`, `name`, `confirmation` |
| `create-field` | `tableId`, `name`, `fieldType`, `confirmation` |
| `delete-database` | `databaseId`, `confirmation` |
| `delete-table` | `tableId`, `confirmation` |
| `delete-field` | `fieldId`, `confirmation` |
| `create-record` | `tableId`, `fields`, `confirmation` |
| `update-record` | `tableId`, `recordId`, `fields`, `confirmation` |
| `delete-record` | `tableId`, `recordId`, `confirmation` |

Field types: `text`, `long_text`, `number`, `boolean`, `date`, `url`, `email`, `phone_number`, and `file`.

## Read structure and records

Queries use `POST /databases/query` with `databases:read`. They are read-only and need no idempotency key.

```ts
const records = await hive.databases.query({
  action: "list-records",
  tableId: 42,
  page: 1,
  pageSize: 50,
  orderBy: "created_at desc",
});

if (!records.ok) throw new Error(records.error);
```

| Action | Required fields |
|---|---|
| `list-workspaces` | None |
| `list-databases` | `workspaceId` |
| `list-tables` | `databaseId` |
| `list-fields` | `tableId` |
| `list-records` | `tableId`; optional `page`, `pageSize`, `search`, `orderBy` |
| `get-record` | `tableId`, `recordId` |

## Delete the workspace

Deleting the workspace permanently removes its databases, records, usage history, and unfinished transfer files. Export anything you need first.

```ts
const deleted = await hive.databases.deprovision(
  { confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.deprovision },
  { idempotencyKey: "customer-database-delete-v1" },
);
```

Repeating the same confirmed request is safe and returns `active: false`.

## Move a workspace copy

### Copy a workspace to the cloud

Upload a ZIP archive of up to 100 MB. The source workspace is kept.

1. Calculate the archive's byte length and lowercase SHA-256 hash.
2. Call `beginUpload` with the file details and exact confirmation.
3. Split the archive by the returned `partSize` and upload numbered parts starting at 1. Each part must be between 1 byte and 8 MB.
4. Call `completeUpload`.
5. Poll `getTransfer` until the copy is `complete` or `failed`.

```ts
const started = await hive.databases.beginUpload(
  {
    fileName: "customer-workspace.zip",
    expectedBytes: archive.byteLength,
    sha256: archiveSha256,
    confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.migrateToCloud,
  },
  { idempotencyKey: "workspace-upload-2026-08-24" },
);

if (!started.ok) throw new Error(started.error);

const { migration, partSize } = started;
let partNumber = 1;

for (let offset = 0; offset < archive.byteLength; offset += partSize) {
  const part = archive.slice(offset, offset + partSize);
  const uploaded = await hive.databases.uploadPart(
    migration.id,
    partNumber,
    part,
    { idempotencyKey: `workspace-upload-part-${partNumber}` },
  );
  if (!uploaded.ok) throw new Error(uploaded.error);
  partNumber += 1;
}

await hive.databases.completeUpload(
  migration.id,
  { idempotencyKey: "workspace-upload-complete-2026-08-24" },
);
```

Upload from your server, never from a browser holding an API key.

### Copy a workspace to a device

```ts
const started = await hive.databases.beginDownload(
  { confirmation: HIVEMINDOS_DATABASE_CONFIRMATIONS.migrateToLocal },
  { idempotencyKey: "workspace-download-2026-08-24" },
);

if (!started.ok) throw new Error(started.error);

const response = await hive.databases.downloadArchive(started.migration.id);
if (!response.ok) throw new Error(`Archive download failed: ${response.status}`);

const bytes = new Uint8Array(await response.arrayBuffer());
const expectedSha256 = response.headers.get("X-Content-Sha256");
```

- Wait until `getTransfer` reports `archiveReady: true` before downloading.
- Check the bytes against `X-Content-Sha256` before importing. `X-HivemindOS-Archive-Public-Key` shows where the archive came from.
- Transfers expire, so keep the archive in your own storage if you need it later. Cancel an unneeded copy with `cancelTransfer` and an idempotency key.

## Errors

| HTTP | Meaning |
|---:|---|
| 402 | The account needs an eligible subscription or is outside its plan allowance. |
| 409 | The confirmation, transfer state, or idempotency state does not allow the action. |
| 410 | The requested archive has expired. |
| 413 | The JSON request or archive part is too large. |
| 424 | Required managed-service setup is incomplete. |

## Related

- [Endpoint reference](reference.html#managed-databases)
- [Runs and webhooks](runs-webhooks.html)

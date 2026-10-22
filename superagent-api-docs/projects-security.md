# Projects, Isolation, And Service Accounts

> https://hivemindos.app/superagent-api/docs/projects-security · Markdown version: https://hivemindos.app/superagent-api/docs/projects-security.md

# Projects, isolation, and service accounts

A project keeps one product, customer, or environment separate from another. Its wallets, approvals, runs, files, webhooks, database data, usage, and audit history stay inside it. Inside an account or a project, an end user id keeps each of your app's own users apart as well.

Use projects when you have more than one customer, app, or environment. For a small first integration, the account-level default is enough.

## Create a project

Use an account-level key with `projects:write`:

```ts
const created = await hive.projects.create(
  {
    name: "Acme production",
    description: "Managed backend for the Acme application",
  },
  { idempotencyKey: "project-acme-production" },
);

if (!created.ok) throw new Error(created.error);
const projectId = created.project.id;
```

Projects can be listed, read, renamed, and archived. Archiving stops new requests from selecting the project; it does not move its resources anywhere.

## Give each workload its own key

Create a child key with `projectId`. The project binding can never be removed or changed, and every descendant inherits it.

```ts
const worker = await hive.apiKeys.create(
  {
    label: "Acme research worker",
    projectId,
    scopes: [
      "services:read",
      "services:invoke",
      "runs:read",
      "runs:write",
      "artifacts:read",
    ],
    allowedServices: ["hive-research"],
    allowedOperations: [
      "capabilities.list",
      "services.invoke.hive-research.analyses.create",
      "runs.create.hive-research.analyses.create",
      "runs.read",
      "artifacts.list",
      "artifacts.content.read",
    ],
  },
  { idempotencyKey: "key-acme-research-worker-v1" },
);
```

This is the recommended service-account pattern: one project-bound key per workload, with exact scopes, services, operations, expiry, and limits.

## Pick a project with an account key

An account-level key can select an active project for one request:

```http
X-HivemindOS-Project: project_...
```

The TypeScript client sends that header for you when created with `projectId`:

```ts
const acme = new HivemindOSClient({
  apiKey: process.env.HIVEMINDOS_ACCOUNT_API_KEY!,
  projectId: "project_...",
});
```

A project-bound key rejects a different project header. Use one client per project, and never pass an unchecked project id straight from an end-user request.

## Act for one of your app's users

When your app serves its own users, name the user a request is for, so what a service stores for one of them never reaches another. An account-level or project key sends the id on each request:

```http
X-HivemindOS-End-User: user_8f2c41
```

Or bind a key to one end user when you create it, with `endUserId`:

```ts
const userKey = await hive.apiKeys.create(
  {
    label: "Memory for user_8f2c41",
    projectId,
    endUserId: "user_8f2c41",
    scopes: ["services:read", "services:invoke"],
    allowedServices: ["cloud-superbrain"],
  },
  { idempotencyKey: "key-user_8f2c41-memory-v1" },
);
```

- An end user id is 1–128 characters: letters, digits, and `.` `_` `:` `@` `-`, starting with a letter or digit. Use your own stable, opaque user id, and set it in your backend from the signed-in user, never from a value the user can edit.
- The binding is permanent. Every child key inherits it, a bound key cannot name a different end user (`403`), and a request's `X-HivemindOS-End-User` must match the key's binding.
- Runs remember the end user they were created for.
- Keys report the binding in `endUserId`.

## Which services keep a project or user apart

A project-bound key, an `X-HivemindOS-Project` header, or an `X-HivemindOS-End-User` header promises that one project's or one user's data stays apart. The services below keep that promise: a project or end user sees and changes only what it created, never the account's own data or another user's. Plans, allowances, limits and charges stay the account's, so every project and end user draws on the same balance and counts toward the same plan limits.

| Keeps apart | Services |
|---|---|
| Each project and each end user | `cloud-superbrain`, `hive-research`, `swarm`, `x-studio`, `x-transcript`, `reddit-voc`, `media-studio`, `token-autopsy`, `wallet-risk`, `outbound-email`, `hivemind-finance`, `managed-bookings`, `managed-socials`, `hivemind-analytics`, `svg-studio`, `photo-keyworder`, `distill`, `gpu-rentals`, `integration-broker`, `managed-agents`, `managed-workflows`, `copy-trading`, `managed-media`, `miroshark`, `hiveverse`, `hive-compute`, `x-api` |
| Each project (no end user yet) | `hivemind-database`, `managed-wallets`, `managed-trading`, `universal-swaps` |
| Nothing to keep apart: it stores nothing a later call can read back, so any key may use it | `answer-engine`, `managed-models`, `leadgen-data`, `web-data`, `onchain-intelligence`, `hive-bridge`, `testnet-faucet`, `hall` |
| The whole account only | `app-hosting`, `nft-agents` (except `agents.get` and `agents.policy`), `agent-service-access` (except `plans.list`), and the Copy wallet routes of `copy-trading` |

The last row belongs to the account as a whole: an account's hosted sites, its wallet's NFT agents and their earnings, its prepaid service access, and money held in its Copy wallet. A project or end-user request to one of them is refused before anything runs or is charged, for managed-service calls and runs alike:

```json
{
  "ok": false,
  "code": "scope_not_supported",
  "serviceId": "app-hosting",
  "error": "This managed service does not keep one project's data apart from the rest of the account yet, so a project-bound key cannot use it. Use an account-level key."
}
```

Call these with an account-level key and no end user, and keep your own users' data apart in your backend.

On `managed-bookings`, each plan allows one booking profile per account, whichever project or end user sets it up first.

**Memory.** In Cloud Superbrain, each project, each end user, and each end user within a project gets a brain of its own. It starts empty, never includes the account's own memories (or a desktop brain synced to them), and uses the account's plan: every brain in the account shares the one plan's storage and allowance. Plans are bought, and a desktop brain synced, with an account-level request. See [managed memory](memory.html).

## Isolation rules

- Resource ids only mean something inside their account and project. An id from one project returns not found from another.
- Idempotency keys are isolated by project and API key.
- Webhooks receive only events from their project and allowed services.
- Usage and audit queries report only the selected project.
- Managed databases follow the same project boundary.
- A project-bound key cannot create another project or an account-level child key.
- A managed service that cannot keep a project or end user apart refuses the request with `scope_not_supported` instead of serving account-wide data. See [which services keep a project or user apart](#which-services-keep-a-project-or-user-apart).

## Separate your environments

Create separate projects, API keys, and webhook destinations for development, staging, and production. Do not run tests in a production project: isolation protects data, but it cannot tell that a valid production key was used by mistake.

## Related

- [Restrict exact operations](authentication.html#choose-operation-access)
- [Per-endpoint limits](limits.html)
- [Usage and audit events](usage-audit.html)

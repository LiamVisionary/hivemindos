# HivemindOS SuperAgent API

> https://hivemindos.app/superagent-api/docs/ · Markdown version: https://hivemindos.app/superagent-api/docs/index.md

<div class="heroPanel" markdown="1">
<div markdown="1">
<p class="eyebrow">SuperAgent API</p>

# Build with the HivemindOS backend

<p class="lede">Add agents, memory, data, wallets, trading, media, and workflows to your own product.</p>

<div class="actionRow">
  <a href="#quickstart">Make your first call</a>
  <a href="explorer.html">Open the API reference</a>
</div>
</div>
</div>

The HivemindOS SuperAgent API lets your server use managed HivemindOS services. Your app sends a request, HivemindOS does the work, and your app gets the result. Paid work uses the same Agent Credit balance as the rest of HivemindOS.

It does **not** control a user's computer or open a desktop session.


| Resource | Address |
|---|---|
| API base | `https://api.hivemindos.app/v1` |
| Private and confidential bases | `https://api.hivemindos.app/v1/private` and `https://api.hivemindos.app/v1/confidential` ([what they include](privacy.html)) |
| Remote MCP | [`https://api.hivemindos.app/mcp`](https://api.hivemindos.app/mcp) |
| OpenAPI 3.1 contract | [`https://api.hivemindos.app/openapi.json`](https://api.hivemindos.app/openapi.json) |
| TypeScript package | `@hivemindos/sdk` |

## Quickstart

### 1. Get an API key

Pick the path that fits you:

- **Let your coding agent do it.** On [hivemindos.app/superagent-api](https://hivemindos.app/superagent-api/#setup), press **Copy** under "Set it up with your agent" and send it to the agent working on your project. You open one link to sign in, add credits and approve. The agent saves the key in your project's env file and checks it works. See [agent setup](agent-setup.html).
- **Make one yourself** in the [console](https://hivemindos.app/superagent-api/console/#keys).
- **Create one in code** with an existing HivemindOS credit token (shown below).
- **Skip the account.** An agent with an x402 wallet can [pay for a single call](pay-per-call.html) and is charged only if the call succeeds.
- **Earn while you build.** Your first x402 payment is matched, your app earns 5% of what its users spend, and your agent NFTs can earn a fee you set on each reply people get from them (free to chat unless you set one). See [rewards and the Hall](rewards.html).

Keys begin with `hmos_live_`. Keep them on your server: never put one in a browser bundle, mobile app, public repository, log, or analytics event.

To create a key in code, install the SDK:

```bash
npm install https://github.com/LiamVisionary/hivemindos-sdk/releases/download/v1.7.0/hivemindos-sdk-1.7.0.tgz
```

This installs the built SDK from its GitHub release. It works with npm, pnpm and yarn, and is imported as `@hivemindos/sdk`. The API also works with any HTTPS client.

This key can list services and run research, and nothing else:

```ts
import { createHivemindOSApiKey } from "@hivemindos/sdk";

const result = await createHivemindOSApiKey({
  creditToken: process.env.HIVEMINDOS_CREDIT_TOKEN!,
  idempotencyKey: "my-backend-key-v1",
  label: "My backend",
  scopes: ["services:read", "services:invoke"],
  allowedServices: ["hive-research"],
  allowedOperations: [
    "services.list",
    "capabilities.list",
    "actions.list",
    "services.invoke.hive-research.analyses.create",
  ],
  limits: {
    "services.invoke.hive-research.analyses.create": {
      requestsPerMinute: 60,
      maxConcurrent: 2,
    },
  },
});

if (!result.ok) throw new Error(result.error);

// The full secret is returned only now. Save it in your secret manager.
const apiKey = result.secret;
```

`allowedServices` and `allowedOperations` limit what the key can reach. See [authentication and API keys](authentication.html) for every option.

### 2. Make your first call

```ts
import { HivemindOSClient } from "@hivemindos/sdk";

const hive = new HivemindOSClient({
  apiKey: process.env.HIVEMINDOS_API_KEY!,
  projectId: process.env.HIVEMINDOS_PROJECT_ID, // optional
});

const catalog = await hive.services.list();
if (!catalog.ok) throw new Error(catalog.error);

const research = await hive.services.invokeOperation(
  "hive-research",
  "analyses.create",
  { question: "Summarize the strongest evidence for this thesis." },
  { idempotencyKey: "research-thesis-001" },
);

if (!research.ok) throw new Error(research.error);
```

Over plain HTTPS, send the key as a bearer token:

```http
Authorization: Bearer hmos_live_...
```

Every mutation and spending action also needs a unique `Idempotency-Key` header. A retry with the same key and input returns the first result instead of repeating the work.

### 3. Read the result

Every JSON response has the same shape. Check `ok` first:

```json
{ "ok": true, "services": [] }
```

```json
{ "ok": false, "error": "This API key does not have access to that managed service." }
```

A failure may also include `code`, `operationId`, `metric`, and `retryAfterSeconds` so your app can decide what to do next. See [errors](runs-webhooks.html#error-envelope).

### Or connect an agent with MCP

Add `https://api.hivemindos.app/mcp` as a remote Streamable HTTP server and send the key in a protected `Authorization` header. The agent gets four tools: list services, search allowed actions, read, and act. See [Connect an agent with MCP](mcp.html).

If your agent supports reusable skills, download [the SuperAgent API `SKILL.md`](https://hivemindos.app/superagent-api/SKILL.md) so it can keep managing keys, limits, funding, and tests.

## How payment works

- Every key belongs to one HivemindOS account, and paid work uses that account's Agent Credits. A request cannot charge another account or set its own price.
- Wallet assets are separate: Agent Credits pay for managed work, while wallet assets pay transfer amounts, network fees, and trades.
- Managed database capacity follows the account's eligible plan.
- Read the current price with `GET /pricing` and the balance with `GET /credits/balance`. Show the returned final or maximum price before paid work starts.
- A key with `credits:write` can buy more Agent Credits with x402 through `POST /credits/x402/top-up`. HivemindOS fixes the recipient, network, asset, price, and credited account on the server. See the [reference](reference.html#x402-agent-credit-top-up).

## Choose what to build

<div class="docGrid">
  <div class="docCard">
    <h3>Give your app an agent</h3>
    <p>Run research, swarms, mini apps, media work, publishing, analytics, and scheduled workflows.</p>
    <a href="services.html">Browse managed services</a>
  </div>
  <div class="docCard">
    <h3>Add long-term memory</h3>
    <p>Save facts and decisions, find them later, and answer from them.</p>
    <a href="memory.html">Use managed memory</a>
  </div>
  <div class="docCard">
    <h3>Store application data</h3>
    <p>Provision a managed database, then read and change records.</p>
    <a href="databases.html">Use managed databases</a>
  </div>
  <div class="docCard">
    <h3>Build safer money flows</h3>
    <p>Create managed wallets, ask for approvals, and run bounded transfers, signatures, trades, and any-token swaps.</p>
    <a href="wallets-trading.html">Use wallets and trading</a>
  </div>
  <div class="docCard">
    <h3>Run work in the background</h3>
    <p>Track long jobs, save their results, and get signed webhooks.</p>
    <a href="runs-webhooks.html">Use runs and webhooks</a>
  </div>
  <div class="docCard">
    <h3>Control what a key can do</h3>
    <p>Allow only selected services and actions, then set request and spending limits.</p>
    <a href="authentication.html">Create a restricted key</a>
  </div>
</div>

The catalog spans 33 stable service ids. The authenticated service catalog and capability registry are the source of truth: each capability has a stable operation id, access selector, method, path, approval mode, and run support.

## All guides

- Start: [agent setup](agent-setup.html), [authentication and API keys](authentication.html), [pay per call with x402](pay-per-call.html), [rewards and the Hall](rewards.html), [MCP](mcp.html), [per-endpoint limits](limits.html)
- Build: [services](services.html), [AI web search](answer-engine.html), [memory](memory.html), [memory benchmarks](benchmarks.html), [capabilities and agents](capabilities-agents.html), [Hive Compute and testnet assets](compute-faucet.html), [files and connections](files-connections.html), [databases](databases.html), [wallets and trading](wallets-trading.html), [runs and webhooks](runs-webhooks.html)
- Operate: [privacy tiers](privacy.html), [projects and isolation](projects-security.html), [usage and audit](usage-audit.html)
- Reference: [endpoints and scopes](reference.html)

The [OpenAPI contract](https://api.hivemindos.app/openapi.json) is authoritative for request and response schemas.

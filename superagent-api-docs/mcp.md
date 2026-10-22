# Connect An Agent With MCP

> https://hivemindos.app/superagent-api/docs/mcp · Markdown version: https://hivemindos.app/superagent-api/docs/mcp.md

# Connect an agent with MCP

MCP is the simplest way to let an agent use HivemindOS managed services. The agent searches the actions its key allows, reads data, and runs approved work, without you writing a wrapper for each endpoint.

```text
MCP address: https://api.hivemindos.app/mcp
Transport: Streamable HTTP
Authentication: Authorization: Bearer hmos_live_...
```

## Connect it

Add a remote HTTP MCP server, using your client's secret or environment-variable feature for the key:

```json
{
  "mcpServers": {
    "hivemindos": {
      "type": "http",
      "url": "https://api.hivemindos.app/mcp",
      "headers": {
        "Authorization": "Bearer ${HIVEMINDOS_API_KEY}"
      }
    }
  }
}
```

If your client has an **Add remote MCP server** screen, enter the address and add `Authorization` as a protected header. Never paste the key into a shared config file, prompt, repository, screenshot, or browser app.

## Give it a narrow key

An MCP key needs:

- the `services:read` scope;
- the `actions.list` operation, so the server can open the session and return its action catalog; and
- only the extra scopes, services, and exact operations the agent's job needs.

This key can search Cloud Superbrain memory and do nothing else:

```json
{
  "scopes": ["services:read", "services:invoke"],
  "allowedServices": ["cloud-superbrain"],
  "allowedOperations": [
    "actions.list",
    "services.invoke.cloud-superbrain.memory.search"
  ],
  "limits": {
    "services.invoke.cloud-superbrain.memory.search": {
      "requestsPerMinute": 30,
      "maxConcurrent": 3
    }
  }
}
```

Make keys in the [console](https://hivemindos.app/superagent-api/console/#keys) or through the API ([authentication guide](authentication.html)).

## What the agent gets

Four stable tools:

| Tool | Purpose |
|---|---|
| `hive_services_list` | List services the key may use and optionally check live availability. |
| `hive_actions_search` | Find exact allowed actions and their input, approval, and execution details. |
| `hive_read` | Run an action marked read-only. It refuses writes and execution. |
| `hive_write` | Run a write or execution action with a stable idempotency key. It refuses reads. |

Search results are filtered by the key, so a restricted key cannot discover or call an excluded service or operation.

## One tool per operation

Some apps pick from a fixed tool list instead of searching, such as Meta Muse connectors and chat apps with a tool picker. Connect those to:

```text
https://api.hivemindos.app/mcp?tools=operations
```

This adds one tool per operation, named `<service>__<operation>`, such as `svg-studio__svgs_generate` or `token-autopsy__reports_create`. Each tool describes its input with an example, its price, and how to collect a background result. Add `&services=svg-studio,leadgen-data` to list only the services your app uses.

These tools are a view, not extra permission: every call still goes through the key's scopes, services, operations, limits, approvals and privacy tier. A write gets its own idempotency key if the app does not send one.

**Meta Muse:** ask Muse to connect a remote MCP server at `https://api.hivemindos.app/mcp?tools=operations`, authenticated with `Authorization: Bearer <key>`. Give it a key with only the services it should use. Muse keeps the key in its own credential store.

## HivePunkz and other NFT agents

The `nft-agents` service lets Grok Bot, a Muse or any agent with a key use the person's own NFT agents: HivePunkz, Loopers, JPEG Frens and any other NFT that is an agent. Search for `nft-agents` to find its actions.

| Action | What it does |
|---|---|
| `agents.list` | The agents in the wallet the person linked on hivemindos.app/chat, each with an id like `hivepunkz:441`. |
| `agents.get` | Any bee or agent NFT: its card, shift, holder and what its holder shares. Free. |
| `agents.chat` | Talk with one of the person's own agents in its own voice. The linked wallet must hold it. Billed as the model costs. |
| `bees.quote`, `bees.run`, `bees.job` | Talk to or hire someone else's shared bee. Quote, ask the person, then run on exactly the quoted price. |
| `bees.services.list`, `bees.services.set` | See and set what one of your own bees sells. Service `writing` with a `priceUsd` turns paid writing on with nothing to approve onchain; any other service is repriced or switched. The linked wallet must hold the bee. |
| `agents.open` | Set who can talk with one of the person's Loopers, JPEG Frens or other agent NFTs and what it costs. Free until they set a fee (`mode`, `freeUses`, `feeCredits` up to 50, `feePercent` up to 25%). |
| `agents.policy` | Read an agent's rule before talking with it. |
| `agents.ask` | Talk with someone else's agent: its own free chat if it has one, otherwise in its voice on the person's free replies, then credits, plus its holder's fee only if one is set. |
| `agents.earnings`, `agents.claim` | What the person's opened agents have earned, and claiming it into their credits. See [rewards](rewards.html). |

A chat never runs work for the agent. When an agent asks for something to be done, the answer includes it as `work`, and your agent runs it only if the person agrees and the key allows it.

## Rules to give the agent

1. Search before every unfamiliar action. Never invent an `actionId`.
2. Use `hive_read` for actions marked `read` and `hive_write` for `write` or `execute`.
3. Reuse an idempotency key only for the same intended write and the same input.
4. Ask the user before payments, trades, transfers, signatures, deletion, publishing, or any other consequential action.
5. Never send a seed phrase, wallet private key, API secret, or unrelated credential as service input.
6. Treat an approval request or HTTP 402 response as a pause for user confirmation, not permission to continue.

The [SuperAgent API skill](https://hivemindos.app/superagent-api/SKILL.md) includes these rules and the full setup workflow.

## Projects, files, and payments

- A project-bound key always stays in its project. An account-level key can pick a project with the protected `X-HivemindOS-Project` header or the `projectId` tool argument.
- JSON actions return their normal API result. Binary downloads return an authenticated resource link; fetch it with the same key. Binary uploads take `bodyBase64` plus a file header such as `X-File-Name`.
- MCP calls use the same Agent Credit balance, pricing, limits, approvals, and audit trail as REST and the SDK.
- To buy Agent Credits with x402, search for `credits.x402.topUp` and call it with `hive_write`. The first call returns the payment challenge. After the user confirms the exact amount, the x402 wallet signs and the retry sends `Payment-Signature` with the same idempotency key. The MCP cannot change the recipient, network, asset, price, or credited account.

## Protocol details

The endpoint is a stateless Streamable HTTP MCP server. It supports `initialize`, `ping`, `tools/list`, `tools/call`, notifications, and JSON-RPC batches. Tool annotations mark read-only and consequential actions. `GET /v1/actions` publishes the same key-filtered action catalog over REST for SDK clients and custom adapters.

Every call goes through the normal SuperAgent API request path, so MCP adds no second permission system.

For GPU-marketplace-only agents there is also a separate [Hive Compute MCP](compute-faucet.html#connect-an-agent-through-mcp).

## Related

- [Authentication and API keys](authentication.html)
- [Per-endpoint limits](limits.html)
- [API reference](reference.html)

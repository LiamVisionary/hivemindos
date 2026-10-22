# Set up the SuperAgent API with your agent

> https://hivemindos.app/superagent-api/docs/agent-setup · Markdown version: https://hivemindos.app/superagent-api/docs/agent-setup.md

Your coding agent can set up the SuperAgent API in your project for you. You never copy a key: you open one link, sign in, add credits and approve, and the agent collects the key and saves it where your project keeps secrets.

## Set it up

1. On [hivemindos.app/superagent-api](https://hivemindos.app/superagent-api/#setup), press **Copy** in "Set it up with your agent".
2. Paste it into the agent working in your project (Claude Code, Codex, Cursor, Hermes, or any agent that can run commands) and send it.
3. The agent gives you a link and a short code. Open the link and check the code matches.
4. **Sign in or make an account** with your email. One code does both, and the account works on any device. A passkey works too, or you can continue without an email and add one later.
5. **Add credits** by card or crypto, from $5, or choose Later.
6. **Approve.** The page says the account is ready, then shows "your agent has your key" once the agent collects it.

The agent saves the key as `HIVEMINDOS_API_KEY` in your project's `.env.local` or `.env`, makes sure git ignores that file, checks the key works, and tells you your credit balance.

A setup link lasts 60 minutes and can be approved once. The key it makes can use every service but can never move funds: it can't sign, send or trade from a wallet, approve actions, or manage other keys. Those stay with you.

## If your agent can't run commands

Chat apps such as ChatGPT and Claude on the web can't collect the key themselves. Either:

- on the setup link, after approving, open **Using a chat that can't save files?** and press **Show my key** to see the key and the exact `.env` line; or
- make a key yourself in the [console](https://hivemindos.app/superagent-api/console/#keys).

## What the agent does

The setup message points the agent at [hivemindos.app/superagent-api/llms.txt](https://hivemindos.app/superagent-api/llms.txt). With Node.js 18 or newer, the agent runs a small dependency-free script, [setup.mjs](https://hivemindos.app/superagent-api/setup.mjs), that does every step below and never prints the key. If the command times out, running it again continues the same setup.

Without Node, the agent calls the API directly:

1. `POST https://api.hivemindos.app/v1/setup-sessions` with a label and its name. No key is needed. The response has your link (`setupUrl`), the code (`confirmCode`), and a `claimToken` the agent keeps secret. Use `/v1/private/setup-sessions` to pin the key to the [private tier](privacy.html).
2. It shows you the link and the code.
3. It calls `POST https://api.hivemindos.app/v1/setup-sessions/claim` with `Authorization: Bearer <claimToken>` every 5 seconds. The answer is `202` until you approve, then `200` with the key. If that reply is lost, the same claim token returns the same key for 10 minutes.
4. It saves the key and checks it with `GET /v1/services` and `GET /v1/credits/balance`.

### Let the agent pay for the account

An agent with an x402 wallet on Base can pay for the account itself, after you approve the exact amount. It calls `POST /v1/setup-sessions/fund` with its claim token and an `Idempotency-Key`, answers the payment challenge, and gets the key straight away. You then open the same link to take over the account and add your email to keep it.

## Let the integration buy more credits

Give the key the `credits:write` scope and the `credits.x402.topUp` operation. The agent can then add an x402-aware client that pays Base payment challenges and credits the same HivemindOS account.

1. The first request gets an HTTP 402 payment challenge.
2. The agent asks you to confirm the exact dollar amount. Top-ups may be $5 to $500.
3. The wallet client signs and retries with the same `Idempotency-Key`.
4. Success returns a receipt and the updated Agent Credit balance.

HivemindOS fixes and verifies the official revenue wallet, payment network, asset, amount, and credited account, so the integration cannot redirect the payment. See the [reference](reference.html#x402-agent-credit-top-up) for exact headers and fields.

## Keep it as a reusable skill

If your agent supports skills, download [hivemindos.app/superagent-api/SKILL.md](https://hivemindos.app/superagent-api/SKILL.md) and install it the way that agent installs skills. The skill lets the agent keep managing access, endpoint limits, MCP, capabilities, Agent Credits, tests, and audits for the project.

If the agent supports remote MCP servers, it can also connect directly to `https://api.hivemindos.app/mcp` with the same key. See [Connect an agent with MCP](mcp.html).

## Manage keys and billing

The [console](https://hivemindos.app/superagent-api/console/) shows your balance, keys, usage, request history, limits, projects and privacy tiers. Make or revoke keys there, and add credits to the one balance every service draws on.

## Checklist for a finished setup

- The app loads its key from private runtime settings, on the server only.
- The key reaches only the services and actions you chose.
- Endpoint request and concurrency limits are set.
- Balance, service, and capability checks pass through the app's real client.
- A deliberately disallowed capability is denied, when practical to test.
- Mutations use idempotency keys.
- No secret appears in the project diff, logs, tests, or docs.

## Related

- [Authentication and API keys](authentication.html)
- [Per-endpoint limits](limits.html)
- [API reference](reference.html) and the [live OpenAPI document](https://api.hivemindos.app/openapi.json)

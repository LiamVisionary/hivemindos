---
name: b20-issuer-proof
description: Use when a user wants to create, deploy, issue, launch, or inspect the creation proof for a Base B20 token, especially from vague prompts like "make a b20 token", "create B20", "issue a Base native token", or "deploy a B20 stablecoin". The skill prepares a deterministic proof card first, requires explicit confirmation, then creates the token only through the HivemindOS wallet-gated B20 issuer route.
---

# B20 Issuer Proof

Prepare and execute Base B20 token creation with a clear issuer proof, a deterministic address preview, and a hard confirmation gate.

## Contract

- Default to **Base Sepolia** for live tests and early B20 work. Do not deploy on Base mainnet unless the user explicitly requests mainnet and the current B20 mainnet activation status has been verified from official Base sources.
- Treat B20 creation as a wallet/network side effect. Never create the token from the first vague prompt.
- Ask only for missing essentials: token name, symbol, variant when relevant, initial supply, and any non-default admin/minter/recipient wallets.
- Use this agent's encrypted EVM wallet as deployer, admin, minter, metadata admin, pauser, unpauser, and initial mint recipient unless the user gives specific addresses.
- Show a proof card before signing. The proof must include network, factory, deployer, predicted B20 address, salt, token params hash, init calls hash, create calldata hash, roles, supply cap, initial mint, balance/gas readiness, and the exact confirmation instruction.
- Execute only after the user confirms the exact proof. In HivemindOS chat, a plain `confirm` may be mapped by the chat route to the internal `B20_CREATE` confirmation. For direct API/script use, pass `B20_CREATE`.
- If the deployer lacks Base Sepolia ETH, stop with the funding address and do not claim the token was made.
- Never ask for, print, store, or summarize private keys, seed phrases, dashboard auth tokens, or wallet-vault contents.

## Required Inputs

Minimum useful request:

```text
name Adaptive Test Token, symbol ADAPT, initial supply 1000
```

Optional inputs:

- `variant asset` or `variant stablecoin`.
- `decimals 6` through `decimals 18` for asset tokens; stablecoins use 6 decimals.
- `currency USD` for stablecoins.
- `cap 1000` for a fixed supply, or a higher cap for future issuance.
- `admin 0x...`, `minter 0x...`, `recipient 0x...`, and `salt 0x...`.

## HivemindOS Route

Prefer the native authenticated route when available:

```http
GET /api/crypto/b20/issuer-proof
POST /api/crypto/b20/issuer-proof
```

Draft request:

```json
{
  "action": "draft",
  "agentId": "<agent-id>",
  "messages": [
    { "role": "user", "content": "hey make a b20 token" },
    { "role": "user", "content": "name Adaptive Test Token, symbol ADAPT, initial supply 1000" }
  ]
}
```

Create request:

```json
{
  "action": "create",
  "draftMessage": "<assistant proof card text>",
  "confirmation": "B20_CREATE"
}
```

The route signs from the encrypted local wallet vault server-side. It does not accept private keys in the request body.

## Helper Script

Use `scripts/b20-issuer-proof.mjs` only when a local HivemindOS API URL and dashboard device token are available. The script reads `HIVEMINDOS_DASHBOARD_DEVICE_TOKEN` and sends it as the device-token header without printing it.

```bash
node scripts/b20-issuer-proof.mjs draft --base-url http://127.0.0.1:5020 --agent-id <agent-id> --message "name Adaptive Test Token, symbol ADAPT, initial supply 1000"
node scripts/b20-issuer-proof.mjs create --base-url http://127.0.0.1:5020 --draft-message-file /path/to/proof.txt --confirm B20_CREATE
```

## Response Pattern

For an inexperienced first prompt such as:

```text
hey make a b20 token
```

Respond with a short setup question:

```text
I can make this on Base Sepolia. I still need:
- token name
- token symbol
- initial supply

Reply like: name Adaptive Test Token, symbol ADAPT, initial supply 1000
```

After all inputs exist, show the proof card and stop. After the user confirms, create the token and return the token address, transaction hash, and explorer URL, or the exact blocker.

## References

Read `references/b20-issuer-reference.md` before hand-encoding params, roles, init calls, or activation assumptions.

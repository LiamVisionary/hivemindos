# ClawBank platform reference

> Imported from the ClawBank docs (https://app.clawbank.co/docs) plus the HivemindOS
> integration. ClawBank's REST docs are intentionally **discovery-first**: only auth and a
> few request bodies are fully specified; the authoritative per-account surface is the MCP
> tool catalog (`tools/list`) and the capability guide tools (`*_guide`). Treat the typed
> endpoints below as the stable subset and use discovery for everything else.

## What ClawBank is

ClawBank is a financial + legal operating system for autonomous agents. One credential gives
an agent a self-custody crypto wallet, KYC bank rails, off-ramp, autonomous trading, real US
LLC formation, contracts, comms, and more — over a REST JSON API, an MCP JSON-RPC surface,
and a CLI.

- **Base URL:** `https://app.clawbank.co`
- **REST:** `/api/v1/*`, `Authorization: Bearer <api_token>`, `Content-Type: application/json`
- **MCP:** `POST /mcp` (JSON-RPC: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`)
- **CLI:** `clawbank` (npm `clawbank-cli`, Node 20+); `clawbank context`, `clawbank login`, `clawbank list`, `clawbank run <tool> '<json>'`, `clawbank whoami`, `clawbank tui`
- **Env:** `CLAWBANK_API_URL` (default `https://app.clawbank.co`), `CLAWBANK_MCP_URL` (default `…/mcp`), `CLAWBANK_TOKEN`

### Response envelope

Every REST response is `{ "ok": true, "data": {...} }` or `{ "ok": false, "error": { "code": "..." } }`.
Status codes: `200` success, `400` validation, `401` auth, `409`/`422` business rules, `429`
rate limit, `5xx` service errors. MCP `tools/call` returns `{ "isError": boolean, "structuredContent": {...} }`.

### Two money systems (critical distinction)

| | Self-custody wallet | Bank rails (Money) |
|---|---|---|
| KYC | Not required | Required (Bridge.xyz) |
| Provisioning | Auto at signup | After KYC |
| Holds | USDC/tokens on Base + XRPL | USD custodial balance |
| Use for | Trading, on-chain transfers | USD deposits, off-ramp, ACH |

Only banking endpoints (`/money/*`, `/offramp/*`) return `bridge_customer_required`; trading never does.

## Authentication (three-step email flow)

1. `POST /api/v1/auth/request_code` — `{ email }` → emails a login code.
2. `POST /api/v1/auth/verify_code` — `{ email, code }` → `{ bootstrap_token, token_type, expires_at }`.
3. `POST /api/v1/auth/bootstrap/api_tokens` — `{ name, expires_at? }` with `Authorization: Bearer <bootstrap_token>` → `{ api_token, token_type, user }`.

Store the long-lived `api_token` as `CLAWBANK_TOKEN` (never in a file/transcript).

## Capability sections

### Discovery / readiness
- `GET /api/v1/me` (`get_me`) — `{ id, email, bridge_customer_configured, kyc_approved, trading_enabled, wallet { address, chain, provisioned } }`.
- MCP `tools/list` — authoritative per-account catalog with JSON-Schema `inputSchema`.
- Capability guides: `clawbank_coms_guide`, `clawbank_formation_guide`, `clawbank_trading_guide`, `clawbank_contracts_guide` (REST: `/api/v1/<capability>/guide`).
- Schema inspectors: `inspect_formation_payload_schema`, `inspect_fightclub_payload_schema`.

### Wallet (self-custody, KYC-free)
- `GET /api/v1/self_custody/address` — Base address.
- `GET /api/v1/self_custody/token_balance?symbol=USDC` — trading balance.
- `POST /api/v1/self_custody/send_usdc` — `{ to_address, amount }`, gas-sponsored. **Money-moving.**
- `POST /api/v1/self_custody/topup_link` — `{ amount }` → card/Apple Pay funding link.
- Base ↔ XRPL bridge ops (via Squid) — discovery-only schemas.
- MCP: `get_self_custody_wallet_address`, `get_self_custody_token_balance`, `send_usdc_on_base`.

### Trading (vs USDC from the self-custody wallet)
- `GET /api/v1/trading/tokens` — tradeable tokens.
- `POST /api/v1/trading/swaps` — `{ base_token, side: "buy"|"sell", amount_usdc, max_slippage_bps }`. **Money-moving.**
- `POST /api/v1/trading/engines` — long-running strategy; `GET /api/v1/trading/engines/:guid/pnl`.
- `GET /api/v1/trading/report` — account-wide performance.
- MCP: `clawbank_trading_guide`, `execute_spot_swap`, `create_trading_engine`, `get_trading_report`.

### Money (custodial bank rails, KYC-required)
- `GET /api/v1/money/deposit` — deposit instructions.
- `GET /api/v1/money/balance` — custodial balance (not the trading balance).
- `GET /api/v1/money/wallets` (`list_wallets`).
- `POST /api/v1/money/transfers` — `{ chain, to_address, amount }`. **Money-moving.**
- MCP: `get_deposit_instructions`, `list_wallets`, `get_balance`, `create_usdc_transfer`.

### Off-ramp (USDC → USD via ACH)
- `POST /api/v1/bridge/external-accounts` — register US bank (`bank_name, account_name, first_name, last_name, routing_number, account_number, checking_or_savings, street_line_1, city, state, postal_code`).
- `POST /api/v1/bridge/offramp/address` — mint a liquidation address.
- `GET /api/v1/bridge/offramp/history`.
- MCP: `link_offramp_bank_account`, `create_offramp_address`, `get_offramp_status`.

### Formation (real US LLCs)
- `GET /api/v1/formation/jurisdictions` — supported states.
- `POST /api/v1/formation/quotes` → `GET /api/v1/formation/quotes/:token` — quote + status.
- `GET /api/v1/formation/orders` — formed entities.
- **Checkout** files a real entity + takes on-chain payment; `declared_payer_wallet` must match the actual sender. Schema via `inspect_formation_payload_schema`.
- MCP: `clawbank_formation_guide`, `inspect_formation_payload_schema`, `start_formation_checkout`, `get_formation_order`.

### Contracts, Company records, Comms, Fight clubs, Wise
- Contracts: `POST /api/v1/contracts`, `GET /api/v1/contracts/inbox`, `POST /api/v1/contracts/:id/sign`, Shodai milestone state. MCP: `clawbank_contracts_*`.
- Records (read-only governance docs): `GET /api/v1/records/businesses/:id/documents[/:doc]`. MCP: `list_company_records`, `read_company_record`, `get_company_history`.
- Comms (handles, inbox, chat, email, Moltbook): `POST /api/v1/coms/handle`, `GET /api/v1/coms/discover`, `POST /api/v1/coms/messages`, `POST /api/v1/coms/email/send`. MCP: `set_coms_handle`, `discover_coms_users`, `send_coms_message`, `register_coms_moltbook_agent`.
- Fight clubs (runtime-configured): `POST /api/v1/moloch/read/:command`, `POST /api/v1/moloch/write/:command`. MCP: `inspect_fightclub_payload_schema` + `fightclub_<command>`.
- Wise (only if a Wise token is linked): `GET /api/v1/wise/exchange_rate`, `POST /api/v1/wise/send`, `GET /api/v1/wise/recipients`. MCP: `get_exchange_rate`, `send_money`, `list_transfers`.

## HivemindOS integration

ClawBank is wired as a **first-class but isolated** capability: it has its own routes, MCP
tools, chat awareness, and skill, and it does **not** touch the shared crypto-capability-router
(Bankr/x402/Veil/Hyperliquid). Do not look for ClawBank under `/api/crypto/capabilities`.

### Credential

Set `CLAWBANK_TOKEN` (or `CLAWBANK_API_TOKEN` / `CLAWBANK_API_KEY`) in the shared hive env:

```
hive-env-add CLAWBANK_TOKEN <api_token>
```

Optional overrides: `CLAWBANK_API_URL`, `CLAWBANK_MCP_URL`. The CLI config at
`~/.config/clawbank/config.json` (`{ token, apiUrl, mcpUrl }`) is also read as a fallback.
Mint a token via `POST /api/clawbank/auth` (or `clawbank login`).

### Routes (`src/app/api/clawbank/*`, all `requireAuth`-gated)

| Route | Methods | Purpose |
|---|---|---|
| `/api/clawbank` | GET | Readiness + `me` |
| `/api/clawbank/auth` | POST | Onboarding: `request_code` / `verify_code` / `mint_token` |
| `/api/clawbank/wallet` | GET / POST | address+balance / `send_usdc` (gated), `topup_link` |
| `/api/clawbank/trading` | GET / POST | tokens+report / `swap` (gated) |
| `/api/clawbank/money` | GET / POST | balance+deposit / `transfer` (gated) |
| `/api/clawbank/formation` | GET | jurisdictions+orders (checkout via the runner) |
| `/api/clawbank/run` | GET / POST | discovery `tools/list` / run a tool (reads free, writes gated) |

### MCP tools

`clawbank_status`, `clawbank_list_tools`, `clawbank_read` (reads); `clawbank_send_usdc`,
`clawbank_trade`, `clawbank_call` (writes, confirmation-gated and listed in
`EXECUTION_TOOL_NAMES`). The long tail (off-ramp, contracts, coms, formation checkout,
fight clubs, Wise, engines) runs through `clawbank_read` / `clawbank_call` against the
discovered catalog.

### Confirmation tokens

| Token | Action | Gate is wired? |
|---|---|---|
| `CLAWBANK_SEND_USDC` | Self-custody USDC send (`/api/clawbank/wallet`) | Yes |
| `CONFIRM_CLAWBANK_SWAP` | Spot swap (`/api/clawbank/trading`) | Yes |
| `CONFIRM_CLAWBANK_TRANSFER` | Custodial (Bridge) transfer (`/api/clawbank/money`) | Yes |
| `CONFIRM_CLAWBANK_CALL` | Generic write-tool runner (`/api/clawbank/run`) | Yes |
| `CONFIRM_CLAWBANK_OFFRAMP` | Off-ramp link/mint/withdraw | Reserved* |
| `CONFIRM_CLAWBANK_FORMATION` | LLC formation checkout | Reserved* |

\* Off-ramp and formation checkout have no typed route today (their bodies are
discovery-only), so they execute through the generic runner gated by
`CONFIRM_CLAWBANK_CALL`. The `OFFRAMP`/`FORMATION` tokens are defined in
`constants.ts` to reserve the namespace for future dedicated routes.

### Spend discipline

Read-only first (status, balances, deposit instructions, tradeable tokens, reports, guides,
schema inspectors). Money- and entity-moving actions need the exact confirmation token above
and explicit human go-ahead. Never reveal or request the credential; refer to it by key name
and set/missing status only.

## Notes / caveats

- The MCP discovery client (`src/lib/services/clawbank/mcp.ts`) implements the Streamable-HTTP
  handshake to spec but is **unverified against the live server** (no token in the build env).
  The typed REST methods are the verified-shape path.
- Source of truth: `src/lib/services/clawbank/` (client, mcp, tool-policy, constants).

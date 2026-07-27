---
name: clawbank
description: ClawBank — the financial + legal OS for AI agents (app.clawbank.co). Use when the user wants a self-custody crypto wallet, a real US bank account / KYC rails, off-ramp to USD, autonomous trading or spot swaps, forming a real US LLC, contracts, agent comms, or any ClawBank action — through HivemindOS's /api/clawbank/* routes and clawbank_* MCP tools.
license: MIT
---

# ClawBank

ClawBank gives an agent a self-custody crypto wallet (Base/XRPL), KYC bank rails
(Bridge.xyz), off-ramp, autonomous trading, real US LLC formation, contracts, comms, fight
clubs, and Wise — over one credential. In HivemindOS it is a **first-class but isolated**
capability: its own routes and MCP tools, separate from the shared crypto rail router
(Bankr/x402/Veil/Hyperliquid). Do **not** route ClawBank through `/api/crypto/capabilities`.

Full reference: [docs/clawbank/clawbank-platform-reference.md](../../docs/clawbank/clawbank-platform-reference.md).

## Credential

ClawBank needs `CLAWBANK_TOKEN` in the shared hive env. Check presence by **name only**
(never read or print the value):

```
hive-env-check CLAWBANK_TOKEN
```

If missing, mint a token via the three-step email flow (`POST /api/clawbank/auth` actions
`request_code` → `verify_code` → `mint_token`, or `clawbank login`) and store it:

```
hive-env-add CLAWBANK_TOKEN <api_token>
```

Optional: `CLAWBANK_API_URL`, `CLAWBANK_MCP_URL`.

## Always start read-only

1. **Readiness** — `GET /api/clawbank` (MCP `clawbank_status`): is a credential set, is KYC
   approved, is a Bridge customer configured, is trading enabled, what is the wallet address.
2. **Discover** — `GET /api/clawbank/run` (MCP `clawbank_list_tools`): the live per-account
   tool catalog. ClawBank is discovery-first — this is the authoritative surface for anything
   the typed routes below don't cover.

## Typed routes (documented endpoints)

| Need | Route | Notes |
|---|---|---|
| Wallet address + balance | `GET /api/clawbank/wallet?symbol=USDC` | read-only |
| Send USDC (self-custody) | `POST /api/clawbank/wallet` `{ action: "send_usdc", toAddress, amount, confirmation }` | gate `CLAWBANK_SEND_USDC` |
| Card / Apple Pay top-up | `POST /api/clawbank/wallet` `{ action: "topup_link", amount }` | read-ish |
| Tradeable tokens + report | `GET /api/clawbank/trading` | read-only |
| Spot swap vs USDC | `POST /api/clawbank/trading` `{ action: "swap", baseToken, side, amountUsdc, maxSlippageBps?, confirmation }` | gate `CONFIRM_CLAWBANK_SWAP` |
| Bank balance + deposit | `GET /api/clawbank/money` | KYC; read-only |
| Custodial transfer | `POST /api/clawbank/money` `{ action: "transfer", chain, toAddress, amount, confirmation }` | gate `CONFIRM_CLAWBANK_TRANSFER` |
| LLC jurisdictions + orders | `GET /api/clawbank/formation` | read-only |

## Everything else → the discovery runner

Off-ramp, contracts, comms, company records, fight clubs, Wise, trading engines, P&L, and
formation checkout are discovered, not typed. Use:

- **Read** a discovered tool: `POST /api/clawbank/run` `{ tool, args, mode: "read" }` (MCP `clawbank_read`). Rejects non-read tools.
- **Write/execute** a discovered tool: `POST /api/clawbank/run` `{ tool, args, confirmation: "CONFIRM_CLAWBANK_CALL" }` (MCP `clawbank_call`). Inspect the tool's schema first (`inspect_*` / `*_guide`).

Read/write is classified server-side and **defaults to write** (gated) for anything unknown.

## Spend discipline (read before you write)

- Preview first: status → discover/list → inspect schema / guide → quote/report.
- Money- and entity-moving actions (`send_usdc`, `swap`, `transfer`, off-ramp, formation
  checkout, Wise send, custodial transfer) require the exact confirmation token **and**
  explicit human go-ahead. The server route is authoritative for recipient, amount, and
  execution.
- Two money systems: self-custody (Base/XRPL, KYC-free, for trading/transfers) vs custodial
  bank rails (Bridge, KYC-required, for USD/off-ramp). `bridge_customer_required` only comes
  from banking endpoints.
- Never reveal, request, store, or print the ClawBank credential or any wallet secret. Refer
  to credentials by key name and set/missing status only.

## Error handling

Treat errors as control flow: retry only on `429`/transient `5xx`, re-fetch status after any
state-changing call, and check the MCP `isError` flag before assuming success.

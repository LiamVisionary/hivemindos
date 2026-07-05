# Hosted Service Boundary

The MIT-licensed HivemindOS app stays local-first and self-hostable, but the
official HivemindOS cloud, ledger, gateway, marketplace, and enterprise
authority services are not distributed from this public repository.

The public app may call official HivemindOS endpoints for:

- Honey/HIVE ledger reads, signed reward receipts, and managed Honey credits.
- Trusted reward compute through the official compute gateway.
- x402 paid-agent calls through the official paid-agent gateway.
- Free-tier model calls through the official gateway's `free-models` surface
  (`POST <gateway>/api/free-models/<model>/chat/completions`, plus the dynamic
  model inventory at `GET <gateway>/api/paid-agents/<slug>/models`). The
  hosted gateway is the sole authority on the free daily allowance — metered
  per anonymous device id (`X-HivemindOS-Free-Device`) and per client IP, with
  a global daily budget — and reports remaining allowance via
  `X-HivemindOS-Free-Remaining-Requests` / `-Tokens` / `-Reset-At` headers and
  `429` + `Retry-After` when exhausted.
- Official platform-fee and Hyperliquid builder-code policy.
- Production health-report collection for official builds.

Forks can implement compatible self-hosted services, but official settlement,
entitlement, quota, fee-recipient, payout, marketplace, ledger, and receipt
authority must be enforced by HivemindOS-controlled infrastructure or by a
verifiable third-party settlement system.

Private hosted-service source is maintained outside this repo. Do not add
secrets, treasury keys, provider keys, customer data, or official service source
under `workers/`.

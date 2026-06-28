# Hosted Service Boundary

The MIT-licensed HivemindOS app stays local-first and self-hostable, but the
official HivemindOS cloud, ledger, gateway, marketplace, and enterprise
authority services are not distributed from this public repository.

The public app may call official HivemindOS endpoints for:

- Honey/HIVE ledger reads, signed reward receipts, and managed Honey credits.
- Trusted reward compute through the official compute gateway.
- x402 paid-agent calls through the official paid-agent gateway.
- Official platform-fee and Hyperliquid builder-code policy.
- Production health-report collection for official builds.

Forks can implement compatible self-hosted services, but official settlement,
entitlement, quota, fee-recipient, payout, marketplace, ledger, and receipt
authority must be enforced by HivemindOS-controlled infrastructure or by a
verifiable third-party settlement system.

Private hosted-service source is maintained outside this repo. Do not add
secrets, treasury keys, provider keys, customer data, or official service source
under `workers/`.

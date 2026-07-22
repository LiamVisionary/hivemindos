# API Route Rules

These rules apply under `src/app/api/` in addition to the root and `src/` instructions.

## Boundary Discipline

- Authenticate first unless an exact self-authenticating callback or receipt path has a reviewed exception.
- Validate and normalize external values at the route boundary. Return the canonical API envelope; do not hand-roll `{ ok, error }` variants.
- Keep official commercial decisions server-owned. Verify settlement, recipient, network, asset, amount, resource, SKU, tenant, idempotency, expiry, and replay window before granting value.
- Use signed receipts or server-issued sessions for paid or entitlement-changing operations. Never trust local balance, price, entitlement, quota, tenant, or fee claims.
- Mutation routes need explicit authority, idempotency where applicable, audit evidence, and a recovery story. Keep collectors private to Tailscale by default.

## OAuth And Browser Returns

- Read `INTEGRATIONS.md` before adding or debugging OAuth. Desktop client secrets live only in the hosted broker, never the repo or binary.
- For loopback callback providers, add only the exact callback path to `SELF_AUTHENTICATING_API_PREFIXES`. For exact-match providers, register the broker's HTTPS callback and keep confidential-client secrets in the broker.
- A public callback/receipt page must validate signed provider state, allowlist only its exact path, hand off to the registered native scheme, show an obvious “Open HivemindOS” fallback, and retain authenticated app polling as fallback delivery.
- Never return a desktop browser-mediated flow to a protected dashboard URL, and never place tokens or secrets in a deep link.

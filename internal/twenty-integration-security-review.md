# Twenty integration security review

Verdict: **Conditionally approved** for the HivemindOS API connector implemented from the pinned Twenty source at commit `26e8937118c04b8879fb83dee67a2d5d0ca00bce`. This verdict covers adapting the audited MIT REST client subtree and calling Twenty's published HTTP APIs. It does not approve installing, embedding, modifying, or redistributing the Twenty server.

## Reviewed boundary

- Source: `https://github.com/twentyhq/twenty`
- Commit: `26e8937118c04b8879fb83dee67a2d5d0ca00bce`
- Commit date: `2026-08-23T16:08:30+02:00`
- Selected source: `packages/twenty-client-sdk/src/rest`
- Selected license: MIT, copyright Twenty.com PBC
- HivemindOS runtime mode: server-held API key or public-client OAuth with PKCE; optional signed webhook receipt ingestion
- Explicitly excluded: Twenty server, Docker images, enterprise code, generated metadata clients, SDK dependencies, install scripts, telemetry, and background services

The repository's top-level license is primarily AGPL-3.0 and identifies narrower MIT packages. Its application exception permits proprietary applications to use published HTTP APIs, webhooks, application manifests, functions, components, and SDKs without making the proprietary application subject to the AGPL. HivemindOS stays inside that API-facing boundary and ships no Twenty server code.

## Evidence

Focused heuristic audit of `packages/twenty-client-sdk/src/rest` returned zero high, medium, or low findings. Manual inspection confirmed that the selected client builds bounded HTTP requests, supplies a bearer token, serializes JSON, parses responses, and throws typed errors. HivemindOS removed the donor's environment discovery, application-host communication, token mutation, absolute request URLs, and SDK dependencies.

Recorded SHA-256 values:

- `packages/twenty-client-sdk/LICENSE`: `f2c3d261cefa7be3fe81790e777f72c83083b832e653c493db0cc960e81f2b0f`
- `packages/twenty-client-sdk/package.json`: `3be8512acf4950049ae2f8c6a11024e648ec985d2f6cf1fb934fbb117bb4850d`
- `packages/twenty-client-sdk/src/rest/index.ts`: `85abe47b1c86a7a45ee3e77549d5f3d8147711e796f9b97bf73c42d3d8c49c00`
- `packages/twenty-client-sdk/src/rest/__tests__/RestApiClient.test.ts`: `f256eadce6d2af78b20d2dfc07b1d55bacdbb23ef8fe022eb3440c29ff9f607a`

The whole repository heuristic scan was not used as an install approval. It reported install-oriented and generated-code findings outside the selected subtree, including a mutable `curl | bash` development Docker step. Because no Twenty package, image, binary, lifecycle hook, or service is installed, a dynamic sandbox install was intentionally skipped.

## Hardening applied

- Only relative `/rest/` paths can receive the bearer credential.
- HTTPS is required except for an explicitly local self-hosted workspace.
- Redirects are refused, requests time out, and responses are size-bounded.
- OAuth uses discovery, dynamic public-client registration, a one-use random state, PKCE, a short-lived private pending-flow file, and server-side token storage.
- Disconnect removes access, refresh, client-registration, workspace, and webhook credentials.
- Webhooks require a timestamped HMAC, a five-minute replay window, an exact payload signature, and a bounded body.
- Webhook receipts omit the full customer record.
- CRM writes require exact action confirmation, an idempotency ledger, bounded JSON, reserved-field rejection, and company task/agent/limit checks for runtime agents.

## Residual risk and re-audit triggers

This review does not establish the security of a user's Twenty deployment, its plugins, its workspace role configuration, or future upstream changes. Re-audit before changing the pinned donor commit, adding an SDK dependency, installing a Twenty image/service, widening the API path allowlist, accepting redirects, or copying code from outside the selected MIT subtree.

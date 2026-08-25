# NocoDB 2026.08.1 Integration Review

## Verdict

- **Approved:** HivemindOS may connect over the bounded REST client to a user-operated NocoDB instance on loopback or a reviewed private Tailscale fleet address.
- **Blocked:** HivemindOS may not install or start the reviewed local container stack. The exact NocoDB image has 3 critical and 11 high findings, PostgreSQL has 4 critical and 39 high findings, Redis has 2 critical and 3 high findings, and the NocoDB container runs as root. A one-click installer inside a paid product may also fall within NocoDB's commercial embedding terms, so commercial-license review is required before activation even after the image findings are resolved.
- **Blocked:** HivemindOS may not offer hosted or managed NocoDB access until Rizzma Inc. has a reviewed NocoDB commercial/OEM agreement and the service is registered in HivemindOS-controlled commercial infrastructure.

## Reviewed Provenance

- Release: NocoDB `2026.08.1`, published 2026-08-19.
- Source commit: `2898c01789f0817af712aebba859a8d14aa7e5d8`.
- GitHub release source archive SHA-256: `5bdc208507586646de6445b3f8e5fbf235153bff9afe63cb20c2046b16f0f42e`.
- NocoDB multi-architecture image: `nocodb/nocodb@sha256:2aacc3c704d4f74b27e2a39ac838ac9019c0b008bbbfff673b541a3a75ee1579`.
- PostgreSQL 17.10 image: `postgres@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317`.
- Redis 7 image: `redis@sha256:91d0f7e8c748ec7a4c2b4fb2c4f84edab794dd91d01e095e38dc906db9d684ab`.
- Upgrade policy: no floating tags. Re-check license, source, images, environment flags, and runtime behavior before changing any digest.

## Static Review

The reviewed path does not run the repository's package lifecycle scripts and does not build mutable source. The blocked Compose model references only the three exact images above and never mounts a home directory, browser profile, SSH directory, keychain, Docker socket, or shared credential file into the containers. The runtime service refuses both install and start actions; only status and stopping an already-present project remain available.

The prepared stack disables NocoDB anonymous telemetry, support chat, error reports, external-database connections, private-network webhooks, local data imports, and automation logs. It exposes only NocoDB on loopback. PostgreSQL and Redis have no host ports. Logs are size-limited. The connector sends the API token only to a validated loopback or private Tailscale origin, refuses redirects, bounds responses to 2 MiB, caps list calls at 100 records, and caps mutation payloads at 64 KiB.

## Dynamic Review

An isolated no-secret Compose project reached healthy state through the real startup path in about 94 seconds. `/api/v1/health` returned `{"message":"OK"}`. Docker inspection confirmed only `127.0.0.1:8080` was published and neither PostgreSQL nor Redis had host bindings. The audit project, containers, network, and all three temporary volumes were removed afterward.

Docker Scout indexed the exact ARM64 images on 2026-08-24. It reported 14 critical/high findings in NocoDB, 43 in PostgreSQL, and 5 in Redis. Several findings have upstream fixes, while others were reported without a fixed version. This fails the install-security gate even though loopback binding reduces exposure.

## Remaining Risk

NocoDB is a large third-party application. The exact image runs as root and retains network access. The source includes an on-premise agent path that may contact NocoDB infrastructure periodically; disabling anonymous telemetry and reports does not prove that every optional outbound path is unreachable. Community self-hosted API tokens may cover all resources and may not expire. Restrict admin access, use a dedicated connector token, keep the service on loopback or a private fleet address, and monitor outbound traffic when stronger isolation is required.

Stopping the service is recoverable and preserves all volumes. Removing the Compose project with volumes would be destructive and is deliberately not exposed as an in-app action.

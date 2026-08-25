# Hivemind Database 2026.08 Review

## Decision

- **Approved for local self-hosting:** ship a HivemindOS-managed installer around the Baserow Open Source Edition, restricted with `BASEROW_OSS_ONLY=true`, loopback-only ingress, sign-ups disabled after owner creation, exact image digests, and HivemindOS hardening overlays.
- **Approved in source for a managed subscriber service:** use the same Open Source Edition in private HivemindOS infrastructure, with one isolated engine workspace per authenticated HivemindOS account. Entitlement, hierarchy, quotas, idempotency, and migration ownership remain server-authoritative.
- **Not deployed:** the Worker database identifier is deliberately still a placeholder, no D1/R2 resources or production runtime were created, no migration was applied, and no DNS or Worker release changed in this task.
- **NocoDB remains a user-operated connector only:** its current Sustainable Use License does not provide the commercial hosting right required for HivemindOS to sell managed NocoDB without a separate agreement.

## License Basis

Baserow's repository states that the core Open Source Edition is MIT licensed and that Premium and Advanced functionality use Baserow's commercial license. The reviewed runtime forces the Open Source Edition path and neither installs nor enables premium/enterprise functionality. Primary references:

- <https://github.com/baserow/baserow/blob/develop/LICENSE>
- <https://github.com/baserow/baserow>

The commercial conclusion is limited to the MIT-covered Open Source Edition. It does not cover Baserow Premium, Advanced, hosted branding claims, trademarks, or future releases. Re-review the license and the full image set before every engine upgrade.

## Reviewed Release And Provenance

- Engine release: Baserow `2.3.3`.
- Backend: `baserow/backend@sha256:7c00549b3a6fd79ab861b9eb63468152d5a4c9deac9d6b60d840fdf0284c87c2`.
- Web frontend: `baserow/web-frontend@sha256:566d24c7d9f5995e5a1a660293e151c72bc1371c294930e6d1abc0948e04fe21`.
- PostgreSQL: `postgres@sha256:5fe8ca7fc662071188c30271cb870d1ce9a6ec4578c934b064697ae77a9241e1`.
- Redis: `redis@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`.
- HivemindOS overlays: backend, frontend, and PostgreSQL are rebuilt as versioned `2.3.3-hardened.1` images; pulls never use floating tags.

The backend overlay removes unused Perl and PostgreSQL CLI packages and pins patched Python packages. The frontend overlay pins patched `linkify-it`, `brace-expansion`, and `xlsx` packages. The PostgreSQL overlay upgrades Alpine packages and replaces the Go-based `gosu` binary with `su-exec`. Startup performs independent provenance and hardening assertions before any local service can run.

Docker Scout review on the hardened images found no critical/high findings in the backend, PostgreSQL, or exact Redis images. The frontend scanner reported two SheetJS metadata findings against version ranges that do not include the installed `xlsx 0.20.3`; the actual package version and affected ranges were checked directly. Treat this as a reviewed false positive, not a blanket scanner waiver.

## Local Trust Boundary

- Only `127.0.0.1:8095` is published. PostgreSQL, Redis, workers, media, and backend services have no host port.
- A small Node gateway routes UI/API traffic and serves media with `nosniff` plus a sandbox content-security policy. It refuses media path traversal.
- The installer generates private owner, database, Redis, application, and signing secrets under `~/.hivemindos/services/database` with owner-only permissions.
- New sign-ups and invitation sign-ups are disabled immediately after the local owner is created.
- Private-address webhooks, integrations, data sync, and SSO callbacks are disabled. Active-content upload policy is set to block. OpenTelemetry and the support surface are disabled. Baserow treats some feature switches as enabled whenever the value is non-empty, so the reviewed Compose files deliberately leave the OpenTelemetry and private-webhook enable switches empty; the focused tests pin those exact semantics.
- Local connection URLs accept loopback or reviewed private fleet addresses; redirects and oversized responses are rejected.
- Stop is recoverable and preserves named volumes. The app exposes no remove-volumes action.

## Managed Trust Boundary

The managed path spans the private sibling `hivemind-cloud-services` repository:

1. The desktop app authenticates with the user's single HivemindOS account token and cannot choose a payer, tier, workspace mapping, quota, or official service origin in production.
2. The paid-agent gateway proves the account and its active Plus, Pro, or Max subscription over an internal service-authenticated route.
3. The database Worker owns the account-to-workspace mapping, validates the complete workspace/database/table/record hierarchy, applies quotas, claims idempotency keys, meters operations and transfer bytes, and stores migration receipts.
4. The private runtime adapter owns the engine administrator credential and exposes only an allowlisted set of operations to the Worker. It cannot select a customer account.
5. A private trust broker reads only transfer/media archive paths, extracts and validates the archive's RSA public signing key, temporarily registers that public key for an import, and removes the temporary trust record after the import. It never receives, exports, or stores another installation's private signing key. Cloud-to-local downloads carry the validated public key alongside the separately verified archive checksum; the local installer validates it again before registering the managed source.

The shared runtime contains one engine workspace per HivemindOS account. This is logical tenant isolation inside a shared runtime, not a separate database process per customer. A future enterprise tier that promises process or database-level isolation requires a distinct architecture and contract.

## Included Subscription Limits

The authoritative cloud service mirrors these initial limits and rejects client overrides:

| Tier | Workspaces | Databases | Tables | Rows | Storage | Transfer/month | Operations/month |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Plus | 1 | 10 | 100 | 100,000 | 1 GiB | 5 GiB | 100,000 |
| Pro | 1 | 50 | 500 | 1,000,000 | 5 GiB | 25 GiB | 1,000,000 |
| Max | 1 | 200 | 2,000 | 5,000,000 | 20 GiB | 100 GiB | 5,000,000 |

There is no standalone or per-seat database charge in this design. Managed availability is a resource entitlement attached to an active subscription. The free local path has no HivemindOS subscription fee; the user provides their own machine and local runtime resources.

## Two-Way Portability Contract

Both directions use the engine's native workspace ZIP export/import format rather than a HivemindOS-specific row dump.

- Local to cloud: export the chosen local workspace to an owner-only temporary file; enforce the 100 MiB transfer bound; calculate SHA-256; create an authenticated migration receipt; upload exact 8 MiB parts; reassemble and verify byte count plus digest; import into the mapped managed workspace; roll back applications created by a failed import; delete the temporary archive and multipart objects. The local workspace is never deleted.
- Cloud to local: export the mapped managed workspace; verify and store the archive behind an expiring authenticated receipt; download and independently verify size plus SHA-256; create a new local staging workspace; import; delete only that staging workspace if import fails; clean temporary files and expire the cloud archive. The managed workspace is never deleted.

Native workspace archives include tables, fields, relations, views, rows, attachments, and supported workspace applications. They exclude users, memberships/permissions, domains, webhooks, and personal settings. The destination must run the same or a newer compatible engine release. Local and managed image upgrades therefore need coordinated compatibility tests before promotion.

The end-to-end harness builds two fresh isolated runtimes, writes and updates real records, exports the source workspace, imports it into the managed runtime, adds another managed record, exports it back, imports it into a new local workspace, and verifies both sources remain unchanged. It also checks SHA-256 digests, public-key handoff, usage reporting, and rollback after a corrupt import. The 2026-08-24 run passed through both native signed-archive directions and removed its test containers and volumes afterward.

## Deployment Gate And Recovery

Before any production deployment:

1. Create the dedicated D1 database and R2 bucket; replace the placeholder database id; apply the schema migration.
2. Provision the private runtime behind HivemindOS-controlled HTTPS ingress and take a restorable PostgreSQL plus media backup.
3. Set matching internal and runtime secrets without placing values in source, docs, logs, or the desktop app.
4. Deploy the database Worker and paid-gateway binding through a zero-traffic canary, then compare the existing catalog and subscription paths against baseline.
5. Run a funded Plus/Pro/Max entitlement matrix and the full local-to-cloud-to-local E2E through the deployed origins with synthetic data, then delete only the synthetic account mapping and archives.

Rollback keeps customer data in place: return the Workers and runtime to their prior version, restore the matching PostgreSQL/media backup when a schema-incompatible runtime rollback requires it, and preserve D1/R2 receipts until the investigation is complete. Never remove named volumes or customer workspaces as part of code rollback.

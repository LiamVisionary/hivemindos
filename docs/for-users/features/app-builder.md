---
title: "App Builder"
---

# App Builder

HivemindOS agents can create and work on an app without requiring a managed
cloud machine. The same app-building capability selects either a machine you
control or an existing Managed Cloud Agent.

## Build On Your Own Machine

Choose a directory on This Mac or another connected fleet machine. The agent
can create a reviewed Next.js starter there and register it as a HivemindOS
project. Source files remain on that machine.

Local projects support:

- project creation and status
- bounded file browsing and reading
- confirmation-gated file writes, renames, and deletes
- confirmation-gated dependency installation
- confirmation-gated start and stop
- a loopback-only development preview
- automatic discovery in Apps while the preview is running
- deterministic static and dynamic hosting artifacts with secret and symbolic-link checks

The agent cannot silently choose a filesystem destination. Project creation
uses a directory selected by the operator or already attached to the task.
Dependency installation and runtime execution remain separate confirmations,
so creating source files does not automatically execute downloaded code.

## Build On A Managed Cloud Agent

Choose the managed backend when the app must live on an existing Managed Cloud
Agent. Project metadata and ownership remain server-authoritative, while source
stays on that agent's retained workspace.

The first managed slice supports creating, listing, and reading projects. Local
file editing and runtime lifecycle are not presented as managed capabilities
until their isolated-container implementation is available.

Managed projects can prepare the same bounded static release artifact from an
`out` directory when the managed agent is running. Publishing that artifact is
still a separate hosting purchase; owning a managed agent never grants or
requires a hosting entitlement.

## Test Deploy For 60 Minutes

An agent can create an external Cloudflare Temporary Account deployment for a
quick online verification loop from either a built static site or a bounded
dynamic Worker. This action requires explicit confirmation, uses Wrangler
4.102 or newer, returns a `workers.dev` preview, and expires after 60 minutes
unless the user claims the temporary Cloudflare account.

The claim URL grants ownership and must be treated like a credential. It is not
stored in Shared Brain or ordinary project logs. This external preview is not a
HivemindOS hosting purchase and does not use a HivemindOS domain.

## Publish With HivemindOS

Official hosting is independent of where the project was built. A user can
build on their own machine, a connected fleet machine, or a Managed Cloud Agent
and publish to a stable URL such as:

```text
https://hivemindos.app/build/example-site-a7k2
```

The live server-owned catalog currently defines these plans:

| Plan | Runtime | Charge | Lifecycle |
| --- | --- | ---: | --- |
| Share Preview | Static | $1 | Seven days |
| Hosted Site | Static | $5 | 30 days, renewable from hosted credits |
| Pro Site | Static | $15 | 30 days, renewable from hosted credits |
| Dynamic App | Isolated Worker | $25 | 30 days, renewable from hosted credits |

The downloaded app never chooses the official price or expiry. It sends a plan
identifier and a confirmed publish request; HivemindOS-controlled
infrastructure resolves the price, verifies the hosted credit token, records an
idempotent debit, and activates the release. Existing card and x402 top-ups fund
the same encrypted hosted-credit pool.

Static publishing reads a generated `out` directory. The current client
transport accepts at most 1,000 files, 20 MiB total, and 5 MiB per file.
Dynamic publishing reads one bundled `dist/worker.mjs` module and runs it as an
untrusted Workers for Platforms tenant with server-controlled CPU and
subrequest limits and no customer-selected bindings.

Recurring plans can renew automatically while the hosted credit balance is
sufficient. A failed renewal enters a seven-day grace period. Unpublished or
expired releases remain recoverable for 30 days before their private artifacts
and tenant Worker are deleted. “Permanent hosting” therefore means ongoing
renewable hosting, not an irreversible lifetime promise.

Hosted publishing appears only when the official hosting service, branded
route, storage, billing service, and dynamic namespace are configured. Local
building and loopback previews continue to work when that service is absent.

## One Project Contract

Local and managed projects use the same versioned templates, operation names,
confirmation requirements, and capability catalog. HivemindOS reports which
operations each backend currently supports instead of letting the dashboard,
agents, and cloud service maintain separate feature lists.

This keeps local-first operation independent of managed credits while ensuring
that a project can later move between execution backends without changing its
basic identity or template contract.

## Safety Model

- Project paths cannot escape the selected workspace or traverse symbolic links.
- File reads and writes have size limits.
- Package installation uses argument arrays and disables dependency lifecycle scripts.
- Development servers bind to loopback and use the project's own installed runtime.
- Stop operations verify that the process still belongs to the project before terminating it.
- Remote machine calls are restricted to discovered fleet collector addresses.
- Managed ownership, entitlements, credentials, and audit state remain in HivemindOS-controlled infrastructure.
- Hosted artifacts are rehashed and revalidated server-side before activation.
- Static releases stay in private object storage and are served through the branded hosting gateway.
- Dynamic releases receive no platform bindings and execute with plan-owned limits.
- Failed activation after a charge triggers a compensating hosted-credit refund.

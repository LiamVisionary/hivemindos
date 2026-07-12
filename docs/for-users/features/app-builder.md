---
title: "App Builder And Web Hosting"
---

# App Builder And Web Hosting

App Builder gives you a Replit/Lovable-style app-building experience inside
HivemindOS. Start with an idea, ask an agent to create the project, review or
change files, install dependencies with confirmation, run a local preview, and
publish your finished app without leaving the HivemindOS workflow.

A Managed Cloud Agent is optional. You can build on This Mac or another linked
machine, then publish the finished app through HivemindOS hosting. The computer
that holds the source code and the cloud service that serves the finished site
are separate choices.

## From Prompt To Published App

1. **Choose where the source lives.** Use This Mac, another connected fleet
   machine, or an existing Managed Cloud Agent.
2. **Create and refine the project.** The agent can start from the reviewed
   HivemindOS template, inspect the project, and propose bounded file changes.
3. **Preview locally.** Start the development server on a private loopback URL
   and keep iterating with the agent.
4. **Share a test build.** Create a free 60-minute Cloudflare preview when
   someone outside your machine needs to see the work in progress.
5. **Publish when it is ready.** Buy a temporary share link or renewable Site
   on `build.hivemindos.app`, choose who can open it, and roll back if a later
   version is not right.

The result can be a static website or a bounded dynamic edge app. Static Sites
are suited to landing pages, portfolios, documentation, dashboards with
client-side data, and generated exports. Dynamic Apps can run server-side
request logic with isolated, Site-scoped capabilities.

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
https://build.hivemindos.app/build/example-site-a7k2
```

The server-owned product catalog defines these plans; only plans with available
managed capacity are returned by the live catalog:

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

Each hosted app is a persistent Site project. You can save a new immutable
version without changing the live website, inspect version and production
deployment history, explicitly deploy a selected version, or roll production
back to an earlier saved version. The familiar Publish action remains available
as a shortcut that saves and deploys in one confirmed operation. When a local
project is a Git worktree, its saved version automatically records the current
commit; non-Git project folders remain supported.

For a local project, `.hivemindos/hosting.json` links the source folder to its
Site. It intentionally contains only the Site project id and optional logical
binding names:

```json
{
  "project_id": "site_example",
  "d1": ["DB"],
  "r2": ["BUCKET"]
}
```

Environment values, physical storage identifiers, share tokens, prices, and
entitlements never appear in this file. Environment values are encrypted and
kept by the hosted service; the app can list their key names but cannot read
their stored values back.

Site access can be private, workspace-token-scoped, available through a
revocable link, or public. Private and workspace Sites do not become
anonymously visible; workspace mode admits only workspace access tokens issued
by the hosted authority, pending a future member-directory sign-in broker.
Link access uses a revocable URL and a secure, Site-scoped browser cookie so
assets and page navigation continue to work without exposing the token in every
request.

Static publishing reads a generated `out` directory. The current client
transport accepts at most 1,000 files, 20 MiB total, and 5 MiB per file.
Dynamic publishing reads one bundled `dist/worker.mjs` module and runs it as an
untrusted Cloudflare Dynamic Worker with server-controlled CPU and
subrequest limits. Declared D1/R2-style bindings are narrow, per-Site
capabilities; user code never receives the hosting control database or raw
multi-tenant artifact bucket. The official catalog
omits this plan until the managed dynamic runtime is enabled, so a user cannot
be charged for unavailable execution capacity.

The Dynamic App plan includes a server-enforced 30-day allowance of 10 million
requests, 250 million reserved CPU-ms, 1 million storage operations, and 1 GiB
of runtime storage. Each request reserves the full 25ms execution ceiling even
when it finishes faster, so a customer cannot turn unmetered CPU into a surprise
platform bill. `hosting_usage` reports the current counters and reset time. When
a request or CPU allowance is exhausted, the Site returns HTTP 429 until its
next usage period. Storage operations are rejected after their allowance is
exhausted, and writes stop at the capacity limit without corrupting the prior
value.

Recurring plans can renew automatically when you turn on auto-renew and the
hosted credit balance is sufficient. This is a renewable 30-day hosting
entitlement funded from hosted credits, not an irreversible lifetime purchase.
A failed renewal enters a seven-day grace period. Unpublished or expired
releases remain recoverable for 30 days before their private artifacts and
isolated runtime release are deleted.

Manual renewal opens seven days before the current period ends. Manual and
automatic renewal use the same server-generated billing-cycle identity, so a
race or retry cannot debit the same period twice. Hosted Site and Pro Site plan
changes use a published **full-price extension** policy: the new plan takes
effect immediately, all remaining hosting time is preserved, and one complete
30-day period is added. There is no partial refund, hidden proration, or
client-selected credit amount.

Hosted publishing appears only when the official hosting service, branded
route, storage, and billing service are configured. Dynamic publishing appears
only when its isolated runtime is also available. Local building and loopback
previews continue to work when the hosted service is absent.

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
- Dynamic releases receive only declared, Site-scoped capabilities and execute with plan-owned limits.
- Hosted environment values are encrypted server-side and are never written to the project manifest or returned by list APIs.
- Access tokens are stored as hashes and can be revoked by changing the Site access policy.
- Failed activation after a charge triggers a compensating hosted-credit refund.

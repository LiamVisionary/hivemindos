---
name: posthog-provisioning-and-query
description: Use when provisioning or reading PostHog analytics via its API — creating a project, wiring the browser SDK, or querying metrics/funnels with HogQL. Covers the org→project model, the two key types (personal vs project-public), the ingestion-vs-management host split, and how to avoid creating a redundant project when one already exists. Triggers include "set up PostHog", "create a PostHog project", "track events in PostHog", "read PostHog analytics", "PostHog funnel", "provision analytics".
---

# PostHog Provisioning & Query

Provision and read PostHog entirely over its REST API. Verified against PostHog Cloud (2026-07).

## The model (get these straight first)

- **Account → Organization(s) → Project(s).** A project (a.k.a. "team") is the isolation unit — one project per site/app/funnel. Orgs are the billing/team boundary; you rarely need a new org, usually a new **project**.
- **Two key types, do not confuse them:**
  - **Personal API key** (`phx_…`, secret) — used server-side for the **management API** and **HogQL queries**, with `Authorization: Bearer <key>`. Scope it (`query:read`, `project:read`) for least privilege; a broad "management" key also works but is overpowered for read-only query use.
  - **Project API key** (`phc_…`, PUBLIC) — the browser SDK key, safe to ship to clients as `NEXT_PUBLIC_POSTHOG_KEY`.
- **Host split:** browser **ingestion** host is `https://us.i.posthog.com` (EU: `eu.i.posthog.com`); the **management/query** host is `https://us.posthog.com` (EU: `eu.posthog.com`). Using the wrong one is a common silent failure.

## ALWAYS check for an existing project first

Before creating anything, look at where the app already sends events (its `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_PROJECT_ID` in the host's env). Many sites already have a project — creating a second one splits analytics and leaves a confusing empty project. List what a key can see:

```bash
curl -s https://us.posthog.com/api/organizations/ -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" \
  | jq '.results[] | {id, name, teams: [.teams[] | {project_id, api_token, name}]}'
```

If a suitable project exists, reuse it (segment a new funnel by event name, not a new project).

## Create a project (only if none fits)

```bash
ORG=<organization_id>   # from the list above
curl -s -X POST "https://us.posthog.com/api/organizations/$ORG/projects/" \
  -H "Authorization: Bearer $POSTHOG_PERSONAL_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"My Project"}'
# response → { "id": <numeric project id>, "api_token": "phc_…" (public browser key), ... }
```

Set `NEXT_PUBLIC_POSTHOG_KEY = <api_token>`, `POSTHOG_PROJECT_ID = <id>`, `NEXT_PUBLIC_POSTHOG_HOST = https://us.i.posthog.com` in the host env (build-time for `NEXT_PUBLIC_*`).

## Browser tracking

Initialize the SDK only if the key is present; capture pageviews manually on route change if the router doesn't. Emit a stable event contract you can query later, e.g. `offer_viewed`, `offer_checkout_started`, `cta_clicked {location,label,href}`, `paid`. Server components can't use the browser SDK — fire a client "ping" component for view events, and count server-side metrics in your own store.

## Read metrics with HogQL

```ts
// POST {mgmtHost}/api/projects/{projectId}/query/  — Bearer personal key, scope query:read
const res = await fetch(`https://us.posthog.com/api/projects/${projectId}/query/`, {
  method: "POST",
  headers: { Authorization: `Bearer ${personalKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { kind: "HogQLQuery",
    query: `SELECT count() AS events, count(DISTINCT person_id) AS visitors
            FROM events WHERE timestamp > now() - INTERVAL ${days} DAY` } }),
});
// runs synchronously (blocking is the default; no async polling).
// response → { results: any[][], columns, types }  — results[0] = [events, visitors]
```

`person_id` is the standard unique-users column on the `events` table. Both `/api/projects/{id}/` and `/api/environments/{id}/` work; prefer `projects` for compatibility with older self-hosted instances. Bound the request with a timeout and surface PostHog's error message on non-2xx.

## Optional: create a funnel insight

`POST /api/projects/{id}/insights/` with a funnel spec (steps `offer_view → checkout_started → paid`). Best-effort — never abort provisioning if it fails.

## Safety

- Treat the personal/management key as a secret — write it to the host env, never print or commit it.
- The `phc_` project key is public by design (it's in the browser bundle) — don't treat a leak of it as a secret incident, but don't reuse it as a personal key.
- Verify a key with a cheap read (`GET /api/organizations/`) before relying on it; confirm it can query the specific project id you'll use.

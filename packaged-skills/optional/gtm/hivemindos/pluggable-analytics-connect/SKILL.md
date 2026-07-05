---
name: pluggable-analytics-connect
description: Use when adding a generic, multi-provider analytics view to an app — an at-a-glance dashboard for any entity (company, project, site) that reads from any provider (PostHog, Plausible, GA4, or a custom/self-hosted funnel) with a guided setup flow when nothing is connected yet. Covers the provider-adapter abstraction, per-entity provider linking, shared-env credentials, and honest empty states. Triggers include "add an analytics tab/section", "connect an analytics provider", "generic analytics for every user", "guided analytics setup", "show at-a-glance metrics per company/project".
---

# Pluggable Analytics Connect

A provider-agnostic analytics layer: each entity (a company, project, or site) optionally links to ONE analytics provider; a normalized adapter fetches an at-a-glance summary; the UI renders honest states including a guided setup when unconfigured. Generic across users because credentials live once in shared env (keyed by name) and the per-entity link stores only a non-secret project/site id.

Pairs with `posthog-provisioning-and-query` (the PostHog adapter) and `self-serve-payment-funnel` (the funnel a "self-funnel" provider reads).

## The adapter abstraction

```ts
type AnalyticsSummary = {            // normalized; ALL fields optional so a partial provider still renders honestly
  rangeDays: number;
  visitors?: number; conversions?: number; conversionRatePct?: number;
  revenueUsd?: number; revenueDisplay?: string;
  topEvents?: { name: string; count: number }[];
  funnel?: { name: string; count: number; conversionPct?: number }[];
  timeseries?: { date: string; visitors: number }[];
};

type AnalyticsAdapter = {
  key: "posthog" | "plausible" | "ga4" | "self-funnel";
  label: string; detail: string;             // picker copy
  credentialEnvKey: string;                   // shared-env var holding the credential ("" if none)
  requiresCredential: boolean;
  configFieldLabel: string; configFieldHint: string; configFieldPlaceholder: string; // per-entity id/domain
  getSummary(ctx, opts): Promise<AnalyticsSummary>;  // MUST throw a human-readable Error on failure
};
```

The registry resolves an entity's provider + credential and returns a **four-state discriminated result** — this is what makes the UI honest:

```ts
type AnalyticsSummaryResult =
  | { state: "live"; provider; providerLabel; summary }
  | { state: "unconfigured"; providers }         // no provider linked → guided setup
  | { state: "credential-missing"; provider; providerLabel; credentialEnvKey } // linked but shared-env key absent
  | { state: "error"; provider?; providerLabel?; error };                       // linked + key present, live query failed
```

## Four honest UI states (never fake "connected")

Mirror these exactly — a credential *name being present* is NOT "connected"; only a successful live query is:
1. **unconfigured** → guided setup: a provider picker + per-provider chips showing `key set` / `no key` / `no key needed`.
2. **credential-missing** → name the exact env var to add (e.g. `hive-env-add POSTHOG_PERSONAL_API_KEY`).
3. **error** → surface the provider's real error message (rate limit / 401 / timeout).
4. **live** → the at-a-glance cards (visitors / conversions / revenue / a conversion-rate ring / funnel / top events), rendering only the sections whose data is present.

## Per-entity linking (mirror an existing link field end-to-end)

Add `analyticsProvider?` + `analyticsConfig?: { projectId?, host? }` to the entity, threaded through the SAME path as an existing link field (e.g. a `projectId` "code repo" link): the type → the store's upsert input + persist → the API body → the edit-form type → the mapper → the modal picker → the save payload. Credentials do NOT live on the entity — only the non-secret project/site id does. This is what keeps it multi-tenant and generic: any user connects their own key once in shared env; each entity just points at its project/site.

## Client/server split (critical)

The registry reads secrets from shared env, so it must be **server-only**. But the edit-modal picker (a client component) needs the provider list. Put the static adapter metadata (keys, labels, config-field labels) in a **client-safe module** that both the server registry and the client picker import; keep the credential-reading + `getSummary` calls in the server-only registry. Importing a server-only module into a client component breaks the build — this split avoids it.

## The panel (self-fetching)

Model it on any existing lazy per-entity tab: `data/error/loading/nonce` state, `useEffect` fetching `GET /api/<entity>/{id}/analytics?days=7` with `cache:"no-store"`, a refresh button that bumps `nonce`, and the four-state render above. A GET-only route (read model) stays out of any mutating-action registry.

## Adapters

- **PostHog** — HogQL `POST /api/projects/{id}/query/` (see `posthog-provisioning-and-query`).
- **Plausible** — Stats API v1 `GET /api/v1/stats/aggregate?site_id=&period=&metrics=visitors,events`, Bearer key. NOTE `period` accepts only fixed presets (`day|7d|30d|month|6mo|12mo|custom`) — snap an arbitrary day-count to the nearest preset and report that preset's real span so `rangeDays` stays truthful.
- **GA4** — ship an explicit **not-wired stub** that throws a clear message until the GA4 Data API + OAuth are implemented. Do NOT half-implement it silently — a stub that says "not wired" is more honest than partial numbers.
- **self-funnel** — needs no external credential: reads the entity's OWN metric fields (revenue / conversions), which a funnel or agent keeps current via an existing metric-update rail. This is the batteries-included provider every entity can use, and how a `self-serve-payment-funnel` surfaces its sales here without any inbound network path.

## Cross-system reality check

If the analytics host (e.g. a local/tailnet app) can't be reached from the public internet, do NOT design a "push metrics in" flow from a cloud app — it isn't routable. Invert it: the analytics host (which CAN reach the public internet) **pulls** from the provider's API (PostHog/Plausible) or from a token-gated read endpoint the funnel exposes. Point the entity's provider at the same project the site already reports to.

## Safety & honesty

- Credentials live once in shared env by name; never per-entity, never in the repo.
- Distinguish "present by name" from "live-verified" in every status string.
- Adapters throw human-readable errors; the registry converts them to the `error` state — never a blank panel or a false "connected".
- Mark any provider API shape you haven't verified against current docs as INFERRED, and verify before trusting the numbers.

---
name: product-analytics-audit
description: Audit product growth, funnel, retention, and monetization metrics from analytics APIs such as PostHog and RevenueCat without exposing secrets. Use for DAU/MAU and growth readouts, retention cohorts, funnel drop-off diagnosis, HogQL queries, RevenueCat entitlement checks, attribution gaps, or "how is my app doing" analytics questions.
---

# Product Analytics Audit

Use this skill when the user asks to analyze how an app/product is doing: DAU/MAU, growth, retention, drop-offs, funnel conversion, attribution, subscriptions, purchases, or monetization using analytics tools and business APIs.

## Principles

- **Never print secret values.** If reading `.env`, list variable names and load values into process env only.
- **Prefer complete days.** Current-day data is often partial; label it as partial or exclude from trend calculations.
- **Separate instrumentation health from product health.** Broken identity merges, missing purchase events, or disconnected billing can make funnels look worse/different than reality.
- **Use raw counts + interpretation.** Provide crisp metrics first, then explain the likely product/business meaning.
- **Save raw API outputs to `/tmp/...json`** for local summarization, not to user-visible chat, unless requested.

## Workflow

1. **Discover credentials safely**
   - Locate the project's env file (`.env`/`.env.local`) or shared credential store.
   - Parse variable names matching likely services/app names, but never print values.
   - Common patterns: `YOUR_APP_POSTHOG_PERSONAL_API_KEY`, `YOUR_APP_POSTHOG_PROJECT_ID`, `YOUR_APP_POSTHOG_HOST`, `YOUR_APP_REVENUECAT_V2_SECRET_KEY`.

2. **Query PostHog via HogQL**
   - Endpoint: `POST {POSTHOG_HOST}/api/projects/{PROJECT_ID}/query/`
   - Header: `Authorization: Bearer {personal_api_key}`
   - Payload shape:
     ```json
     {"query":{"kind":"HogQLQuery","query":"SELECT ..."}}
     ```
   - Core queries:
     - DAU for last 60 days: group by `toDate(timestamp)`, count distinct `person_id`.
     - MAU for last 12 months: group by `toStartOfMonth(timestamp)`.
     - Top events for last 7/30 days: event count and distinct users.
     - Last-seen distribution: bucket users by max timestamp.
     - Retention cohorts: cohort by first event week and active week age.
     - Entry/exit events: `argMin(event, timestamp)` / `argMax(event, timestamp)` per `person_id`.
     - Funnel candidate events: exclude `$%` system events and sort by distinct users.
     - Monetization event search: event names containing purchase/subscription/revenue/checkout/payment/trial/pro/ultra.

3. **Query RevenueCat v2**
   - Endpoint root: `https://api.revenuecat.com/v2`.
   - Header: `Authorization: Bearer {secret_key}`.
   - Discover project: `GET /v2/projects`.
   - Customers list: `GET /v2/projects/{project_id}/customers` and follow `next_page`.
   - Active entitlements per customer: `GET /v2/projects/{project_id}/customers/{customer_id}/active_entitlements`.
   - Product/config endpoints that usually work: `/products`, `/entitlements`, `/offerings`, `/apps`.
   - Do not assume `/v1/subscribers`, `/v2/customers`, `/charts`, or `/metrics` exist for the key/project; probe and handle 404/400 cleanly.

4. **Analyze**
   - DAU: compute latest complete day, 7-day average, 30-day average, and change vs prior periods.
   - MAU: compare full prior month vs current month-to-date, clearly marking MTD.
   - Activation: login/onboarding and the app's other key feature-event counts.
   - Drop-off: compare key step distinct users; identify exits and events with high abandonment.
   - Retention: convert cohort counts to percentages from week 0.
   - Monetization: compare credit exhaustion/paywall/checkout/purchase/subscription/RevenueCat active entitlements.
   - Attribution/geography: report top UTM sources and countries, and call out missing/null attribution.

5. **Report format**
   - Lead with an executive snapshot.
   - Use bullets/labeled metrics rather than wide tables when the report is delivered to a chat surface with poor table rendering.
   - Include a short “My read” section and prioritized fixes.
   - Explicitly call out tracking gaps before over-interpreting bad-looking funnels.

## PostHog HogQL snippets

```sql
-- DAU last 60 days
SELECT toDate(timestamp) AS day, count(DISTINCT person_id) AS users, count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL 60 DAY
GROUP BY day
ORDER BY day
```

```sql
-- MAU last 12 months
SELECT formatDateTime(toStartOfMonth(timestamp), '%Y-%m') AS month,
       count(DISTINCT person_id) AS users,
       count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL 12 MONTH
GROUP BY month
ORDER BY month
```

```sql
-- Top product events, excluding PostHog system events
SELECT event, count() AS events, count(DISTINCT person_id) AS users
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY AND event NOT LIKE '$%'
GROUP BY event
ORDER BY users DESC
LIMIT 100
```

## Pitfalls

- HogQL function/type errors can vary by PostHog version; if `toDateOrNull` fails on `DateTime64`, use `toDate(first_seen)` instead.
- A funnel query requiring event order can produce nonsense if `minIf` defaults to epoch/zero for missing events. Safer first pass: compute boolean per-user event presence and pairwise overlaps.
- Anonymous landing events and logged-in app events may not join unless `identify`/aliasing is implemented correctly. If `landing_cta` and `login_completed` counts are high but `landing_and_login` is zero, suspect identity merge, cross-project instrumentation, or a cross-root-domain handoff gap.
- For landing pages and apps on different root domains (e.g. `.ai` -> `.app`), browser cookies/localStorage cannot carry PostHog identity. Pass `posthog.get_distinct_id()` through the CTA URL, persist it on app arrival, preserve it through OAuth callbacks, and alias/merge it to the logged-in user after auth. Also link in client identity sync for non-OAuth login methods. See `references/cross-domain-posthog-identity-handoff.md`.
- RevenueCat v2 secret keys may list customers/config but not expose dashboard-style revenue charts. Derive entitlement/customer health via API, or ask for Stripe/RevenueCat exports if revenue totals are required.
- Zero active entitlements means either no active subscribers or billing/entitlement sync is broken; check RevenueCat app/store configuration and webhook/backend purchase flow before concluding revenue is truly zero.

## References

- `references/cross-domain-posthog-identity-handoff.md` — implementation pattern for linking anonymous landing users to logged-in app users across different root domains.

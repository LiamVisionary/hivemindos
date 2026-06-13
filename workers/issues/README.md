# hivemindos-issues

A tiny Cloudflare Worker + D1 database that collects **anonymized client health
reports** from HivemindOS desktop installs. It exists so a broken boot — e.g. an
install stuck on a loading screen because it can't reach its local dashboard
service — shows up centrally, without asking a lay user to open devtools.

## What it stores

One row per `(install, issue fingerprint)`. Repeated occurrences bump `count` and
`last_seen_at` instead of inserting duplicates, so a single install stuck in a
retry loop never floods the table.

Fields (see [`schema.sql`](./schema.sql)): `kind`, `severity`, `install_id`
(random per-install id, **not** tied to identity), `app_version`, `commit_sha`,
`platform`, `detail`, `failure_kind`, `status_code`, `attempt`, `context`,
`count`, `created_at`, `last_seen_at`.

**Never sent:** user content, file paths, secrets, Tailnet IPs, or anything
identifying. The client builds the payload in
`src/lib/utils/issue-reporter.ts`.

## Endpoints

- `POST /issues` — record a report. Open (no auth) so any install can phone home a
  broken boot. Bounded by `DAILY_REPORT_CAP` per install/day + body/field size
  caps. Always returns `200` so the client never retries a rejected report.
- `GET /issues?limit=&kind=` — list recent issues, newest first. **Bearer-gated**
  on `ISSUES_READ_TOKEN`.
- `GET /health` — liveness.

## First-time setup

```sh
cd workers/issues
pnpm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
pnpm d1:create

# 2. Apply the schema (remote)
pnpm d1:migrate:remote

# 3. Set the read token used by GET /issues
wrangler secret put ISSUES_READ_TOKEN

# 4. Deploy
pnpm deploy
```

The desktop client posts to `https://hivemindos-issues.hivemindos.workers.dev`
by default; override with `NEXT_PUBLIC_HIVEMINDOS_ISSUES_URL`.

## Reading reports

```sh
curl -s -H "Authorization: Bearer $ISSUES_READ_TOKEN" \
  "https://hivemindos-issues.hivemindos.workers.dev/issues?kind=hydration_stall&limit=50" | jq
```

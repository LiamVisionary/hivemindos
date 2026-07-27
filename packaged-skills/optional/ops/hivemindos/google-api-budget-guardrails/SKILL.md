---
name: google-api-budget-guardrails
description: Put hard cost guardrails on ANY Google Cloud API (Places/Maps, Vision, Gemini/Vertex, Translate, Geocoding, etc.) — set a monthly billing budget with alert thresholds AND per-API per-day quota caps that make Google itself refuse runaway calls, all via gcloud. Use when someone says "set a budget on X API", "cap my Google/GCP API spend", "why is my Places/Maps API bill so high", "runaway Google API charges", "limit requests per day", "billing alert", "quota cap", "gcloud billing budgets", or wants a project protected from a surprise Google Cloud bill. Covers the three-layer defense (app-level meter → Google quota cap → billing budget), finding the right billing project, and the gcloud quota-project / Service-Usage gotchas that block the commands.
---

# Google API Budget Guardrails

Stop a Google Cloud API from ever surprising you with a big bill. Written from a real incident: an autonomous agent loop ran the **Places API** to ~$1,800/mo by re-resolving photos on a 30-minute cron. This skill is the general playbook that came out of fixing it — it applies to **any** Google API and **any** budget/quota metric.

## Mental model: defense in three independent layers

A single control is never enough. Stack all three so any one failing is caught by the next:

1. **App-level meter (primary, graceful).** The code that makes the calls counts them by SKU, hard-stops at a per-day cap and/or a monthly $ ceiling, and degrades to empty results instead of erroring. This is the only layer that fails *gracefully*. Reference pattern for your project: a `_charge()` helper in your API client that raises `BudgetCapReached` past the cap, driven by a config block (e.g. `config/api-budget.json` with `monthly_usd_ceiling`, `daily_call_caps`, `sku_unit_cost_usd`, `free_monthly_calls`).
2. **Google per-API daily quota cap (hard backstop).** A consumer quota override so Google itself returns HTTP 429 past N requests/day. Independent of your code — catches bugs, forks, and other consumers of the same project. Set with `gcloud alpha services quota update`.
3. **Billing budget (visibility, NOT a stop).** A monthly $ budget that **emails alerts** at thresholds. It does **not** block spend — it's the tripwire, not the ceiling. Set with `gcloud billing budgets create`.

> Key truth: **a budget only alerts; the quota cap is what actually stops calls.** Always set both.

## Sizing caps so the worst case stays under your target

Google's new per-SKU pricing gives each SKU a **free monthly allotment**, then a per-1,000 rate that steps down at volume. To *guarantee* a monthly ceiling even if the free tier vanished, size **daily** caps by current per-call price:

```
worst_case_monthly = Σ_sku ( daily_cap_sku × 30 × price_per_call_sku )
```

Example that kept Places under $50/mo (mirrored into both the app meter and the Google quota):

| SKU (Places metric) | Daily cap | Price/1k | Worst case/mo |
| --- | --- | --- | --- |
| `SearchTextRequest` (Text Search Pro) | 30 | $32 | $28.80 |
| `GetPlaceRequest` (Place Details) | 10 | $40* | $12.00 |
| `GetPhotoMediaRequest` (Place Photo) | 15 | $7 | $3.15 |
| **Total (free tier ignored)** | | | **$43.95** |

*Place Details tier depends on the field mask — requesting `reviews`/phone pushes it to Enterprise+Atmosphere ($40/1k). Verify live rates: https://developers.google.com/maps/billing-and-pricing/pricing . Note Place Photo bills **$7/1k even for `skipHttpRedirect=true` URL resolution** (you pay to resolve the reference, not just to fetch bytes).

## Prerequisites (one-time)

```bash
brew install --cask google-cloud-sdk          # macOS
gcloud auth login                              # user consent in browser (only YOU can do this)
gcloud services enable serviceusage.googleapis.com billingbudgets.googleapis.com --project=PROJECT_ID
```

`gcloud auth login` (user creds) is enough for everything here — you do **not** need `gcloud auth application-default login` unless a client-library command demands ADC (see gotchas).

## Step 1 — Find the RIGHT billing project (don't guess, don't key-scan)

Charges land on **one project on one OPEN billing account**. Identify it by *enabled service + open billing*, not by pulling API-key strings across projects (that's invasive and the HivemindOS safety classifier will block it):

```bash
gcloud projects list --format="table(projectId,name,projectNumber)"
gcloud billing accounts list          # OPEN=True is the only one that can be charging now
# For each candidate, show its billing account + whether the target API is enabled:
gcloud billing projects describe PROJECT_ID --format="value(billingAccountName,billingEnabled)"
gcloud services list --enabled --project=PROJECT_ID | grep -i 'places\|maps\|vision\|aiplatform'
```

The project that has the API enabled **and** `billingEnabled=True` on an **OPEN** account is the biller. If ambiguous, confirm with the human (they can read the account name off the billing page). Grab the **project NUMBER** — budgets and quota consumers use `projects/<number>`.

## Step 2 — Discover the quota metrics for the API

Quota metrics are **per request type**, each with several **units**: `1/min/{project}/{user}`, `1/min/{project}`, and — the one that caps cost — **`1/d/{project}`** (requests per day per project).

```bash
gcloud alpha services quota list --service=SERVICE.googleapis.com --consumer=projects/PROJECT_NUMBER \
  --flatten="consumerQuotaLimits[].quotaBuckets[]" \
  --format="table(metric, consumerQuotaLimits.unit, consumerQuotaLimits.quotaBuckets.effectiveLimit)"
```

Pick the metrics whose `1/d/{project}` limit you want to lower. (Places example metrics: `SearchTextRequest`, `GetPlaceRequest`, `GetPhotoMediaRequest`, `SearchNearbyRequest`, `AutocompletePlacesRequest`.)

## Step 3 — Set the per-day quota caps (the hard backstop)

```bash
gcloud alpha services quota update \
  --service=SERVICE.googleapis.com \
  --consumer=projects/PROJECT_NUMBER \
  --metric='SERVICE.googleapis.com/SearchTextRequest' \
  --unit='1/d/{project}' \
  --value=30 --force
```

Repeat per metric. Verify:

```bash
gcloud alpha services quota list --service=SERVICE.googleapis.com --consumer=projects/PROJECT_NUMBER \
  --flatten="consumerQuotaLimits[].quotaBuckets[]" \
  --format="table(metric, consumerQuotaLimits.quotaBuckets.effectiveLimit, consumerQuotaLimits.quotaBuckets.consumerOverride.overrideValue)"
```

`OVERRIDE_VALUE` populated on the `1/d/{project}` row = it took. These caps throttle the **whole project**, so make sure no other app on that project needs more.

## Step 4 — Create the monthly billing budget (the tripwire)

```bash
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="SERVICE API \$50-mo cap (PROJECT_ID)" \
  --budget-amount=50USD \
  --filter-projects=projects/PROJECT_NUMBER \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

**Any budget metric / scope** — budgets filter by more than project:
- `--filter-projects=projects/NUMBER` — scope to a project.
- `--filter-services=services/SERVICE_ID` — scope to one API only (get IDs from `gcloud billing budgets` docs / the Cloud Billing catalog).
- `--filter-credit-types-treatment`, `--filter-labels=KEY=VALUE`, `--filter-subaccounts` — credits, resource labels, reseller subaccounts.
- `--budget-amount=NUSD` fixed, or `--last-period-amount` to track last month.
Thresholds repeat; add `,basis=forecasted-spend` for an early "on track to blow the budget" alert. Alerts email Billing Admins/Users by default; add a Pub/Sub topic (`--all-updates-rule-pubsub-topic`) to wire a programmatic hard-kill (a Cloud Function that disables billing) if you want a true stop at the money layer.

Verify: `gcloud billing budgets list --billing-account=BILLING_ACCOUNT_ID` then `... describe <id>`.

## Gotchas that will waste your time (all hit live)

- **`gcloud billing budgets` needs a quota project.** It uses a client library and errors `requires a quota project` / `SERVICE_DISABLED consumer projects/32555940559`. Fix: add `--billing-project=PROJECT_ID` to the create command (cleanest), or `gcloud config set billing/quota_project PROJECT_ID`.
- **…but `gcloud config set billing/quota_project` then breaks `gcloud services` / `gcloud alpha services quota`.** It attaches an `x-goog-user-project: PROJECT` header to *all* calls; if Service Usage isn't enabled on that project you get `SERVICE_DISABLED` on unrelated commands. Fix: prefer the per-command `--billing-project` flag, or **`gcloud config unset billing/quota_project`** before running service/quota commands.
- **Chicken-and-egg API enablement.** `gcloud alpha services quota …` fails until `serviceusage.googleapis.com` is enabled on the project. Enable it first (Step "Prerequisites").
- **`gcloud auth login` vs ADC.** Most commands use your gcloud login creds. A few client-library commands (budgets) want ADC — if `--billing-project` doesn't clear it, `gcloud auth application-default set-quota-project PROJECT_ID` (needs ADC to exist) or `gcloud auth application-default login`.
- **Budgets don't stop spend.** They email. The quota cap (Step 3) is the actual stop. Don't ship a budget alone and think you're protected.
- **Quotas are project-wide.** A 30/day cap protects against a runaway but also throttles every legit consumer on that project. Scope the project accordingly or raise caps deliberately.
- **Finding the biller by key = blocked.** Retrieving API-key strings across projects to hash-match trips the credential-exploration guard (and is invasive). Use enabled-service + open-billing signals, or ask the human.

## Failure → cause quick table

| Symptom | Cause | Fix |
| --- | --- | --- |
| `requires a quota project` on budget create | client lib needs quota project | add `--billing-project=PROJECT_ID` |
| `SERVICE_DISABLED` on `gcloud services …` right after setting a budget | `billing/quota_project` header routing | `gcloud config unset billing/quota_project` |
| `alpha services quota list` → `Service Usage API not been used` | Service Usage API disabled on project | `gcloud services enable serviceusage.googleapis.com --project=…` |
| quota `update` succeeds but limit unchanged | wrong `--unit` (used `1/min/...` not `1/d/{project}`) | re-run with the daily unit string |
| bill still climbs after budget set | budgets only alert | set the Step 3 quota cap |
| `PERMISSION_DENIED` listing keys across projects | credential-exploration guard | identify biller by enabled-service + open-billing instead |

## HivemindOS Treasury UI integration (target architecture)

These guardrails should be **configurable from the HivemindOS Treasury UI**, per-company and per-API, not just via gcloud. The Zero-Human-Company Treasury is the natural home ("what are we spending, and on what").

- **Company model already has** `dailyBudgetUsd` / `monthlyBudgetUsd` / `totalBudgetUsd` (`hivemind-os/src/lib/types/company.ts`), a spend ledger with `appendSpend()` + `companyId` (`src/lib/services/wallet/spend-ledger.ts`), and the burn panel `TreasuryColumn` (`src/features/dashboard/views/zero-human-companies/Cockpit.tsx`).
- **Wiring (proposed):** add `"api"` to `SpendKind`; a `record-api-cost` action on `/api/companies/route.ts` calling `appendSpend`; an "API spend" line in the burn panel; and a Treasury editor field for **per-API daily caps + monthly ceiling** that writes both (a) the app-meter config (e.g. your project's `config/api-budget.json`) and (b) the Google-side quota + budget via the gcloud recipe above. Agents must **consult the company budget before any expense-incurring call** (see the app-meter reference pattern above) and **populate costs into the Treasury**.
- Reference app-meter shape the UI should read/write: your project's API-budget config (`monthly_usd_ceiling`, `daily_call_caps`, `sku_unit_cost_usd`, `free_monthly_calls`).

## Helper

`scripts/set-api-budget.sh` parameterizes Steps 3–4: pass a project, billing account, budget amount, and `METRIC=DAILYCAP` pairs; it sets the quota caps and the budget, then verifies. Read it before running — it makes real writes to a live billing account.

## Checklist

- [ ] Identified biller project (enabled API + OPEN billing account) and its project **number**.
- [ ] `serviceusage` + `billingbudgets` APIs enabled on it.
- [ ] Per-day quota caps set on the cost-driving metrics and **verified** (`OVERRIDE_VALUE` present).
- [ ] Monthly budget created with 50/90/100% + forecasted alerts, scoped to the project/service.
- [ ] App-level meter in place so the *primary* stop is graceful (not 429s).
- [ ] Worst-case math (`Σ daily_cap × 30 × price`) is under the target.

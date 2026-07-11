# Zero Human Company API Reference

Use these authenticated HivemindOS routes. Prefer the current app origin or an injected route tool; do not assume a fixed localhost port.

## Founder Mode

`POST /api/founder`

Compile without writing:

```json
{
  "action": "compile",
  "goal": "Reach $5,000 MRR from a rights-safe short-form content service.",
  "constraints": {
    "privacy": "private-first",
    "budgetTier": "starter",
    "pace": "week"
  }
}
```

Create the compiled company and outcome Lab by changing `action` to `found`.

Supported constraint values:

- `privacy`: `private-first`, `balanced`, `cloud-ok`
- `budgetTier`: `local-free`, `starter`, `growth`, `scale`
- `pace`: `today`, `week`, `month`

Founder Mode chooses from stored agent profiles. Preflight existing company membership before accepting its candidate crew.

## Repository Import

`POST /api/companies/import`

```json
{
  "action": "preview",
  "repoPath": "<absolute-repository-path>",
  "companyName": "Example Studio",
  "ticker": "EXMPL",
  "sector": "Media",
  "apexGoalTitle": "Reach the first retained customer"
}
```

Review `preview`, then repeat with `action: "import"`. Capture:

```text
company.id
company.projectId
project.id
updatedExisting
```

Import discovers repository metadata and known operations. It does not launch the company or validate external services.

## Company List And Upsert

`GET /api/companies` returns company records with spend and revenue-share rollups plus autonomy-driver health.

`POST /api/companies` defaults to `action: "upsert"`:

```json
{
  "id": "<existing-id-when-refining-an-import>",
  "name": "Example Studio",
  "ticker": "EXMPL",
  "sector": "Professional Services",
  "blurb": "An agent-run studio for a clearly named customer and outcome.",
  "charter": "Pursue the apex goal through reviewable milestones and preserve approval boundaries.",
  "members": [
    {
      "agentId": "<verified-agent-id>",
      "roleInCompany": "Queen / CEO",
      "reportsTo": null,
      "companyCap": 2,
      "task": "Own sequencing, evidence, and approval boundaries."
    }
  ],
  "dailyBudgetUsd": 5,
  "monthlyBudgetUsd": 50,
  "totalBudgetUsd": 250,
  "frozen": false,
  "status": "setup",
  "execution": { "engine": "hivemind" },
  "autonomyPause": { "maxWaitingOnHuman": 8, "countMode": "all" },
  "apexGoal": {
    "title": "Reach the first retained customer",
    "metric": "monthly recurring revenue",
    "target": "1000",
    "current": "0",
    "progress": 0,
    "unit": "currency"
  }
}
```

Omit `id` only for a genuinely new direct upsert. Supplying `members` makes that list authoritative for company membership.

Important actions on the same route:

```json
{ "action": "set-approval-policy", "id": "<company-id>", "approvalPolicy": { "id": "public-publishing", "subject": "publishing public work", "mode": "ask", "source": "manual" } }
```

```json
{ "action": "add-directive", "id": "<company-id>", "directive": { "text": "Prove one inspectable milestone before scaling.", "skills": ["<installed-skill-slug>"], "source": "inject" } }
```

```json
{ "action": "freeze", "id": "<company-id>" }
```

```json
{ "action": "delete", "id": "<company-id>" }
```

Do not call `dispatch-goal` as part of ordinary creation. Launch is a separate side effect.

## Products

`POST /api/companies/<company-id>/products`

```json
{
  "items": [
    {
      "key": "pilot",
      "name": "Pilot",
      "amountUsd": 299,
      "description": "One bounded, reviewable pilot outcome.",
      "recommended": true,
      "interval": "one-time",
      "kind": "package"
    }
  ]
}
```

Allowed intervals are `one-time`, `month`, and `year`. Allowed kinds are `package` and `addon`.

Verify with `GET /api/companies/<company-id>/products`.

## Setup And Fleet Checks

- `GET /api/fleet/discover`: available machines and agents.
- `GET /api/companies/<company-id>/setup-blockers`: structural setup blockers detected by HivemindOS.
- `GET /api/companies/<company-id>/analytics?range=30`: current analytics connection state.
- `GET /api/projects`: shared project-registry records.

An empty setup-blocker list is not evidence that a checkout, social integration, payment provider, analytics project, mailbox, deployment, or external account is live. Verify each selected external capability through its own read-only status or dry-run path.

## Authentication And Receipts

Use the dashboard session, an authenticated app/phone bridge, or the configured device-token header through a safe runtime wrapper. Never print token values or paste them into skill output.

Treat the returned `company.id` as the creation receipt. Treat external actions as successful only when their provider returns a concrete receipt such as a post ID, message ID, URL, transaction ID, or explicit `success: true` result.

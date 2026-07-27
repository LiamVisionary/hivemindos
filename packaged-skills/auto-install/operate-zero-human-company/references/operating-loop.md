# Zero Human Company Operating API Reference

Use these authenticated HivemindOS routes. Prefer the current app origin or an injected route tool; do not assume a fixed localhost port. All mutation payloads are JSON.

## Company State And Posture

`GET /api/companies` returns every company as `{ company, rollup, revenueShare }` plus `driver` (autonomy-driver status: `running`/`stopped`, `lastTickAt`, `lastError`, lease info) and `membershipConflicts` (agents assigned to more than one company). `rollup` carries `dailySpentUsd`/`dailyRemainingUsd`, `monthlySpentUsd`/`monthlyRemainingUsd`, and `totalSpentUsd`/`totalRemainingUsd`; a `remaining` of `null` means no cap is set for that window.

`POST /api/companies` actions used while operating:

```json
{ "action": "freeze", "id": "<company-id>" }
```

```json
{ "action": "unfreeze", "id": "<company-id>" }
```

```json
{ "action": "stop-autonomy", "id": "<company-id>" }
```

```json
{ "action": "dispatch-goal", "id": "<company-id>" }
```

`dispatch-goal` is the launch: it turns perpetual autonomy on, claims this machine as the company's home machine, and dispatches toward the apex goal. It rejects a frozen company, a missing apex goal, and (for crew-based engines) an unstaffed company. Only call it on an explicit launch request.

```json
{ "action": "resolve-pricing", "id": "<company-id>", "proposalId": "<id>", "decision": "approve", "note": "why" }
```

```json
{ "action": "add-directive", "id": "<company-id>", "directive": { "text": "One merged, standing lesson.", "skills": ["<installed-skill-slug>"], "source": "inject" } }
```

```json
{ "action": "remove-directive", "id": "<company-id>", "directiveId": "<id>" }
```

```json
{ "action": "set-approval-policy", "id": "<company-id>", "approvalPolicy": { "id": "public-publishing", "subject": "publishing public work", "mode": "ask", "source": "manual" } }
```

Policy modes are `off`, `ask`, and `never`. Defaults plus policies learned from permission-shaped directives plus explicit policies are merged by id; a directive like "ask for approval before X" auto-creates an `ask` policy, so recreate the gate explicitly before removing such a directive.

```json
{ "action": "update-metric", "id": "<company-id>", "current": "1200", "progress": 24, "source": "operator-review", "note": "verified from provider dashboard" }
```

### Merge-safe upsert (budgets, autonomy pause, status)

The default action (`upsert`) merges field-by-field: any field left out keeps its existing value, but `id` **and** `name` are always required on an update. `autonomy` is never writable through upsert — only `dispatch-goal`/`stop-autonomy` change it.

```json
{
  "id": "<company-id>",
  "name": "<existing company name>",
  "dailyBudgetUsd": 5,
  "monthlyBudgetUsd": 50,
  "autonomyPause": { "maxWaitingOnHuman": 8, "countMode": "all" }
}
```

Budget normalization treats zero or an omitted cap as unlimited — never use `0` to mean "no paid spend"; use finite caps or `freeze`. `autonomyPause.maxWaitingOnHuman` pauses new-work planning once that many of the company's tasks sit in the needs-human lane (held/parked tasks do not count) and auto-resumes when the count drops below the threshold. `countMode: "deliverable-kinds"` with a `deliverableKinds` list counts only tasks carrying those deliverable kinds; an empty list falls back to counting all.

### Integration limits and API usage

```json
{ "action": "set-integration-limit", "id": "<company-id>", "integrationLimit": { "providerKey": "<connector-key>", "dailyRequestLimit": 200, "monthlySpendLimitUsd": 25 } }
```

```json
{ "action": "remove-integration-limit", "id": "<company-id>", "limitId": "<id>" }
```

```json
{ "action": "check-api-usage", "id": "<company-id>", "providerKey": "<connector-key>", "requestCount": 1 }
```

`check-api-usage` evaluates without consuming; `consume-api-usage` consumes; both return a `decision` and answer 429 with `decision: "block"` when a limit would be exceeded. At least one positive limit is required when setting; limits must be positive numbers.

## Setup Blockers

`GET /api/companies/<company-id>/setup-blockers` returns `{ blockers: [{ envKey, title, explanation, kind, placeholder, links }] }` — the required shared-env keys the crew is currently paused on. The list is derived from live env presence: a key appears only while it is actually absent, so saving the value (through the dashboard blocker card or the shared hive env) makes the blocker disappear on the next fetch with no task mutation. `kind: "secret"` values must never be echoed; `kind: "text"` values (e.g. a mailing address) are plain. The route is read-only — there is no POST here; the write path is the shared env itself.

An empty blocker list is not proof external services work; it only means no required key is currently reported missing.

## Spend Approvals

`GET /api/wallet/approvals?status=pending&companyId=<company-id>` lists spend-approval requests (`status` also accepts `approved`, `denied`, `expired`, `consumed`). Each carries `agentId`/`agentName`, `kind`, `amountUsd`, `target`, `reason`, optional structured `explanation`, and `expiresAtMs`. The escalation bridge warns at `urgent` severity when an approval is within a few hours of expiry.

```json
{ "id": "<approval-id>", "decision": "approved", "decidedBy": "<who>", "note": "optional reasoning" }
```

`POST /api/wallet/approvals` with `decision: "approved"` or `"denied"` records the human decision and resolves the matching escalation cards. Expired approvals cannot be decided; the crew must re-request.

## Work Board (Needs-Human Rail)

`GET /api/kanban` returns the board with tasks grouped into columns. A company's blocked items are tasks with `status: "needs-human"` whose `source` starts with `company:<company-id>:`. Task fields that matter for triage: `result` (carries the `ACTION NEEDED:` section and any `Failures:` detail), `lastFailureReason`, `held` (parked marker), `assignee`, `deliverables`.

`POST /api/kanban` actions:

```json
{ "action": "answer", "taskId": "<task-id>", "answer": "<the human decision>", "author": "<who>" }
```

Answer applies only to `needs-human` tasks (anything else errors). It stamps the answer, moves the task back to ready, clears any hold, and schedules an immediate pickup by the same agent that asked when the task still carries a delegated target.

```json
{ "action": "hold", "taskId": "<task-id>", "note": "why deferred" }
```

Hold ("park"/snooze) also applies only to `needs-human` tasks. The task keeps its status but leaves the approval grid, stops pinging external channels, and stops counting toward the autonomy-pause threshold. A later real answer supersedes the park automatically.

```json
{ "action": "promote", "taskId": "<task-id>" }
```

Promote re-queues an `ideas` or `needs-human` task to ready without a text answer — the right verb for infrastructure-stranded tasks after the shared cause is fixed. Agents are deliberately forbidden from promoting a needs-human task (only a human answer or promote releases an approval park); unfinished parent dependencies block promote unless forced.

### Structured asks and noise classification

Genuine asks follow the structured-ask protocol in the task `result`:

```text
ACTION NEEDED: <what is blocking and how to unblock>
LINK: <https://where-to-act> — optional label
OPTIONS: Yes | No
NEEDS: api-key SOME_ENV_KEY
```

`NEEDS:` also accepts `file` and `text`. Cards without a genuine ask are classified noise: delegates offline / at capacity / unreachable (transport timeouts), a dispatch race, an eval-gate park ("missing passing eval receipts"), or a runtime failure ("Failure reason: … Attempts: n/m"). Infrastructure-stranded tasks are auto-rescued (re-queued and re-dispatched) a bounded number of times per rolling day; eval-gate and runtime parks need a human re-run or a fix, not a decision.

`POST /api/companies/<company-id>/explain-issue` with `{ "taskTitle": "...", "result": "...", "receipts": [...] }` returns a plain-language explanation of a blocked task (read-only, one LLM completion, no side effects) for presenting technical blockers to the user.

## Runs And Proposals

`GET /api/companies/<company-id>/runs?status=pending` returns `{ runs, proposals }` from the company's run ledger. Proposal statuses: `pending`, `approved`, `rejected`, `applied`, `superseded`. Kinds include `pricing-change`, `human-input`, `preview-review`, `deliverable-redirect`, `revenue-share`, `replay`, `manual`.

```json
{ "action": "settle-proposal", "id": "<proposal-id>", "status": "approved", "decision": "<the human decision>", "decidedBy": "<who>" }
```

`POST /api/companies/<company-id>/runs` with `settle-proposal` records the decision (`status` must be a non-pending status; it defaults to `applied` — pass the real outcome explicitly). `{ "action": "request-replay", "runId": "<run-id>" }` creates a pending replay proposal instead of re-running anything directly. Pricing-change proposals that live on the company record settle through `POST /api/companies` `resolve-pricing`, not here.

## Output And Health Reads (all read-only)

- `GET /api/companies/<company-id>/analytics?days=30` — linked-provider analytics, or a guided-setup payload when none is linked; the response's `state` field is honest about unconfigured vs. failing.
- `GET /api/companies/<company-id>/emails` — the crew's outreach threads; add `?threadId=<id>` for one full thread.
- `GET /api/companies/<company-id>/email-qa` — fast deterministic quality scan of already-sent emails (live-probes CTA links); `POST { "deep": true }` adds an LLM review. Never sends.
- `GET /api/companies/<company-id>/sales-content` — the sales/content machine snapshot (local analysis only).
- `GET /api/companies/<company-id>/products` — the sellable catalog; `POST { "items": [...] }` replaces it (a pricing decision — user's call).
- `GET /api/companies/<company-id>/api-budget` — per-company cloud cost guardrails (per-day quota caps + monthly billing budget); POST applies a validated config and gates any raise behind an explicit confirmation flag.

## Authentication And Receipts

Use the dashboard session, an authenticated app/phone bridge, or the configured device-token header through a safe runtime wrapper. Never print token values or paste them into skill output.

Treat each mutation's returned record (the decided approval, the answered task, the settled proposal, the updated company) as the receipt, and quote its id and new status in the final report. Treat external effects as real only when their provider returns a concrete receipt.

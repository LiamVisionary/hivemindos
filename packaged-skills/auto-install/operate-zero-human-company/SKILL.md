---
name: operate-zero-human-company
description: Operate an already-created Zero Human Company in HivemindOS through a strict highest-leverage triage order — clear setup blockers first, decide pending and expiring spend approvals, answer genuine ACTION NEEDED asks through the Work Board answer rail, park retryable infrastructure noise instead of treating it as decisions, review budgets and burn, prune duplicate standing directives, and manage launch, pause, and freeze posture with approval-count backpressure instead of a raw stop. Use whenever the user asks to operate, run, triage, check on, catch up on, unblock, review, or clean up a Zero Human Company, its alerts, notifications, Needs You queue, approvals, budgets, deliverables, or directives. Do not use for creating a new company (use create-zero-human-company) or for merely explaining Zero Human Companies.
---

# Operate A Zero Human Company

Operate the company through HivemindOS's existing company, Work Board, and approval APIs. Company state is durable shared-vault data and ledger files; do not hand-edit `Operations/Companies/companies.json`, the kanban shards, or run ledgers directly.

The #1 operator failure mode is a pile of hundreds of notifications treated as equals. Most of them are not decisions: one missing credential can hold an entire queue, and one offline machine can mint dozens of identical "blocked" cards. Triage by leverage, not by arrival order.

## Operating Contract

- Treat a request to operate, triage, or catch up on the company as authorization to read state, park noise, and clear blockers whose fix the user supplied. Approving spend, answering a decision ask, publishing, contacting anyone, or changing budgets/policies/autonomy requires the user's explicit choice on that item.
- Deciding is the user's job; sequencing, evidence, and honest counts are yours. Bring each decision to the user with its evidence and a recommendation, then record the decision through the sanctioned rail so the crew resumes correctly.
- Check credentials by key name and set/missing status only. Never print, persist, or echo secret values, tokens, or private network addresses.
- Use an authenticated dashboard/app bridge or the current HivemindOS origin. Do not hard-code a port, machine name, Tailnet address, or one user's filesystem path.
- If an API contract has changed, inspect the current route implementation before retrying. Do not work around a route error by writing vault or ledger files directly.

Read [references/operating-loop.md](references/operating-loop.md) for the exact endpoints and payloads before mutating anything.

## Do Not

- **Do not bypass an approval policy** to move work along — not by answering an approval card yourself, not by promoting a gated task past its ask, not by weakening a policy from `ask` to `off` without the user explicitly choosing that. An `ask` policy exists because a human must decide.
- **Do not mark work done to clear a queue.** Never complete a task, settle a proposal as `applied`, or attach a receipt for work that did not actually happen. A cleared count must mean the underlying condition was handled.
- **Do not delete records to reduce counts.** Tasks, proposals, runs, notifications, and the company record are the audit trail. Park (hold) is the sanctioned deferral; delete only when the user explicitly asks to delete a named thing.
- **Do not answer infrastructure noise with an invented decision.** A "delegates offline" card answered with made-up guidance poisons the task's history; fix or park it instead.
- **Do not read, echo, or store secret values** while clearing setup blockers — key names and set/missing status only.
- **Do not launch, publish, send, spend, or contact anyone** as a side effect of triage. Each outward action needs its own explicit request.

## Understand The Alert Feed Before Trusting It

Escalations reach the operator as deduplicated cards (and, for high/urgent severity, external messages when messaging is enabled). Knowing the model prevents double-handling:

- Every event has a stable dedupe key and a re-notify TTL — a stuck task pings about once a day, not every driver tick, so one card can represent days of waiting.
- `low`/`normal` cards are in-app FYIs (weekly revenue checks, "paused — N waiting on you" nudges); only `high`/`urgent` are true escalations. Do not treat an FYI as a backlog item.
- Cards self-track their task: re-dispatched shows in-progress, completed/archived shows resolved, and a bounce back to needs-human makes the card live again. The Work Board — not the card pile — is the ground truth for what still needs a human.
- Identical systemic blockers (e.g. many tasks stranded by one offline machine) are consolidated into one card with a shared cause; a genuine human ask always stays its own card.

## 1. Snapshot Before Touching Anything

Build one picture of the company, then triage from it:

1. `GET /api/companies` — the company record with spend rollup (daily/monthly/total spent and remaining), revenue share, autonomy-driver health, and membership conflicts. A company shown as running while the driver is stalled is its own finding; reading this route also revives a dead driver loop, so re-read once before escalating and report the driver's `lastError` if it persists.
2. `GET /api/companies/<id>/setup-blockers` — required shared-env keys the crew is paused on.
3. `GET /api/wallet/approvals?status=pending&companyId=<id>` — pending spend approvals with expiry times.
4. `GET /api/kanban` — the Work Board; this company's blocked items are tasks with `status: "needs-human"` whose `source` starts with `company:<id>:`. Held (parked) tasks are already-deferred; exclude them from fresh triage.
5. `GET /api/companies/<id>/runs?status=pending` — pending proposals (deliverable reviews, replay requests, pricing changes, human-input asks).

Report the counts per bucket before acting. That summary is the triage plan.

## 2. Triage In This Order (Highest Leverage First)

### 2.1 Setup blockers

A setup blocker is a missing shared-env key (mailing address, mail provider key, payment key) that pauses every send or action depending on it. Blockers are derived from live env presence: saving the key clears the issue on the next fetch with no task mutation, and every task that was held on it can proceed. One paste can release a whole queue, so this always goes first. Ask the user for the value (or where to get it via the blocker's links), have them save it through the dashboard blocker card or the shared hive env; never ask them to paste a secret into chat output you will echo.

### 2.2 Pending and expiring spend approvals

Approvals expire; an expired approval silently becomes a denial and the crew re-asks later. Surface each pending approval as agent, kind, amount, target, reason, and time to expiry — nearest expiry first. The user decides; record it with `POST /api/wallet/approvals` `{ "id": "...", "decision": "approved" | "denied", "note": "..." }`. Denials deserve a note: it becomes the crew's steering signal.

### 2.3 Genuine ACTION NEEDED decisions

Agents end a blocked task's result with an `ACTION NEEDED:` section, optionally followed by `LINK:`, `OPTIONS: a | b`, and `NEEDS: api-key KEY_NAME` (or `NEEDS: file` / `NEEDS: text`) lines. These are the real decisions. Present the ask and its options verbatim, get the user's choice, then answer through the answer rail:

`POST /api/kanban` `{ "action": "answer", "taskId": "...", "answer": "<the decision>", "author": "<who decided>" }`

Answer only applies to `needs-human` tasks. It clears any park, stamps the answer into the task, and schedules an immediate pickup by the same agent that asked — so an answered task resumes without waiting for the next dispatch sweep. Not every needs-human card carries a genuine ask: worker boilerplate ("re-run or revise the worker result…", bare completion reports) is not a human decision — treat those as section 2.4 noise. Use `POST /api/companies/<id>/explain-issue` when a blocked task's raw result is too technical to present as-is.

Pending proposals from the runs ledger belong here too: settle deliverable reviews and replay requests with the runs route's `settle-proposal` action (`approved`, `rejected`, `applied`, or `superseded` — never fake `applied` for work that was not applied), and settle pricing proposals through `POST /api/companies` `{ "action": "resolve-pricing" }`.

### 2.4 Infrastructure-failure noise

A large share of needs-human cards are not decisions — they are delegation failures: every delegate offline, at capacity, unreachable (timeouts, refused connections), a dispatch race, an eval-gate park, or a runtime error. These are retryable. HivemindOS already consolidates them by shared cause and auto-rescues infrastructure-stranded tasks (bounded retries per rolling day), so:

- Identify the shared cause (the card classifier names it) and fix that once — bring the machine/collector back, then let rescue re-queue, or promote the tasks back to ready yourself (`POST /api/kanban` `{ "action": "promote", "taskId": "..." }` — a human may promote a needs-human task; agents are deliberately forbidden).
- Park what the user chooses to defer: `{ "action": "hold", "taskId": "...", "note": "..." }`. A held task keeps its status but leaves the approval grid, stops external pings, and stops counting toward the autonomy-pause threshold.
- Never "answer" an infra failure with an invented decision, and never complete it to clear it.

### 2.5 Budget and burn review

From the `GET /api/companies` rollup, report spent vs. remaining for the daily, monthly, and total windows, plus revenue share. An exhausted window blocks all member spend until it rolls or the user raises the cap. Raising caps is a merge-safe upsert (`POST /api/companies` with `id`, `name`, and only the budget fields) — and a zero or omitted cap means unlimited, never "no spend"; use finite caps or freeze. Per-provider request/spend ceilings use `set-integration-limit`; check consumption with `check-api-usage`. Cloud-provider-side guardrails live at `GET/POST /api/companies/<id>/api-budget`. Cross-check burn against output: `GET /api/companies/<id>/analytics?days=30`, `.../sales-content`, `.../emails`, and `.../email-qa` show whether the spend is producing anything.

### 2.6 Directive hygiene

Directives (Learning-tab injections and deliverable-rejection lessons) are appended to the standing context of every dispatched task — a long, duplicated list dilutes every future instruction. With the user: merge near-duplicate lessons into one clear directive (`add-directive`), then remove the superseded ones (`remove-directive`). Two cautions: a permission-shaped directive ("ask for approval before X") auto-learns an `ask` approval policy — before removing one, recreate its gate explicitly with `set-approval-policy`; and removal is not undoable through the API, so list exactly what will be removed and get a yes first.

### 2.7 Launch, pause, and freeze posture

Decide posture last, with the queue now honest:

- **Backpressure, not stop:** prefer `autonomyPause` (`{ "maxWaitingOnHuman": N }` via merge-safe upsert) over halting the company. The driver then stops planning new work whenever N items are already waiting on a human and resumes by itself once the count drops — reversible, self-tuning, no button to remember. Held items do not count.
- **Launch** is explicit and separate: `POST /api/companies` `{ "action": "dispatch-goal" }` enables perpetual autonomy and dispatches toward the apex goal. Only on the user's explicit ask, with finite budgets and approval policies verified first.
- **Stop** (`stop-autonomy`) fully halts new dispatch; **freeze**/**unfreeze** is the kill switch that also blocks member spend on every rail. Freeze for runaway spend or misbehavior; stop for "we're done for now"; backpressure for "the human is the bottleneck".

## 3. When The Company Looks Dead

A quiet company is not always broken. Check these in order before proposing fixes, and name which one you confirmed:

1. **Paused by backpressure** — the needs-human count reached `autonomyPause.maxWaitingOnHuman`. This is the system working as designed: clearing the queue (sections 2.1–2.4) resumes it automatically. Do not raise the threshold to silence it.
2. **Frozen** — the kill switch blocks dispatch and all member spend. Only the user unfreezes.
3. **Budget window exhausted** — spend is blocked until the window rolls or the user raises the cap (section 2.5).
4. **Driver stalled** — `driver.status` stopped or a stale `lastTickAt` in the `GET /api/companies` response. Reading that route revives the loop; a persisting `lastError` is the finding to report.
5. **No progress backoff** — when a dispatched batch drains without completing anything, the driver deliberately widens its re-dispatch interval instead of burning tokens re-planning a stuck goal. The fix is whatever is blocking completion, not more dispatching.
6. **Nobody online** — a crew-based company with no member agent online dispatches nothing by design; fleet visibility problems escalate on their own after repeated empty snapshots.

## 4. Final Receipt

Return:

- counts per triage bucket at start and end (setup blockers, pending approvals, genuine asks, infra noise, pending proposals)
- each decision made, who made it, and the API action that recorded it
- keys configured by name and status only
- budget windows: spent, remaining, and any cap changes
- directives merged/removed and policies preserved
- posture changes (autonomyPause threshold, launch, stop, freeze) with rollback (`stop-autonomy`, `unfreeze`, threshold revert)
- what remains parked or unresolved, and why

Label each load-bearing statement as confirmed by an API response or inferred. Never report a queue as "cleared" when items were parked — parked is deferred, not done.

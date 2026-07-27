---
name: create-zero-human-company
description: Create a durable Zero Human Company in HivemindOS from a natural-language business goal, optionally linking an existing repository, assigning an available agent crew, defining measurable goals, products, budgets, approval policies, and setup directives, then verifying the saved company without silently launching it. Use whenever the user asks to create, found, start, set up, configure, or turn a project or business idea into a Zero Human Company, autonomous company, agent-run company, or company in HivemindOS. Do not use for merely explaining Zero Human Companies or operating an already-created company unless creation is also requested.
---

# Create A Zero Human Company

Create the company through HivemindOS's existing company APIs. The company record is durable shared-vault state; do not hand-edit `Operations/Companies/companies.json` or invent a parallel store.

## Operating Contract

- Treat an explicit request to create or found the company as authorization for the durable company and optional project-registry records.
- Treat creation and launch as separate actions. Do not call `dispatch-goal`, enable autonomy, contact anyone, publish, spend, deploy, or move money unless the user explicitly asked for that action too.
- Keep the new company in `setup` or `paused` state with autonomy off after creation.
- Never print or persist auth tokens, provider secrets, private keys, or private network addresses. Check credentials by key name and status only.
- Use an authenticated dashboard/app bridge or the current HivemindOS origin. Do not hard-code a port, machine name, Tailnet address, or one user's filesystem path.
- If an API contract has changed, inspect the current route implementation before retrying. Do not work around a route error by writing the vault JSON directly.

Read [references/company-api.md](references/company-api.md) before issuing creation or mutation requests.

## 1. Build The Founder Brief

Extract these fields from the request and existing conversation:

- business goal and target customer
- company name, ticker, sector, and one-line positioning
- measurable apex metric, current baseline, and target
- repository path, when the user named an existing project
- privacy, pace, and spend constraints
- fixed products or services, when known
- actions that must require human approval

Use `hive-brain answer` for prior project decisions before relying on memory. Run or consume `hive-capability-search` for the goal so the company is built around capabilities that actually exist. Mark inferred fields in the final receipt; ask only when a missing choice would materially change identity, ownership, cost, or an external side effect.

Prefer a measurable business outcome over a vague activity goal. For example, use `Reach $5,000 MRR from three retained customers` rather than `grow the business`.

## 2. Preflight The Hive

Before creating anything:

1. Read `GET /api/companies` and reject an accidental duplicate by company name, linked `projectId`, or imported repository path. Update an existing company only when the user asked to update it.
2. Read `GET /api/fleet/discover` or the equivalent injected fleet snapshot.
3. Exclude agents already assigned to another company unless the user explicitly wants shared membership and the current runtime supports it safely.
4. Prefer available agents whose worker class or role fits Queen/planning, research/growth, implementation, creative production, and QA. A small capable crew is better than filling every possible title.
5. If no suitable agent is available, create the company with an empty crew in `paused` state and report staffing as a launch blocker. Do not invent agent IDs.

## 3. Choose The Creation Path

### Natural-language company

Use `POST /api/founder` with `action: "compile"` first. Review the returned blueprint, capability gaps, candidate crew, budgets, and approval posture.

- If the blueprint identity and unassigned crew are suitable, call the same route with `action: "found"`. This creates the company and its outcome Lab.
- If the user supplied exact identity, crew, products, or governance requirements—or the suggested crew conflicts with existing membership—create the precise record with `POST /api/companies` instead of accepting a misleading blueprint.

### Existing repository

Use `POST /api/companies/import` with `action: "preview"` first. Confirm the resolved repository, Git metadata, discovered operations, suggested identity, and whether an existing company already links that path.

Then call `action: "import"`, capture both `company.id` and `project.id`, and refine the imported company through the normal company endpoints. Importing a repository does not prove its services, schedules, credentials, checkout, analytics, or monetization are operational.

## 4. Make The Record Operationally Honest

Configure the company with the shared company schema rather than prose alone:

- `members` is authoritative for membership; keep `agentIds` consistent through the API.
- Give each member a clear `roleInCompany`, reporting line, responsibility, and finite company cap when paid work is possible.
- Set a measurable `apexGoal` with `metric`, `current`, `target`, `progress`, and `unit`.
- Set `execution` to `{ "engine": "hivemind" }` unless the user explicitly selected a verified AEON profile and skill.
- Add `autonomyPause.maxWaitingOnHuman` so approvals cannot accumulate without bound.
- Add a product catalog through the dedicated products endpoint when the offer and prices are known. Do not invent testimonials, traction, revenue, legal terms, or market validation.
- Add standing directives for the first milestone, success evidence, non-goals, missing setup, and provider truth. Directives should name capability intents or installed skill slugs, not transient endpoints.
- For a content/media company that may use `hosted-media.generate`, link the studio's `HIVEMINDOS_CONTENT_STUDIO_AGENT_ID` to a real company member, assign finite company/member caps, and use the shared HivemindOS credit pool. Hosted provider keys, the exact 25% markup, reservations, refunds, and receipts remain server-side; a local env toggle must never become commercial authority.

Current company budget normalization treats zero or an omitted cap as unlimited. Never use `0` to mean "no paid spend." Use finite positive caps, keep the company frozen, or leave it unlaunched until the user chooses a budget. State any inferred caps in the receipt.

## 5. Install Human Boundaries

At minimum, create `ask` approval policies for:

- public publishing, scheduling, uploading, or cross-posting
- contacting customers, prospects, creators, or partners
- moving money or committing paid spend
- contracts, pricing commitments, or scope changes
- destructive or irreversible actions

Add domain-specific gates when relevant, such as rights approval for media, production deployment, regulated claims, wallet transactions, or access-control changes.

When the user explicitly asks for a zero-human bounded spend loop, do not replace budget policy with a fake confirmation token. Configure finite daily/monthly/total and member caps, keep public publishing and customer contact approval-gated unless separately authorized, and let the hosted route return `approvalRequired` whenever the company policy still requires a human decision.

Approval policies protect side effects; they do not make a missing provider, credential, contract, or entitlement operational.

## 6. Verify Through The User Path

After every successful create:

1. Read `GET /api/companies` and find the exact returned company ID.
2. Verify identity, project link, crew, apex goal, finite budgets or frozen state, approval policies, directives, products, `frozen`, and `autonomy`.
3. Read `GET /api/companies/<id>/products` when products were configured.
4. Read `GET /api/companies/<id>/setup-blockers` and report its result without treating an empty list as proof that external services work.
5. Verify selected providers through their own status or dry-run surface before calling them ready.
6. Confirm that no launch, publish, contact, payment, or deployment occurred unless separately requested and evidenced.

If a multi-step creation fails after the company record was created, delete only that new company through `POST /api/companies` with `action: "delete"`. Report whether an imported project-registry entry remains; do not silently delete unrelated or pre-existing project records.

## Final Receipt

Return:

- company name, ID, state, and linked project ID/path when applicable
- apex goal and metric
- crew roles and count
- products and prices, if configured
- budget caps or frozen posture
- approval policies and autonomy-pause rule
- verified capabilities and remaining setup gaps
- whether autonomy was launched (normally `false`)
- rollback path
- exact verification surfaces read

Label each load-bearing statement as confirmed by an API response or inferred from the founder brief.

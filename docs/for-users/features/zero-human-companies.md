---
title: "Zero Human Companies"
---

# Zero Human Companies

Zero Human Companies turn a business goal into an agent-run operating loop.

A company has a charter, an apex goal, governance controls, a run history, and a selected autonomy engine. The default engine plans work for a HivemindOS crew through the Work Board. The optional AEON engine runs one chosen background skill in a linked AEON workspace, without requiring native company agents. The operator still owns the high-trust decisions: funding, policy, approval thresholds, public exposure, and whether a company should keep running.

## What It Does

Zero Human Companies are for repeatable work that should behave more like an operating company than a one-off chat:

- create or review a company charter
- choose the HivemindOS crew engine or an optional AEON background skill
- assign agents to roles when the company uses a native crew
- set an apex goal and task backlog
- launch planned work into the shared Work Board, or hand one bounded goal to AEON
- route native tasks to eligible agents or reuse a saved AEON workspace and skill
- track approvals, spend caps, and kill-switch state
- preserve receipts, deliverables, eval gates, and learning artifacts
- summarize the company's accumulated know-how as capability capital

The feature is local-first. It can run with local agents, user-configured runtimes, user-owned wallets, and the shared Obsidian vault. Managed cloud, official monetization, marketplace listing, hosted capacity, or paid-agent access must be verified by HivemindOS-controlled infrastructure or by a verifiable payment rail before it grants official value.

## Agent Identity Isolation

One operational agent identity belongs to one company at a time. A company assignment carries more than a display role: it determines the company budget, member-level daily spend cap, freeze switch, approvals, mailbox scope, work history, and company context for that company's Work Board tasks. The same agent's personal, product, and unrelated tasks continue under its ordinary wallet and workspace policy. Sharing one identity between companies would make task-scoped controls ambiguous.

You can still reuse the same agent blueprint across as many companies as you need. When an agent is already assigned, choose **Duplicate agent** from the crew picker. The normal duplication flow creates a separate identity and wallet while letting you choose whether to copy its agent-specific environment, fork its private memory metadata, or copy chat history. Add the resulting copy to the other company; its model, runtime, skills, and personality can match the original while its operations remain isolated.

Founder Mode and the standard crew picker only consider unassigned identities. Direct API or shared-vault edits that attempt to place one identity in several companies are rejected. If a manual edit creates a conflict anyway, the portfolio remains available for repair, shows the affected companies, and fails closed on spending until the identity is removed from all but one company.

## Founder Mode

Founder Mode is the outcome-first path into a company. Describe what you want to make happen, choose a privacy posture, milestone budget, and pace, then review a generated blueprint covering the charter, goal, crew, capabilities, compute, approvals, first Lab, and proof requirements.

Compiling is read-only. Founding requires an explicit action and creates the company plus its first private Lab, but does not launch autonomous work. The operator still decides when the crew begins. See [Founder Mode, Hivemind Labs, And Proof Packs](founder-mode.html).

## Imported Companies

Existing projects can be imported as companies without being re-founded from scratch. The import flow starts from a repository folder, previews what HivemindOS can see, then creates or updates a company linked to that source project.

The same flow also accepts a local **data room**: a folder of plans, reports, spreadsheets, presentations, exports, and other company documents. HivemindOS previews the readable files, converts them locally with the document reader bundled into the desktop app, and creates a reviewable **Sources** library in the company cockpit. The resulting Obsidian notes retain source names, paths, hashes, and conversion provenance so future agents can cite the material and detect unchanged re-imports.

Data-room content stays explicitly untrusted. Importing a strategy deck, contract, or old operating manual does not turn its text into a standing directive, approve spend, launch autonomy, or grant an entitlement. The operator reviews the sources and decides what should become governed company work.

See [Local Document Reader](local-document-reader.html) for every supported data-room extension, extraction behavior, local conversion guarantees, and archive limits.

The importer records the repository, Git remote, GitHub Actions workflows, scheduled workflow crons, Supabase `pg_cron` schedules, Render services, Vercel crons, cron-like files, and package scripts when those signals are present. The company cockpit then shows those systems in a **Systems** tab so operators can inspect the code and operating schedules that already keep the product running.

Importing a legacy project does not make historical or off-platform revenue subject to a HivemindOS fee. Imported companies still show the Treasury revenue recorder; only a separately disclosed hosted marketplace or billing policy can attach a fee to a HivemindOS-sourced transaction.

## Cockpit

The Zero Human Company cockpit is the operator surface for one company.

It shows:

- the company charter, stage, and apex goal
- the selected autonomy engine
- assigned agents and their roles, when the company has a native crew
- team settings and agent membership
- approval queues and governance events
- treasury controls, budgets, and spend summaries
- issue-board style work lanes
- native Work Board tasks or accepted AEON dispatches
- learning-loop metrics and capability-capital summaries

The cockpit is organized into tabs:

- **Board** — the active work block, the autonomous-execution launch control, and issue-board work lanes.
- **Issues** — open company work and items that need review.
- **Deliverables** — the company's real outputs, with a collapsed work log for the scratch that evidenced them. The label can follow the company's primary output.
- **Comms** — outreach threads and the crew's mailboxes, with a company-specific label where appropriate.
- **Sales** — customer and pipeline activity.
- **Products** — the catalog for companies that sell fixed products.
- **Systems** — imported workflows and schedules for companies linked from an existing project.
- **Sources** — locally imported data-room documents with type, provenance, and direct links to their Shared Brain notes.
- **Limits** — integration request and spend guardrails, Google Cloud quotas and billing budgets, and 30-day usage charts.
- **Frontier Lab** — company-scoped token capacity, elastic task slots, earned scale gates, the reviewed OpenAI OAuth model ladder, and recent task settlements.
- **Team** — the org chart and agent membership.
- **Analytics** — company performance and operating summaries.
- **Learning** — capability-capital metrics and the eval frontier.
- **Labs** — bounded hypotheses, measured results, evidence lineage, frontiers, and a preview-first Hive Skill Fusion path for graduating verified methods into reusable shared skills.
- **Approvals** — spend and actions waiting for human sign-off.
- **Runs** — accepted dispatches, flow history, proposals, outputs, and replay requests.
- **Ops** — governance, treasury, budgets, the kill switch, and other operator controls.

The cockpit is designed as a control surface, not a magic-autonomy promise. It keeps the human operator close to funding, risky actions, and governance while letting agents carry the routine execution loop.

## Launch Flow

Every launch starts from the company's apex goal and preserves a company Runs record, but execution depends on the selected engine.

With **HivemindOS crew**, HivemindOS plans the goal into Work Board tasks, routes them to eligible company agents, and connects the tasks to deliverables, evaluations, approvals, and reviewed learning. The Work Board answers both “what is the task?” and “which company is learning from this work?”

With **AEON background skill**, HivemindOS sends one bounded company-goal input to the selected workspace and skill. The accepted handoff appears in company Runs; detailed execution and outputs remain in AEON. No fake completed Work Board task is created.

## Optional AEON Automation

AEON is an optional autonomy engine for a Zero Human Company. It is not required to create or run companies, and the default remains the HivemindOS crew path described above.

In the create or edit flow, choose **AEON background skill**, then select a saved AEON workspace and one of the skills actually available in that workspace. A native HivemindOS crew becomes optional because the selected AEON workspace is the executor. The saved binding is checked against the live workspace catalog before it is accepted and again before dispatch.

Later cycles reuse the same workspace and skill until autonomy is stopped or the company is frozen. For an AEON-backed company, “idle” means the selected workspace has no queued or active run; HivemindOS does not use native agent presence or Work Board tasks as AEON's activity signal. Runs in one selected workspace are serialized so the company cadence does not create overlapping background jobs there. If workspace activity cannot be read, that cycle waits instead of launching another job blindly.

The responsibility boundary remains visible:

- HivemindOS owns the company definition, home-machine dispatch ownership, launch and stop controls, kill switch, and Company Runs trace.
- AEON owns the background skill execution, runtime credentials and permissions, outputs, schedules, and detailed run history.
- An accepted AEON dispatch is recorded in **Company Runs** without manufacturing a completed Work Board task. AEON outputs remain available through the selected workspace and the AEON view.
- Stopping or freezing the company prevents future cycles; an AEON job already accepted may finish.
- Company Work Board budgets and approval pauses do not automatically wrap an external AEON job. Configure the selected AEON workspace's own provider limits, permissions, and skill safety boundaries for that execution.

This option is useful for recurring background work already expressed as an AEON skill. Keep the HivemindOS crew engine selected when the goal should be decomposed into governed Work Board tasks and routed across multiple company agents. Follow [Use AEON With Zero Human Companies](../runtimes/aeon/zero-human-companies.html) for the complete setup, launch, monitoring, and troubleshooting walkthrough.

## Runs And Proposals

The **Runs** tab records the company's consequential operating branches: dispatches, flow starts, task outcomes, preview reviews, deliverable redirects, revenue events, and replay requests. A run keeps the input snapshot, status, recent events, outputs, and related proposals so operators can inspect why a company moved a branch forward.

Proposals are the human-settlement boundary. Pricing changes, human-input blockers, customer-preview decisions, deliverable rejection redirects, revenue-share records, and replay requests are recorded as pending, applied, rejected, or superseded decisions. That gives a company a durable record of what it proposed, what the operator selected or discarded, and what changed afterward.

Replay requests do not silently redo customer-facing or money-facing work. They create a pending replay proposal linked to the prior run, so the operator can choose when to branch the company forward again.

## Autonomous Execution

The Board tab has one launch control whose label follows the selected engine.

- **HivemindOS crew:** launch plans the apex goal into Work Board tasks. Later cycles wait for the company's board work to become idle and for an eligible crew member to be available.
- **AEON background skill:** launch sends the bounded goal to the selected skill. Later cycles wait for the AEON workspace to have no queued or active run. Native agents and Work Board availability are not used as AEON's activity signal.

**Stop autonomy** halts new dispatches; work already in flight finishes. Launching also claims the company for the machine that pressed the button, so a company definition replicated across the fleet auto-dispatches only from its home machine rather than from every machine at once.

Every company needs an explicit apex goal and an unfrozen treasury. The HivemindOS crew engine also needs at least one company agent; the AEON engine needs a current workspace and runnable skill instead. The Board shows when the goal was last dispatched and whether autonomy is running.

## Frontier Lab

Frontier Lab turns the native company execution loop into a governed intelligence utility. It is for operators who want one small crew to run more concurrent, independently reviewed work without pretending that more agent names automatically create more capability.

Frontier Lab currently requires the native **HivemindOS crew** with the **hierarchical** process. It cannot be enabled for AEON, sequential flows, or graph flows because those execution boundaries do not yet provide the same task-scoped reservation and settlement path. This is a fail-closed product boundary: an external or unattributed run never inherits a budget merely because the dashboard shows one.

### OAuth-Only Model Ladder

Frontier Lab uses one immutable reviewed ladder:

- **Scout — `gpt-5.6-luna`:** research, triage, planning, and routine synthesis.
- **Builder — `gpt-5.6-terra`:** implementation, operations, design, and deployment.
- **Reviewer — `gpt-5.6-sol`:** independent QA, evaluation, security, and audit gates.

All three tiers use the local OpenAI OAuth provider (`openai-codex`). Enabling requires a working OpenAI OAuth session and at least two distinct configured company agent identities, so the worker cannot review its own result. Frontier Lab does not fall back to OpenRouter, Claude, or an API-key provider when OAuth is absent. Stored policy is normalized again at runtime, so a hand-edited provider or model cannot silently bypass this ladder; dispatch rechecks that the reviewer is online and independent.

### Token Reservations And Settlement

The monthly ceiling is an internal token control budget, not a provider bill or a promise about subscription economics. Before a Frontier Lab task can claim a worker or call a model, HivemindOS atomically reserves the configured per-task amount in the company's private intelligence ledger. Concurrent processes cannot reserve the same remaining budget twice, and reservation ids make retries idempotent.

After execution, collector-reported worker and reviewer usage settles against the same task reservation. If a request starts but its response or usage metadata is unavailable, HivemindOS conservatively settles at least the full reservation and labels it estimated. A reservation is released only when execution stops before any inference request starts, and that release does not count as scale-gate evidence. Observed overages are preserved as facts and reduce future capacity to zero until the UTC month rolls over or the operator raises the ceiling.

A task created under Frontier Lab carries its tier on the Work Board. Disabling Frontier Lab while such a task is still queued does not let the task escape onto its agent's ordinary provider: it blocks before inference until the company policy is restored or the task is deliberately replaced outside Frontier Lab.

### Elastic Capacity And Scale Gates

Elastic workers mean an online company identity may serve more than one bounded task slot. They do not clone memory, create new wallets, bypass one-company identity isolation, or manufacture capacity without at least two online, independently identifiable worker/reviewer agents. The stage, monthly budget, per-task reservation, active reservations, tasks-per-cycle limit, parallel-task limit, and per-machine concurrency all constrain the scheduler; the smallest available bound wins.

Scale is operator-selected and evidence-gated:

| Stage | Maximum parallel tasks | Tasks per cycle | Turns per machine | Evidence required to enter |
| --- | ---: | ---: | ---: | --- |
| Pilot | 4 | 4 | 1 | Starting stage |
| Team | 12 | 12 | 2 | 3 settled tasks at 67% success |
| Frontier | 24 | 24 | 4 | 12 settled tasks at 80% success |

Scaling down is always available. Scaling up is never automatic: the cockpit enables a larger stage only after the company's settled outcomes meet its gate. These are safe capacity ceilings, not a literal “100 employees” equivalence or a claim that task count alone produces frontier-quality research.

### Earned Scale And The Scale Curve

Frontier Lab now places an **Earned Scale** recommendation beside those hard capacity gates. Every observed Frontier settlement records the task's evaluated outcome score, proof eligibility, elapsed time, token use, uniqueness check, duplication or conflict signal, human-intervention signal, and independent-review disagreement when those measurements exist. Older settlements remain valid accounting records; missing telemetry stays visibly missing instead of being guessed.

The Scale Curve compares a fixed baseline with a treatment across eight dimensions:

- outcome or evaluator-rubric score
- proof satisfied
- latency
- tokens
- unique contribution
- duplication or coordination conflict
- human intervention
- reviewer disagreement

Every new settlement retains the Frontier stage that produced it. The current stage is the treatment; its immediately smaller stage is the baseline. Comparative recommendations require at least three baseline and three treatment runs with every dimension observed. Pilot therefore collects treatment telemetry but has no smaller-stage comparison; after the operator enters Team, Pilot becomes the baseline, and after entering Frontier, Team becomes the baseline. A proof rate below 90%, any proof regression, material outcome regression, or severe coordination/reviewer debt produces **Reduce** even when the treatment completed more tasks or ran faster. A safe but negligible change produces **Hold**. Only a safe positive weighted curve produces **Scale**. Until the evidence is complete, the cockpit says **Collect evidence**.

The Scale Curve is a local experiment receipt and one additional stage guard, not a commercial authority. Pilot-to-Team expansion establishes the first comparison, but Team-to-Frontier expansion is blocked unless the measured Team treatment earns **Scale** against Pilot; stages cannot be skipped. The curve never auto-increases the monthly ceiling, changes the immutable OAuth ladder, bypasses the existing completion, budget, capacity, or independent-review gates, or spends tokens. The operator still chooses and saves every policy change.

### Outcome-Aware Allocation And Judgment Checkpoints

The cockpit shows the route HivemindOS uses for each kind of intelligence work. Outside Frontier Lab, scouts prefer adaptive free or local candidates when privacy and quality permit, builders are ranked by accepted outcome, quality, budget, latency, and privacy evidence, and consequential results use the strongest independently staffed reviewer. Inside Frontier Lab, the same roles stay on the immutable Luna, Terra, and Sol OAuth ladder.

Frontier company tasks also carry three explicit judgment checkpoints:

1. Before the first costly or mutating action, state the outcome metric, proof, task split, budget, and rollback path.
2. Mid-run, pause and re-plan when evidence contradicts the plan, reviewers disagree, or half the task reservation is consumed.
3. Before completion or stage expansion, require independent proof and score the full Scale Curve.

### Swarm Blackboard And Delight Miner

Frontier Lab reuses **Agent Challenges** as its live swarm blackboard instead of creating another coordination store. The cockpit summarizes active challenges, public-within-the-hive entries, experiment lineage, frontier results, contributors, and integrity alerts. Detailed candidates, findings, run requests, results, rulings, and playbooks still live in Hivemind Labs and the normal Agent Challenge path.

The **Delight Miner** looks at existing skill analytics from reviewed chat, Work Board, Company, and scheduled outcomes. Three distinct successful runs at an 80% success floor can propose a stronger reusable skill. Repeated success across days can also propose a schedule, and five strong Company uses can propose a standing company capability. These are review-gated suggestions only: the miner never installs a skill, creates a schedule, launches a company, or spends on its own.

### Cockpit Operation

Open a company and choose **Frontier Lab**. The cockpit leads with **Scale this goal**, the Scale Curve recommendation, outcome-aware allocation and checkpoints, the Agent Challenge blackboard, and review-gated Delight Miner proposals. It also shows settled, reserved, and remaining tokens; budget-affordable configured slots (with online routing rechecked at dispatch); stage locks; the model assigned to each tier; and recent task-scoped reservation events. Choose preset ceilings and concurrency limits, enable elastic slots if desired, select an earned stage, then save. Frontier planning itself is deterministic so no unreserved planner call can escape the ledger; metered inference starts only after a task reservation. New native hierarchical dispatches immediately use the saved policy. Existing non-Frontier tasks are not retroactively reclassified.

To compare agent behavior through a real local collector and model, run `hive-env-run -- pnpm benchmark:earned-scale`. It holds one Hermes worker fixed, counterbalances three baseline and three treatment sessions, preserves raw outputs, uses a condition-blind independent judge, and records an append-only Harness Experiment receipt. This live benchmark is explicit because it spends inference. `pnpm benchmark:earned-scale:policy` is the separate deterministic policy regression; it validates Scale Curve decisions but is not evidence that agents produce better work.

## Deliverables

The Deliverables tab shows what the company actually produced — the live sites it built, the pieces it published, the clips it made — as the headline output, and demotes the trackers, receipts, and scratch files that only evidence the work into a collapsed work log. What counts as a deliverable versus work log is decided per company from its charter, so a website agency's product is a preview link while a spreadsheet is just work log.

## Emails

Companies that run outreach — a website agency, a lead-gen crew, any team that emails prospects — send and receive real email through their agents' mailboxes. The **Emails** tab streams those threads onto the cockpit so the operator can see what the crew sent and what came back, without opening a separate mail client.

The tab only appears for companies whose charter or recent work looks like outreach (agency, sales, leads, campaigns, cold email, and similar signals). It loads live when the tab is opened, so it never slows the main company list.

### Where mail comes from

The Emails tab reads across every mail provider a company's agents use and merges the results newest-first:

- **AgentMail** — hosted agent inboxes. Threads are read from the AgentMail thread API. Inboxes are matched to the company's agents by the provisioning identifier HivemindOS stamps on each inbox, so a mailbox created on any machine in the fleet still shows up here.
- **Cloudflare Agentic Inbox** — self-hosted email-agent Workers. Received messages are read from the deployed Worker's inbox store and filtered to the company's mailbox addresses.

Mailboxes themselves are created in Agent Settings with **Create mailbox**, not here — see [Agent Provider Integrations](agent-provider-integrations.html) for provisioning and provider setup. The Emails tab is the read surface for what those mailboxes exchange. (ClawBank, despite offering a comms directory, is not a mail provider: it exposes no readable inbox.)

Each thread card shows who is on the other end, the subject and a preview, the mailbox and provider it came through, whether it was sent or received, and how recently it was active.

### Two views

A toggle switches between:

- **All mail** — the merged thread list across every provider (the default). Click a mailbox in the roster to focus this list on just that mailbox's threads; a chip clears the filter.
- **Mailboxes** — a roster of the crew's mailboxes, one card per agent mailbox, with its address, provider, and thread count.

The Mailboxes view is also where problems surface. A mailbox that is blocked, or a Cloudflare inbox that was provisioned but never deployed, appears as an **attention card** with the reason; a company agent that has no mailbox yet appears as a "no mailbox" card. The toggle badge turns red with a count when anything needs attention.

### Honest empty states

The tab never pretends. If no mail provider is connected, it says so and points at setup. If providers are connected but the crew has no mailboxes, or has mailboxes but no threads yet, it says exactly that. Nothing is fabricated — an empty tab always explains why it is empty.

## Learning Loops

Zero Human Companies use the generic HivemindOS loop contract as their private learning layer. With the HivemindOS crew engine, each launched Work Board task can carry an optimizer loop with success criteria, evidence requirements, eval gates, experiment candidates, and frontier metadata. The loop contract is also shared by chat-started work, Scheduler, Queen Bee flows, and Evo-compatible optimization.

The attached skills on those native Company tasks participate in HivemindOS's app-wide skill autoresearch mechanism. Three failed or blocked executions across distinct tasks can create one Brain Review proposal with Company provenance. Nothing changes automatically: applying the proposal launches a measured Work Board optimizer task, and any winning skill diff still needs human approval before installation.

AEON mode records the company handoff in Runs but leaves detailed execution and outputs in the selected workspace. AEON output does not automatically become a completed Work Board task or company learning receipt; bring reviewed outputs into the normal company workflow when they should contribute to deliverables or durable learning.

Every company task requires outcome evidence before completion. Product, design, content, and customer-facing work also requires a separate eligible agent to review the result. If the evidence or reviewer is unavailable, the task stops for review instead of quietly teaching the company that weak work succeeded.

Each dispatched company task includes a written done contract: planner assertions, evaluator pushback, agreed done criteria, and expected artifacts. Product, design, content, and customer-facing work also carries a default evaluator rubric for design, originality, craft, and functionality, so subjective quality can be reviewed consistently across models and workers. The reviewer records evidence for each score and must be a different agent from the worker that produced the result.

An AEON dispatch is handled differently because HivemindOS does not own the detailed external run. The accepted handoff is recorded as unobserved, not passed. Bring the resulting output back into the company workflow when it should count toward deliverables, learning, or routing history.

When a company is linked to a code project, implementation-shaped work asks for an isolated worktree workspace. Research, planning, and other non-code work stays in the normal scratch workspace.

That creates a model-independent company veteran layer made of:

- outcomes
- deliverables
- workflow assets
- receipts
- eval gates
- experiment lineage
- frontier candidates
- avoided failure modes
- reviewed memory candidates

Future workers can change, but the company keeps its charter, receipts, workflows, evals, and reviewed memory.

See [Agent Evaluations](agent-evaluations.html) for the shared verdicts, trust rules, managed runtime coverage, and benchmark.

## Capability Capital

Capability capital is the cockpit's summary of what the company has learned and produced. It is not a currency balance, and its underlying metric calculation is shared with generic loop reporting rather than owned by the company UI.

It can include:

- learning assets from completed work, durable outputs, committed experiments, and anti-patterns
- workflow assets from reusable task skills and committed loop branches
- private eval gates and pass rate
- Evo-style frontier candidates and experiment count
- distillation backlog for completed work that should be reviewed before it becomes Shared Brain Memory
- model-independence score from runtime diversity, eval structure, and frontier metadata

This gives the operator a way to see whether the company is building reusable capability instead of only spending tokens.

## Budgets And Approvals

Zero Human Companies can coordinate agent wallets, approval queues, spend caps, and kill switches. These controls govern native company work. External AEON provider usage follows the selected workspace's own credentials, permissions, and provider limits; a company Work Board budget does not automatically cap it. The local app may cache and display company controls, but it must not be the authority for official commercial value.

### API And Integration Limits

Every company has an always-available **Limits** tab. It lets the operator set daily or monthly request and estimated-spend limits for a connected provider, either across the provider or for one specific operation. Provider-wide and operation-specific limits stack: a call proceeds only when every applicable guardrail allows it. Removing a guardrail does not erase its historical usage.

Company-aware HivemindOS tools reserve expected requests and cost before execution, using an idempotency key so a retry is not charged twice. A frozen company is denied before the call. Integrations with their own meter can report observed requests and cost into the same usage ledger; actual observed cost is also recorded once in the company's Treasury spend rollup. The cockpit distinguishes observed history from a preflight reservation. External tools and AEON workspaces are not automatically intercepted, so they must use the company preflight action or enforce equivalent limits in their own runtime.

The Limits dashboard shows today's and this month's request and spend totals, a 30-day requests-or-spend chart, provider saturation bars, recent activity, and the number of active guardrails. These are local/BYOK operational controls and estimates, not official managed-service entitlements or a substitute for the provider's billing records.

For Google Cloud, the same tab can discover accessible projects, enabled APIs, quota metrics, and billing accounts. The operator chooses the daily quota caps, monthly billing ceiling, optional per-call estimate, and free monthly allowance, and can manage the same API independently in more than one project. Applying a limit creates or updates the existing provider quota and billing budget instead of stacking duplicate provider resources. Raising an existing limit requires an explicit second confirmation. Daily quotas are hard provider-enforced caps; Google Cloud billing budgets are alerts and forecasts, not hard monthly shutdowns. Project and billing discovery also require the corresponding Google Cloud APIs and OAuth permissions to be enabled.

For official paid access, managed credits, marketplace revenue, hosted-agent access, or enterprise quotas:

- settlement must be verified server-side or through a verifiable payment rail
- entitlements must come from a trusted backend or signed receipt
- local state can display access, but cannot create official access by itself
- provider keys, treasury keys, official pay-to routing, and pricing authority must stay out of the downloadable app

Self-hosted operators may configure their own wallets, pay-to addresses, providers, quotas, and terms. Those flows should be presented as self-hosted, not as official HivemindOS-managed revenue or entitlement.

## Revenue Recording And Platform Fees

Zero Human Companies can record external revenue events without giving HivemindOS a share of revenue earned elsewhere. **Revenue earned outside HivemindOS is not charged.**

The Treasury tab shows recorded revenue and any hosted-policy fee attached to a HivemindOS-sourced or HivemindOS-billed transaction. Operators can record an external event by amount and source without creating a fee.

A future marketplace-sourced or managed commercial transaction may carry a disclosed server-authoritative fee when HivemindOS supplies the buyer, billing, hosting, execution, or protection. The downloaded app and a manually recorded event cannot invent that obligation.

## Automated Revenue Rail (x402 Offers And Stripe)

Beyond manual recording, revenue can land in a company's ledger automatically from two sources:

- **x402 product offers.** A product in the company catalog can be published as a public x402 seller endpoint at `POST /api/paid-agents/offers/<slug>` (publish/unpublish through the company products API). Payment is the auth, the 402 challenge always serves the catalog price from the server, and each settled purchase writes a seller receipt attributed to the company. Settled receipts bridge into the company revenue ledger with the receipt id as the idempotency key, so replays and re-syncs never double-count. The local seller gateway follows the same explicit `HIVEMINDOS_PAID_AGENT_SELLER_MODE=self-hosted` opt-in and payment configuration as the paid-agent gateway.
- **Stripe checkout webhook.** Point a Stripe webhook at `POST /api/company-revenue/stripe-webhook` and map a payment link or checkout session to a company with `metadata.companyId` (or `client_reference_id`). The route verifies the Stripe signature, honors only the settled `amount_total`, and dedupes on the checkout session id. Set `HIVEMINDOS_COMPANY_STRIPE_WEBHOOK_SECRET` (or share `STRIPE_WEBHOOK_SECRET`).

Bridged revenue moves the company's apex-goal metric automatically for currency goals, so autonomy progress tracking runs off real recorded money. The Treasury tab's **revenue rail** line shows whether each source is connected and why not when it isn't.

## Related Docs

- [Work Board And Scheduler](work-and-scheduler.html) covers task storage, dispatch, loop contracts, eval gates, deliverables, scheduler work, and work history.
- [Use AEON With Zero Human Companies](../runtimes/aeon/zero-human-companies.html) covers choosing, launching, monitoring, and troubleshooting the optional AEON engine.
- [AEON v0.1 Control Plane](../runtimes/aeon/v01-control-plane.html) covers linking and operating a current AEON workspace.
- [Evo Optimization Runtime](evo-optimization.html) covers benchmark-driven optimizer loops and frontier-style experiments.
- [Wallets, Tokens, Honey, HIVE, And x402](wallets-honey-and-x402.html) covers agent wallets, payment rails, Hivemind Cloud credits, and x402 paid requests.
- [Agent Provider Integrations](agent-provider-integrations.html) covers agent mailbox provisioning (the **Create mailbox** flow, AgentMail and Cloudflare Agentic Inbox backends, and Agentic Inbox setup) that the Emails tab reads from.
- [Monetization](../../for-investors/) covers the free-vs-paid product boundary for managed services.

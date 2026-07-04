---
title: "Zero Human Companies"
---

# Zero Human Companies

Zero Human Companies turn a business goal into an agent-run operating loop.

A company has a charter, an apex goal, a crew of agents, budgets, approvals, a kill switch, Work Board tasks, and a private learning layer. The operator still owns the high-trust decisions: funding, policy, approval thresholds, public exposure, and whether a company should keep running.

## What It Does

Zero Human Companies are for repeatable work that should behave more like an operating company than a one-off chat:

- create or review a company charter
- assign agents to roles
- set an apex goal and task backlog
- launch work into the shared Work Board
- route tasks to eligible agents
- track approvals, spend caps, and kill-switch state
- preserve receipts, deliverables, eval gates, and learning artifacts
- summarize the company's accumulated know-how as capability capital

The feature is local-first. It can run with local agents, user-configured runtimes, user-owned wallets, and the shared Obsidian vault. Managed cloud, official monetization, marketplace listing, hosted capacity, or paid-agent access must be verified by HivemindOS-controlled infrastructure or by a verifiable payment rail before it grants official value.

## Cockpit

The Zero Human Company cockpit is the operator surface for one company.

It shows:

- the company charter, stage, and apex goal
- assigned agents and their roles
- team settings and agent membership
- approval queues and governance events
- treasury controls, budgets, and spend summaries
- issue-board style work lanes
- launched Work Board tasks and dispatch status
- learning-loop metrics and capability-capital summaries

The cockpit is organized into tabs:

- **Board** — the active work block, the autonomous-execution launch control, and issue-board work lanes.
- **Deliverables** — the company's real outputs, with a collapsed work log for the scratch that evidenced them.
- **Emails** — outreach threads and the crew's mailboxes, for companies that do outreach.
- **Learning** — capability-capital metrics and the eval frontier.
- **Team** — the org chart and agent membership.
- **Approvals** — spend and actions waiting for human sign-off.
- **Governance** — patches, reflections, escalations, and alerts.
- **Treasury** — budgets, the kill switch, spend summaries, and revenue share.

The cockpit is designed as a control surface, not a magic-autonomy promise. It keeps the human operator close to funding, risky actions, and governance while letting agents carry the routine execution loop.

## Launch Flow

When a company launches its apex goal, HivemindOS decomposes the goal into Work Board tasks and attaches company metadata to the dispatched work.

The launch path connects these systems:

- company records and presentation metadata
- Queen Bee planning
- Work Board task creation
- agent dispatch and autonomous pickup
- loop contracts and eval gates
- deliverables and run receipts
- Shared Brain review queues for durable memory

The same Work Board card can therefore answer both "what is the task?" and "which company is learning from this work?"

## Autonomous Execution

The Board tab has a single launch control for perpetual autonomy. **Launch autonomous work** decomposes the apex goal into Work Board tasks and dispatches them to the crew, then keeps the company running: whenever the board goes idle, the autonomy driver re-dispatches toward the same goal, on its own, until the operator stops it or the company is frozen. Spend stays inside the company budget the whole time.

**Stop autonomy** halts new dispatches; work already in flight finishes. Launching also claims the company for the machine that pressed the button, so a company definition replicated across the fleet auto-dispatches only from its home machine rather than from every machine at once.

Launch is gated on the basics — the company needs at least one agent, an explicit apex goal, and an un-frozen treasury. The Board shows when the goal was last dispatched and whether the driver is actually running, so "running" reflects real dispatch health rather than a stale flag.

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

Zero Human Companies use the generic HivemindOS loop contract as their private learning layer. Work Board is one place those loops are visible, but the loop contract itself is shared by chat-started work, Scheduler, Queen Bee flows, company dispatch, and Evo-compatible optimization. Each launched task can carry an optimizer loop with success criteria, evidence requirements, eval gates, experiment candidates, and Pareto frontier metadata.

The default company loop is non-blocking at creation time. Agents can finish useful work while HivemindOS preserves the eval structure and evidence trail for later review.

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

Zero Human Companies can coordinate agent wallets, approval queues, spend caps, and kill switches. The local app may cache and display company controls, but it must not be the authority for official commercial value.

For official paid access, managed credits, marketplace revenue, hosted-agent access, or enterprise quotas:

- settlement must be verified server-side or through a verifiable payment rail
- entitlements must come from a trusted backend or signed receipt
- local state can display access, but cannot create official access by itself
- provider keys, treasury keys, official pay-to routing, and pricing authority must stay out of the downloadable app

Self-hosted operators may configure their own wallets, pay-to addresses, providers, quotas, and terms. Those flows should be presented as self-hosted, not as official HivemindOS-managed revenue or entitlement.

## Revenue Share

Zero Human Companies can now record external revenue events and collect the HivemindOS company revenue share through the same policy-driven platform-fee rail used by local wallet payments. The default share is **2% of recorded company revenue with a $0.01 minimum**, net of refunds and chargebacks when those are known to the settlement route.

The Treasury tab shows recorded revenue, quoted share, collected share, and pending share for the company. Operators can record a revenue event by amount and source, and can optionally collect the share immediately from a selected company agent wallet. Collection requires explicit `COLLECT_COMPANY_REVENUE_FEE` confirmation and writes the fee as a visible platform-fee receipt in wallet activity.

This does not make the downloadable app the authority over official revenue. External revenue is charged only when it is recorded or settled through a trusted route such as `/api/company-revenue`, a hosted HivemindOS marketplace/billing service, or a verifiable third-party payment rail. Off-app cash, invoices, Stripe revenue, or marketplace sales that never report into one of those routes are not automatically charged by the local app.

## Related Docs

- [Work Board And Scheduler](work-and-scheduler.html) covers task storage, dispatch, loop contracts, eval gates, deliverables, scheduler work, and work history.
- [Evo Optimization Runtime](evo-optimization.html) covers benchmark-driven optimizer loops and frontier-style experiments.
- [Wallets, Tokens, Honey, HIVE, And x402](wallets-honey-and-x402.html) covers agent wallets, payment rails, managed HONEY credits, and x402 paid requests.
- [Agent Provider Integrations](agent-provider-integrations.html) covers agent mailbox provisioning (the **Create mailbox** flow, AgentMail and Cloudflare Agentic Inbox backends, and Agentic Inbox setup) that the Emails tab reads from.
- [Monetization](../../for-investors/) covers the free-vs-paid product boundary for managed services.

## Main Code Paths

- `src/features/dashboard/views/GovernancePanel.tsx`
- `src/features/dashboard/views/zero-human-companies/`
- `src/app/api/companies/route.ts`
- `src/app/api/companies/[id]/emails/route.ts`
- `src/lib/services/agent-mailboxes.ts`
- `src/lib/services/companies-store.ts`
- `src/lib/services/companies-orchestration.ts`
- `src/lib/services/companies-goal-planner.ts`
- `src/lib/types/company.ts`
- `src/lib/services/kanban/local-kanban-store.ts`
- `src/app/api/kanban/route.ts`

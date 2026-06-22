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

## Learning Loops

Zero Human Companies use the Work Board loop contract as their private learning layer. Each launched task can carry an optimizer loop with success criteria, evidence requirements, eval gates, experiment candidates, and Pareto frontier metadata.

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

Capability capital is the cockpit's summary of what the company has learned and produced. It is not a currency balance.

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

## Related Docs

- [Work Board And Scheduler](work-and-scheduler.html) covers task storage, dispatch, loop contracts, eval gates, deliverables, scheduler work, and work history.
- [Evo Optimization Runtime](evo-optimization.html) covers benchmark-driven optimizer loops and frontier-style experiments.
- [Wallets, Tokens, Honey, HIVE, And x402](wallets-honey-and-x402.html) covers agent wallets, payment rails, managed HONEY credits, and x402 paid requests.
- [Monetization](../monetization/) covers the free-vs-paid product boundary for managed services.

## Main Code Paths

- `src/features/dashboard/views/GovernancePanel.tsx`
- `src/features/dashboard/views/zero-human-companies/`
- `src/app/api/companies/route.ts`
- `src/lib/services/companies-store.ts`
- `src/lib/services/companies-orchestration.ts`
- `src/lib/services/companies-goal-planner.ts`
- `src/lib/types/company.ts`
- `src/lib/services/kanban/local-kanban-store.ts`
- `src/app/api/kanban/route.ts`

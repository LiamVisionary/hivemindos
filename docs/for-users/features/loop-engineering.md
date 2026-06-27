---
title: "Loop Engineering"
---

# Loop Engineering

Loop engineering is the HivemindOS layer that turns agent work into repeatable loops with visible state, gates, budgets, receipts, and learning records.

The live source of truth is still the Work Board. A loop can begin from chat, Scheduler, Queen Bee, a company dispatch, Evo, or a direct Work Board task, but the contract, run history, receipts, and handoff state stay in one inspectable record.

## What It Adds

- A machine-readable pattern registry for common loop shapes.
- Loop contracts with success criteria, retry/runtime budgets, evidence requirements, and eval gates.
- Receipts that prove why a gate or outcome passed.
- Human gates for external actions, risky spend, sensitive decisions, repeated failed attempts, and ambiguous handoffs.
- Exportable snapshots for humans and raw agents: `LOOP.md`, `STATE.md`, `loop-budget.md`, `loop-run-log.md`, and `patterns/registry.yaml`.
- A readiness score that says whether the current loop setup is report-only, assisted, or structurally ready for unattended work.

## Readiness Levels

| Level | Meaning | Use it for |
|---|---|---|
| L0 | Registry or isolated pieces exist, but durable loop state is not proving operation. | Design and setup. |
| L1 | Work Board state can be reported, but loop contracts or receipts are still thin. | Human-reviewed reports and dry runs. |
| L2 | Contracts and eval gates are present. | Assisted agent runs with human review before completion or side effects. |
| L3 | Gates, receipts, budgets, recent run activity, and human handoff gates are all visible. | Carefully bounded unattended loops. |

## Built-In Patterns

| Pattern | Mode | Typical use |
|---|---|---|
| Code Fix Loop | Closed | Repair code against tests, lint, type checks, and evidence receipts. |
| App Build Harness | Closed | Planner, builder, browser smoke, judge, and handoff loops for app work. |
| Research Loop | Open | Source-backed investigation with evidence receipts and review. |
| Content Loop | Open | Draft, judge, revise, and deliver content against a rubric. |
| Daily Brief Loop | Open | Recurring scan, prioritize, brief, deliver, and log work. |
| Operating Unit Learning Loop | Optimizer | Company, crew, or long-running goal learning loops. |
| Evo Benchmark Loop | Optimizer | Benchmark-driven experiment trees that can be handed to Evo. |

## Readiness Signals

The audit looks for pattern registry coverage, durable Work Board state, attached loop contracts, eval gates, verification receipts, run history, budget limits, human gates, Queen Bee or flow coordination, code-work isolation hints, and learning memory from experiments or anti-patterns.

L3 is intentionally conservative. A high score alone is not enough: the board also needs loop tasks, gates, receipts, complete budget coverage, a human handoff gate, and recent activity.

## Operator Surfaces

Use the dashboard loop APIs or the raw CLI depending on where the agent is running:

```bash
pnpm loop:audit
pnpm loop:audit -- --json
node scripts/hive-loop export --write <folder>
node scripts/hive-loop patterns
```

For API callers, `GET /api/loops` returns the registry, templates, and verifier definitions. Add `?readiness=true` to audit the current board, and add `&artifacts=true` to include the exported snapshot strings. `POST /api/loops` can return a readiness report, export artifacts, build a loop contract, or create a Work Board task with the generated contract attached.

## Operating Rule

Treat the readiness level as a ceiling, not a guarantee. Start new loop families at L1 or L2, run them with human review, then raise autonomy only when the Work Board shows passing receipts, bounded budgets, recent run history, and clear human gates for anything that should not be decided by an agent alone.

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
- Exportable snapshots for humans and raw agents: `LOOP.md`, `STATE.md`, `contract.md`, `loop-budget.md`, `loop-run-log.md`, and `patterns/registry.yaml`.
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

`contract.md` is the portable done-contract snapshot. It records the planner's assertions, evaluator pushback, agreed done criteria, expected artifacts, and any evaluator rubric attached to visible loop tasks. Product, design, content, and customer-facing loops can carry rubrics so subjective quality is graded against explicit axes instead of vibes.

## Completion Evaluation

For the user-facing overview, verdict reference, managed runtime coverage, and benchmark, see [Agent Evaluations](agent-evaluations.html).

HivemindOS records one normalized evaluation receipt when work finishes through a managed surface. The policy is proportional to risk:

| Tier | Typical work | What is checked |
|---|---|---|
| Quick | Ordinary chat | Terminal status, empty/thin output, and dead-end refusals. |
| Verified | Work Board tasks, Scheduler runs, and managed runtime CLI tasks | Quick checks plus trusted verification of any claimed artifacts or configured commands. |
| High assurance | Customer-facing, publishing, payment, deployment, or rubric-scored work | Verified checks plus a separate judge decision with confidence, rubric-axis scores, evidence, and evaluator identity. |

The receipt distinguishes `accepted`, `rejected`, `needs-evidence`, `abstained`, `evaluation-error`, and `unobserved`. An external runtime accepting a dispatch is not treated as proof that its work passed: AEON handoffs are recorded as `unobserved` until HivemindOS can read the corresponding result.

Security-sensitive gates are server-authoritative. A worker or API client cannot self-approve an independent judge, command, artifact-existence, governance, integrity, or optimizer-score gate. Passing server receipts are bound to the exact output reviewed, so changing the output invalidates the receipt. Ordinary evidence receipts remain attachable, but they do not substitute for authoritative checks.

Managed Codex and Claude Code tasks launched through HivemindOS produce run records and completion evaluations like other runtime tasks. A CLI process launched independently in a terminal is outside the managed run path. HivemindOS cannot honestly grade work it cannot observe. Route that work through the runtime task action, or return its completion event and artifacts to a Work Board loop, when an evaluation receipt is required.

Only accepted managed-task evaluations are eligible to influence task routing. Casual chat volume and unobserved external dispatches do not train Queen Bee's worker-success signal.

Run the deterministic evaluator regression suite and benchmark with:

```bash
pnpm test:evaluation
pnpm benchmark:evaluation
```

## Operating Rule

Treat the readiness level as a ceiling, not a guarantee. Start new loop families at L1 or L2, run them with human review, then raise autonomy only when the Work Board shows passing receipts, bounded budgets, recent run history, and clear human gates for anything that should not be decided by an agent alone.

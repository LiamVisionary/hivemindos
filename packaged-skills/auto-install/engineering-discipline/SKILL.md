---
name: engineering-discipline
description: HivemindOS-native engineering workflow for ambiguous, risky, or multi-step software work. Use when a task benefits from explicit design, a written plan, test-first implementation, systematic debugging, isolated work, evidence receipts, independent review, or a safe branch handoff. Select only the stages that fit the task; small clear reversible changes should stay lightweight.
---

# Engineering Discipline

Use HivemindOS as the control plane and the optional Engineering Discipline pack as a method shelf. The Work Board task, its loop contract, project instructions, and the user's request decide what is required. The methods do not create authority to commit, push, merge, delete, deploy, publish, spend, or fan out to other agents.

## Select The Smallest Useful Path

- For a clear, bounded, reversible change: inspect the call chain, capture a baseline, implement, and verify.
- For material ambiguity or a costly-to-reverse choice: use `brainstorming`, then `writing-plans`.
- For a defect: use `systematic-debugging`; add `test-driven-development` when a focused regression can express the failure.
- For a planned multi-step build: use `executing-plans` or `subagent-driven-development` only when the runtime and project permit delegation.
- For risky repository overlap: use `using-git-worktrees` while preserving every unrelated dirty change.
- Before completion: use `verification-before-completion`, then `requesting-code-review` or `receiving-code-review` when independent review is proportionate.
- At branch handoff: use `finishing-a-development-branch`, but perform no merge, push, cleanup, or deletion without exact authorization.

## Work Board Contract

When the task uses the Engineering Discipline Work Board template:

1. Scope the user-visible outcome, constraints, rollback, and explicit non-goals.
2. Record design approval only when the work is materially ambiguous, cross-system, or expensive to reverse.
3. Capture the real baseline through the same entry path that will be used for final verification.
4. For logic that can regress, record the failing test or equivalent red evidence before the implementation evidence.
5. Implement the smallest in-scope change and preserve concurrent work.
6. Run focused tests plus the relevant lint, type, build, browser, or runtime gates.
7. Attach the exact outputs, artifacts, files changed, known gaps, and rollback path.
8. Use an independent judge for high-risk, broad, security-sensitive, or user-visible work when the runtime supports it.

Never mark a gate passed from intention, stale output, a subagent summary, or a proxy that did not exercise the relevant path.

## Packaged Source Policy

The canonical HivemindOS copies live under `packaged-skills/auto-install/` and `packaged-skills/optional/`. Shared-vault and runtime skill folders are projections of those packages. The optional donor methods are pinned, security-reviewed adaptations of `obra/superpowers`; their upstream global bootstrap and local web-server tooling are intentionally not included.

If an installed skill conflicts with current HivemindOS or project rules, follow HivemindOS/project rules and record the conflict for a packaged-source update.

## Completion Receipt

Report:

- what was changed and why;
- the baseline and final gate results, including unchanged pre-existing failures;
- the real user/runtime path exercised;
- what remains inferred, skipped, or user-verifiable;
- whether repository changes are uncommitted, committed, or pushed.

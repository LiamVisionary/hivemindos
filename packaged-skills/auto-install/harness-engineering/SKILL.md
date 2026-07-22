---
name: harness-engineering
description: Improve an agent system by holding the worker constant and testing focused changes to context, tools, instructions, authority, or proof. Use for controlled baseline/treatment comparisons, repository harness reviews, prompt or tool-routing optimization, agent reliability work, context-usage audits, and evidence-backed retain/revise/remove decisions.
---

# Harness Engineering

Treat the model and agent runtime as a fixed worker. Improve the environment around that worker, one owned intervention at a time.

## Run the experiment

1. Define the job contract before editing:
   - exact target revision and external state;
   - worker runtime, model, configuration, and authority envelope;
   - one representative job and its accepted outcome;
   - worker-produced proof required for acceptance;
   - run, time, token, and cost budgets;
   - suspected earliest harness gap.
2. Reproduce the baseline through the real user or runtime entry path. Preserve the raw output, trajectory, proof, context evidence, metrics, and failure.
3. Locate the earliest gap. Record context as four distinct sets: `available`, `retrieved`, `invoked`, and `relevant`. Do not infer invocation from availability or retrieval.
4. Make the smallest intervention that could close that gap. Name its owner, mechanism, expected behavior, supporting and weakening evidence, carrying cost, and retirement condition.
5. Run fresh treatment sessions against an isolated target. Hold the worker, target, environment, authority, job, and evaluator steady. Prove that the intervention was available and exercised. Add an ablation when it materially tests causality.
6. Grade the domain outcome, worker-produced proof, and architecture boundary separately from tokens, latency, tool calls, retries, or trajectory shape.
7. Repeat both conditions at least three times before making a comparative claim. Counterbalance order when shared external state could bias the result.
8. Decide `retain`, `revise`, or `remove`. Retain only when accepted outcomes and proof do not regress and at least one measured dimension improves. Keep failed and superseded experiments as append-only evidence.

## HivemindOS surfaces

- Store experiments through `/api/harness-experiments` or `src/lib/services/evaluation/harness-experiments.ts`.
- Attach outcome contracts to the evaluation control plane when success needs a trusted verifier.
- Use Context X-Ray lifecycle evidence for retrieval and capability invocation claims.
- Use `scripts/benchmark-e2e-token-savings.mjs` only for live, user-approved provider runs. A lower token count is not a win unless the outcome grader also passes.
- Use skill autoresearch for repeated skill failures; it emits the same fixed-worker harness contract and remains review-gated.
- Do not commit, push, deploy, send, spend, or replace an installed skill unless the user authorized that exact action.

## Result contract

Return the contract, baseline receipt, intervention, treatment and ablation receipts, outcome/proof/architecture grades, comparison limits, and retain/revise/remove decision. State what remains unverified and whether any comparative claim is ready.

## Attribution

Adapted for HivemindOS from Ryan Lopopolo's [`lopopolo/harness-engineering`](https://github.com/lopopolo/harness-engineering), commit `226c8d35fb6ea3ed55467753dba6dea2b5fd5778`, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This adaptation adds HivemindOS experiment storage, evaluation, Context X-Ray, skill-autoresearch, and safety routes and does not vendor the upstream corpus.

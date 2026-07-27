---
title: "Harness Experiments"
description: "How HivemindOS compares agent context and tool changes without confusing lower cost or shorter runs with better work."
---

# Harness Experiments

Harness experiments help you improve an agent without changing the model underneath it. HivemindOS holds the worker and job steady, compares the current setup with one focused change, and keeps the evidence behind the result.

## What You Can Compare

- narrower task context instead of a broad context dump;
- a new or revised skill;
- better tool descriptions or capability routing;
- a repository instruction placed closer to the files it governs;
- a safer authority or approval boundary;
- stronger proof of the finished outcome.

Each experiment begins with a contract: the fixed worker, exact target, representative job, accepted outcome, required proof, authority boundary, and budget. The treatment then names one change and the behavior it is expected to improve.

## Evidence, Not Vibes

HivemindOS separates four context states:

| State | Meaning |
| --- | --- |
| Available | The source or capability could have been used. |
| Retrieved | It was selected and placed in task context. |
| Invoked | The worker actually used the capability. |
| Relevant | Evidence links it to the accepted outcome. |

This prevents a common false conclusion: seeing a tool in the prompt does not prove that the worker used it, and seeing a shorter prompt does not prove that the result was correct.

## How A Comparison Earns Trust

HivemindOS requires fresh, isolated runs with the same worker, target, environment, job, evaluator, and authority. A comparative claim needs at least three baseline and three treatment runs. The treatment must be available and exercised, and it must not leak into the baseline.

The result is graded in separate layers:

- Did the real task outcome pass?
- Did the worker produce the required proof?
- Did the implementation respect the intended architecture and authority boundary?
- Only then: did latency, retries, tool calls, tokens, or cost improve?

An experiment can be retained, revised, or removed. HivemindOS blocks a retain decision when outcome or proof quality regresses, parity was not held, or there is too little repeat evidence.

## Where You See It

Open the Memory and Review view to see recent controlled comparisons beside Context X-Ray. Each card shows baseline and treatment counts, claim readiness, outcome and proof deltas, token change when available, and the current decision.

Skill Autoresearch uses the same contract when repeated skill failures qualify for review. It compares the installed baseline with isolated candidates and never replaces the installed skill automatically.

## Cost And External Runs

Local deterministic graders do not call a paid model. Live provider comparisons can spend tokens and may depend on changing external state, so HivemindOS runs them only when you explicitly choose that benchmark. Provider usage is useful evidence, but a savings percentage is published only when the outcome grader also passes and the repeat threshold is met.

The method is adapted from Ryan Lopopolo's [Harness Engineering](https://github.com/lopopolo/harness-engineering), licensed under CC BY 4.0.

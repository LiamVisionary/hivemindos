---
title: "Agent Evaluations"
description: "How HivemindOS checks agent work, verifies evidence, uses independent reviewers, and avoids rewarding fake completion."
---

# Agent Evaluations

<section class="heroPanel">
  <div>
    <p class="eyebrow">Proof before credit</p>
    <h1>Agents do not get credit just for saying done.</h1>
    <p class="lede">HivemindOS checks the result, verifies the evidence that matters, and records what actually passed. Risky or customer-facing work gets a separate reviewer. Work the system cannot observe is labeled honestly instead of being counted as a success.</p>
    <div class="actionRow">
      <a href="loop-engineering.html">See loop contracts</a>
      <a href="zero-human-companies.html">See company quality controls</a>
    </div>
  </div>
</section>

The point is simple. An agent saying “I finished it” is not the same as the work being finished.

HivemindOS adds a shared completion check across managed agent work. It can reject empty answers, verify claimed files and commands, ask another agent to score a result against a rubric, and preserve the verdict with the run.

## What You Get

- One evaluation language across chat, Work Board tasks, companies, schedules, and managed runtime tasks.
- Proportional checks, so a normal chat reply does not pay the cost of a full review.
- Stronger review for publishing, payments, deployments, customer work, and other consequential actions.
- Clear results such as accepted, rejected, needs evidence, or unobserved.
- Receipts tied to the exact output that was reviewed.
- Routing signals based on evaluated task outcomes, not casual chat volume.

## Where It Works

| Surface | Evaluation behavior |
|---|---|
| Chat | Quick checks catch empty answers, very thin output, and dead-end refusals. Thumbs feedback records whether a managed response was useful. |
| Work Board | Managed completions receive a task evaluation and must satisfy required loop gates. |
| Zero Human Companies | Outcome evidence is required. Product, design, content, and customer-facing work also requires a separate reviewer. |
| Scheduler | Finished run notes include the evaluation verdict and receipt. |
| Managed runtime tasks | Codex, Claude Code, OpenHands, and Aider task runs are evaluated when their process finishes. |
| AEON company handoff | Dispatch acceptance is recorded as unobserved until HivemindOS can read and review the actual result. |
| Independently launched CLI | A process started outside HivemindOS is outside the managed run path. Bring its result back to a Work Board loop if you need an evaluation receipt. |

## Three Levels Of Review

### Quick

Used for ordinary chat. It answers basic questions: Did the run complete? Did the agent return anything useful? Was the answer only a refusal?

### Verified

Used for managed tasks, schedules, and runtime jobs. It adds trusted checks for claimed artifacts and configured commands. A path-looking string is not proof that a file exists, and pasted test output is not the same as a test HivemindOS actually ran.

### High assurance

Used when the work is risky, outward-facing, or scored by a rubric. A different eligible agent reviews the result, names the evidence behind each score, and records its confidence. If no separate reviewer is available, the work needs evidence or human review instead of silently passing.

## Evaluation Results

| Result | Meaning |
|---|---|
| Accepted | The completion passed the checks required for its risk level. |
| Rejected | The run completed, but the result did not meet the required bar. |
| Needs evidence | The claim may be valid, but a required artifact, command result, or reviewer was unavailable. |
| Abstained | The reviewer could not make a defensible decision from the available evidence. |
| Evaluation error | The evaluation itself failed. The work is not counted as accepted. |
| Unobserved | HivemindOS saw a handoff or external run state, but not enough of the result to grade it honestly. |

## Rate A Chat Response

Managed assistant messages show thumbs-up and thumbs-down buttons beneath the response. The selected rating stays with that exact saved message and can be changed or removed by clicking it again.

A thumbs-down rating changes that message's evaluation to rejected. A thumbs-up rating confirms useful work only when the automatic response checks already passed. It cannot turn an empty, failed, or otherwise rejected response into an accepted result.

Chat ratings remain separate from autonomous worker routing. They improve the evidence attached to the conversation without manufacturing successful task history.

## Why Receipts Are Hard To Fake

Workers and API clients can attach normal evidence, but they cannot approve their own independent review, command, artifact existence, governance, integrity, or optimization gates.

Those decisions belong to the managed evaluation path. Passing receipts are also tied to the exact output that was checked. If the output changes, the old receipt no longer proves the new result.

This matters most when agents are operating for a long time. A false pass does more than make one task look good. It teaches the routing system the wrong lesson, pollutes company memory, and makes future agents more confident in bad work.

## Getting Better Results

1. Run consequential work through the Work Board, Scheduler, a company crew, or a managed runtime task.
2. Ask the worker to return the actual deliverable and concrete verification evidence.
3. Keep expected files, URLs, test commands, and success criteria in the loop contract.
4. Give high assurance work at least two eligible agents, one to build and another to review.
5. Treat `needs evidence` as a useful stop, not a nuisance. It means the system refused to invent certainty.

## Measured Improvement

The deterministic evaluation benchmark covers successful work, empty answers, refusals, missing artifacts, unobserved external runs, and high risk review:

- Completion classification improved from 6/9 correct to 9/9 correct.
- Three adversarial trust checks improved from 0/3 blocked to 3/3 blocked.
- The in-process evaluation layer stayed below 0.01 ms p95 across two final 1,000-run measurements. Network and model review time is intentionally excluded.

This is a focused regression benchmark, not a claim that nine cases represent every kind of agent work. Its job is to make the trust boundary measurable and keep the known failure modes from coming back.

## The Product Difference

Most agent systems track whether a model stopped generating.

HivemindOS tracks whether the work deserves credit.

That is the difference between a pile of agent activity and a fleet you can actually trust.

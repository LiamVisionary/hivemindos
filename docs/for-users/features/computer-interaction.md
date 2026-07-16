---
title: "Computer Interaction"
---

# Computer Interaction

Computer Interaction is HivemindOS's governed way for an agent to operate a
dashboard or web page. It keeps one durable run around the work so observations,
policy decisions, actions, approvals, and verification remain connected even if
the caller reloads or resumes later.

HivemindOS chooses the narrowest useful control surface:

1. Hive Actions for a known product capability.
2. Bee Pilot for typed dashboard actions.
3. Page Agent for DOM interaction inside its opt-in developer lab.
4. Browser Use for general browser elements.
5. A fresh browser screenshot when structured state is not enough.

This ordering matters. A named action such as “open the Work board” is easier to
validate and explain than a guessed screen coordinate.

## Safety model

Every run can declare allowed websites and apps plus maximum steps, runtime, and
cost. Before an action, HivemindOS checks that it was planned from the latest
observation and that the current destination still matches the allowlist. If the
current website or app cannot be proved, a restricted run fails closed.

Page text is untrusted. Suspected prompt injection pauses the run before action so
the operator can inspect it. Submit, send, publish, purchase, transfer, delete,
upload, install, code-execution, and other consequence-bearing actions stop for
an approval tied to that exact pending action. A different or stale approval does
not resume it.

After an allowed action, HivemindOS observes again and binds that new state to the
receipt. Durable receipts retain useful shape and evidence while replacing typed
text, credentials, and secret-like values with redaction markers.

## Pause, resume, and stop

Runs can be paused, resumed, or stopped without losing their bounded policy,
latest observation, prior receipts, or event history. Completed, failed, and
stopped runs are terminal; they cannot silently restart.

Browser runs retain their named Browser Use session, so a resumed task observes
the same controlled browser context. Browser Use remains optional and follows its
own limited/full-permission setting; uploads and generated JavaScript remain in
the full-permission tier.

## What this does not do

Computer Interaction is not blanket permission to control the computer. Page
Agent stays inside its lab page, Browser Use stays inside its controlled browser,
and screenshots are evidence rather than permission. Wallet, payment, trade, and
other protected product capabilities continue to use their dedicated policy and
confirmation flows.

The deterministic evaluation suite covers form navigation, UI-change
verification, stale observations, prompt injection, consequence pauses, and exact
approval resumption. It tests the policy and receipt machinery; final release QA
should still exercise the intended website or dashboard path with the configured
browser and model.

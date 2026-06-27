---
name: n8n-workflow-reliability-guardrails
description: Prevent silent failures and unstable behavior in n8n production workflows by enforcing retries, error handling, timeout policy, and execution limits. Use for: error handling, retry, timeout, dead-letter, workflow reliability.
license: MIT
---
# n8n-workflow-reliability-guardrails

## Purpose

Prevent silent failures and unstable behavior in n8n production workflows by
enforcing retries, error handling, timeout policy, and execution limits.

## Inputs Required

- workflow criticality tier
- retry policy
- timeout settings
- error workflow destination

## Guardrail Policy

### Reliability controls

1. define retry count and backoff strategy
2. define per-node timeouts
3. define global failure path using error workflow
4. define concurrency and queue behavior
5. log execution identifiers and failure reason codes

### Environment controls

- sandbox: broader debug logging allowed
- staging: production-like settings with test data
- production: strict retries, strict timeout, strict alerting

## Output Format

- `workflow_name`
- `criticality`
- `retry_policy`
- `timeout_policy`
- `error_workflow`
- `alert_channel`

## Fail Conditions

Stop and request correction if:

- no error workflow is defined
- retry policy is undefined for external calls
- timeout values are missing

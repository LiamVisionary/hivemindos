---
name: n8n-observability-cost-control
description: Monitor workflow health and control operational cost, including AI-node usage, so GTM automation remains predictable and sustainable. Use for: execution monitoring, AI-node cost control, drift alerting, health checks.
license: MIT
---
# n8n-observability-cost-control

## Purpose

Monitor workflow health and control operational cost, including AI-node usage,
so GTM automation remains predictable and sustainable.

## Inputs Required

- workflow list and owners
- success and failure thresholds
- AI usage budget constraints
- reporting cadence

## Observability Model

Track:

- execution count
- success rate
- failure rate by node
- average runtime
- queue wait time
- AI token or request spend where relevant

## Cost Control Rules

1. set per-workflow budget thresholds
2. alert on weekly and monthly drift
3. move expensive enrichment or AI nodes after qualification gates
4. disable non-critical branches when budget thresholds breach

## Output Format

- `workflow_name`
- `period`
- `success_rate`
- `failure_rate`
- `avg_runtime_ms`
- `estimated_cost`
- `budget_status`
- `action_required`

## Fail Conditions

Stop and request correction if:

- no budget thresholds are defined
- no owner is assigned to alerts
- expensive nodes run before qualification filters

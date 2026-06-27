---
name: n8n-lead-scoring-routing
description: Score leads with explicit criteria and route them to the correct owner and workflow lane. Use for: lead scoring, route leads, MQL/SQL, prioritization, hot-lead alerts.
license: MIT
---
# n8n-lead-scoring-routing

## Purpose

Score leads with explicit criteria and route them to the correct owner and
workflow lane.

## Inputs Required

- scoring criteria and weights
- hard disqualifiers
- route policy by score tier
- notification channel

## Execution Sequence

1. ingest candidate lead row
2. evaluate hard disqualifiers
3. calculate weighted score
4. assign tier and route
5. write route record to destination
6. send route notification with context

## Scoring Rules

- use deterministic numeric weights
- separate fit score from intent score
- block routing when critical fields are missing

## Output Format

- `lead_id`
- `fit_score`
- `intent_score`
- `total_score`
- `tier`
- `route`
- `owner`
- `notification_status`

## Fail Conditions

Stop and request correction if:

- weights are undefined
- disqualifiers are missing
- route policy is missing

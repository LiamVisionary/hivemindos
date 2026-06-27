---
name: n8n-cold-outreach-orchestrator
description: Orchestrate cold outreach enrollment and execution with guardrails for template rotation, send limits, and contact-state transitions. Use for: outreach sequencing, campaign enrollment, template rotation, send guardrails.
license: MIT
---
# n8n-cold-outreach-orchestrator

## Purpose

Orchestrate cold outreach enrollment and execution with guardrails for template
rotation, send limits, and contact-state transitions.

## Inputs Required

- qualified lead list
- sequence rules
- daily send caps
- contact suppression lists

## Execution Sequence

1. ingest only qualified and validated contacts
2. check suppression and do-not-contact lists
3. assign template variant or sequence branch
4. apply send caps by inbox and campaign
5. enqueue send event
6. update status after send outcome

## Guardrails

- no sends to unvalidated contacts
- no duplicate sends within suppression window
- no campaign launch if cap controls are missing

## Output Format

- `contact_id`
- `sequence_id`
- `template_variant`
- `send_status`
- `send_timestamp`
- `next_step`

## Fail Conditions

Stop and request correction if:

- send caps are missing
- suppression list check is missing
- sequence branch logic is undefined

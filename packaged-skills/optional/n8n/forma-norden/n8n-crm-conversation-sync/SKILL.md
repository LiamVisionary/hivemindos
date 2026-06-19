---
name: n8n-crm-conversation-sync
description: Synchronize conversation outcomes from calls and email replies into CRM records with deterministic follow-up task creation. Use for: CRM sync, HubSpot, Salesforce, log activity, follow-up tasks.
license: MIT
---
# n8n-crm-conversation-sync

## Purpose

Synchronize conversation outcomes from calls and email replies into CRM records
with deterministic follow-up task creation.

## Inputs Required

- conversation source events
- CRM object mappings
- follow-up task rules
- owner assignment logic

## Execution Sequence

1. capture conversation event
2. identify account and contact in CRM
3. map outcome fields to CRM objects
4. write summary, status, and disposition
5. create follow-up task with due date and owner
6. notify owner if confidence is low or match fails

## Quality Rules

- no CRM write without entity match confidence
- preserve raw event id for traceability
- apply idempotency guard to avoid duplicate writes

## Output Format

- `event_id`
- `crm_contact_id`
- `crm_account_id`
- `conversation_outcome`
- `next_action`
- `task_owner`
- `task_due_date`

## Fail Conditions

Stop and request correction if:

- CRM field mappings are missing
- owner assignment is missing
- idempotency key is missing

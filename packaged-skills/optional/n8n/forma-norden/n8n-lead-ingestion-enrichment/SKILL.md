---
name: n8n-lead-ingestion-enrichment
description: Build reliable n8n workflows that ingest leads from multiple sources, deduplicate records, enrich account and contact fields, and output a route-ready schema. Use for: lead ingestion, enrich leads, webhook-to-enrichment, dedupe, schema validation.
license: MIT
---
# n8n-lead-ingestion-enrichment

## Purpose

Build reliable n8n workflows that ingest leads from multiple sources, deduplicate
records, enrich account and contact fields, and output a route-ready schema.

## Inputs Required

- source systems and API endpoints
- deduplication keys
- enrichment providers
- required output schema

## Execution Sequence

1. trigger ingestion by schedule or webhook
2. normalize fields into canonical schema
3. deduplicate by domain and person identifiers
4. enrich missing company and contact fields
5. validate required fields and drop invalid rows
6. write clean output to destination system

## Node Pattern

- Trigger node
- HTTP request nodes for source pull
- Set node for canonical mapping
- Merge node for source joins
- Function node for dedupe logic
- HTTP request or native nodes for enrichment
- IF node for quality gates
- destination write node

## Quality Rules

- dedupe before enrichment to reduce cost
- keep source traceability in output
- do not write rows missing required identifiers

## Output Format

- `source`
- `company_name`
- `company_domain`
- `first_name`
- `last_name`
- `title`
- `email`
- `validation_status`
- `enrichment_status`
- `ready_for_routing`

## Fail Conditions

Stop and request correction if:

- dedupe keys are undefined
- output schema is incomplete
- enrichment providers are missing

---
name: n8n-clay-integration
description: Use this skill to build bidirectional data flows between Clay and n8n for automated enrichment, scoring, and CRM sync. Use for: Clay integration, Clay webhook, bidirectional Clay<->n8n sync.
license: MIT
---
# n8n-clay-integration

Use this skill to build bidirectional data flows between Clay and n8n for
automated enrichment, scoring, and CRM sync.

## Integration Patterns

### Pattern 1: Clay Webhook to n8n (Event-Driven)

Clay fires a webhook when a table row is created or updated.
n8n receives the webhook and processes the data.

Setup:
1. In n8n: create a Webhook node (POST), copy the URL
2. In Clay: add an HTTP enrichment column pointing to the n8n webhook URL
3. Map the payload fields Clay sends to n8n node inputs
4. Add processing logic (scoring, routing, CRM push)
5. Return a response to Clay for confirmation

### Pattern 2: n8n HTTP Request to Clay API

n8n calls the Clay API to create rows, trigger enrichments, or read results.

Setup:
1. In n8n: use HTTP Request node
2. Base URL: `https://api.clay.com/v1/`
3. Authentication: Bearer token in header
4. Endpoints: tables, rows, enrichments
5. Use Split in Batches for bulk operations (50 rows per batch)

### Pattern 3: Scheduled Sync (n8n Polls Clay)

n8n runs on a schedule (Cron/Interval) and pulls new/updated rows from Clay.

Setup:
1. Schedule Trigger node (Cron: every 15 min, 1 hour, or daily)
2. HTTP Request to Clay API for rows with status = "ready"
3. Process each row (score, validate, enrich further)
4. Push to CRM or outbound tool
5. Update Clay row status to "processed"

## Data Transformation Nodes

Common n8n nodes for Clay data processing:

| Node | Purpose |
|------|---------|
| Set | Map Clay fields to CRM fields |
| IF | Route based on enrichment results |
| Switch | Multi-path routing by score tier |
| Code | Complex transformations, deduplication |
| Split in Batches | Process large Clay exports in groups |
| Merge | Combine Clay data with CRM data |

## Execution Sequence

1. Identify the data flow direction (Clay to n8n, n8n to Clay, or bidirectional).
2. Select the appropriate integration pattern.
3. Design the n8n workflow with error handling on every Clay API call.
4. Test with 5 rows before enabling production.
5. Add monitoring for API rate limits and failures.

## Output Contract

Return:

- n8n workflow design with node types and connections
- Clay API endpoint and payload configuration
- field mapping between Clay columns and downstream systems
- error handling setup for API failures
- monitoring setup for integration health

## Anti-Patterns

- calling Clay API without rate limiting in n8n
- processing all rows at once without batching
- not handling Clay API downtime in n8n workflows
- hardcoded field names instead of dynamic mapping
- missing retry logic on HTTP Request nodes to Clay

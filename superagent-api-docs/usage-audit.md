# Usage and audit events

> https://hivemindos.app/superagent-api/docs/usage-audit · Markdown version: https://hivemindos.app/superagent-api/docs/usage-audit.md

Use **usage** to answer "how much did this app use?" and **audit events** to answer "what happened on this exact request?"

Neither ever includes API secrets, credit credentials, connection credentials, wallet keys, request inputs, or service outputs.

## Read a usage summary

Needs the `usage:read` scope.

```ts
const response = await hive.usage.get({
  since: "2026-08-01T00:00:00.000Z",
  until: "2026-09-01T00:00:00.000Z",
  serviceId: "hive-research",
});

if (!response.ok) throw new Error(response.error);
console.log(response.usage.requests, response.usage.chargedCredits);
```

The summary shows total requests, failures, charged credits, and average duration, in total and per operation id. Filter with `since`, `until`, `serviceId`, or `operationId`.

Credits appear only when the service reports an authoritative charge. A zero means no charge was reported for that request, not that the service is free. Use the price catalog and account credit history for billing reconciliation.

## Read audit events

Needs the `audit:read` scope.

```ts
const response = await hive.usage.auditEvents({
  operationId: "services.invoke.hive-research.analyses.create",
  limit: 100,
});
```

Each event has its id and time, project and API-key id, operation and service, HTTP method and public path, final status and duration, and the charged credits when reported.

## Projects and access

- A project-bound key reads only its project. An account-level key selects a project with `X-HivemindOS-Project`. See [projects](projects-security.html).
- Give audit access to operator and support workloads, not ordinary workers.
- To trace an asynchronous action end to end, combine audit events with [webhook delivery receipts](runs-webhooks.html).

## Related

- [Projects and isolation](projects-security.html)
- [Runs and webhooks](runs-webhooks.html)
- [Per-endpoint limits](limits.html)

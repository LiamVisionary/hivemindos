---
title: "Monid And AKTA Pro"
---

# Monid And AKTA Pro

Connect Monid to let HivemindOS agents discover and use data tools from Monid's live catalog. This includes AKTA Pro private-company intelligence when it is available in your Monid workspace.

AKTA Pro can help research private companies using enrichment, funding and transaction history, company news, and business signals. Availability, schemas, and prices come from Monid at the time of the request rather than being fixed in HivemindOS.

## Connect

1. Create an API key in your Monid account.
2. Open **Integrations** in HivemindOS and select **Monid**.
3. Paste the API key and connect it.

HivemindOS verifies the key against your Monid workspace balance before saving it. The key stays in the shared credential store and is not returned to agents or shown in connection status.

## Use It From Chat

Ask naturally, for example:

> Use AKTA Pro through Monid to research Databricks funding, enrichment, recent news, and company signals.

The agent follows a guarded workflow:

1. Search Monid's current catalog for a suitable endpoint.
2. Inspect the endpoint's schema and current pricing.
3. Build input from the inspected schema and show the paid action for confirmation.
4. Recheck the price and run only after explicit confirmation.
5. Return immediate results or retrieve an asynchronous run by its run ID.

Catalog search, schema inspection, balance checks, and run-history reads do not execute a paid endpoint. Paid runs use your Monid workspace balance and require `CONFIRM_MONID_RUN`. If the price changes after inspection, HivemindOS refuses the run until the endpoint is inspected and confirmed again.

Start with small result limits on endpoints priced per result. Monid workspace budget controls remain authoritative and can block a run before it executes.

## Boundaries

- Monid is a third-party, bring-your-own-account integration. HivemindOS does not set Monid prices or grant Monid credits.
- HivemindOS reads endpoint availability, schemas, and prices live instead of assuming that a catalog entry remains unchanged.
- Provider output is external research data. Review sources and confidence before relying on it for financial, legal, or operational decisions.

import {
  MONID_API_KEY_ENV,
  MONID_RUN_CONFIRMATION,
  monidReadSchema,
  monidRunSchema,
} from "@/lib/services/integrations/monid";

import { defineHiveAction } from "../define";

export const monidReadAction = defineHiveAction({
  id: "integrations.monid-read",
  title: "Discover and inspect Monid data tools",
  description:
    "Discover Monid data endpoints, inspect their live schemas and prices, check balance, and retrieve run results. Includes AKTA Pro private-company intelligence when it is available in Monid's live catalog.",
  schema: monidReadSchema,
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["monid", "akta", "akta-pro", "private-markets", "companies", "funding", "signals", "research", "data", "mcp"],
  aliases: ["monid_read", "discover monid tools", "inspect monid endpoint", "akta pro research", "private company intelligence"],
  requiresConnection: [MONID_API_KEY_ENV],
  mcp: { expose: true, compact: true, toolName: "monid_read" },
  contextIndex: {
    summary: "Discover and inspect Monid data tools, including live schemas and prices, without spending balance.",
    retrievalText:
      "Use monid_read after Monid is connected in Integrations. Always action=discover with a short focused query first, then action=inspect for the selected provider and endpoint before constructing input. AKTA Pro can provide private-company enrichment, funding, transactions, news, and signals when returned by Monid's live catalog. action=status checks workspace balance; get-run and list-runs retrieve prior results. Discovery, inspection, balance, and run-history reads do not execute a paid data endpoint.",
    route: "/api/integrations/monid",
    methods: ["POST"],
  },
});

export const monidRunAction = defineHiveAction({
  id: "integrations.monid-run",
  title: "Run a Monid data tool",
  description:
    "Execute one inspected Monid data endpoint against the connected workspace balance. The confirmed price must still match Monid's live price and every run requires explicit confirmation.",
  schema: monidRunSchema,
  sideEffects: ["network", "payment"],
  risk: "high",
  tags: ["monid", "akta", "akta-pro", "research", "data", "run", "paid-api", "payment", "mcp"],
  aliases: ["monid_run", "run monid endpoint", "run akta pro", "paid private company research"],
  requiresConnection: [MONID_API_KEY_ENV],
  confirmation: {
    token: MONID_RUN_CONFIRMATION,
    reason:
      "A Monid run can spend the connected workspace balance. The app re-inspects the endpoint and refuses the run if its current pricing differs from the reviewed confirmedPrice.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "monid_run" },
  contextIndex: {
    summary: "Execute a price-bound Monid data request after explicit confirmation.",
    retrievalText:
      "Use monid_run only after monid_read action=discover and action=inspect. Build input strictly from the inspected schema; do not guess fields. Copy the inspected price object into confirmedPrice and obtain explicit confirmation CONFIRM_MONID_RUN. The server re-inspects immediately before execution and refuses stale pricing. Start with conservative result limits because PER_RESULT endpoints can cost more as result volume grows. Async responses return a runId; retrieve them with monid_read action=get-run.",
    route: "/api/integrations/monid",
    methods: ["POST"],
  },
});

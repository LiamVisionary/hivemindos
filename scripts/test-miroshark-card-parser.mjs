import assert from "node:assert/strict";

import {
  extractMiroSharkSimulationCard,
  getMiroSharkProcessSummary,
} from "../src/features/dashboard/views/chat/miroshark-card-parser.ts";

const bankrCapabilityReply = `
As a BankrAgent, I can help with wallet balances, trading, x402 paid APIs,
and connected app capabilities. HivemindOS also has a MiroShark social
simulation capability in the catalog, with status checks available elsewhere.
`;

assert.equal(
  extractMiroSharkSimulationCard(bankrCapabilityReply),
  null,
  "generic Bankr/capability text must not render a MiroShark simulation card",
);

assert.equal(
  getMiroSharkProcessSummary([
    {
      label: "Capability search completed",
      detail:
        "Matched MiroShark social simulation, x402, wallet, status, and paid API routes.",
      status: "completed",
    },
  ]),
  null,
  "capability-search process events must not render the MiroShark process card",
);

const realCard = extractMiroSharkSimulationCard(
  JSON.stringify({
    miroshark: {
      amountUsd: 1,
      paid: true,
      runId: "run_regression_123",
      seed: "Will a local food app pass safety review?",
      status: "complete",
      title: "Local food app safety review",
    },
  }),
);

assert.equal(realCard?.runId, "run_regression_123");
assert.equal(realCard?.title, "Local food app safety review");

const realProcess = getMiroSharkProcessSummary([
  {
    label: "Starting MiroShark x402",
    detail: "Preparing MiroShark simulation",
    status: "running",
  },
  {
    label: "MiroShark x402 running",
    detail: "MiroShark simulation started · run_regression_123",
    status: "running",
  },
]);

assert.equal(realProcess?.runId, "run_regression_123");
assert.equal(realProcess?.status, "running");

console.log("MiroShark card parser regression passed.");

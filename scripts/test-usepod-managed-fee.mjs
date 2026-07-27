#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const [
  usePodSource,
  paidAgentClientSource,
  streamSource,
  contextIndexSource,
  agentRuntimeTypesSource,
  usePodDocs,
  walletDocs,
  investorIndex,
  ecosystemPlan,
] = await Promise.all([
  readFile(new URL("src/lib/services/usepod.ts", root), "utf8"),
  readFile(new URL("src/lib/services/paid-agent-cloud-client.ts", root), "utf8"),
  readFile(new URL("src/app/api/chat/agent-runtime/stream-openai-compatible.ts", root), "utf8"),
  readFile(new URL("src/lib/services/context-index.ts", root), "utf8"),
  readFile(new URL("src/lib/types/agent-runtime.ts", root), "utf8"),
  readFile(new URL("docs/for-users/integrations/usepod.md", root), "utf8"),
  readFile(new URL("docs/for-users/features/wallets-honey-and-x402.md", root), "utf8"),
  readFile(new URL("docs/for-investors/index.md", root), "utf8"),
  readFile(new URL("docs/for-investors/ecosystem-plan.md", root), "utf8"),
]);

assert.match(agentRuntimeTypesSource, /billingMode\?: "direct" \| "hivemindos-managed"/);
assert.match(agentRuntimeTypesSource, /managedMaxDebitUsd\?: string/);

assert.match(paidAgentClientSource, /managedUsePodOpenAiBaseUrl/);
assert.match(paidAgentClientSource, /"api", "usepod", "managed", "v1"/);

assert.match(usePodSource, /HIVEMINDOS_USEPOD_MANAGED_PROXY_ENABLED/);
assert.match(usePodSource, /HIVEMINDOS_USEPOD_MANAGED_MAX_DEBIT_USD/);
assert.match(usePodSource, /HIVEMINDOS_USEPOD_MANAGED_CREDIT_SLUG/);
assert.match(usePodSource, /billingMode === "hivemindos-managed"/);
assert.match(usePodSource, /managedUsePodOpenAiBaseUrl\(\)/);
assert.match(usePodSource, /resolvePooledHivemindosModelCreditToken/);
assert.match(usePodSource, /X-HivemindOS-Credit-Token/);
assert.match(usePodSource, /X-HivemindOS-UsePod-Max-Debit-Usd/);
assert.match(usePodSource, /chatPath: "\/chat\/completions"/);
assert.match(usePodSource, /statusPath: "\/models"/);
assert.match(usePodSource, /const managedBilling = config\.tokenSource === "hivemindos-managed"/);
assert.match(usePodSource, /response\.ok && !managedBilling && !balanceRemaining/);
assert.match(usePodSource, /!managedBilling && response\.ok && models\[0\]\?\.id/);

assert.match(streamSource, /normalizeChatResponseBilling\(parsed\?\.hivemindos_billing\)/);
assert.match(streamSource, /responseBilling = managedBilling/);

assert.match(contextIndexSource, /Managed UsePod billing uses provider 'usepod'/);
assert.match(contextIndexSource, /preserves streaming SSE/);
assert.match(contextIndexSource, /UsePod hoster earnings are not locally skimmed/);

assert.match(usePodDocs, /HivemindOS-Managed Billing/);
assert.match(usePodDocs, /forwards the original streaming request to UsePod/);
assert.match(usePodDocs, /emits a final `hivemindos_billing` event/);
assert.match(usePodDocs, /UsePod hosters still receive the normal UsePod provider earnings/);
assert.match(walletDocs, /preserves streaming responses/);
assert.match(walletDocs, /charges upstream UsePod spend plus the configured HivemindOS platform fee/);
assert.match(investorIndex, /Managed UsePod inference brokerage/);
assert.match(investorIndex, /\*\*5% default HivemindOS platform fee\*\*/);
assert.match(investorIndex, /UsePod hoster earnings remain governed by UsePod/);
assert.match(ecosystemPlan, /Managed UsePod Inference Brokerage/);
assert.match(ecosystemPlan, /upstream UsePod spend plus a \*\*5% HivemindOS platform fee\*\*/);
assert.match(ecosystemPlan, /\$0\.05` gross hosted platform fee/);

console.log("Managed UsePod hosted-fee checks passed.");

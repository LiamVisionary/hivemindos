#!/usr/bin/env node
// Hermetic coverage for approval reasoning trails. New approvals should carry
// a direct explanation, reused approvals should refresh missing context, and old
// rows should get a fallback trail instead of showing only "exceeds threshold".
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-approvals-reasoning-"));
process.env.HOME = tempHome;

const {
  SPEND_APPROVALS_PATH,
  enqueueApproval,
  listApprovals,
} = await import("../src/lib/services/wallet/spend-approvals.ts");
const {
  approvalPushBody,
} = await import("../src/lib/services/push/mobile-push.ts");

try {
  const created = await enqueueApproval({
    agentId: "agent-models",
    agentName: "Scout",
    companyId: "co-demo",
    kind: "x402",
    asset: "USDC",
    amountUsd: 5,
    target: "http://localhost:5121/api/official-paid-agents/default/credits/top-up",
    reason: "Exceeds approval threshold ($2.00).",
    thresholdUsd: 2,
    explanation: {
      headline: "Add $5.00 of HivemindOS Models credits to the shared model balance.",
      summary: "This buys prepaid hosted model credits for future HivemindOS Models calls.",
      whyNow: "The selected top-up is $5.00 and needs review before the x402 payment settles.",
      impact: "Approving funds the shared model balance. Rejecting leaves the balance unchanged.",
      requestedAction: "Approve only if paid HivemindOS Models should be funded now.",
      evidence: ["Credit pool: default", "Existing pool token: not found"],
      missingContext: [],
      source: "HivemindOS Models credit top-up",
    },
  });

  assert.equal(created.explanation?.summary, "This buys prepaid hosted model credits for future HivemindOS Models calls.");
  assert.match(created.explanation?.whyNow ?? "", /\$5\.00/);
  assert.ok(created.explanation?.evidence.some((line) => line.includes("Approval threshold: $2.00")), "threshold is recorded as evidence");
  assert.equal(approvalPushBody({
    id: created.id,
    agentName: created.agentName,
    kind: created.kind,
    asset: created.asset,
    amountUsd: created.amountUsd,
    summary: created.explanation?.headline,
  }), created.explanation?.headline, "pushes use the direct explanation headline");

  const reused = await enqueueApproval({
    agentId: "agent-models",
    agentName: "Scout",
    companyId: "co-demo",
    kind: "x402",
    asset: "USDC",
    amountUsd: 5,
    target: "http://localhost:5121/api/official-paid-agents/default/credits/top-up",
    reason: "Exceeds approval threshold ($2.00).",
    thresholdUsd: 2,
    explanation: {
      summary: "Updated route context travels onto a reused pending approval.",
      evidence: ["Retry: same request reused"],
      missingContext: [],
    },
  });
  assert.equal(reused.id, created.id, "equivalent retries reuse one pending approval");
  const pending = await listApprovals({ status: "pending" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].explanation?.summary, "Updated route context travels onto a reused pending approval.");
  assert.ok(pending[0].explanation?.evidence.some((line) => line.includes("Retry: same request reused")));

  await mkdir(dirname(SPEND_APPROVALS_PATH), { recursive: true });
  await writeFile(SPEND_APPROVALS_PATH, JSON.stringify([{
    id: "legacy-approval",
    agentId: "legacy-agent",
    kind: "x402",
    asset: "USDC",
    amountUsd: 5,
    target: "http://localhost:5121/api/official-paid-agents/default/credits/top-up",
    reason: "Exceeds approval threshold ($2.00).",
    status: "pending",
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  }], null, 2));
  const legacy = await listApprovals({ status: "pending" });
  assert.equal(legacy[0].explanation?.source, "Legacy spend approval");
  assert.match(legacy[0].explanation?.summary ?? "", /before detailed reasoning trails/);
  assert.ok(legacy[0].explanation?.missingContext?.some((line) => line.includes("original agent prompt")));

  console.log("PASS test-spend-approval-reasoning");
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
}
process.exit(0);

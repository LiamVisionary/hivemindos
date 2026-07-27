#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const tempHome = await mkdtemp(join(tmpdir(), "hivemindos-crypto-gaps-"));
process.env.HOME = tempHome;

try {
  const clearSigning = await import("../src/lib/services/crypto/clear-signing.ts");
  const identity = await import("../src/lib/services/crypto/agent-identity-registry.ts");
  const crosschain = await import("../src/lib/services/crypto/crosschain-intents.ts");
  const risk = await import("../src/lib/services/crypto/risk-monitor.ts");
  const router = await import("../src/lib/services/crypto-capability-router.ts");

  const x402Review = clearSigning.buildClearSigningReview({
    kind: "x402",
    agentId: "agent:test",
    provider: "x402",
    url: "http://pay.example.com/run",
    amountUsd: 2,
    policy: { enabled: true, autoPayEnabled: true, maxPaymentUsd: 1, network: "eip155:8453" },
    paymentRequirement: { network: "eip155:8453", scheme: "exact", asset: "USDC", maxAmountRequired: "2000000" },
  });
  assert.equal(x402Review.blocked, true, "cap-exceeded x402 review should block");
  assert(x402Review.risks.some((item) => item.code === "cap-exceeded"));
  assert(x402Review.risks.some((item) => item.code === "non-https-url"));
  assert.equal(x402Review.fingerprint.length, 64);

  const sendReview = clearSigning.buildClearSigningReview({
    kind: "send",
    agentId: "agent:test",
    recipientAddress: "0x0000000000000000000000000000000000000001",
    amountUsd: 0.25,
    policy: { maxPaymentUsd: 1, network: "eip155:8453" },
  });
  assert.equal(sendReview.blocked, false);
  assert.equal(sendReview.confirmation, "SEND_USDC");

  const identityResult = await identity.upsertAgentIdentity({
    agentId: "agent:test",
    displayName: "Test Agent",
    handle: "@test-agent",
    walletAddress: "0x0000000000000000000000000000000000000001",
    network: "eip155:8453",
    ensName: "test-agent.eth",
    erc8004EntityId: "erc8004:test-agent",
    serviceEndpoint: "https://agent.example.com/api",
    x402Endpoint: "https://agent.example.com/x402",
    capabilities: ["paid-api", "crosschain-swap", "private-payment"],
    proofs: [{ type: "manual", value: "unit-test" }],
  });
  assert.equal(identityResult.record.handle, "test-agent");
  assert.equal(identityResult.record.fingerprint.length, 64);
  assert.equal(identityResult.warnings.length, 0);
  assert.equal((await identity.listAgentIdentities()).length, 1);
  assert.equal((await identity.getAgentIdentity("test-agent.eth")).agentId, "agent:test");
  await identity.retireAgentIdentity("agent:test");
  assert.equal((await identity.listAgentIdentities()).length, 0);

  const plan = crosschain.planCrosschainIntent({
    kind: "bridge",
    preferredProvider: "bankr",
    fromChain: "base",
    toChain: "arbitrum",
    fromAsset: "USDC",
    toAsset: "USDC",
    amountUsd: 5,
    prompt: "bridge 5 USDC from Base to Arbitrum",
  });
  assert.equal(plan.kind, "bridge");
  assert.equal(plan.selected.provider, "bankr");
  assert(plan.options.some((option) => option.provider === "lifi" && option.status === "planned"));
  assert(plan.options.some((option) => option.provider === "open-intents" && option.status === "planned"));

  assert.equal(router.normalizeCryptoIntent("cross chain payment"), "crosschain-payment");
  assert.equal(router.normalizeCryptoIntent("bridge"), "bridge");
  assert.equal(router.normalizeCryptoIntent("cross-chain bridge"), "bridge");
  assert.equal(clearSigning.normalizeClearSigningKind("cross-chain-swap"), "crosschain-intent");
  const capabilityMap = await router.getCryptoCapabilityMap({ intent: "bridge" });
  assert.equal(capabilityMap.selected.provider, "bankr");
  const preparedBridge = await router.prepareCryptoAction({
    agentId: "agent:test",
    intent: "bridge",
    fromChain: "base",
    toChain: "arbitrum",
    fromAsset: "USDC",
    toAsset: "USDC",
    amountUsd: 5,
    recipientAddress: "0x0000000000000000000000000000000000000001",
  });
  assert.equal(preparedBridge.provider, "bankr");
  assert.equal(preparedBridge.crosschainPlan.kind, "bridge");
  assert.equal(preparedBridge.review.kind, "crosschain-intent");
  assert.match(String(preparedBridge.requestBody.prompt), /bridge/);

  const riskReport = await risk.evaluateCryptoRisk({
    agentId: "agent:test",
    wallet: { agentId: "agent:test", enabled: true, autoPayEnabled: true, maxPaymentUsd: 0, provider: "veil", veilAutoSendEnabled: true },
    identity: { agentId: "agent:test", displayName: "Test Agent", capabilities: [] },
    env: { requiredKeys: ["HIVEMINDOS_TEST_CRYPTO_REQUIRED_KEY"] },
    infrastructure: {
      publicEndpoints: ["http://pay.example.com/x402"],
      tailnetOnly: false,
      webhookSecretsConfigured: false,
      runtimeMutationRequiresApproval: false,
    },
    repo: {
      githubRepo: "example/project",
      defaultBranchProtected: false,
      requiredReviewCount: 0,
      dependencyAuditClean: false,
      hasSecurityPolicy: false,
      deployKeyScoped: false,
    },
    dns: [{ domain: "example.com", dnssec: false, registrarLock: false, expiryDays: 5 }],
    multisig: { threshold: 1, signerCount: 1, hardwareSignerCount: 0, recoveryDocumented: false },
  });
  assert.equal(riskReport.severity, "critical");
  assert(riskReport.score < 50);
  assert(riskReport.findings.some((finding) => finding.code === "autopay-without-cap"));
  assert(riskReport.findings.some((finding) => finding.code === "required-env-missing"));

  const mcpSource = await readFile(new URL("./hivemind-mcp", import.meta.url), "utf8");
  assert.match(mcpSource, /review_crypto_action/);
  assert.match(mcpSource, /agent_crypto_identity/);
  assert.match(mcpSource, /crypto_risk_monitor/);
  assert.match(mcpSource, /crosschain-swap/);

  const docs = await readFile(new URL("../docs/for-users/features/wallets-honey-and-x402.md", import.meta.url), "utf8");
  assert.match(docs, /Clear signing is a review layer/);
  assert.match(docs, /Agent identity is local-first/);
  assert.match(docs, /Risk monitoring is an offline control review/);

  console.log("Crypto gap capabilities passed: clear-signing, identity registry, crosschain intent planning, risk monitor, router, MCP, and docs.");
} finally {
  await rm(tempHome, { recursive: true, force: true });
}

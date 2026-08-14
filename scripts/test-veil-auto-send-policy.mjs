#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

import ts from "typescript";

const root = process.cwd();
const routePath = join(root, "src/app/api/wallet/veil/transfer/route.ts");

function stripImports(source) {
  return source.replace(/^import[\s\S]*?;\n/gm, "");
}

function compileRouteSource() {
  const source = stripImports(readFileSync(routePath, "utf8"));
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: routePath,
  }).outputText;
}

function wallet(agentId, patch = {}) {
  return {
    agentId,
    enabled: true,
    provider: "veil",
    walletAddress: "0x1111111111111111111111111111111111111111",
    network: "eip155:8453",
    tokenSymbol: "USDC",
    seedBalanceUsd: 100,
    currentBalanceUsd: 100,
    dailyComputeBurnUsd: 0,
    maxPaymentUsd: 10,
    assetSpendCaps: { USDC: 10, ETH: 0.01 },
    approvalRequiredOverUsd: 0,
    dailyBudgetUsd: 0,
    monthlyBudgetUsd: 0,
    autoPayEnabled: false,
    duplicatePaymentGuardEnabled: true,
    duplicatePaymentGuardSeconds: 900,
    clawCardEnvName: "CLAWCARD_API_KEY",
    moneyClawEnvName: "MONEYCLAW_API_KEY",
    x402BaseUrl: "",
    veilAutoSendEnabled: false,
    veilAutoPrivateX402: true,
    survivalStartedAt: 0,
    updatedAt: 0,
    notes: "",
    custodyMode: "local",
    vaultAddress: "0x1111111111111111111111111111111111111111",
    onchainBalanceUsd: 100,
    nativeBalance: 0.1,
    lastOnchainSyncAt: 0,
    ...patch,
  };
}

function createRouteHarness() {
  const records = new Map([
    ["auto-on", { wallet: wallet("auto-on", { veilAutoSendEnabled: true, agentPermissions: { runner: "autonomous" } }), agentName: "Auto On" }],
    ["auto-off", { wallet: wallet("auto-off", { veilAutoSendEnabled: false, agentPermissions: { runner: "approval-required" } }), agentName: "Auto Off" }],
    ["wrong-network", { wallet: wallet("wrong-network", { veilAutoSendEnabled: true, network: "eip155:1" }), agentName: "Wrong Network" }],
    ["disabled", { wallet: wallet("disabled", { veilAutoSendEnabled: true, enabled: false }), agentName: "Disabled" }],
  ]);
  const calls = { execute: 0, veilEnv: 0 };
  const context = {
    exports: {},
    console,
    Response,
    Request,
    TextEncoder,
    TextDecoder,
    URL,
    VEIL_CASH_NETWORK: "eip155:8453",
    VEIL_CASH_TRANSFER_ASSETS: ["ETH", "USDC"],
    VEIL_CASH_TRANSFER_CONFIRMATION: "CONFIRM",
    VEIL_CASH_TRANSFER_CONFIRMATION_LABEL: "CONFIRM",
    VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM: 5,
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
    veilEnvValue: async () => {
      calls.veilEnv += 1;
      return "";
    },
    executeVeilPrivateTransfer: async () => {
      calls.execute += 1;
      throw new Error("executeVeilPrivateTransfer should not run in this validation test");
    },
    veilPrivateTransferErrorMessage: (error) => error?.message ?? String(error),
    requireAuth: async () => null,
    evaluateSpend: async () => ({ decision: "allow", reason: "test", budget: {} }),
    loadGovernanceWallet: async (agentId) => records.get(agentId) ?? null,
    resolveGovernedWalletAccess: async (agentId, actingAgentId) => {
      const record = records.get(agentId);
      if (!record) return null;
      if (!actingAgentId) return { walletId: agentId, wallet: record.wallet, walletName: record.agentName };
      const permissionMode = record.wallet.agentPermissions?.[actingAgentId];
      if (!permissionMode) return null;
      return {
        walletId: agentId,
        walletName: record.agentName,
        actingAgentId,
        permissionMode,
        wallet: {
          ...record.wallet,
          autoPayEnabled: permissionMode === "autonomous",
          veilAutoSendEnabled: permissionMode === "autonomous" && record.wallet.veilAutoSendEnabled,
        },
      };
    },
    resolveSpendGovernance: async (agentId) => records.get(agentId) ?? null,
    appendSpend: async () => {},
    shortTarget: (value) => String(value).slice(0, 10),
  };
  context.globalThis = context;
  vm.runInNewContext(compileRouteSource(), context, { filename: routePath });
  return { POST: context.exports.POST, calls };
}

const baseBody = {
  enabled: true,
  provider: "veil",
  network: "eip155:8453",
  asset: "USDC",
  recipientAddress: "0x2222222222222222222222222222222222222222",
  amount: "5",
  amountUsd: "5",
  maxPaymentUsd: 10,
  maxAssetAmount: 10,
  autoShield: true,
};

async function post(POST, body) {
  const response = await POST(new Request("http://unit.test/api/wallet/veil/transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

function assertError(result, status, text) {
  assert.equal(result.status, status);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error, text);
}

function assertStaticWiring() {
  const files = {
    walletPanel: readFileSync(join(root, "src/features/dashboard/views/WalletPanel.tsx"), "utf8"),
    walletView: readFileSync(join(root, "src/components/wallets-drop-in/WalletsView.tsx"), "utf8"),
    ledger: readFileSync(join(root, "src/lib/services/obsidian/wallet-ledger.ts"), "utf8"),
    router: readFileSync(join(root, "src/lib/services/crypto-capability-router.ts"), "utf8"),
    skill: readFileSync("/Users/liam/Documents/Obsidian/hivemindos-vault/Skills/hivemindos-wallet-rails/SKILL.md", "utf8"),
  };
  assert.match(files.walletPanel, /veilAutoSend: wallet\?\.veilAutoSendEnabled === true/);
  assert.match(files.walletPanel, /autoSendEnabled: veilAutoSendEnabled/);
  assert.match(files.walletView, /Allow Veil auto-send/);
  assert.match(files.walletView, /const requiresSendConfirmation = true/);
  assert.match(files.walletView, /Agent access/);
  assert.match(files.ledger, /\["veilAutoSendEnabled", record\.wallet\.veilAutoSendEnabled === true\]/);
  assert.match(files.ledger, /veilAutoSendEnabled: typeof fm\.veilAutoSendEnabled === "boolean" \? fm\.veilAutoSendEnabled : false/);
  assert.match(files.router, /return canAutoSendVeilTransfer\(wallet\) \? undefined : VEIL_CASH_TRANSFER_CONFIRMATION_LABEL/);
  assert.match(files.skill, /autoSendEnabled` in the request body is a client hint only/);
}

async function main() {
  const { POST, calls } = createRouteHarness();

  assertError(
    await post(POST, { ...baseBody, agentId: "auto-off" }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "auto-off", autoSendEnabled: true }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "missing-record", autoSendEnabled: true }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "wrong-network" }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "disabled" }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "auto-on" }),
    400,
    /Type CONFIRM to confirm this private transfer/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "auto-on", actingAgentId: "runner" }),
    424,
    /VEIL_KEY is not configured/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "auto-off", confirmation: "CONFIRM" }),
    424,
    /VEIL_KEY is not configured/,
  );
  assertError(
    await post(POST, { ...baseBody, agentId: "auto-on", actingAgentId: "runner", amount: "11", amountUsd: "11" }),
    400,
    /Amount exceeds this agent's USDC spend cap/,
  );

  assert.equal(calls.execute, 0, "The validation tests must never execute a Veil transfer.");
  assert.equal(calls.veilEnv, 2, "Only validation-passing cases should reach the VEIL_KEY gate.");
  assertStaticWiring();

  console.log("Veil auto-send policy tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

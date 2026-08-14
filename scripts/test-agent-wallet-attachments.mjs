#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { readWalletLedger, writeWalletRecord } = await import("../src/lib/services/obsidian/wallet-ledger.ts");
const { resolveGovernedWalletAccess } = await import("../src/lib/services/wallet/spend-governance.ts");
const {
  agentWalletsForAgent,
  createDefaultAgentWallet,
  indexAgentWalletsByAgent,
  normalizeAgentWalletAssignments,
  normalizeAgentWalletPermissions,
  walletWithAgentPermission,
} = await import("../src/lib/utils/agent-wallet.ts");

const researchWallet = normalizeAgentWalletAssignments({
  ...createDefaultAgentWallet("agent-wallet:research"),
  name: "Research treasury",
  walletAddress: "0x0000000000000000000000000000000000000001",
  enabled: true,
  autoPayEnabled: true,
  agentPermissions: {
    researcher: "autonomous",
    reviewer: "approval-required",
  },
  survivalStartedAt: 10,
  updatedAt: 10,
});
const operationsWallet = normalizeAgentWalletAssignments({
  ...createDefaultAgentWallet("agent-wallet:operations"),
  name: "Operations wallet",
  walletAddress: "0x0000000000000000000000000000000000000002",
  enabled: true,
  agentPermissions: {
    researcher: "approval-required",
  },
  survivalStartedAt: 20,
  updatedAt: 20,
});
const walletsById = {
  [researchWallet.agentId]: researchWallet,
  [operationsWallet.agentId]: operationsWallet,
};

assert.deepEqual(normalizeAgentWalletPermissions('{"researcher":"autonomous","reviewer":"approval-required"}'), {
  researcher: "autonomous",
  reviewer: "approval-required",
});
assert.deepEqual(normalizeAgentWalletPermissions(undefined, "legacy-agent", true), { "legacy-agent": "autonomous" });
assert.deepEqual(normalizeAgentWalletPermissions({}, "legacy-agent", true), {});
assert.deepEqual(normalizeAgentWalletPermissions(undefined, "agent-wallet:new", true), {});

assert.deepEqual(agentWalletsForAgent(walletsById, "researcher").map((wallet) => wallet.agentId), [
  "agent-wallet:research",
  "agent-wallet:operations",
]);
assert.equal(walletWithAgentPermission(researchWallet, "researcher")?.autoPayEnabled, true);
assert.equal(walletWithAgentPermission(researchWallet, "reviewer")?.autoPayEnabled, false);
assert.equal(walletWithAgentPermission(researchWallet, "unattached"), null);
assert.equal(indexAgentWalletsByAgent(walletsById, ["researcher", "reviewer"]).researcher.agentId, "agent-wallet:research");
assert.equal(indexAgentWalletsByAgent(walletsById, ["researcher", "reviewer"]).reviewer.agentId, "agent-wallet:research");

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-agent-wallets-"));
try {
  await writeWalletRecord({
    vaultPath,
    agentId: researchWallet.agentId,
    agentName: researchWallet.name,
    wallet: researchWallet,
  });
  await writeWalletRecord({
    vaultPath,
    agentId: operationsWallet.agentId,
    agentName: operationsWallet.name,
    wallet: operationsWallet,
  });

  const ledger = await readWalletLedger(vaultPath);
  assert.equal(ledger.records.length, 2);
  assert.deepEqual(ledger.records.find((record) => record.agentId === researchWallet.agentId)?.wallet.agentPermissions, researchWallet.agentPermissions);

  const autonomousAccess = await resolveGovernedWalletAccess(researchWallet.agentId, "researcher", { vaultPath });
  const approvalAccess = await resolveGovernedWalletAccess(researchWallet.agentId, "reviewer", { vaultPath });
  const secondaryAccess = await resolveGovernedWalletAccess(operationsWallet.agentId, "researcher", { vaultPath });
  const deniedAccess = await resolveGovernedWalletAccess(researchWallet.agentId, "unattached", { vaultPath });
  assert.equal(autonomousAccess?.permissionMode, "autonomous");
  assert.equal(autonomousAccess?.wallet.autoPayEnabled, true);
  assert.equal(approvalAccess?.permissionMode, "approval-required");
  assert.equal(approvalAccess?.wallet.autoPayEnabled, false);
  assert.equal(secondaryAccess?.walletId, operationsWallet.agentId);
  assert.equal(deniedAccess, null);

  const walletView = await readFile(join(process.cwd(), "src/components/wallets-drop-in/WalletsView.tsx"), "utf8");
  const accessModal = await readFile(join(process.cwd(), "src/components/wallets-drop-in/AgentWalletAccessModal.tsx"), "utf8");
  const walletPanel = await readFile(join(process.cwd(), "src/features/dashboard/views/WalletPanel.tsx"), "utf8");
  assert.match(walletView, /Create agent wallet/);
  assert.match(walletView, /No agent wallets created/);
  assert.doesNotMatch(walletView, /No wallet yet\. Initialise a rail/);
  assert.match(accessModal, /Clear all/);
  assert.match(accessModal, /Ask for approval/);
  assert.match(accessModal, /Autonomous within limits/);
  assert.match(walletPanel, /agent-wallet:\$\{/);
} finally {
  await rm(vaultPath, { recursive: true, force: true });
}

console.log("Agent wallet attachment and per-agent permission tests passed.");

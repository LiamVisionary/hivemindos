#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHiveFleetEconomy } from "../src/components/fleet-hive/hive-economy.ts";

function agent(id, name) {
  return {
    id,
    name,
    role: "Worker",
    state: "idle",
    wallet: "—",
    source: {},
  };
}

function machine(id, name, agents) {
  return {
    id,
    name,
    kind: "Mac",
    role: "Worker",
    state: "online",
    agents,
    source: {},
  };
}

function wallet(id, name, balanceUsd, agentPermissions) {
  return {
    agentId: id,
    name,
    enabled: true,
    provider: "moneyclaw",
    walletAddress: "",
    network: "eip155:8453",
    tokenSymbol: "USDC",
    seedBalanceUsd: balanceUsd,
    currentBalanceUsd: balanceUsd,
    dailyComputeBurnUsd: 0,
    maxPaymentUsd: 1,
    approvalRequiredOverUsd: 2,
    dailyBudgetUsd: 0,
    monthlyBudgetUsd: 0,
    autoPayEnabled: false,
    duplicatePaymentGuardEnabled: true,
    clawCardEnvName: "CLAWCARD_API_KEY",
    moneyClawEnvName: "MONEYCLAW_API_KEY",
    x402BaseUrl: "",
    survivalStartedAt: 0,
    updatedAt: 0,
    notes: "",
    agentPermissions,
    tokens: [{ symbol: "USDC", name: "USD Coin", balance: balanceUsd, network: "base" }],
  };
}

const alpha = agent("agent-alpha", "Alpha");
const beta = agent("agent-beta", "Beta");
const gamma = agent("agent-gamma", "Gamma");
const sharedWallet = wallet("wallet-shared", "Shared treasury", 50, {
  "agent-alpha": "approval-required",
  "agent-beta": "autonomous",
});
const alphaWallet = wallet("wallet-alpha", "Alpha operating wallet", 20, {
  "agent-alpha": "autonomous",
});

// The dashboard registry contains raw wallet entries plus per-agent primary
// aliases. The economy projection must collapse those aliases by wallet ID.
const economy = buildHiveFleetEconomy(
  [
    machine("machine-one", "One", [alpha]),
    machine("machine-two", "Two", [beta, gamma]),
  ],
  {
    "wallet-shared": sharedWallet,
    "wallet-alpha": alphaWallet,
    "agent-alpha": sharedWallet,
    "agent-beta": sharedWallet,
  },
);

assert.equal(economy.wallets.length, 2, "fleet should count each unique wallet once");
assert.equal(economy.totalUsd, 70, "fleet should not double-count a shared wallet");
assert.equal(economy.fundedAgentCount, 2);
assert.equal(economy.fundedMachineCount, 2);

const machineOne = economy.machines.find((entry) => entry.machineId === "machine-one");
const machineTwo = economy.machines.find((entry) => entry.machineId === "machine-two");
assert.equal(machineOne?.totalUsd, 70, "machine should include every wallet accessible to its agents");
assert.equal(machineTwo?.totalUsd, 50, "shared wallet should appear on each relevant machine");
assert.equal(machineTwo?.agents.find((entry) => entry.agentId === "agent-gamma")?.wallets.length, 0);

const alphaEconomy = machineOne?.agents.find((entry) => entry.agentId === "agent-alpha");
const betaEconomy = machineTwo?.agents.find((entry) => entry.agentId === "agent-beta");
assert.equal(alphaEconomy?.wallets.length, 2, "agent should show all attached wallets");
assert.equal(alphaEconomy?.totalUsd, 70);
assert.equal(betaEconomy?.wallets.length, 1);
assert.deepEqual(
  betaEconomy?.wallets[0]?.attachedAgentNames,
  ["Alpha", "Beta"],
  "shared-wallet metadata should resolve the other attached agent names",
);

const holdingsSource = await readFile(new URL("../src/components/fleet-hive/AgentHoldings.tsx", import.meta.url), "utf8");
assert.match(holdingsSource, /Shared with \{countLabel\(otherAgents\.length, "agent"\)\}/);
assert.match(holdingsSource, /Also using this wallet/);
assert.match(holdingsSource, /HiveFleetEconomyPanel/);
assert.match(holdingsSource, /HiveMachineEconomyPanel/);
assert.match(
  holdingsSource,
  /const walletAgents = economy\.agents\.filter\(\(agent\) => agent\.wallets\.length > 0\)/,
  "machine economy should omit agents that do not have a wallet",
);
assert.match(
  holdingsSource,
  /countLabel\(walletAgents\.length, "agent"\)/,
  "machine economy summary should count only visible wallet-bearing agents",
);

console.log("fleet Hive economy aggregation and shared-wallet disclosure checks passed");

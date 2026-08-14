import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import { agentWalletsForAgent, normalizeAgentWalletPermissions } from "@/lib/utils/agent-wallet";
import type { HiveAgent, HiveMachine } from "./fleet-hive-types";

export type HiveEconomyWallet = {
  id: string;
  name: string;
  balanceUsd: number;
  tokenSummary: string;
  attachedAgentIds: string[];
  attachedAgentNames: string[];
  source: AgentWalletConfig;
};

export type HiveAgentEconomy = {
  agentId: string;
  agentName: string;
  wallets: HiveEconomyWallet[];
  totalUsd: number;
};

export type HiveMachineEconomy = {
  machineId: string;
  machineName: string;
  agents: HiveAgentEconomy[];
  wallets: HiveEconomyWallet[];
  totalUsd: number;
};

export type HiveFleetEconomy = {
  machines: HiveMachineEconomy[];
  wallets: HiveEconomyWallet[];
  totalUsd: number;
  fundedAgentCount: number;
  fundedMachineCount: number;
  agentNamesById: Record<string, string>;
};

function positiveNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function walletBalanceUsd(wallet: AgentWalletConfig) {
  const onchain = positiveNumber(wallet.onchainBalanceUsd);
  return onchain > 0 ? onchain : positiveNumber(wallet.currentBalanceUsd);
}

function walletTokenSummary(wallet: AgentWalletConfig) {
  const tokenRows = (wallet.tokens ?? [])
    .filter((token) => positiveNumber(token.balance) > 0)
    .map((token) => `${positiveNumber(token.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${token.symbol}`);
  if (tokenRows.length) return tokenRows.join(" · ");
  const symbol = wallet.tokenSymbol?.trim().toUpperCase() || "USDC";
  const balance = walletBalanceUsd(wallet);
  if (balance > 0 && (symbol === "USD" || symbol === "USDC" || symbol === "USDG")) {
    return `${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${symbol}`;
  }
  return symbol;
}

function uniqueWallets(wallets: HiveEconomyWallet[]) {
  const unique = new Map<string, HiveEconomyWallet>();
  for (const wallet of wallets) {
    if (!unique.has(wallet.id)) unique.set(wallet.id, wallet);
  }
  return [...unique.values()];
}

function walletForEconomy(wallet: AgentWalletConfig, agentNamesById: Record<string, string>): HiveEconomyWallet {
  const permissions = normalizeAgentWalletPermissions(wallet.agentPermissions, wallet.agentId, wallet.autoPayEnabled);
  const attachedAgentIds = Object.keys(permissions);
  return {
    id: wallet.agentId,
    name: wallet.name?.trim() || "Agent wallet",
    balanceUsd: walletBalanceUsd(wallet),
    tokenSummary: walletTokenSummary(wallet),
    attachedAgentIds,
    attachedAgentNames: attachedAgentIds.map((agentId) => agentNamesById[agentId] || agentId),
    source: wallet,
  };
}

function walletsForAgent(
  agent: HiveAgent,
  walletRegistry: Record<string, AgentWalletConfig>,
  agentNamesById: Record<string, string>,
) {
  const fromRegistry = agentWalletsForAgent(walletRegistry, agent.id);
  const fallback = fromRegistry.length ? fromRegistry : walletRegistry[agent.id] ? [walletRegistry[agent.id]] : [];
  return uniqueWallets(fallback.map((wallet) => walletForEconomy(wallet, agentNamesById)));
}

export function buildHiveFleetEconomy(
  machines: HiveMachine[],
  walletRegistry: Record<string, AgentWalletConfig>,
): HiveFleetEconomy {
  const agentNamesById: Record<string, string> = {};
  for (const machine of machines) {
    for (const agent of machine.agents) agentNamesById[agent.id] = agent.name;
  }

  const economyMachines = machines.map((machine): HiveMachineEconomy => {
    const agents = machine.agents.map((agent): HiveAgentEconomy => {
      const wallets = walletsForAgent(agent, walletRegistry, agentNamesById);
      return {
        agentId: agent.id,
        agentName: agent.name,
        wallets,
        totalUsd: wallets.reduce((total, wallet) => total + wallet.balanceUsd, 0),
      };
    });
    const wallets = uniqueWallets(agents.flatMap((agent) => agent.wallets));
    return {
      machineId: machine.id,
      machineName: machine.name,
      agents,
      wallets,
      totalUsd: wallets.reduce((total, wallet) => total + wallet.balanceUsd, 0),
    };
  });

  const wallets = uniqueWallets(economyMachines.flatMap((machine) => machine.wallets));
  const fundedAgentIds = new Set(
    economyMachines.flatMap((machine) => (
      machine.agents
        .filter((agent) => agent.wallets.length > 0)
        .map((agent) => agent.agentId)
    )),
  );
  return {
    machines: economyMachines,
    wallets,
    totalUsd: wallets.reduce((total, wallet) => total + wallet.balanceUsd, 0),
    fundedAgentCount: fundedAgentIds.size,
    fundedMachineCount: economyMachines.filter((machine) => machine.wallets.length > 0).length,
    agentNamesById,
  };
}

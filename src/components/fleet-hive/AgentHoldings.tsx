"use client";

import { ArrowRight, WalletCards } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatEconomyHoney,
  formatEconomyUsd,
  useFleetEconomyBalances,
} from "@/components/fleet/use-fleet-economy-balances";
import type {
  HiveAgentEconomy,
  HiveFleetEconomy,
  HiveMachineEconomy,
} from "./hive-economy";
import styles from "./hive-economy.module.css";

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function EconomyHeader({ label, totalUsd }: { label: string; totalUsd: number }) {
  return (
    <div className={styles.header}>
      <span className={styles.eyebrow}>{label}</span>
      <strong>{formatEconomyUsd(totalUsd)}</strong>
    </div>
  );
}

export function HiveFleetEconomyPanel({ economy }: { economy: HiveFleetEconomy }) {
  const { data, loading } = useFleetEconomyBalances();
  return (
    <section className={`${styles.economyRoot} ${styles.fleetCard}`} aria-label="Fleet economy">
      <EconomyHeader label="Economy" totalUsd={economy.totalUsd} />
      <p className={styles.summaryCopy}>
        Unique wallet balance across {countLabel(economy.fundedMachineCount, "machine")} and {countLabel(economy.fundedAgentCount, "agent")}.
      </p>
      <div className={styles.fleetMetrics}>
        <div>
          <span>Wallets</span>
          <strong>{economy.wallets.length}</strong>
        </div>
        <div title={data?.totalHoney != null ? `${formatEconomyHoney(data.totalHoney)} Honey recorded lifetime` : undefined}>
          <span>Honey</span>
          <strong data-loading={loading ? "true" : undefined}>
            {loading ? "" : data?.availableHoney == null ? "—" : formatEconomyHoney(data.availableHoney)}
          </strong>
        </div>
        <div>
          <span>Bankr credits</span>
          <strong data-loading={loading ? "true" : undefined}>
            {loading ? "" : data?.bankrBalanceUsd == null ? "—" : formatEconomyUsd(data.bankrBalanceUsd)}
          </strong>
        </div>
      </div>
    </section>
  );
}

export function HiveMachineEconomyPanel({ economy }: { economy: HiveMachineEconomy }) {
  const walletAgents = economy.agents.filter((agent) => agent.wallets.length > 0);
  return (
    <section className={`${styles.economyRoot} ${styles.machineCard}`} aria-label={`${economy.machineName} economy`}>
      <EconomyHeader label="Economy" totalUsd={economy.totalUsd} />
      <div className={styles.machineMeta}>
        {countLabel(economy.wallets.length, "unique wallet")} across {countLabel(walletAgents.length, "agent")}
      </div>
      <div className={styles.agentBalances}>
        {walletAgents.length ? walletAgents.map((agent) => (
            <div className={styles.agentBalanceRow} key={agent.agentId}>
              <span>
                <strong>{agent.agentName}</strong>
                <small>{countLabel(agent.wallets.length, "wallet")}</small>
              </span>
              <strong>{formatEconomyUsd(agent.totalUsd)}</strong>
            </div>
          )) : (
            <div className={styles.empty}>No agent wallets on this machine.</div>
          )}
      </div>
    </section>
  );
}

function SharedWalletAgents({ agentId, economy }: { agentId: string; economy: HiveAgentEconomy }) {
  const walletRows = economy.wallets.map((wallet) => ({
    wallet,
    otherAgents: wallet.attachedAgentIds
      .map((id, index) => ({ id, name: wallet.attachedAgentNames[index] || id }))
      .filter((agent) => agent.id !== agentId),
  }));

  return (
    <div className={styles.walletList}>
      {walletRows.map(({ wallet, otherAgents }) => (
        <article className={styles.walletCard} key={wallet.id}>
          <span className={styles.walletIcon} aria-hidden="true"><WalletCards /></span>
          <div className={styles.walletMain}>
            <strong>{wallet.name}</strong>
            <span>{wallet.tokenSummary}</span>
            {otherAgents.length ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className={styles.sharedAgentsLink}>
                    Shared with {countLabel(otherAgents.length, "agent")}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8} className={styles.sharedAgentsTooltip}>
                  <strong>Also using this wallet</strong>
                  {otherAgents.map((agent) => <span key={agent.id}>{agent.name}</span>)}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <strong className={styles.walletValue}>{formatEconomyUsd(wallet.balanceUsd)}</strong>
        </article>
      ))}
    </div>
  );
}

export function AgentHoldings({
  economy,
  onViewWallet,
}: {
  economy: HiveAgentEconomy;
  onViewWallet?: () => void;
}) {
  return (
    <section className={`${styles.economyRoot} ${styles.agentWallets}`} aria-label={`${economy.agentName} wallets`}>
      <EconomyHeader label="Wallets" totalUsd={economy.totalUsd} />
      {economy.wallets.length ? (
        <SharedWalletAgents agentId={economy.agentId} economy={economy} />
      ) : (
        <div className={styles.empty}>No wallets attached yet.</div>
      )}
      <button type="button" className={styles.viewWallet} disabled={!onViewWallet} onClick={onViewWallet}>
        See full wallet
        <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { hasConfiguredAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import styles from "./trade.module.css";
import { CryptoTradeView } from "./CryptoTradeView";
import { StocksTradeView } from "./StocksTradeView";
import { WalletSelectModal } from "./WalletSelectModal";

type TradeSegment = "crypto" | "stocks";

// Panel prop bags are loosely typed across the dashboard; keep agents permissive.
type TradeAgent = { id: string; name?: string; wallet?: unknown; provider?: unknown; usePod?: unknown; venice?: unknown };

type TradePanelProps = {
  displayAgents?: TradeAgent[];
  walletsByAgent?: Record<string, unknown>;
  selectedAgent?: { id?: string } | null;
  setSelectedAgentId?: (id: string) => void;
  setActiveView?: (view: DashboardView) => void;
  getSurvivalSnapshot?: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  theme?: "light" | "dark";
};

function walletFor(agent: TradeAgent, walletsByAgent?: Record<string, unknown>): AgentWalletConfig {
  return resolveAgentWallet(
    agent as Parameters<typeof resolveAgentWallet>[0],
    (walletsByAgent?.[agent.id] ?? agent.wallet) as Parameters<typeof resolveAgentWallet>[1],
  );
}

export function TradePanel(props: TradePanelProps) {
  const agents = useMemo(() => (Array.isArray(props.displayAgents) ? props.displayAgents : []), [props.displayAgents]);
  const [segment, setSegment] = useState<TradeSegment>("crypto");
  const [actingAgentId, setActingAgentId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Prefer the currently-selected agent, then the first configured wallet, then
  // any agent (so the views can still show their setup states).
  const configuredIds = useMemo(
    () => new Set(agents.filter((agent) => {
      const wallet = walletFor(agent, props.walletsByAgent);
      return hasConfiguredAgentWallet(agent as Parameters<typeof hasConfiguredAgentWallet>[0], wallet) && !(wallet as { setupRequired?: boolean }).setupRequired;
    }).map((agent) => agent.id)),
    [agents, props.walletsByAgent],
  );
  const defaultAgentId = (props.selectedAgent?.id && configuredIds.has(props.selectedAgent.id))
    ? props.selectedAgent.id
    : (agents.find((agent) => configuredIds.has(agent.id))?.id || props.selectedAgent?.id || agents[0]?.id || "");

  const actingAgentId2 = actingAgentId && agents.some((agent) => agent.id === actingAgentId) ? actingAgentId : defaultAgentId;
  const actingAgent = agents.find((agent) => agent.id === actingAgentId2) ?? null;
  const actingWallet = useMemo<Record<string, unknown> | null>(
    () => (actingAgent ? (walletFor(actingAgent, props.walletsByAgent) as unknown as Record<string, unknown>) : null),
    [actingAgent, props.walletsByAgent],
  );

  const pickAgent = (id: string) => {
    setActingAgentId(id);
    props.setSelectedAgentId?.(id);
  };

  return (
    <div className={`fr-root ${styles.root}`} data-fr-theme={props.theme === "light" ? "light" : undefined}>
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.title}>Trade</h2>
          <p className={styles.subtitle}>Buy, sell, and swap — crypto and stocks — through your agents&apos; governed wallets.</p>
        </div>
        <div className={styles.actingRow}>
          <span className={styles.label}>Acting wallet</span>
          <button type="button" className={styles.actingButton} onClick={() => setPickerOpen(true)} disabled={!agents.length}>
            <span className={styles.actingName}>{actingAgent ? (actingAgent.name || actingAgent.id) : "Select a wallet"}</span>
            <span className={styles.actingChange}>Change</span>
          </button>
        </div>
      </div>

      <div className={styles.segmented} role="tablist" aria-label="Asset class">
        {(["crypto", "stocks"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={segment === value} data-active={segment === value ? "" : undefined} onClick={() => setSegment(value)}>
            {value === "crypto" ? "Crypto" : "Stocks"}
          </button>
        ))}
      </div>

      {!actingAgent ? (
        <div className={styles.card}>
          <div className={styles.empty}>Add an agent with a wallet to start trading. Open the Fleet tab to create one.</div>
        </div>
      ) : segment === "crypto" ? (
        <CryptoTradeView
          key={actingAgent.id}
          agentId={actingAgent.id}
          wallet={actingWallet}
          agentName={actingAgent.name || actingAgent.id}
          setActiveView={props.setActiveView}
        />
      ) : (
        <StocksTradeView
          key={actingAgent.id}
          agentId={actingAgent.id}
          wallet={actingWallet}
          agentName={actingAgent.name || actingAgent.id}
          setActiveView={props.setActiveView}
        />
      )}

      {pickerOpen ? (
        <WalletSelectModal
          agents={agents as unknown as AgentProfile[]}
          walletsByAgent={props.walletsByAgent as Record<string, AgentWalletConfig | undefined>}
          getSurvivalSnapshot={props.getSurvivalSnapshot ?? (() => ({}) as AgentSurvivalSnapshot)}
          currentAgentId={actingAgentId2}
          onConfirm={pickAgent}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default TradePanel;

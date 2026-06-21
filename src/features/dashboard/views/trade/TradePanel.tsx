"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import type { AgentProfile, SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { createDefaultAgentWallet, hasConfiguredAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import { fetchPersonalWalletBalance, fetchPersonalWalletRecords } from "@/lib/native/personal-wallets";
import styles from "./trade.module.css";
import { fetchBankrWallet, type BankrWalletInfo } from "./trade-api";
import { CryptoTradeView } from "./CryptoTradeView";
import { StocksTradeView } from "./StocksTradeView";
import { WalletSelectModal, type PickableWallet } from "./WalletSelectModal";

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
  sharedVault?: SharedVaultConfig;
  theme?: "light" | "dark";
};

function walletFor(agent: TradeAgent, walletsByAgent?: Record<string, unknown>): AgentWalletConfig {
  return resolveAgentWallet(
    agent as Parameters<typeof resolveAgentWallet>[0],
    (walletsByAgent?.[agent.id] ?? agent.wallet) as Parameters<typeof resolveAgentWallet>[1],
  );
}

/** Map a personal/user wallet record (from the Wallets route) to a pickable card. */
function personalPickable(record: Record<string, unknown>): PickableWallet | null {
  const id = String(record.id || record.agentId || "").trim();
  const address = String(record.address || "").trim();
  if (!id || !address) return null;
  const custody = record.custodyMode === "local" ? "local" : "watch";
  const wallet = {
    ...createDefaultAgentWallet(id),
    walletAddress: address,
    network: String(record.network || "eip155:8453"),
    custodyMode: custody,
    enabled: custody === "local",
    currentBalanceUsd: Number(record.currentBalanceUsd) || 0,
  } as AgentWalletConfig;
  return {
    id,
    name: String(record.name || "My wallet"),
    kind: "user",
    wallet,
    statusOverride: custody === "local" ? { tone: "ok", text: "Local wallet" } : { tone: "muted", text: "Watch only" },
  };
}

export function TradePanel(props: TradePanelProps) {
  const agents = useMemo(() => (Array.isArray(props.displayAgents) ? props.displayAgents : []), [props.displayAgents]);
  const vaultPath = props.sharedVault?.enabled ? String(props.sharedVault.vaultPath || "").trim() : "";
  const [segment, setSegment] = useState<TradeSegment>("crypto");
  const [actingId, setActingId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [personalWallets, setPersonalWallets] = useState<Array<Record<string, unknown>>>([]);
  const [personalBalancesLoading, setPersonalBalancesLoading] = useState(true);
  const [bankr, setBankr] = useState<BankrWalletInfo | null>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      setPersonalBalancesLoading(true);
      const list = await fetchPersonalWalletRecords(vaultPath);
      if (ignore) return;
      setPersonalWallets(list);
      // Stored ledger balances can be stale/zero until the Wallets view has
      // refreshed and persisted them, so refresh live here too — otherwise the
      // picker shows $0 until the user happens to open the Wallets tab first.
      const refreshed = await Promise.all(list.map(async (record) => {
        const address = String(record.address || "").trim();
        const network = String(record.network || "").trim();
        if (!address || !network) return record;
        const balance = await fetchPersonalWalletBalance(address, network);
        return balance
          ? { ...record, currentBalanceUsd: balance.currentBalanceUsd, nativeBalance: balance.nativeBalance, tokens: balance.tokens, lastOnchainSyncAt: balance.lastOnchainSyncAt }
          : record;
      }));
      if (ignore) return;
      setPersonalWallets(refreshed);
      setPersonalBalancesLoading(false);
    })();
    return () => { ignore = true; };
  }, [vaultPath]);

  useEffect(() => {
    let ignore = false;
    void fetchBankrWallet().then((info) => { if (!ignore) setBankr(info); });
    return () => { ignore = true; };
  }, []);

  // Unified pickable list: the user's own wallets first, then the Bankr trading
  // wallet (when the API key is set), then configured agents.
  const pickables = useMemo<PickableWallet[]>(() => {
    const user = personalWallets
      .map(personalPickable)
      .filter((p): p is PickableWallet => Boolean(p))
      // While balances are still refreshing, mark them pending so the picker
      // shows a loading state instead of a misleading stale $0.
      .map((p) => ({ ...p, pending: personalBalancesLoading }));
    const bankrPickable: PickableWallet | null = bankr?.configured ? {
      id: "bankr",
      name: "Bankr trading wallet",
      kind: "bankr",
      wallet: {
        ...createDefaultAgentWallet("bankr"),
        walletAddress: bankr.address || "",
        network: "eip155:8453",
        enabled: true,
        currentBalanceUsd: Number(bankr.balanceUsd) || 0,
      } as AgentWalletConfig,
      statusOverride: { tone: "ok", text: "Bankr-managed" },
    } : null;
    const agentPickables = agents
      .map((agent): PickableWallet => ({ id: agent.id, name: agent.name || agent.id, kind: "agent", wallet: walletFor(agent, props.walletsByAgent), usePod: agent.usePod as AgentProfile["usePod"] }))
      .filter((p) => hasConfiguredAgentWallet({ usePod: p.usePod } as Parameters<typeof hasConfiguredAgentWallet>[0], p.wallet) && !(p.wallet as { setupRequired?: boolean }).setupRequired);
    return [...user, ...(bankrPickable ? [bankrPickable] : []), ...agentPickables];
  }, [personalWallets, personalBalancesLoading, bankr, agents, props.walletsByAgent]);

  // Default to the selected agent if it's pickable, else the first pickable
  // (which is a user wallet when any exist).
  const defaultId = (props.selectedAgent?.id && pickables.some((p) => p.id === props.selectedAgent!.id))
    ? props.selectedAgent.id
    : (pickables[0]?.id || "");
  const resolvedId = actingId && pickables.some((p) => p.id === actingId) ? actingId : defaultId;
  const acting = pickables.find((p) => p.id === resolvedId) ?? null;

  const pickWallet = (id: string) => {
    setActingId(id);
    // Only sync the global selected agent for real agents, not user wallets.
    if (pickables.find((p) => p.id === id)?.kind === "agent") props.setSelectedAgentId?.(id);
  };

  return (
    <div className={`fr-root ${styles.root}`} data-fr-theme={props.theme === "light" ? "light" : undefined}>
      <div className={styles.headerRow}>
        <div>
          <h2 className={styles.title}>Trade</h2>
          <p className={styles.subtitle}>Buy, sell, and swap — crypto and stocks — through your own and your agents&apos; governed wallets.</p>
        </div>
        <div className={styles.actingRow}>
          <span className={styles.label}>Acting wallet</span>
          <button type="button" className={styles.actingButton} onClick={() => setPickerOpen(true)}>
            <span className={styles.actingName}>{acting ? acting.name : "Select a wallet"}</span>
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

      {!acting ? (
        <div className={styles.card}>
          <div className={styles.empty}>No wallet to trade with yet. Open the Wallets tab to create or import one.</div>
          {props.setActiveView ? (
            <div className={styles.actions}><button type="button" className={styles.btn} onClick={() => props.setActiveView?.("wallet")}>Open Wallets</button></div>
          ) : null}
        </div>
      ) : segment === "crypto" ? (
        <CryptoTradeView
          key={acting.id}
          agentId={acting.id}
          wallet={acting.wallet as unknown as Record<string, unknown>}
          agentName={acting.name}
          walletKind={acting.kind}
          setActiveView={props.setActiveView}
        />
      ) : (
        <StocksTradeView
          key={acting.id}
          agentId={acting.id}
          wallet={acting.wallet as unknown as Record<string, unknown>}
          agentName={acting.name}
          setActiveView={props.setActiveView}
        />
      )}

      {pickerOpen ? (
        <WalletSelectModal
          pickables={pickables}
          getSurvivalSnapshot={props.getSurvivalSnapshot ?? (() => ({}) as AgentSurvivalSnapshot)}
          currentId={resolvedId}
          onConfirm={pickWallet}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export default TradePanel;

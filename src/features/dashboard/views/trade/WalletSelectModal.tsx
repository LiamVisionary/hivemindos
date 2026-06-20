"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { hasConfiguredAgentWallet, resolveAgentWallet } from "@/lib/utils/agent-wallet";
import { AgentWalletCardCompact } from "@/components/wallet/AgentWalletCardCompact";
import styles from "./trade.module.css";

type WalletSelectModalProps = {
  agents: AgentProfile[];
  walletsByAgent: Record<string, AgentWalletConfig | undefined>;
  getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  currentAgentId: string;
  onConfirm: (agentId: string) => void;
  onClose: () => void;
};

/**
 * Wallet picker that reuses the Wallets-screen compact card (AgentWalletCardCompact)
 * in selectable mode. Only shows wallets that are configured — using the same
 * hasConfiguredAgentWallet check the Wallets screen uses — because this is a picker,
 * not the place wallets get initialized.
 *
 * Mounted only while open (parent conditionally renders it), so the selection
 * seeds from the current acting wallet on mount without a state-syncing effect.
 */
export function WalletSelectModal({ agents, walletsByAgent, getSurvivalSnapshot, currentAgentId, onConfirm, onClose }: WalletSelectModalProps) {
  const configured = useMemo(
    () =>
      agents
        .map((agent) => ({ agent, wallet: resolveAgentWallet(agent, walletsByAgent[agent.id] ?? (agent as { wallet?: AgentWalletConfig }).wallet) }))
        .filter(({ agent, wallet }) => hasConfiguredAgentWallet(agent, wallet) && !(wallet as { setupRequired?: boolean }).setupRequired),
    [agents, walletsByAgent],
  );

  const [selectedId, setSelectedId] = useState(() => (configured.some(({ agent }) => agent.id === currentAgentId) ? currentAgentId : ""));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Select a wallet" onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <h3 className={styles.title} style={{ fontSize: 15 }}>Select a wallet</h3>
            <p className={styles.subtitle}>Pick which agent&apos;s wallet trades. Only configured wallets are shown.</p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.modalBody}>
          {configured.length ? (
            <div className={styles.modalCards}>
              {configured.map(({ agent, wallet }) => (
                <AgentWalletCardCompact
                  key={agent.id}
                  agentName={agent.name || agent.id}
                  agentUsePod={agent.usePod}
                  wallet={wallet}
                  survival={getSurvivalSnapshot(wallet)}
                  selectable
                  selected={selectedId === agent.id}
                  onSelect={() => setSelectedId(agent.id)}
                />
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              No configured wallets yet. Open the Wallets tab to create or import one, then come back to trade.
            </div>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!selectedId}
            onClick={() => { if (selectedId) { onConfirm(selectedId); onClose(); } }}
          >
            Use this wallet
          </button>
        </div>
      </div>
    </div>
  );
}

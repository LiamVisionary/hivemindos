"use client";

import { useEffect, useState } from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { WalletPickerCard, GroupedWalletPickerCard } from "@/components/wallets-drop-in/WalletPickerCard";
import styles from "./trade.module.css";

/** One executable per-chain account inside a grouped user wallet (Base, Solana …). */
export type PickableAccount = {
  id: string;
  chainKey: "base" | "solana" | "other";
  network: string;
  networkLabel: string;
  address: string;
  custodyMode: "local" | "watch";
  wallet: AgentWalletConfig;
};

export type PickableWallet = {
  id: string;
  name: string;
  kind: "user" | "agent" | "bankr";
  wallet: AgentWalletConfig;
  usePod?: AgentProfile["usePod"];
  /** Custody-based status chip for user wallets (rail status for agents is computed). */
  statusOverride?: { tone: "ok" | "warn" | "danger" | "off" | "muted"; text: string };
  /** Balance is still being fetched — show a loading state instead of a stale $0. */
  pending?: boolean;
  /** Per-chain accounts for a grouped user wallet. When present with >1 entry the
   *  picker renders selectable chain badges; selection resolves to an account id. */
  accounts?: PickableAccount[];
};

type WalletSelectModalProps = {
  pickables: PickableWallet[];
  getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot;
  currentId: string;
  onConfirm: (id: string) => void;
  onClose: () => void;
  /** Optional copy overrides (default to the trade-picker wording). */
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
};

/**
 * Wallet picker that renders the Wallets-route card look via WalletPickerCard
 * (the `.fw-cc` visual language, driven by props — no shared runtime globals).
 * Shows the user's own wallets first, then the Bankr trading wallet, then
 * configured agent wallets. Mounted only while open (parent conditionally
 * renders it), so the selection seeds from the current acting wallet on mount.
 */
/** A selectable id is either a pickable's own id, or — for a grouped user wallet
 *  — one of its per-chain account ids. */
function canSelectId(pickables: PickableWallet[], id: string): boolean {
  if (!id) return false;
  return pickables.some((p) => (p.accounts && p.accounts.length) ? p.accounts.some((a) => a.id === id) : p.id === id);
}

export function WalletSelectModal({ pickables, getSurvivalSnapshot, currentId, onConfirm, onClose, title = "Select a wallet", subtitle = "Pick which wallet trades. Your own wallets come first, then configured agent wallets.", confirmLabel = "Use this wallet" }: WalletSelectModalProps) {
  const [selectedId, setSelectedId] = useState(() => (canSelectId(pickables, currentId) ? currentId : ""));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const userWallets = pickables.filter((p) => p.kind === "user");
  const bankrWallets = pickables.filter((p) => p.kind === "bankr");
  const agentWallets = pickables.filter((p) => p.kind === "agent");

  const renderGroup = (title: string, list: PickableWallet[]) => (
    list.length ? (
      <div className={styles.intentGroup}>
        <div className={styles.groupTitle}>{title}</div>
        <div className={styles.modalCards}>
          {list.map((p) => (
            p.accounts && p.accounts.length > 1 ? (
              <GroupedWalletPickerCard
                key={p.id}
                name={p.name}
                accounts={p.accounts}
                statusOverride={p.statusOverride}
                pending={p.pending}
                selectedAccountId={selectedId}
                onSelect={() => setSelectedId(p.id)}
              />
            ) : (
              <WalletPickerCard
                key={p.id}
                name={p.name}
                agentUsePod={p.usePod}
                wallet={p.wallet}
                survival={getSurvivalSnapshot(p.wallet)}
                statusOverride={p.statusOverride}
                pending={p.pending}
                selected={selectedId === p.id}
                onSelect={() => setSelectedId(p.id)}
              />
            )
          ))}
        </div>
      </div>
    ) : null
  );

  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Select a wallet" onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <h3 className={styles.title} style={{ fontSize: 15 }}>{title}</h3>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.modalBody}>
          {pickables.length ? (
            <>
              {renderGroup("Your wallets", userWallets)}
              {renderGroup("Bankr", bankrWallets)}
              {renderGroup("Agent wallets", agentWallets)}
            </>
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
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

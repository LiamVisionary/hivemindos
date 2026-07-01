"use client";

import { useEffect, useState } from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import {
  WalletPickerCard,
  GroupedWalletPickerCard,
  resolveWalletPickerStatus,
  isWalletPickerStatusDisabled,
  type WalletPickerChipTone,
} from "@/components/wallets-drop-in/WalletPickerCard";
import { getDisplayWalletBalanceUsd } from "@/lib/utils/agent-wallet";
import { chainBadgeSrc, chainKeyForNetwork, chainLabelForNetwork } from "@/lib/utils/personal-wallet-grouping";
import styles from "./trade.module.css";

const BANKR_LOGO_SRC = "/icons/runtimes/bankr.svg";

// Managed-rail providers that lead their card with a brand badge (logo + name),
// the way the Bankr wallet does — e.g. a UsePod-funded agent wallet.
const PROVIDER_BRAND_TAGS: Record<string, { label: string; src: string }> = {
  usepod: { label: "UsePod", src: "/icons/runtimes/usepod.webp" },
  veil: { label: "Veil", src: "/icons/runtimes/veil.svg" },
  moneyclaw: { label: "MoneyClaw", src: "/icons/runtimes/clawbank.svg" },
  clawcard: { label: "MoneyClaw", src: "/icons/runtimes/clawbank.svg" },
  venice: { label: "Venice", src: "/icons/runtimes/venice-keys.svg" },
};

/** Brand + chain badges for a non-grouped pickable (agent / Bankr / single-chain
 *  user wallet): managed wallets (Bankr, UsePod, Veil, …) lead with their brand
 *  logo, and every card shows its chain badge. */
function tagsForPickable(pickable: PickableWallet): Array<{ label: string; src?: string | null; round?: boolean }> {
  const network = String((pickable.wallet as unknown as Record<string, unknown>)?.network || "");
  const chainKey = chainKeyForNetwork(network);
  const chainTag = network ? { label: chainLabelForNetwork(network), src: chainBadgeSrc(chainKey) } : null;
  if (pickable.kind === "bankr") {
    return [{ label: "Bankr", src: BANKR_LOGO_SRC, round: false }, ...(chainTag ? [chainTag] : [])];
  }
  const provider = String((pickable.wallet as unknown as Record<string, unknown>)?.provider || "").toLowerCase();
  const brand = PROVIDER_BRAND_TAGS[provider];
  if (brand) return [{ ...brand, round: false }, ...(chainTag ? [chainTag] : [])];
  return chainTag ? [chainTag] : [];
}

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

export type WalletSelectPanelProps = Omit<WalletSelectModalProps, "onClose"> & {
  onCancel?: () => void;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  emptyCopy?: string;
  panelClassName?: string;
  showCloseButton?: boolean;
};

/**
 * Wallet picker that renders the Wallets-route card look via WalletPickerCard
 * (the `.fw-cc` visual language, driven by props — no shared runtime globals).
 * Shows the user's own wallets first, then the Bankr trading wallet, then
 * configured agent wallets.
 */
/** A selectable id is either a pickable's own id, or — for a grouped user wallet
 *  — one of its per-chain account ids. */
function canSelectId(pickables: PickableWallet[], id: string): boolean {
  if (!id) return false;
  return pickables.some((p) => (p.accounts && p.accounts.length) ? p.accounts.some((a) => a.id === id) : p.id === id);
}

/** Displayed balance for a pickable — matches what its card shows: the per-chain
 *  account total for a grouped user wallet, otherwise the single-wallet display
 *  balance. Used to sort largest-first. */
function pickableBalanceUsd(p: PickableWallet): number {
  if (p.accounts && p.accounts.length) {
    return p.accounts.reduce((sum, account) => sum + (Number(account.wallet.currentBalanceUsd) || 0), 0);
  }
  return getDisplayWalletBalanceUsd(p.wallet);
}

/** The status chip tone the pickable's card renders. Mirrors how each card kind
 *  resolves its status (grouped cards default to an "ok" Local-wallet chip). */
function pickableStatusTone(p: PickableWallet, getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot): WalletPickerChipTone {
  if (p.accounts && p.accounts.length > 1) return p.statusOverride?.tone ?? "ok";
  return resolveWalletPickerStatus(p.wallet, getSurvivalSnapshot(p.wallet), p.usePod, p.statusOverride).tone;
}

/** Sort a section: active (spendable) wallets first by largest balance, with the
 *  muted/off wallets (watch-only, wallet off, rails not set up) sunk to the end.
 *  Array.sort is stable, so wallets that tie keep their incoming order. */
function sortPickables(list: PickableWallet[], getSurvivalSnapshot: (wallet: AgentWalletConfig) => AgentSurvivalSnapshot): PickableWallet[] {
  return [...list].sort((a, b) => {
    const aDisabled = isWalletPickerStatusDisabled(pickableStatusTone(a, getSurvivalSnapshot));
    const bDisabled = isWalletPickerStatusDisabled(pickableStatusTone(b, getSurvivalSnapshot));
    if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
    return pickableBalanceUsd(b) - pickableBalanceUsd(a);
  });
}

export function WalletSelectModal({ pickables, getSurvivalSnapshot, currentId, onConfirm, onClose, title = "Select a wallet", subtitle = "Pick which wallet trades. Your own wallets come first, then configured agent wallets.", confirmLabel = "Use this wallet" }: WalletSelectModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.modalOverlay} role="presentation" onMouseDown={onClose}>
      <WalletSelectPanel
        pickables={pickables}
        getSurvivalSnapshot={getSurvivalSnapshot}
        currentId={currentId}
        title={title}
        subtitle={subtitle}
        confirmLabel={confirmLabel}
        onCancel={onClose}
        showCloseButton
        panelClassName={styles.modal}
        onConfirm={(selectedId) => {
          onConfirm(selectedId);
          onClose();
        }}
      />
    </div>
  );
}

export function WalletSelectPanel({
  pickables,
  getSurvivalSnapshot,
  currentId,
  onConfirm,
  onCancel,
  title = "Select a wallet",
  subtitle = "Pick which wallet trades. Your own wallets come first, then configured agent wallets.",
  confirmLabel = "Use this wallet",
  cancelLabel = "Cancel",
  confirmDisabled = false,
  emptyCopy = "No configured wallets yet. Open the Wallets tab to create or import one, then come back to trade.",
  panelClassName,
  showCloseButton = false,
}: WalletSelectPanelProps) {
  const [selectedId, setSelectedId] = useState(() => (canSelectId(pickables, currentId) ? currentId : ""));

  // Within each section, surface the highest-balance spendable wallets first and
  // sink the muted/off ones (watch-only, wallet off, rails not set up) to the end.
  const userWallets = sortPickables(pickables.filter((p) => p.kind === "user"), getSurvivalSnapshot);
  const bankrWallets = sortPickables(pickables.filter((p) => p.kind === "bankr"), getSurvivalSnapshot);
  const agentWallets = sortPickables(pickables.filter((p) => p.kind === "agent"), getSurvivalSnapshot);

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
                tags={tagsForPickable(p)}
              />
            )
          ))}
        </div>
      </div>
    ) : null
  );

  return (
    <div className={`${styles.walletSelectPanel} ${panelClassName ?? ""}`} role={showCloseButton ? "dialog" : "group"} aria-modal={showCloseButton ? "true" : undefined} aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <div className={styles.modalHead}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>
        {showCloseButton && onCancel ? (
          <button type="button" className={styles.iconBtn} onClick={onCancel} aria-label="Close">×</button>
        ) : null}
      </div>

      <div className={styles.modalBody}>
        {pickables.length ? (
          <>
            {renderGroup("Your wallets", userWallets)}
            {renderGroup("Bankr", bankrWallets)}
            {renderGroup("Agent wallets", agentWallets)}
          </>
        ) : (
          <div className={styles.empty}>{emptyCopy}</div>
        )}
      </div>

      <div className={styles.modalFoot}>
        {onCancel ? <button type="button" className={styles.btn} onClick={onCancel}>{cancelLabel}</button> : null}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!selectedId || confirmDisabled}
          onClick={() => { if (selectedId && !confirmDisabled) onConfirm(selectedId); }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

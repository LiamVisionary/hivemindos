"use client";

import { useState } from "react";
import { Check, ChevronRight, LoaderCircle, Power } from "lucide-react";
import { CloseIconButton } from "@/components/ui/close-icon-button";

import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import { getDisplayWalletBalanceUsd, getUsePodBalanceUsd } from "@/lib/utils/agent-wallet";

import styles from "./AgentWalletCardCompact.module.css";

export type AgentWalletCardCompactProps = {
  agentName: string;
  agentUsePod?: AgentProfile["usePod"];
  wallet: AgentWalletConfig;
  survival: AgentSurvivalSnapshot;
  onOpen?: () => void;
  onInitialize?: () => Promise<void>;
  /** Render as a selectable picker tile: clicking selects (outline) instead of
   *  opening the wallet, and the setup/initialize flow is suppressed. */
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Replace the computed provider status chip — used for user/personal wallets
   *  whose status is custody-based (e.g. "Local wallet") rather than rail-based. */
  statusOverride?: { tone: ChipTone; text: string };
};

type ChipTone = "ok" | "warn" | "danger" | "off" | "muted";
type SetupStage = "idle" | "confirm" | "loading" | "done";

function hasUsePodSetupEvidence(agentUsePod?: AgentProfile["usePod"]): boolean {
  const balance = getUsePodBalanceUsd(agentUsePod);
  return Boolean(
    agentUsePod?.depositAddress
    || agentUsePod?.depositCode
    || agentUsePod?.dashboardUrl
    || agentUsePod?.lastTestStatus
    || balance !== null,
  );
}

function statusFor(wallet: AgentWalletConfig, survival: AgentSurvivalSnapshot, agentUsePod?: AgentProfile["usePod"]): {
  tone: ChipTone;
  text: string;
} {
  const providerFeatures = agentPaymentProviderFeatures(wallet.provider);
  if (providerFeatures.balanceSource === "usepod-runtime") {
    const balance = getUsePodBalanceUsd(agentUsePod);
    if (balance !== null && balance > 0) return { tone: "ok", text: "UsePod funded" };
    if (agentUsePod?.lastTestStatus === "ready") return { tone: "ok", text: "UsePod ready" };
    if (agentUsePod?.lastTestStatus === "needs-funding") return { tone: "warn", text: "Needs funding" };
    if (agentUsePod?.lastTestStatus === "missing-token") return { tone: "warn", text: "Token pending" };
    if (agentUsePod?.lastTestStatus === "provider-unavailable" || agentUsePod?.lastTestStatus === "error") return { tone: "warn", text: "Check UsePod" };
    const hasFundingDetails = Boolean(agentUsePod?.depositAddress || agentUsePod?.depositCode || agentUsePod?.dashboardUrl);
    return { tone: hasFundingDetails ? "muted" : "off", text: hasFundingDetails ? "Check funding" : "Set up UsePod" };
  }
  if (wallet.provider === "veil") {
    if (wallet.walletAddress || wallet.vaultAddress) return { tone: wallet.enabled ? "ok" : "muted", text: "Veil configured" };
    return { tone: "off", text: "Set up Veil" };
  }
  if (providerFeatures.localWalletRequired && !wallet.walletAddress && !wallet.vaultAddress) {
    return hasUsePodSetupEvidence(agentUsePod) ? { tone: "muted", text: "Rail setup" } : { tone: "off", text: "Initialize rails" };
  }
  if (!wallet.enabled) return { tone: "off", text: "Wallet off" };
  if (survival.tier === "critical" || survival.tier === "dead") {
    return { tone: "danger", text: "Needs funding" };
  }
  if (survival.tier === "low_compute") return { tone: "warn", text: "Slowing down" };
  if (survival.daysRemaining != null) {
    return { tone: "ok", text: `${survival.daysRemaining.toFixed(1)} days runway` };
  }
  return { tone: "ok", text: "Can spend" };
}

function formatMoney(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

export function AgentWalletCardCompact({ agentName, agentUsePod, wallet, survival, onOpen, onInitialize, selectable, selected, onSelect, statusOverride }: AgentWalletCardCompactProps) {
  const tier = wallet.enabled ? survival.tier : "off";
  const safeBalance = getDisplayWalletBalanceUsd(wallet);
  const status = statusFor(wallet, survival, agentUsePod);
  const providerFeatures = agentPaymentProviderFeatures(wallet.provider);
  const usePodBalanceUnknown = providerFeatures.balanceSource === "usepod-runtime" && getUsePodBalanceUsd(agentUsePod) === null;
  const usePodReadyBalanceUnknown = usePodBalanceUnknown && agentUsePod?.lastTestStatus === "ready";
  const hasWalletFunds = safeBalance > 0;
  const [setupStage, setSetupStage] = useState<SetupStage>("idle");
  const needsInitialization = providerFeatures.localWalletRequired && !wallet.walletAddress && !wallet.vaultAddress && !hasUsePodSetupEvidence(agentUsePod);
  const spendLabel = wallet.enabled ? "Spend on" : "Spend off";
  const showsSpendStatus = providerFeatures.balanceSource === "usepod-runtime"
    ? hasUsePodSetupEvidence(agentUsePod)
    : wallet.provider === "veil"
      ? Boolean(wallet.walletAddress || wallet.vaultAddress)
      : !needsInitialization;
  const walletLabel = selectable
    ? `Select ${agentName} wallet`
    : showsSpendStatus
      ? `Open ${agentName} wallet, ${spendLabel.toLowerCase()}`
      : `Open ${agentName} wallet`;

  const openOrConfirm = () => {
    if (selectable) {
      onSelect?.();
      return;
    }
    if (needsInitialization) {
      setSetupStage("confirm");
      return;
    }
    onOpen?.();
  };

  const initialize = async () => {
    setSetupStage("loading");
    const startedAt = Date.now();
    await onInitialize?.();
    const remaining = Math.max(0, 2000 - (Date.now() - startedAt));
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    setSetupStage("done");
    window.setTimeout(() => {
      onOpen?.();
      setSetupStage("idle");
    }, 1000);
  };

  if (setupStage === "confirm") {
    return (
      <article className={styles.card} data-tier="off" data-setup="true" aria-label={`Create a wallet for ${agentName}`}>
        <div className={styles.setupPrompt}>
          <strong>Create a wallet for {agentName}?</strong>
        </div>
        <div className={styles.confirmActions}>
          <CloseIconButton className={styles.confirmButton} data-tone="cancel" onClick={() => setSetupStage("idle")} aria-label="Cancel wallet creation" />
          <button type="button" className={styles.confirmButton} data-tone="confirm" onClick={() => void initialize()} aria-label={`Create wallet for ${agentName}`}>
            <Check aria-hidden="true" />
          </button>
        </div>
      </article>
    );
  }

  if (setupStage === "loading" || setupStage === "done") {
    return (
      <article className={styles.card} data-tier="off" data-setup="true" aria-live="polite" aria-label={`${agentName} wallet setup`}>
        <div className={styles.setupPrompt}>
          <strong>{setupStage === "done" ? "Wallet created" : `Creating wallet for ${agentName}`}</strong>
          {setupStage === "done" ? (
            <Check className={styles.setupStatusIcon} data-state="done" aria-hidden="true" />
          ) : (
            <LoaderCircle className={styles.setupStatusIcon} data-state="loading" aria-hidden="true" />
          )}
        </div>
      </article>
    );
  }

  return (
    <button
      type="button"
      className={styles.card}
      data-tier={tier}
      data-funded={hasWalletFunds ? "true" : undefined}
      data-selected={selectable && selected ? "true" : undefined}
      aria-pressed={selectable ? Boolean(selected) : undefined}
      onClick={openOrConfirm}
      aria-label={walletLabel}
    >
      <div className={styles.head}>
        <span className={styles.dot} aria-hidden="true" />
        <strong className={styles.name}>{agentName}</strong>
      </div>

      <div className={styles.balance}>
        <span className={styles.amount}>{usePodReadyBalanceUnknown ? "Ready" : usePodBalanceUnknown ? "Pending" : formatMoney(safeBalance)}</span>
        <span className={styles.unit}>{wallet.tokenSymbol || "USDC"}</span>
      </div>

      <div className={styles.statusRow}>
        <span className={styles.statusChips}>
          {statusOverride ? (
            <span className={styles.statusChip} data-tone={statusOverride.tone}>
              {statusOverride.text}
            </span>
          ) : showsSpendStatus ? (
            <span className={styles.spendChip} data-on={wallet.enabled}>
              {spendLabel}
            </span>
          ) : (
            <span className={styles.statusChip} data-tone={status.tone}>
              {status.tone === "off" ? <Power aria-hidden="true" /> : null}
              {status.text}
            </span>
          )}
        </span>
        <span className={styles.openIcon} aria-hidden="true">
          <ChevronRight width={16} height={16} />
        </span>
      </div>
    </button>
  );
}

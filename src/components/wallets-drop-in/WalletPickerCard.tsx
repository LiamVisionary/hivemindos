"use client";

import { Check } from "lucide-react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSurvivalSnapshot, AgentWalletConfig } from "@/lib/types/agent-wallet";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import { getDisplayWalletBalanceUsd, getUsePodBalanceUsd } from "@/lib/utils/agent-wallet";

import { frFmtUsdFull } from "./wallet-data";
import "./wallets.css";
import styles from "./WalletPickerCard.module.css";

export type WalletPickerChipTone = "ok" | "warn" | "danger" | "off" | "muted";

export type WalletPickerCardProps = {
  /** Display name (agent name, "My wallet", "Bankr trading wallet", …). */
  name: string;
  wallet: AgentWalletConfig;
  survival: AgentSurvivalSnapshot;
  /** UsePod runtime config, for agents whose balance is provider-managed. */
  agentUsePod?: AgentProfile["usePod"];
  /** Custody-based chip for user/bankr wallets (rail status is computed otherwise). */
  statusOverride?: { tone: WalletPickerChipTone; text: string };
  /** Balance is still being fetched — render a skeleton instead of a stale $0. */
  pending?: boolean;
  selected?: boolean;
  onSelect?: () => void;
};

const TONE_DOT_COLOR: Record<WalletPickerChipTone, string> = {
  ok: "var(--live)",
  warn: "var(--honey)",
  danger: "var(--danger)",
  off: "var(--fg-4)",
  muted: "var(--fg-4)",
};

// USDC brand blue, matching the allocation colour used on the Wallets route
// (FR_CCY.USDC.color). The picker only knows a single USD balance per wallet,
// so the bar is one honest segment rather than a fabricated token breakdown.
const USDC_BAR_COLOR = "#2775ca";

function networkLabel(network?: string): string {
  const value = String(network || "").toLowerCase();
  if (value.includes("solana")) return "Solana mainnet";
  if (value.includes("84532") || value.includes("sepolia")) return "Base Sepolia";
  if (value.includes("eip155") || value.includes("base") || value.includes("8453")) return "Base mainnet";
  return network || "Base mainnet";
}

function hasUsePodSetupEvidence(agentUsePod?: AgentProfile["usePod"]): boolean {
  return Boolean(
    agentUsePod?.depositAddress
    || agentUsePod?.depositCode
    || agentUsePod?.dashboardUrl
    || agentUsePod?.lastTestStatus
    || getUsePodBalanceUsd(agentUsePod) !== null,
  );
}

// Canonical wallet-status logic, ported from AgentWalletCardCompact so the picker
// shows the same chips the wallet cards do.
function statusFor(
  wallet: AgentWalletConfig,
  survival: AgentSurvivalSnapshot,
  agentUsePod?: AgentProfile["usePod"],
): { tone: WalletPickerChipTone; text: string } {
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
  if (survival.tier === "critical" || survival.tier === "dead") return { tone: "danger", text: "Needs funding" };
  if (survival.tier === "low_compute") return { tone: "warn", text: "Slowing down" };
  if (survival.daysRemaining != null) return { tone: "ok", text: `${survival.daysRemaining.toFixed(1)} days runway` };
  return { tone: "ok", text: "Can spend" };
}

/**
 * Selectable wallet tile rendered in the Wallets-route visual language
 * (`.fw-cc` from wallets.css), driven entirely by props — no shared global
 * runtime state. Used by the Trade tab's wallet picker so it matches the cards
 * on the Wallets screen.
 */
export function WalletPickerCard({ name, wallet, survival, agentUsePod, statusOverride, pending, selected, onSelect }: WalletPickerCardProps) {
  const providerFeatures = agentPaymentProviderFeatures(wallet.provider);
  const usePodBalanceUnknown = providerFeatures.balanceSource === "usepod-runtime" && getUsePodBalanceUsd(agentUsePod) === null;
  const usePodReadyBalanceUnknown = usePodBalanceUnknown && agentUsePod?.lastTestStatus === "ready";
  const safeBalance = getDisplayWalletBalanceUsd(wallet);
  // Only show the loading skeleton when the balance is still pending AND we have
  // nothing real to show yet — a stored non-zero balance is shown immediately.
  const showLoading = Boolean(pending) && !usePodBalanceUnknown && safeBalance <= 0;
  const balanceLabel = usePodReadyBalanceUnknown ? "Ready" : usePodBalanceUnknown ? "Pending" : frFmtUsdFull(Math.max(0, safeBalance));
  const status = statusOverride ?? statusFor(wallet, survival, agentUsePod);
  const showBar = !usePodBalanceUnknown && safeBalance > 0;

  return (
    <button
      type="button"
      className={`fw-cc ${styles.card}`}
      data-tone={status.tone === "danger" ? "danger" : status.tone === "off" || status.tone === "muted" ? "muted" : undefined}
      data-selected={selected ? "true" : undefined}
      aria-pressed={Boolean(selected)}
      aria-label={`Select ${name} wallet`}
      onClick={onSelect}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span className="fw-pdot" style={{ background: TONE_DOT_COLOR[status.tone] }} aria-hidden="true" />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
            <span style={{ display: "block", fontSize: 10.5, color: "var(--fg-3)" }}>{networkLabel(wallet.network)}</span>
          </span>
        </span>
        {selected ? <span className={styles.check} aria-hidden="true"><Check width={12} height={12} strokeWidth={3} /></span> : null}
      </span>

      <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
        {showLoading
          ? <span className={`fw-cc-bal ${styles.balanceSkeleton}`} aria-label="Loading balance" />
          : <span className="fw-cc-bal">{balanceLabel}</span>}
        <span className="fw-chip" data-tone={status.tone === "ok" || status.tone === "warn" || status.tone === "danger" ? status.tone : undefined}>{status.text}</span>
      </span>

      <span className="fw-alloc" aria-hidden="true">
        {showBar ? <i style={{ width: "100%", background: USDC_BAR_COLOR }} /> : null}
      </span>
    </button>
  );
}

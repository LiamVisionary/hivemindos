"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Copy,
  CreditCard,
  Fuel,
  HandCoins,
  KeyRound,
  Power,
  QrCode,
  RefreshCcw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import type {
  AgentPaymentProvider,
  AgentSpendCapAsset,
  AgentSurvivalSnapshot,
  AgentTradingVenue,
  AgentWalletConfig,
  HoneyAgentReward,
} from "@/lib/types/agent-wallet";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { agentPaymentProviderFeatures } from "@/lib/config/agent-payments";
import {
  USEPOD_COMPATIBILITY_MATRIX,
  USEPOD_ROUTING_MATRIX,
} from "@/lib/config/usepod-features";
import {
  VEIL_CASH_APP_URL,
  VEIL_CASH_CONTRACTS,
  VEIL_CASH_DEFAULT_X402_URL,
  VEIL_CASH_USDC_DEPOSIT_MINIMUM,
  VEIL_CASH_DOCS_URL,
  VEIL_CASH_NETWORK,
  VEIL_CASH_TRANSFER_CONFIRMATION_LABEL,
  VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM,
  VEIL_CASH_WALLET_URL,
  VEIL_CASH_X402_CONFIRMATION,
  veilCashCliQuickStart,
} from "@/lib/config/veil-cash";
import { cn } from "@/lib/utils/cn";
import { DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS, assetSpendCapFor, getDisplayWalletBalanceUsd, getUsePodBalanceUsd } from "@/lib/utils/agent-wallet";

import type { MoneyClawSaveOptions, MoneyClawStatus, ProviderCopy, WalletActionState } from "./wallet-card-types";
import { VeilAdvancedSetup, type VeilSetupAction } from "./VeilAdvancedSetup";
import { PaymentMethodSelector } from "./PaymentMethodSelector";
import { MoneyClawKeyModal } from "./MoneyClawKeyModal";
import styles from "./AgentWalletCard.module.css";

type RailState = "ready" | "setup" | "blocked";
type UsePodAdvancedSection = "status" | "connect" | "routing" | "repair";
type VeilSetupStatus = {
  cliInstalled?: boolean;
  cliPath?: string;
  mcpInstalled?: boolean;
  mcpPath?: string;
  mcpVersion?: string;
  mcpMinimumVersion?: string;
  mcpMeetsMinimum?: boolean;
  veilKeyConfigured?: boolean;
  depositKeyConfigured?: boolean;
  mode?: string;
};
type VeilSetupResponse = {
  ok?: boolean;
  status?: VeilSetupStatus;
  message?: string;
  error?: string;
};

export type AgentWalletCardProps = {
  agentName: string;
  machineName?: string;
  agentUsePod?: AgentProfile["usePod"];
  wallet: AgentWalletConfig;
  survival: AgentSurvivalSnapshot;
  honeyReward: HoneyAgentReward | null;
  honeyLedgerEnabled: boolean;
  providerCopy: ProviderCopy;
  providerOptions: Array<[AgentPaymentProvider, ProviderCopy]>;
  moneyClawStatus?: MoneyClawStatus | null;
  walletAction: WalletActionState;
  onUpdateWallet: (patch: Partial<AgentWalletConfig>) => void;
  onUpdateAction: (patch: WalletActionState) => void;
  onSaveMoneyClawKey: (apiKey: string, options: MoneyClawSaveOptions) => Promise<{ ok: boolean; error?: string }>;
  onUpdateUsePod?: (patch: Partial<AgentProfile["usePod"]>) => void | Promise<void>;
  onResetRunway: () => void;
  onCopyPaymentPrompt: () => void;
  onCreateLocalWallet: () => void;
  onRefreshBalance: () => void;
  onSendUsdc: () => void;
  onCallX402: () => void;
  onExportSecret?: () => void;
};

type Sheet = "send" | "receive" | "limits" | null;

function networkLabel(network: string) {
  switch (network) {
    case "eip155:8453":
      return "Base mainnet";
    case "eip155:84532":
      return "Base Sepolia";
    case "eip155:4663":
      return "Robinhood Chain";
    case "eip155:46630":
      return "Robinhood Chain Testnet";
    case "solana:mainnet":
      return "Solana mainnet";
    case "solana:devnet":
      return "Solana devnet";
    default:
      return network;
  }
}

function formatMoney(value: number): string {
  return `$${Math.max(0, value).toFixed(2)}`;
}

function formatNumber(value: number, fractionDigits = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

function shortenAddress(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function readVeilSetupResponse(response: Response | null): Promise<VeilSetupResponse | null> {
  if (!response) return { ok: false, error: "Could not reach the Veil setup route." };
  const text = await response.text().catch(() => "");
  if (!text) return { ok: false, error: `Veil setup returned HTTP ${response.status}.` };
  try {
    return JSON.parse(text) as VeilSetupResponse;
  } catch {
    return {
      ok: false,
      error: `Veil setup returned HTTP ${response.status}: ${redactSetupText(text).slice(0, 240)}`,
    };
  }
}

function veilSetupErrorMessage(response: Response | null, data: VeilSetupResponse | null, fallback: string) {
  if (data?.error) return data.error;
  if (response) return `${fallback}. HTTP ${response.status} ${response.statusText}`.trim();
  return fallback;
}

function redactSetupText(value: string) {
  return value.replace(/0x[a-fA-F0-9]{64,}/g, "[redacted]");
}

function tokenFingerprint(config?: AgentProfile["usePod"]) {
  const source = config?.dashboardUrl || config?.depositCode || "";
  const tokenMatch = source.match(/[?&]token=([^&]+)/);
  const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : source;
  if (!token) return "";
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}…${token.slice(-6)}`;
}

function tokenSourceLabelText(source?: string) {
  if (source === "hivemindos-env") return "HivemindOS env";
  if (source === "legacy-hermes-env") return "Legacy Hermes env";
  if (source === "dashboard-url") return "Dashboard URL";
  if (source === "process-env") return "Process env";
  if (source === "profile") return "Profile token";
  if (source === "missing") return "Missing";
  return "Not checked";
}

function railText(state: RailState) {
  if (state === "ready") return "Ready";
  if (state === "blocked") return "Needs attention";
  return "Set up";
}

function moneyClawBalanceLabel(status?: MoneyClawStatus | null) {
  const balance = status?.balance;
  if (!balance || typeof balance !== "object") return "";
  const record = balance as Record<string, unknown>;
  const value = record.balance ?? record.availableBalance ?? record.amount ?? record.usdBalance;
  if (typeof value === "number") return `$${value.toFixed(2)}`;
  if (typeof value === "string") return value;
  return "";
}

export function AgentWalletCard({
  agentName,
  machineName,
  agentUsePod,
  wallet,
  survival,
  honeyReward,
  honeyLedgerEnabled,
  providerCopy,
  providerOptions,
  moneyClawStatus,
  walletAction,
  onUpdateWallet,
  onUpdateAction,
  onSaveMoneyClawKey,
  onUpdateUsePod,
  onResetRunway,
  onCopyPaymentPrompt,
  onCreateLocalWallet,
  onRefreshBalance,
  onSendUsdc,
  onCallX402,
  onExportSecret,
}: AgentWalletCardProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [moneyClawModalOpen, setMoneyClawModalOpen] = useState(false);
  const [usePodTokenDraft, setUsePodTokenDraft] = useState("");
  const [usePodRepairStatus, setUsePodRepairStatus] = useState("");
  const [usePodAdvancedSection, setUsePodAdvancedSection] = useState<UsePodAdvancedSection>("status");
  const [veilSetupStatus, setVeilSetupStatus] = useState<VeilSetupStatus | null>(null);
  const [veilSetupAction, setVeilSetupAction] = useState<VeilSetupAction>(null);
  const [veilSetupMessage, setVeilSetupMessage] = useState("");

  const tier = wallet.enabled ? survival.tier : "off";
  const safeBalance = getDisplayWalletBalanceUsd(wallet);
  const providerFeatures = agentPaymentProviderFeatures(wallet.provider);
  const usePodRail = providerFeatures.balanceSource === "usepod-runtime";
  const veilRail = wallet.provider === "veil";
  const veilAutoPrivateX402 = wallet.veilAutoPrivateX402 !== false;
  const usePodBalanceValue = usePodRail ? getUsePodBalanceUsd(agentUsePod) : null;
  const usePodStatus = agentUsePod?.lastTestStatus || "not checked";
  const usePodReadyBalanceUnknown = usePodRail && usePodStatus === "ready" && usePodBalanceValue === null;
  const isOff = !wallet.enabled;
  const isCritical = !usePodReadyBalanceUnknown && wallet.enabled && (survival.tier === "critical" || survival.tier === "dead");
  const isLow = !usePodReadyBalanceUnknown && wallet.enabled && survival.tier === "low_compute";
  const cardRailState: RailState = moneyClawStatus?.configured ? "ready" : "setup";
  const cryptoRailState: RailState = wallet.walletAddress || wallet.vaultAddress ? "ready" : "setup";
  const x402RailState: RailState = cryptoRailState === "ready" ? "ready" : "setup";
  const tradingRailState: RailState = "setup";
  const veilWalletRailState: RailState = wallet.network === VEIL_CASH_NETWORK && (wallet.walletAddress || wallet.vaultAddress) ? "ready" : "setup";
  const veilRegistrationRailState: RailState = veilWalletRailState === "ready" ? "setup" : "blocked";
  const veilPrivateRailState: RailState = veilWalletRailState === "ready" ? "setup" : "blocked";
  const veilCliCommand = veilCashCliQuickStart(wallet.walletAddress || wallet.vaultAddress);
  const veilContracts = [
    { key: "entry", label: "Entry", kind: "entry" as const, value: VEIL_CASH_CONTRACTS.entry },
    { key: "usdc", label: "USDC queue", kind: "usdc" as const, value: VEIL_CASH_CONTRACTS.usdcQueue },
    { key: "eth", label: "ETH queue", kind: "eth" as const, value: VEIL_CASH_CONTRACTS.ethQueue },
    { key: "relay", label: "Relay", kind: "relay" as const, value: VEIL_CASH_CONTRACTS.relayUrl },
  ];
  const moneyClawBalance = moneyClawBalanceLabel(moneyClawStatus);
  const usePodDepositAddress = agentUsePod?.depositAddress || wallet.walletAddress;
  const usePodFundingReference = agentUsePod?.depositCode || agentUsePod?.dashboardUrl || "";
  const primaryRailReady = usePodRail
    ? Boolean(usePodDepositAddress || usePodFundingReference)
    : veilRail
      ? veilWalletRailState === "ready"
      : cardRailState === "ready" && cryptoRailState === "ready";
  const usePodBalance = usePodBalanceValue !== null
    ? formatMoney(usePodBalanceValue)
    : usePodStatus === "ready"
      ? "Not returned"
      : "Check funding";
  const usePodRoute = agentUsePod?.lastRoute || "";
  const usePodModelCount = agentUsePod?.lastModelCount;
  const usePodTokenFingerprint = tokenFingerprint(agentUsePod);
  const usePodTokenMissing = agentUsePod?.lastTokenPresent === false || agentUsePod?.lastTokenSource === "missing";
  const usePodTokenHealth = usePodTokenMissing
    ? "Token missing"
    : agentUsePod?.lastTokenPresent
      ? `Token saved in ${tokenSourceLabelText(agentUsePod.lastTokenSource)}`
      : `Token source: ${tokenSourceLabelText(agentUsePod?.lastTokenSource)}`;
  const usePodStatusMessage = agentUsePod?.lastStatusMessage || "";
  const usePodStaleErrorMessage = usePodStatus === "ready"
    && usePodBalanceValue !== null
    && /\b(unauthorized|token not found|not activated)\b/i.test(usePodStatusMessage);
  const visibleUsePodStatusMessage = usePodStaleErrorMessage ? "" : usePodStatusMessage;
  const heroBalanceText = usePodReadyBalanceUnknown ? "Ready" : usePodRail && usePodBalanceValue === null ? "Pending" : formatMoney(safeBalance);
  const usePodFundingRailState: RailState = primaryRailReady ? "ready" : "setup";
  const usePodInferenceRailState: RailState = usePodStatus === "ready" ? "ready" : usePodTokenMissing ? "blocked" : "setup";
  const usePodX402RailState: RailState = usePodTokenMissing ? "blocked" : "ready";
  const usePodCapsRailState: RailState = agentUsePod?.maxPriceInputMicrounits || agentUsePod?.maxPriceOutputMicrounits ? "ready" : "setup";
  const usePodRoutingMode = agentUsePod?.routingMode === "marketplace-only" ? "marketplace-only" : "auto";
  const usePodRoutingFeature = USEPOD_ROUTING_MATRIX[usePodRoutingMode];
  const usePodCompatibility = agentUsePod?.apiCompatibility === "anthropic" ? "anthropic" : "openai";
  const usePodCompatibilityFeature = USEPOD_COMPATIBILITY_MATRIX[usePodCompatibility];
  const autoUseAvailable = providerFeatures.canAutopay;
  const privateTransferAssets = providerFeatures.privateTransferAssets;
  const veilSendAsset: AgentSpendCapAsset = veilRail && walletAction.sendAsset === "ETH" && privateTransferAssets.includes("ETH") ? "ETH" : "USDC";
  const veilSendCap = assetSpendCapFor(wallet, veilSendAsset);
  const veilSendCapLabel = veilSendAsset === "ETH" ? `${veilSendCap.toFixed(6)} ETH` : formatMoney(veilSendCap);
  const duplicateGuardSeconds = Number.isFinite(Number(wallet.duplicatePaymentGuardSeconds))
    ? Math.max(0, Number(wallet.duplicatePaymentGuardSeconds))
    : DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS;
  const duplicateGuardEnabled = wallet.duplicatePaymentGuardEnabled !== false;
  const duplicateGuardOptions = [
    { value: 60, label: "1 minute" },
    { value: 300, label: "5 minutes" },
    { value: DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS, label: "15 minutes" },
    { value: 3600, label: "1 hour" },
  ];
  const hasCustomDuplicateGuard = duplicateGuardSeconds > 0 && !duplicateGuardOptions.some((option) => option.value === duplicateGuardSeconds);
  const advancedSectionSet = new Set<string>(providerFeatures.advancedSetup.sections);
  const showAdvancedSection = (section: string) => advancedSectionSet.has(section);
  const usePodAdvancedTabs: Array<{ id: UsePodAdvancedSection; label: string }> = [
    showAdvancedSection("usepod-status") ? { id: "status", label: "Status" } : null,
    showAdvancedSection("usepod-connection") ? { id: "connect", label: "Connect" } : null,
    showAdvancedSection("usepod-routing") ? { id: "routing", label: "Routing" } : null,
    showAdvancedSection("usepod-repair") ? { id: "repair", label: "Repair" } : null,
  ].filter(Boolean) as Array<{ id: UsePodAdvancedSection; label: string }>;
  const hasUsePodAdvanced = usePodAdvancedTabs.length > 0;

  const handleProviderChange = (provider: AgentPaymentProvider) => {
    const providerSelectedAt = Date.now();
    if (provider === "veil") {
      onUpdateWallet({
        provider,
        providerSelectedAt,
        enabled: wallet.enabled,
        network: VEIL_CASH_NETWORK,
        tokenSymbol: "USDC",
        autoPayEnabled: false,
      });
      return;
    }
    onUpdateWallet({ provider, providerSelectedAt, enabled: wallet.enabled });
  };

  const copyVeilCliQuickStart = async () => {
    await navigator.clipboard.writeText(veilCliCommand).catch(() => undefined);
  };

  const refreshVeilSetupStatus = async () => {
    setVeilSetupAction("checking");
    setVeilSetupMessage("");
    const response = await fetch("/api/wallet/veil/setup", { cache: "no-store" }).catch(() => null);
    const data = await readVeilSetupResponse(response);
    setVeilSetupStatus(data?.status ?? null);
    setVeilSetupMessage(response?.ok && data?.ok ? "Veil setup checked." : veilSetupErrorMessage(response, data, "Could not check Veil setup."));
    setVeilSetupAction(null);
  };

  const setupVeilOperator = async () => {
    setVeilSetupAction("setting");
    setVeilSetupMessage("Setting up Veil...");
    const response = await fetch("/api/wallet/veil/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup" }),
    }).catch(() => null);
    const data = await readVeilSetupResponse(response);
    setVeilSetupStatus(data?.status ?? null);
    setVeilSetupMessage(response?.ok && data?.ok ? data?.message ?? "Veil setup complete." : veilSetupErrorMessage(response, data, "Could not set up Veil."));
    setVeilSetupAction(null);
  };

  const runwayChip: { tone: "ok" | "warn" | "danger" | "muted"; text: string } = isOff
    ? { tone: "muted", text: "Wallet off" }
    : usePodReadyBalanceUnknown
      ? { tone: "ok", text: "Balance not returned" }
    : survival.daysRemaining == null
      ? { tone: "muted", text: "No runway estimate" }
      : isCritical
        ? { tone: "danger", text: `${survival.daysRemaining.toFixed(1)} days left` }
        : isLow
          ? { tone: "warn", text: `${survival.daysRemaining.toFixed(1)} days left` }
          : { tone: "ok", text: `${survival.daysRemaining.toFixed(1)} days runway` };

  const toggleSheet = (next: Sheet) => setSheet((current) => (current === next ? null : next));

  const handleCopyAddress = async () => {
    const address = usePodRail ? usePodDepositAddress : wallet.walletAddress;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* ignore — clipboard may be unavailable */
    }
  };

  const saveUsePodTokenRepair = async () => {
    const raw = usePodTokenDraft.trim();
    if (!raw) {
      setUsePodRepairStatus("Paste a UsePod dashboard URL or token first.");
      return;
    }
    let token = raw;
    try {
      const parsed = new URL(raw);
      token = parsed.searchParams.get("token")?.trim() || raw;
    } catch {
      const match = raw.match(/[?&]token=([^&#]+)/);
      token = match ? decodeURIComponent(match[1]).trim() : raw;
    }
    const compact = token.replace(/[^A-Za-z0-9-]/g, "");
    if (compact.length < 16) {
      setUsePodRepairStatus("That does not look like a UsePod token.");
      return;
    }
    const envSuffix = compact.replace(/[^A-Za-z0-9]/g, "").slice(0, 24).toUpperCase();
    const tokenEnvName = envSuffix ? `USEPOD_TOKEN_${envSuffix}` : agentUsePod?.tokenEnvName || "USEPOD_TOKEN";
    const dashboardUrl = `https://usepod.ai/dashboard?token=${encodeURIComponent(compact)}`;
    setUsePodRepairStatus("Saving UsePod token...");
    const response = await fetch("/api/usepod/save-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: compact,
        tokenEnvName,
        dashboardUrl,
        depositAddress: agentUsePod?.depositAddress || "",
        depositCode: agentUsePod?.depositCode || "",
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { ok?: boolean; tokenEnvName?: string; dashboardUrl?: string; error?: string } | null;
    if (!response?.ok || !data?.ok) {
      setUsePodRepairStatus(data?.error || "Could not save the UsePod token.");
      return;
    }
    await onUpdateUsePod?.({
      dashboardUrl: data.dashboardUrl || dashboardUrl,
      tokenEnvName: data.tokenEnvName || tokenEnvName,
      lastBalanceRemaining: "",
      lastRoute: "",
      lastCheckedAt: "",
      lastTestStatus: "checking",
      lastStatusMessage: "Checking the repaired UsePod token.",
      lastHttpStatus: undefined,
      lastModelCount: undefined,
      lastTokenPresent: true,
      lastTokenSource: "hivemindos-env",
    });
    setUsePodTokenDraft("");
    setUsePodAdvancedSection("status");
    setUsePodRepairStatus("Token saved and UsePod status refreshed.");
  };

  return (
    <article className={styles.card} data-tier={tier} aria-label={`${agentName} wallet`}>
      <div className={styles.topbar}>
        <div className={styles.identity}>
          <div className={styles.agentLine}>
            <span className={styles.agentDot} aria-hidden="true" />
            <strong className={styles.agentName}>{agentName}</strong>
          </div>
          <span className={styles.network}>
            {networkLabel(wallet.network)} · {wallet.tokenSymbol || "USDC"}
            {machineName ? ` · ${machineName}` : ""}
          </span>
        </div>
        <button
          type="button"
          className={styles.powerToggle}
          data-on={wallet.enabled}
          onClick={() => onUpdateWallet({ enabled: !wallet.enabled })}
          aria-label={wallet.enabled ? "Disable agent spending" : "Enable agent spending"}
        >
          <Power aria-hidden="true" />
          {wallet.enabled ? "Spend on" : "Spend off"}
        </button>
      </div>

      <div className={styles.hero}>
        <div className={styles.heroBalance}>{heroBalanceText}</div>
        <div className={styles.heroMeta}>
          <span className={styles.heroChip} data-tone={runwayChip.tone}>
            {runwayChip.text}
          </span>
        </div>
      </div>

      <div className={styles.actionRow}>
        <button
          type="button"
          className={styles.actionBtn}
          data-active={sheet === "send"}
          disabled={isOff || !providerFeatures.canSend}
          onClick={() => toggleSheet("send")}
        >
          <ArrowUpRight aria-hidden="true" />
          <span>Send</span>
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          data-active={sheet === "receive"}
          onClick={() => toggleSheet("receive")}
        >
          <QrCode aria-hidden="true" />
          <span>Receive</span>
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          data-active={sheet === "limits"}
          onClick={() => toggleSheet("limits")}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>Limits</span>
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          data-active={wallet.autoPayEnabled}
          disabled={!autoUseAvailable}
          onClick={() => onUpdateWallet({ autoPayEnabled: !wallet.autoPayEnabled })}
        >
          <HandCoins aria-hidden="true" />
          <span>{wallet.autoPayEnabled ? "Allowed" : "Auto-use"}</span>
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          disabled={!onExportSecret || wallet.custodyMode === "watch" || !(wallet.walletAddress || wallet.vaultAddress)}
          onClick={onExportSecret}
        >
          <KeyRound aria-hidden="true" />
          <span>Export</span>
        </button>
      </div>

      <button
        type="button"
        className={styles.autoUseToggle}
        data-on={wallet.autoPayEnabled}
        disabled={!autoUseAvailable}
        onClick={() => onUpdateWallet({ autoPayEnabled: !wallet.autoPayEnabled })}
        aria-pressed={wallet.autoPayEnabled}
      >
        <span>
          <strong>Allow auto-use</strong>
          <small>{wallet.autoPayEnabled
            ? "Agents can use this wallet within the hard spend cap without another prompt."
            : "Agents must ask before using paid wallet rails."}</small>
        </span>
        <span className={styles.autoUseSwitch} aria-hidden="true">
          <span />
        </span>
      </button>

      <section className={styles.railStack} aria-label="Agent payment rail setup">
        {usePodRail ? (
          <>
            <div className={styles.railStackHeader}>
              <div>
                <strong>UsePod rails</strong>
                <span>{usePodStatus === "ready"
                  ? "One funded token covers model calls, UsePod routing, and machine-native paywalls."
                  : "Finish the UsePod token setup once; the wallet can handle the rest."}</span>
              </div>
            </div>
            <div className={styles.railGrid}>
              <div className={styles.railItem} data-state={usePodInferenceRailState}>
                <Bot aria-hidden="true" />
                <div>
                  <strong>Inference</strong>
                  <span>{usePodStatus === "ready"
                    ? `${typeof usePodModelCount === "number" ? `${usePodModelCount} models` : "Models available"}`
                    : usePodTokenMissing ? "Repair token" : "Check UsePod status"}</span>
                </div>
                <small>{railText(usePodInferenceRailState)}</small>
              </div>
              <div className={styles.railItem} data-state={usePodFundingRailState}>
                <WalletCards aria-hidden="true" />
                <div>
                  <strong>Funding</strong>
                  <span>{usePodDepositAddress ? "Solana USDC receiver" : agentUsePod?.depositCode ? "Deposit code saved" : "Needs deposit details"}</span>
                </div>
                <small>{railText(usePodFundingRailState)}</small>
              </div>
              <div className={styles.railItem} data-state={usePodX402RailState}>
                <HandCoins aria-hidden="true" />
                <div>
                  <strong>x402</strong>
                  <span>{usePodTokenMissing ? "Needs token" : "Automatic via UsePod wallet"}</span>
                </div>
                <small>{usePodX402RailState === "ready" ? "Auto" : railText(usePodX402RailState)}</small>
              </div>
              <div className={styles.railItem} data-state={usePodCapsRailState}>
                <SlidersHorizontal aria-hidden="true" />
                <div>
                  <strong>Spend caps</strong>
                  <span>{usePodCapsRailState === "ready" ? "UsePod price ceilings" : "Default price routing"}</span>
                </div>
                <small>{railText(usePodCapsRailState)}</small>
              </div>
            </div>
          </>
        ) : veilRail ? (
          <>
            <div className={styles.railStackHeader}>
              <div>
                <strong>Veil Cash rails</strong>
                <span>{primaryRailReady ? "One agent spend balance for private sends; shielding is internal when needed." : "Create or connect a Base wallet before deriving Veil keys."}</span>
              </div>
            </div>
            <div className={styles.railGrid}>
              <button type="button" className={styles.railItem} data-state="ready" onClick={() => window.open(VEIL_CASH_APP_URL, "_blank", "noopener,noreferrer")}>
                <ShieldCheck aria-hidden="true" />
                <div>
                  <strong>Veil app</strong>
                  <span>Key management, deposits, private sends, withdrawals</span>
                </div>
                <small>Open</small>
              </button>
              <div className={styles.railItem} data-state={veilWalletRailState}>
                <WalletCards aria-hidden="true" />
                <div>
                  <strong>Base wallet</strong>
                  <span>{wallet.walletAddress ? shortenAddress(wallet.walletAddress) : "Local or external signer address"}</span>
                </div>
                <small>{railText(veilWalletRailState)}</small>
              </div>
              <div className={styles.railItem} data-state={veilRegistrationRailState}>
                <KeyRound aria-hidden="true" />
                <div>
                  <strong>Deposit key</strong>
                  <span>Configured once for shielding agent funds</span>
                </div>
                <small>{railText(veilRegistrationRailState)}</small>
              </div>
              <div className={styles.railItem} data-state={veilPrivateRailState}>
                <Terminal aria-hidden="true" />
                <div>
                  <strong>Private actions</strong>
                  <span>Auto-shield when needed, then withdraw privately</span>
                </div>
                <small>{railText(veilPrivateRailState)}</small>
              </div>
            </div>
          </>
        ) : (
          <>
          <div className={styles.railStackHeader}>
            <div>
              <strong>Core rails</strong>
              <span>{primaryRailReady ? "Card and crypto are ready for bounded spending." : "Initialize once, then top up only when needed."}</span>
            </div>
          </div>
        <div className={styles.railGrid}>
          <button type="button" className={styles.railItem} data-state={cardRailState} onClick={() => setMoneyClawModalOpen(true)}>
            <CreditCard aria-hidden="true" />
            <div>
              <strong>Cards</strong>
              <span>{moneyClawStatus?.configured ? `MoneyClaw${moneyClawBalance ? ` · ${moneyClawBalance}` : ""}` : `Needs ${wallet.moneyClawEnvName}`}</span>
            </div>
            <small>{railText(cardRailState)}</small>
          </button>
          <div className={styles.railItem} data-state={cryptoRailState}>
            <WalletCards aria-hidden="true" />
            <div>
              <strong>Crypto</strong>
              <span>{wallet.walletAddress ? shortenAddress(wallet.walletAddress) : "Local stablecoin wallet"}</span>
            </div>
            <small>{railText(cryptoRailState)}</small>
          </div>
          <div className={styles.railItem} data-state={x402RailState}>
            <Bot aria-hidden="true" />
            <div>
              <strong>x402</strong>
              <span>{x402RailState === "ready" ? "Uses local wallet caps" : "Needs crypto wallet"}</span>
            </div>
            <small>{railText(x402RailState)}</small>
          </div>
          <div className={styles.railItem} data-state={tradingRailState}>
            <TrendingUp aria-hidden="true" />
            <div>
              <strong>Trading</strong>
              <span>Bankr key and allowlist</span>
            </div>
            <small>{railText(tradingRailState)}</small>
          </div>
        </div>
          </>
        )}
      </section>

      {sheet === "send" ? (
        <div className={styles.sheet}>
          <div className={styles.sheetTitle}>
            {veilRail ? "Private send" : `Send ${wallet.tokenSymbol || "USDC"}`}
            <CloseIconButton size="sm" onClick={() => setSheet(null)} aria-label="Close send sheet" />
          </div>
          <p className={styles.sheetHelp}>
            {veilRail
              ? `Private ${veilSendAsset} send from this agent's spend balance. If ready private USDC is short, HivemindOS shields from the local Base wallet first and finishes after Veil accepts the deposit. ${veilSendAsset === "USDC" ? `Minimum send ${VEIL_CASH_USDC_PUBLIC_WITHDRAW_MINIMUM} USDC; shielding may require ${VEIL_CASH_USDC_DEPOSIT_MINIMUM} USDC plus gas.` : ""} Hard cap: ${veilSendCapLabel}. Review the recipient and amount, then type ${VEIL_CASH_TRANSFER_CONFIRMATION_LABEL} to send.`
              : `Hard cap per payment: ${formatMoney(wallet.maxPaymentUsd)}. ${wallet.autoPayEnabled ? "Auto-use is on, so transfers under the hard cap can send without another prompt." : "Auto-use is off, so type SEND_USDC to confirm this transfer."}`}
          </p>
          {veilRail ? (
            <div className={styles.sheetField}>
              <label htmlFor="wallet-send-asset">Asset</label>
              <select
                id="wallet-send-asset"
                value={veilSendAsset}
                onChange={(event) => onUpdateAction({ sendAsset: event.target.value === "ETH" ? "ETH" : "USDC" })}
              >
                {privateTransferAssets.map((asset) => (
                  <option key={asset} value={asset}>{asset}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className={styles.sheetField}>
            <label htmlFor="wallet-send-to">Recipient address</label>
            <input
              id="wallet-send-to"
              value={walletAction.sendTo ?? ""}
              onChange={(event) => onUpdateAction({ sendTo: event.target.value })}
              placeholder="0x… or Solana address"
            />
          </div>
          {wallet.autoPayEnabled && !veilRail ? (
            <div className={styles.sheetField}>
              <label htmlFor="wallet-send-amount">Amount</label>
              <input
                id="wallet-send-amount"
                value={walletAction.sendAmount ?? ""}
                onChange={(event) => onUpdateAction({ sendAmount: event.target.value })}
                placeholder={`Max ${veilRail ? veilSendCapLabel : formatMoney(wallet.maxPaymentUsd)}`}
              />
            </div>
          ) : (
            <div className={styles.sheetGrid}>
              <div className={styles.sheetField}>
                <label htmlFor="wallet-send-amount">Amount</label>
                <input
                  id="wallet-send-amount"
                  value={walletAction.sendAmount ?? ""}
                  onChange={(event) => onUpdateAction({ sendAmount: event.target.value })}
                  placeholder={`Max ${veilRail ? veilSendCapLabel : formatMoney(wallet.maxPaymentUsd)}`}
                />
              </div>
              <div className={styles.sheetField}>
                <label htmlFor="wallet-send-confirm">Confirm</label>
                <input
                  id="wallet-send-confirm"
                  value={walletAction.confirmation ?? ""}
                  onChange={(event) => onUpdateAction({ confirmation: event.target.value })}
                  placeholder={veilRail ? VEIL_CASH_TRANSFER_CONFIRMATION_LABEL : "SEND_USDC"}
                />
              </div>
            </div>
          )}
          <div className={styles.sheetButtons}>
            <Button type="button" size="sm" variant="danger" disabled={walletAction.busy} onClick={onSendUsdc}>
              <Send aria-hidden="true" />
              {veilRail ? "Send privately" : "Send"}
            </Button>
          </div>
          {walletAction.message ? <p className={styles.sheetStatus} data-tone="ok">{walletAction.message}</p> : null}
          {walletAction.error ? <p className={styles.sheetStatus} data-tone="error">{walletAction.error}</p> : null}
        </div>
      ) : null}

      {sheet === "receive" ? (
        <div className={styles.sheet}>
          <div className={styles.sheetTitle}>
            {veilRail ? "Veil Cash receive" : `Receive ${wallet.tokenSymbol || "USDC"}`}
            <CloseIconButton size="sm" onClick={() => setSheet(null)} aria-label="Close receive sheet" />
          </div>
          {veilRail ? (
            <>
              <p className={styles.sheetHelp}>
                Fund this Base signer with USDC and gas. Private sends can shield from it automatically when ready private funds are short.
              </p>
              {wallet.walletAddress ? (
                <>
                  <div className={styles.sheetAddress}>
                    <strong>Public Base signer</strong>
                    {wallet.walletAddress}
                  </div>
                  <button type="button" className={styles.sheetCopy} onClick={handleCopyAddress}>
                    <Copy aria-hidden="true" width={14} height={14} />
                    Copy signer address
                  </button>
                </>
              ) : (
                <p className={styles.sheetHelp}>Add a Base signer address in Advanced setup before building unsigned Veil registration or deposit payloads.</p>
              )}
              <div className={styles.sheetButtons}>
                <Button type="button" size="sm" variant="secondary" onClick={() => window.open(VEIL_CASH_APP_URL, "_blank", "noopener,noreferrer")}>
                  <ArrowUpRight aria-hidden="true" />
                  Open Veil app
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void copyVeilCliQuickStart()}>
                  <Copy aria-hidden="true" />
                  Copy CLI
                </Button>
              </div>
            </>
          ) : (usePodRail ? usePodDepositAddress : wallet.walletAddress) ? (
            <>
              <p className={styles.sheetHelp}>
                {usePodRail ? "Send Solana USDC to the UsePod token deposit address." : `Send ${wallet.tokenSymbol || "USDC"} on ${networkLabel(wallet.network)} to this address.`}
              </p>
              <div className={styles.sheetAddress}>
                <strong>{usePodRail ? "UsePod deposit address" : "Deposit address"}</strong>
                {usePodRail ? usePodDepositAddress : wallet.walletAddress}
              </div>
              <button type="button" className={styles.sheetCopy} onClick={handleCopyAddress}>
                <Copy aria-hidden="true" width={14} height={14} />
                Copy address
              </button>
              {!usePodRail ? (
                <div className={styles.sheetButtons}>
                  <Button type="button" size="sm" variant="secondary" disabled={walletAction.busy} onClick={onRefreshBalance}>
                    <RefreshCcw aria-hidden="true" />
                    Refresh balance
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className={styles.sheetHelp}>
                {usePodRail ? "No UsePod deposit address yet. Register UsePod from agent settings first." : "No deposit address yet. Create a local throwaway wallet, then top it up with a small test amount."}
              </p>
              {!usePodRail ? (
                <div className={styles.sheetButtons}>
                  <Button type="button" size="sm" variant="secondary" disabled={walletAction.busy} onClick={onCreateLocalWallet}>
                    <WalletCards aria-hidden="true" />
                    Create wallet
                  </Button>
                </div>
              ) : null}
            </>
          )}
          {walletAction.message ? <p className={styles.sheetStatus} data-tone="ok">{walletAction.message}</p> : null}
          {walletAction.error ? <p className={styles.sheetStatus} data-tone="error">{walletAction.error}</p> : null}
        </div>
      ) : null}

      {sheet === "limits" ? (
        <div className={styles.sheet}>
          <div className={styles.sheetTitle}>
            Spending limits
            <CloseIconButton size="sm" onClick={() => setSheet(null)} aria-label="Close spending limits" />
          </div>
          <p className={styles.sheetHelp}>The only numbers most users need to set.</p>
          <div className={styles.sheetGrid}>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-limit-balance">Current balance</label>
              <input
                id="wallet-limit-balance"
                type="number"
                min="0"
                step="0.01"
                value={wallet.currentBalanceUsd}
                onChange={(event) => onUpdateWallet({ currentBalanceUsd: Number(event.target.value) || 0 })}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-limit-approve">Ask me over</label>
              <input
                id="wallet-limit-approve"
                type="number"
                min="0"
                step="0.01"
                value={wallet.approvalRequiredOverUsd}
                onChange={(event) => onUpdateWallet({ approvalRequiredOverUsd: Number(event.target.value) || 0 })}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-limit-max">Max per payment</label>
              <input
                id="wallet-limit-max"
                type="number"
                min="0"
                step="0.01"
                value={wallet.maxPaymentUsd}
                onChange={(event) => onUpdateWallet({ maxPaymentUsd: Number(event.target.value) || 0 })}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-trading-venue">Stock buying</label>
              <select
                id="wallet-trading-venue"
                value={wallet.tradingVenue ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  onUpdateWallet({ tradingVenue: value ? (value as AgentTradingVenue) : undefined });
                }}
              >
                <option value="">Off</option>
                <option value="alpaca">Alpaca (real brokerage)</option>
                <option value="robinhood-agentic">Robinhood Agentic (brokerage MCP)</option>
                <option value="xstocks">xStocks (on-chain)</option>
                <option value="robinhood-chain">Robinhood Chain stock tokens</option>
              </select>
            </div>
            {wallet.tradingVenue === "alpaca" ? (
              <div className={styles.sheetField}>
                <label htmlFor="wallet-alpaca-mode">Alpaca mode</label>
                <select
                  id="wallet-alpaca-mode"
                  value={wallet.alpacaPaper === false ? "live" : "paper"}
                  onChange={(event) => onUpdateWallet({ alpacaPaper: event.target.value !== "live" })}
                >
                  <option value="paper">Paper (simulated)</option>
                  <option value="live">LIVE (real money)</option>
                </select>
              </div>
            ) : null}
            {wallet.tradingVenue ? (
              <div className={styles.sheetField}>
                <label htmlFor="wallet-limit-trade">Max per trade</label>
                <input
                  id="wallet-limit-trade"
                  type="number"
                  min="0"
                  step="0.01"
                  value={wallet.maxTradeUsd ?? 0}
                  onChange={(event) => onUpdateWallet({ maxTradeUsd: Number(event.target.value) || 0 })}
                  placeholder={`Defaults to max per payment (${formatMoney(wallet.maxPaymentUsd)})`}
                />
              </div>
            ) : null}
            {wallet.tradingVenue === "alpaca" ? (
              <p className={styles.sheetHelp}>
                Alpaca keys load from shared hive env by name
                (<code>{wallet.alpacaKeyEnvName || "ALPACA_API_KEY_ID"}</code> /{" "}
                <code>{wallet.alpacaSecretEnvName || "ALPACA_API_SECRET_KEY"}</code>).
                {wallet.alpacaPaper === false ? " LIVE mode places real brokerage orders." : " Paper mode is simulated — no real money."}
              </p>
            ) : wallet.tradingVenue === "xstocks" ? (
              <p className={styles.sheetHelp}>Swaps USDC → verified xStock tokens via Jupiter. Requires a Solana mainnet wallet.{wallet.network !== "solana:mainnet" ? " This wallet is not on Solana mainnet, so on-chain buys will be rejected." : ""}</p>
            ) : wallet.tradingVenue === "robinhood-chain" ? (
              <p className={styles.sheetHelp}>Swaps USDG ↔ canonical Robinhood Stock Tokens through 0x on Robinhood Chain.{wallet.network !== "eip155:4663" ? " Use a Robinhood Chain wallet before placing Stock Token orders." : " Fund this wallet with USDG plus ETH gas before placing orders."}</p>
            ) : null}
            {veilRail && privateTransferAssets.includes("ETH") ? (
              <div className={styles.sheetField}>
                <label htmlFor="wallet-limit-eth">Max ETH transfer</label>
                <input
                  id="wallet-limit-eth"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={assetSpendCapFor(wallet, "ETH")}
                  onChange={(event) => onUpdateWallet({
                    assetSpendCaps: {
                      ...(wallet.assetSpendCaps ?? {}),
                      ETH: Number(event.target.value) || 0,
                    },
                  })}
                />
              </div>
            ) : null}
            <div className={styles.sheetField}>
              <label htmlFor="wallet-limit-burn">Daily running cost</label>
              <input
                id="wallet-limit-burn"
                type="number"
                min="0"
                step="0.01"
                value={wallet.dailyComputeBurnUsd}
                onChange={(event) => onUpdateWallet({ dailyComputeBurnUsd: Number(event.target.value) || 0 })}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-budget-daily">Daily budget (0 = off)</label>
              <input
                id="wallet-budget-daily"
                type="number"
                min="0"
                step="0.01"
                value={wallet.dailyBudgetUsd ?? 0}
                onChange={(event) => onUpdateWallet({ dailyBudgetUsd: Number(event.target.value) || 0 })}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-budget-monthly">Monthly budget (0 = off)</label>
              <input
                id="wallet-budget-monthly"
                type="number"
                min="0"
                step="0.01"
                value={wallet.monthlyBudgetUsd ?? 0}
                onChange={(event) => onUpdateWallet({ monthlyBudgetUsd: Number(event.target.value) || 0 })}
              />
            </div>
          </div>
          <p className={styles.sheetHelp}>
            Daily/monthly budgets cap cumulative spend across every rail. Company budgets and freeze switches additionally apply while this agent executes that company's active Work Board tasks.
          </p>
          <button
            type="button"
            className={styles.autoUseToggle}
            data-on={duplicateGuardEnabled}
            onClick={() => onUpdateWallet({ duplicatePaymentGuardEnabled: !duplicateGuardEnabled })}
            aria-pressed={duplicateGuardEnabled}
          >
            <span>
              <strong>Duplicate payment guard</strong>
              <small>{duplicateGuardEnabled
                ? "Repeating the same asset, amount, and recipient returns the recent submitted transaction during the window."
                : "Intentional repeat payments can submit again as soon as the previous transfer finishes."}</small>
            </span>
            <span className={styles.autoUseSwitch} aria-hidden="true">
              <span />
            </span>
          </button>
          {duplicateGuardEnabled ? (
            <div className={styles.sheetField}>
              <label htmlFor="wallet-duplicate-guard-window">Duplicate guard window</label>
              <select
                id="wallet-duplicate-guard-window"
                value={duplicateGuardSeconds}
                onChange={(event) => onUpdateWallet({ duplicatePaymentGuardSeconds: Number(event.target.value) || DEFAULT_DUPLICATE_PAYMENT_GUARD_SECONDS })}
              >
                {hasCustomDuplicateGuard ? <option value={duplicateGuardSeconds}>{Math.round(duplicateGuardSeconds)} seconds</option> : null}
                {duplicateGuardOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className={styles.sheetButtons}>
            <Button type="button" size="sm" variant="secondary" onClick={onResetRunway}>
              <RefreshCcw aria-hidden="true" />
              Reset runway clock
            </Button>
          </div>
        </div>
      ) : null}

      {isOff ? (
        <div className={styles.banner} data-tone="off">
          <Power aria-hidden="true" />
          <div>
            <strong>Spending is off</strong>
            The wallet is ready, but this agent cannot spend until you enable spending.
          </div>
        </div>
      ) : isCritical ? (
        <div className={styles.banner} data-tone="danger">
          <ArrowUpRight aria-hidden="true" />
          <div>
            <strong>Needs funding</strong>
            Top up the wallet before this agent runs out of runway.
          </div>
        </div>
      ) : null}

      <div className={styles.holdings}>
        <div className={styles.holdingsHeader}>
          <strong>Holdings</strong>
          <small>{providerCopy.label}</small>
        </div>

        <div className={styles.token}>
          <span className={styles.tokenIcon} data-token="usdc">{(wallet.tokenSymbol || "USDC").slice(0, 1)}</span>
          <div className={styles.tokenBody}>
            <span className={styles.tokenName}>{wallet.tokenSymbol || "USDC"}</span>
            <span className={styles.tokenSub}>{networkLabel(wallet.network)}</span>
          </div>
          <div className={styles.tokenAmount}>
            <strong>{usePodReadyBalanceUnknown ? "Not returned" : formatMoney(safeBalance)}</strong>
            <small>{usePodReadyBalanceUnknown ? "UsePod balance" : "safe to spend"}</small>
          </div>
        </div>

        {wallet.nativeBalance != null ? (
          <div className={styles.token}>
            <span className={styles.tokenIcon} data-token="gas"><Fuel aria-hidden="true" /></span>
            <div className={styles.tokenBody}>
              <span className={styles.tokenName}>Gas</span>
              <span className={styles.tokenSub}>Native balance</span>
            </div>
            <div className={styles.tokenAmount}>
              <strong>{formatNumber(wallet.nativeBalance, 6)}</strong>
            </div>
          </div>
        ) : null}

        <div className={styles.token}>
          <span className={styles.tokenIcon} data-token="honey">🐝</span>
          <div className={styles.tokenBody}>
            <span className={styles.tokenName}>Honey</span>
            <span className={styles.tokenSub}>
              {honeyLedgerEnabled
                ? `${formatNumber(honeyReward?.honeyAvailable ?? 0, 1)} available · ${(honeyReward?.tokensUsed ?? 0).toLocaleString()} tokens used`
                : "Rewards off"}
            </span>
          </div>
          <button
            type="button"
            className={cn(styles.tokenAction)}
            disabled
          >
            Claim in rail
          </button>
        </div>

        <div className={styles.token}>
          <span className={styles.tokenIcon} data-token="hive">
            <svg viewBox="0 0 32 36" aria-hidden="true" focusable="false">
              <polygon points="16 1.5 29.4 9.25 29.4 26.75 16 34.5 2.6 26.75 2.6 9.25" />
            </svg>
          </span>
          <div className={styles.tokenBody}>
            <span className={styles.tokenName}>Legacy HIVE</span>
            <span className={styles.tokenSub}>Ledger only</span>
          </div>
          <div className={styles.tokenAmount}>
            <strong>{formatNumber(honeyReward?.hiveBalance ?? 0, 2)}</strong>
          </div>
        </div>
      </div>

      <details className={styles.advanced}>
        <summary>Advanced setup</summary>
        <div className={styles.advancedBody}>
          <PaymentMethodSelector
            provider={wallet.provider}
            providerOptions={providerOptions}
            providerCopy={providerCopy}
            onChangeProvider={handleProviderChange}
          />

          {hasUsePodAdvanced ? (
            <>
              <div className={styles.usePodAdvancedSegmented} role="tablist" aria-label="UsePod advanced sections">
                {usePodAdvancedTabs.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    aria-selected={usePodAdvancedSection === section.id}
                    className={cn(styles.usePodAdvancedSegment, usePodAdvancedSection === section.id && styles.usePodAdvancedSegmentActive)}
                    onClick={() => setUsePodAdvancedSection(section.id)}
                  >
                    {section.label}
                  </button>
                ))}
              </div>

              {showAdvancedSection("usepod-status") && usePodAdvancedSection === "status" ? (
                <>
                  <section className={styles.usePodRail} aria-label="UsePod prepaid rail">
                    <div className={styles.usePodRailHeader}>
                      <div>
                        <strong>UsePod prepaid</strong>
                        <span>{usePodStatus === "ready"
                          ? `${typeof usePodModelCount === "number" ? `${usePodModelCount} models` : "Models ready"} · provider-managed x402`
                          : "Prepaid Solana USDC for inference and paywalls"}</span>
                      </div>
                      <small>{usePodStatus}</small>
                    </div>
                    <div className={styles.usePodPrimaryBalance}>
                      <div>
                        <span>Balance</span>
                        <strong>{usePodBalance || "After test"}</strong>
                      </div>
                      {visibleUsePodStatusMessage && usePodStatus !== "ready" ? <p data-tone="error">{visibleUsePodStatusMessage}</p> : null}
                    </div>
                    <div className={styles.usePodActionRow}>
                      <button type="button" className={styles.sheetCopy} onClick={onRefreshBalance}>
                        <RefreshCcw aria-hidden="true" width={14} height={14} />
                        Refresh
                      </button>
                      {agentUsePod?.dashboardUrl ? (
                        <button type="button" className={styles.sheetCopy} onClick={() => window.open(agentUsePod.dashboardUrl, "_blank", "noopener,noreferrer")}>
                          <ArrowUpRight aria-hidden="true" width={14} height={14} />
                          Dashboard
                        </button>
                      ) : null}
                      {usePodDepositAddress ? (
                        <button type="button" className={styles.sheetCopy} onClick={() => void navigator.clipboard.writeText(usePodDepositAddress).catch(() => undefined)}>
                          <Copy aria-hidden="true" width={14} height={14} />
                          Copy receiver
                        </button>
                      ) : null}
                    </div>
                  </section>

                  <div className={styles.usePodAdvancedGrid}>
                    <div>
                      <span>Token source</span>
                      <strong>{usePodTokenHealth}</strong>
                    </div>
                    <div>
                      <span>Token</span>
                      <strong>{usePodTokenFingerprint || "Unknown"}</strong>
                    </div>
                    <div>
                      <span>Funding ref</span>
                      <strong>{agentUsePod?.depositCode || "Not saved"}</strong>
                    </div>
                    <div>
                      <span>Route</span>
                      <strong>{usePodRoute || "Default"}</strong>
                    </div>
                    <div>
                      <span>Models</span>
                      <strong>{typeof usePodModelCount === "number" ? usePodModelCount : "Check status"}</strong>
                    </div>
                  </div>

                  {visibleUsePodStatusMessage ? (
                    <p className={styles.sheetStatus} data-tone={usePodStatus === "ready" ? "ok" : "error"}>{visibleUsePodStatusMessage}</p>
                  ) : null}

                  {usePodDepositAddress ? (
                    <div className={styles.sheetField}>
                      <span className={styles.fieldLabel}>Receiver address</span>
                      <div className={styles.sheetAddress}>{usePodDepositAddress}</div>
                    </div>
                  ) : null}

                  <div className={styles.sheetGrid}>
                    <div className={styles.sheetField}>
                      <span className={styles.fieldLabel}>Network</span>
                      <div className={styles.readOnlyField}>Solana mainnet</div>
                    </div>
                    <div className={styles.sheetField}>
                      <span className={styles.fieldLabel}>Token</span>
                      <div className={styles.readOnlyField}>USDC</div>
                    </div>
                  </div>

                  <div className={styles.sheetButtons}>
                    <Button type="button" size="sm" variant="secondary" onClick={onCopyPaymentPrompt}>
                      <Copy aria-hidden="true" />
                      Copy agent prompt
                    </Button>
                  </div>
                  <p className={styles.sheetStatus} data-tone="muted">{providerCopy.setup}</p>
                </>
              ) : showAdvancedSection("usepod-connection") && usePodAdvancedSection === "connect" ? (
                <>
                  <div className={styles.sheetField}>
                    <span className={styles.fieldLabel}>Current compatibility</span>
                    <div className={styles.readOnlyField}>{usePodCompatibilityFeature.label}</div>
                    <p className={styles.sheetHelp}>
                      UsePod is a base-URL swap. HivemindOS currently runs this wallet through the OpenAI-compatible adapter, and keeps Anthropic details visible for future runtime/provider wiring.
                    </p>
                  </div>

                  <div className={styles.usePodAdvancedGrid}>
                    {Object.values(USEPOD_COMPATIBILITY_MATRIX).map((compatibility) => (
                      <div key={compatibility.id}>
                        <span>{compatibility.label}</span>
                        <strong>{compatibility.baseUrlTemplate}</strong>
                      </div>
                    ))}
                    <div>
                      <span>Token env</span>
                      <strong>{agentUsePod?.tokenEnvName || "USEPOD_TOKEN"}</strong>
                    </div>
                    <div>
                      <span>Endpoints</span>
                      <strong>{usePodCompatibilityFeature.endpoints.join(", ")}</strong>
                    </div>
                  </div>

                  <div className={styles.sheetButtons}>
                    <Button type="button" size="sm" variant="secondary" onClick={() => window.open(usePodCompatibilityFeature.docsUrl, "_blank", "noopener,noreferrer")}>
                      <ArrowUpRight aria-hidden="true" />
                      Open docs
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(usePodCompatibilityFeature.baseUrlTemplate).catch(() => undefined)}>
                      <Copy aria-hidden="true" />
                      Copy template
                    </Button>
                  </div>
                </>
              ) : showAdvancedSection("usepod-routing") && usePodAdvancedSection === "routing" ? (
                <>
                  <div className={styles.sheetField}>
                    <span className={styles.fieldLabel}>Routing mode</span>
                    <div className={styles.readOnlyField}>{usePodRoutingFeature.label}</div>
                    <p className={styles.sheetHelp}>{usePodRoutingFeature.summary}</p>
                  </div>

                  <div className={styles.usePodAdvancedGrid}>
                    <div>
                      <span>Last route</span>
                      <strong>{usePodRoute || "Not returned yet"}</strong>
                    </div>
                    <div>
                      <span>Input cap</span>
                      <strong>{agentUsePod?.maxPriceInputMicrounits || "Default"}</strong>
                    </div>
                    <div>
                      <span>Output cap</span>
                      <strong>{agentUsePod?.maxPriceOutputMicrounits || "Default"}</strong>
                    </div>
                    <div>
                      <span>Request controls</span>
                      <strong>Price ceiling headers</strong>
                    </div>
                  </div>

                  <p className={styles.sheetStatus} data-tone="muted">
                    Marketplace-only is documented as a UsePod routing mode, but the public proxy docs only publish price-ceiling headers right now. HivemindOS keeps the documented request path and records route headers as UsePod returns them.
                  </p>
                </>
              ) : showAdvancedSection("usepod-repair") ? (
                <>
                  <div className={styles.usePodRepair}>
                    <strong>Repair token binding</strong>
                    <p>Paste the funded UsePod dashboard URL or API token for this wallet.</p>
                    <input
                      value={usePodTokenDraft}
                      onChange={(event) => {
                        setUsePodTokenDraft(event.target.value);
                        setUsePodRepairStatus("");
                      }}
                      className={maskedSecretValueClass}
                      placeholder="https://usepod.ai/dashboard?token=..."
                      {...secretInputProps}
                    />
                    <button type="button" className={styles.sheetCopy} onClick={() => void saveUsePodTokenRepair()}>
                      Save and recheck
                    </button>
                    {usePodRepairStatus ? <p className={styles.sheetStatus} data-tone="muted">{usePodRepairStatus}</p> : null}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              {veilRail && showAdvancedSection("veil-setup") ? (
                <VeilAdvancedSetup
                  signerAddress={wallet.walletAddress}
                  networkLabel="Base mainnet"
                  assetsLabel="ETH and USDC"
                  contracts={veilContracts}
                  setupStatus={veilSetupStatus}
                  setupAction={veilSetupAction}
                  setupMessage={veilSetupMessage}
                  autoPrivateX402={veilAutoPrivateX402}
                  onChangeSignerAddress={(walletAddress) => onUpdateWallet({ walletAddress })}
                  onChangeAutoPrivateX402={(veilAutoPrivateX402) => onUpdateWallet({ veilAutoPrivateX402 })}
                  onCheckSetup={refreshVeilSetupStatus}
                  onSetupVeil={setupVeilOperator}
                  onCopyPrompt={onCopyPaymentPrompt}
                  onOpenWallet={() => window.open(VEIL_CASH_WALLET_URL, "_blank", "noopener,noreferrer")}
                  onOpenDocs={() => window.open(VEIL_CASH_DOCS_URL, "_blank", "noopener,noreferrer")}
                  onCopyCli={() => void copyVeilCliQuickStart()}
                />
              ) : (
                <>
                  {showAdvancedSection("wallet-address") ? (
                    <div className={styles.sheetField}>
                      <label htmlFor="wallet-address">Wallet address</label>
                      <input
                        id="wallet-address"
                        value={wallet.walletAddress}
                        onChange={(event) => onUpdateWallet({ walletAddress: event.target.value })}
                        placeholder="0x... or Solana address"
                      />
                      {wallet.walletAddress ? (
                        <p className={styles.sheetHelp}>Deposit: {shortenAddress(wallet.walletAddress)}</p>
                      ) : null}
                    </div>
                  ) : null}

                  {showAdvancedSection("network-token") ? (
                    <div className={styles.sheetGrid}>
                      <div className={styles.sheetField}>
                        <label htmlFor="wallet-network">Network</label>
                        <select
                          id="wallet-network"
                          value={wallet.network}
                          onChange={(event) => onUpdateWallet({ network: event.target.value })}
                        >
                          <option value="eip155:8453">Base mainnet</option>
                          <option value="eip155:84532">Base Sepolia</option>
                          <option value="eip155:4663">Robinhood Chain</option>
                          <option value="solana:mainnet">Solana mainnet</option>
                          <option value="solana:devnet">Solana devnet</option>
                        </select>
                      </div>
                      <div className={styles.sheetField}>
                        <label htmlFor="wallet-token">Token</label>
                        <input
                          id="wallet-token"
                          value={wallet.tokenSymbol}
                          onChange={(event) => onUpdateWallet({ tokenSymbol: event.target.value.toUpperCase() })}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {showAdvancedSection("x402-base-url") ? (
                <div className={styles.sheetField}>
                  <label htmlFor="wallet-x402">x402 base URL</label>
                  <input
                    id="wallet-x402"
                    value={wallet.x402BaseUrl}
                    onChange={(event) => onUpdateWallet({ x402BaseUrl: event.target.value })}
                    placeholder={veilRail ? VEIL_CASH_DEFAULT_X402_URL : "https://paid-api.example.com"}
                  />
                </div>
              ) : null}

              {showAdvancedSection("test-x402") ? (
                <div className={styles.sheetGrid}>
                  <div className={styles.sheetField}>
                    <label htmlFor="wallet-x402-endpoint">x402 endpoint</label>
                    <input
                      id="wallet-x402-endpoint"
                      value={walletAction.x402Url ?? ""}
                      onChange={(event) => onUpdateAction({ x402Url: event.target.value })}
                      placeholder={veilRail ? VEIL_CASH_DEFAULT_X402_URL : "http://127.0.0.1:5025/api/wallet/x402/mock-paid"}
                    />
                  </div>
                  <div className={styles.sheetField}>
                    <label htmlFor="wallet-x402-confirm">Confirm x402</label>
                    <input
                      id="wallet-x402-confirm"
                      value={walletAction.x402Confirmation ?? ""}
                      onChange={(event) => onUpdateAction({ x402Confirmation: event.target.value })}
                      placeholder={veilRail && veilAutoPrivateX402 ? VEIL_CASH_X402_CONFIRMATION : "PAY_X402"}
                    />
                  </div>
                </div>
              ) : null}

              {showAdvancedSection("moneyclaw-env") ? (
                <div className={styles.sheetField}>
                  <label htmlFor="wallet-moneyclaw">MoneyClaw env name</label>
                  <input
                    id="wallet-moneyclaw"
                    value={wallet.moneyClawEnvName}
                    onChange={(event) => onUpdateWallet({ moneyClawEnvName: event.target.value })}
                  />
                </div>
              ) : null}

              {showAdvancedSection("clawcard-env") ? (
                <div className={styles.sheetField}>
                  <label htmlFor="wallet-clawcard">ClawCard env name (legacy)</label>
                  <input
                    id="wallet-clawcard"
                    value={wallet.clawCardEnvName}
                    onChange={(event) => onUpdateWallet({ clawCardEnvName: event.target.value })}
                  />
                </div>
              ) : null}

              {showAdvancedSection("notes") ? (
                <div className={styles.sheetField}>
                  <label htmlFor="wallet-notes">Private setup notes</label>
                  <textarea
                    id="wallet-notes"
                    value={wallet.notes}
                    onChange={(event) => onUpdateWallet({ notes: event.target.value })}
                    placeholder="Provider dashboard URL, deposit memo, funding policy…"
                    rows={3}
                  />
                </div>
              ) : null}

              <div className={styles.sheetButtons}>
                {showAdvancedSection("copy-prompt") && !veilRail ? (
                  <Button type="button" size="sm" variant="secondary" onClick={onCopyPaymentPrompt}>
                    <Copy aria-hidden="true" />
                    Copy agent prompt
                  </Button>
                ) : null}
                {showAdvancedSection("test-x402") ? (
                  <Button type="button" size="sm" variant="secondary" disabled={walletAction.busy} onClick={onCallX402}>
                    <Send aria-hidden="true" />
                    {veilRail && veilAutoPrivateX402 ? "Test private x402" : "Test x402"}
                  </Button>
                ) : null}
              </div>
              <p className={styles.sheetStatus} data-tone="muted">{providerCopy.setup}</p>
            </>
          )}
        </div>
      </details>

      {moneyClawModalOpen ? (
        <MoneyClawKeyModal
          envName={wallet.moneyClawEnvName}
          onClose={() => setMoneyClawModalOpen(false)}
          onSave={onSaveMoneyClawKey}
        />
      ) : null}
    </article>
  );
}

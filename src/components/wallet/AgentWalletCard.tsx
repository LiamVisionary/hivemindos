"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  CreditCard,
  Fuel,
  HandCoins,
  Power,
  QrCode,
  RefreshCcw,
  Send,
  SlidersHorizontal,
  TrendingUp,
  WalletCards,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import { maskedSecretValueClass, secretInputProps } from "@/components/ui/secret-input-props";
import type {
  AgentPaymentProvider,
  AgentSurvivalSnapshot,
  AgentWalletConfig,
  HoneyAgentReward,
} from "@/lib/types/agent-wallet";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import { cn } from "@/lib/utils/cn";
import { getDisplayWalletBalanceUsd } from "@/lib/utils/agent-wallet";

import styles from "./AgentWalletCard.module.css";

type WalletActionState = {
  busy?: boolean;
  sendTo?: string;
  sendAmount?: string;
  confirmation?: string;
  x402Url?: string;
  x402Method?: string;
  x402Confirmation?: string;
  message?: string;
  error?: string;
};

type ProviderCopy = { label: string; summary: string; setup: string };
type RailState = "ready" | "setup" | "blocked";
type MoneyClawStatus = {
  configured: boolean;
  apiKeyEnvName: string;
  balance?: unknown;
  depositAddress?: unknown;
  paymentIntents?: unknown;
  errors?: Record<string, string>;
};
type MoneyClawSaveOptions = { shareWithAllAgents: boolean };

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
  onResetRunway: () => void;
  onCopyPaymentPrompt: () => void;
  onCreateLocalWallet: () => void;
  onRefreshBalance: () => void;
  onSendUsdc: () => void;
  onCallX402: () => void;
};

type Sheet = "send" | "receive" | "limits" | null;

function networkLabel(network: string) {
  switch (network) {
    case "eip155:8453":
      return "Base mainnet";
    case "eip155:84532":
      return "Base Sepolia";
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
  onResetRunway,
  onCopyPaymentPrompt,
  onCreateLocalWallet,
  onRefreshBalance,
  onSendUsdc,
  onCallX402,
}: AgentWalletCardProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [moneyClawModalOpen, setMoneyClawModalOpen] = useState(false);
  const [moneyClawKeyDraft, setMoneyClawKeyDraft] = useState("");
  const [shareMoneyClawKey, setShareMoneyClawKey] = useState(false);
  const [moneyClawSaveState, setMoneyClawSaveState] = useState<"idle" | "checking" | "saved">("idle");
  const [moneyClawSaveError, setMoneyClawSaveError] = useState("");
  const portalTarget = typeof document === "undefined" ? null : document.body;

  const tier = wallet.enabled ? survival.tier : "off";
  const safeBalance = getDisplayWalletBalanceUsd(wallet);
  const isOff = !wallet.enabled;
  const isCritical = wallet.enabled && (survival.tier === "critical" || survival.tier === "dead");
  const isLow = wallet.enabled && survival.tier === "low_compute";
  const cardRailState: RailState = moneyClawStatus?.configured ? "ready" : "setup";
  const cryptoRailState: RailState = wallet.walletAddress || wallet.vaultAddress ? "ready" : "setup";
  const x402RailState: RailState = cryptoRailState === "ready" ? "ready" : "setup";
  const tradingRailState: RailState = "setup";
  const moneyClawBalance = moneyClawBalanceLabel(moneyClawStatus);
  const usePodRail = wallet.provider === "usepod";
  const usePodDepositAddress = agentUsePod?.depositAddress || wallet.walletAddress;
  const primaryRailReady = usePodRail ? Boolean(usePodDepositAddress) : cardRailState === "ready" && cryptoRailState === "ready";
  const usePodBalance = agentUsePod?.lastBalanceRemaining || "";
  const usePodRoute = agentUsePod?.lastRoute || "";
  const usePodModelCount = agentUsePod?.lastModelCount;

  const saveMoneyClawKey = async () => {
    const key = moneyClawKeyDraft.trim();
    setMoneyClawSaveError("");
    setMoneyClawSaveState("checking");
    const result = await onSaveMoneyClawKey(key, { shareWithAllAgents: shareMoneyClawKey });
    if (!result.ok) {
      setMoneyClawSaveState("idle");
      setMoneyClawSaveError(result.error || "MoneyClaw key could not be saved.");
      return;
    }
    setMoneyClawSaveState("saved");
    window.setTimeout(() => {
      setMoneyClawModalOpen(false);
      setMoneyClawKeyDraft("");
      setMoneyClawSaveState("idle");
    }, 900);
  };

  const runwayChip: { tone: "ok" | "warn" | "danger" | "muted"; text: string } = isOff
    ? { tone: "muted", text: "Wallet off" }
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
        <div className={styles.heroBalance}>{formatMoney(safeBalance)}</div>
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
          disabled={isOff}
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
          data-tone={wallet.autoPayEnabled ? "danger" : undefined}
          onClick={() => onUpdateWallet({ autoPayEnabled: !wallet.autoPayEnabled })}
        >
          <HandCoins aria-hidden="true" />
          <span>{wallet.autoPayEnabled ? "Auto on" : "Autopay"}</span>
        </button>
      </div>

      <section className={styles.railStack} aria-label="Agent payment rail setup">
        <div className={styles.railStackHeader}>
          <div>
            <strong>{usePodRail ? "Payment rails" : "Core rails"}</strong>
            <span>{usePodRail
              ? primaryRailReady ? "UsePod deposit details are available for prepaid inference." : "Register UsePod from agent settings before funding."
              : primaryRailReady ? "Card and crypto are ready for bounded spending." : "Initialize once, then top up only when needed."}</span>
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
              <span>{wallet.walletAddress ? shortenAddress(wallet.walletAddress) : "Local USDC wallet"}</span>
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
      </section>

      {usePodRail ? (
        <section className={styles.usePodRail} aria-label="UsePod prepaid rail">
          <div className={styles.usePodRailHeader}>
            <div>
              <strong>UsePod prepaid</strong>
              <span>{agentUsePod?.tokenEnvName || "USEPOD_TOKEN"}</span>
            </div>
            <small>{agentUsePod?.lastTestStatus || "not checked"}</small>
          </div>
          <div className={styles.usePodRailGrid}>
            <div>
              <span>Deposit</span>
              <strong>{usePodDepositAddress ? shortenAddress(usePodDepositAddress) : "Pending"}</strong>
            </div>
            <div>
              <span>Balance</span>
              <strong>{usePodBalance || "After test"}</strong>
            </div>
            <div>
              <span>Route</span>
              <strong>{usePodRoute || "Unknown"}</strong>
            </div>
            <div>
              <span>Models</span>
              <strong>{typeof usePodModelCount === "number" ? usePodModelCount : "Check"}</strong>
            </div>
          </div>
          {usePodDepositAddress ? (
            <button type="button" className={styles.sheetCopy} onClick={() => void navigator.clipboard.writeText(usePodDepositAddress).catch(() => undefined)}>
              <Copy aria-hidden="true" width={14} height={14} />
              Copy UsePod deposit
            </button>
          ) : null}
        </section>
      ) : null}

      {sheet === "send" ? (
        <div className={styles.sheet}>
          <div className={styles.sheetTitle}>
            Send {wallet.tokenSymbol || "USDC"}
            <CloseIconButton size="sm" onClick={() => setSheet(null)} aria-label="Close send sheet" />
          </div>
          <p className={styles.sheetHelp}>
            Hard cap per payment: {formatMoney(wallet.maxPaymentUsd)}. Type SEND_USDC to confirm if asked.
          </p>
          <div className={styles.sheetField}>
            <label htmlFor="wallet-send-to">Recipient address</label>
            <input
              id="wallet-send-to"
              value={walletAction.sendTo ?? ""}
              onChange={(event) => onUpdateAction({ sendTo: event.target.value })}
              placeholder="0x… or Solana address"
            />
          </div>
          <div className={styles.sheetGrid}>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-send-amount">Amount</label>
              <input
                id="wallet-send-amount"
                value={walletAction.sendAmount ?? ""}
                onChange={(event) => onUpdateAction({ sendAmount: event.target.value })}
                placeholder={`Max ${formatMoney(wallet.maxPaymentUsd)}`}
              />
            </div>
            <div className={styles.sheetField}>
              <label htmlFor="wallet-send-confirm">Confirm</label>
              <input
                id="wallet-send-confirm"
                value={walletAction.confirmation ?? ""}
                onChange={(event) => onUpdateAction({ confirmation: event.target.value })}
                placeholder="SEND_USDC"
              />
            </div>
          </div>
          <div className={styles.sheetButtons}>
            <Button type="button" size="sm" variant="danger" disabled={walletAction.busy} onClick={onSendUsdc}>
              <Send aria-hidden="true" />
              Send
            </Button>
          </div>
          {walletAction.message ? <p className={styles.sheetStatus} data-tone="ok">{walletAction.message}</p> : null}
          {walletAction.error ? <p className={styles.sheetStatus} data-tone="error">{walletAction.error}</p> : null}
        </div>
      ) : null}

      {sheet === "receive" ? (
        <div className={styles.sheet}>
          <div className={styles.sheetTitle}>
            Receive {wallet.tokenSymbol || "USDC"}
            <CloseIconButton size="sm" onClick={() => setSheet(null)} aria-label="Close receive sheet" />
          </div>
          {(usePodRail ? usePodDepositAddress : wallet.walletAddress) ? (
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
          </div>
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
            <strong>{formatMoney(safeBalance)}</strong>
            <small>safe to spend</small>
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
          <div className={styles.sheetField}>
            <label htmlFor="wallet-provider">Payment method</label>
            <select
              id="wallet-provider"
              value={wallet.provider}
              onChange={(event) => onUpdateWallet({ provider: event.target.value as AgentPaymentProvider })}
            >
              {providerOptions.map(([provider, copy]) => (
                <option key={provider} value={provider}>{copy.label}</option>
              ))}
            </select>
            <p className={styles.sheetHelp}>{providerCopy.summary}</p>
          </div>

          <div className={styles.sheetField}>
            <label htmlFor="wallet-address">{usePodRail ? "UsePod deposit address" : "Wallet address"}</label>
            <input
              id="wallet-address"
              value={wallet.walletAddress}
              onChange={(event) => onUpdateWallet({ walletAddress: event.target.value })}
              placeholder={usePodRail ? "Solana USDC deposit address" : "0x… or Solana address"}
            />
            {wallet.walletAddress ? (
              <p className={styles.sheetHelp}>{usePodRail ? "UsePod token deposit" : "Deposit"}: {shortenAddress(wallet.walletAddress)}</p>
            ) : null}
          </div>

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

          <div className={styles.sheetField}>
            <label htmlFor="wallet-x402">{usePodRail ? "UsePod proxy base URL" : "x402 base URL"}</label>
            <input
              id="wallet-x402"
              value={wallet.x402BaseUrl}
              onChange={(event) => onUpdateWallet({ x402BaseUrl: event.target.value })}
              placeholder={usePodRail ? "https://api.usepod.ai/proxy/<token>/v1" : "https://paid-api.example.com"}
            />
          </div>

          <div className={styles.sheetField}>
            <label htmlFor="wallet-moneyclaw">MoneyClaw env name</label>
            <input
              id="wallet-moneyclaw"
              value={wallet.moneyClawEnvName}
              onChange={(event) => onUpdateWallet({ moneyClawEnvName: event.target.value })}
            />
          </div>

          <div className={styles.sheetField}>
            <label htmlFor="wallet-clawcard">ClawCard env name (legacy)</label>
            <input
              id="wallet-clawcard"
              value={wallet.clawCardEnvName}
              onChange={(event) => onUpdateWallet({ clawCardEnvName: event.target.value })}
            />
          </div>

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

          <div className={styles.sheetButtons}>
            <Button type="button" size="sm" variant="secondary" onClick={onCopyPaymentPrompt}>
              <Copy aria-hidden="true" />
              Copy agent prompt
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={walletAction.busy} onClick={onCallX402}>
              <Send aria-hidden="true" />
              Test x402
            </Button>
          </div>
          <p className={styles.sheetStatus} data-tone="muted">{providerCopy.setup}</p>
        </div>
      </details>

      {moneyClawModalOpen && portalTarget ? createPortal((
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setMoneyClawModalOpen(false)}>
          <section
            className={styles.moneyClawModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="moneyclaw-key-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Cards rail</p>
                <h3 id="moneyclaw-key-title">MoneyClaw API key</h3>
              </div>
              <CloseIconButton aria-label="Close MoneyClaw setup" onClick={() => setMoneyClawModalOpen(false)} />
            </div>

            <label className={styles.modalField} htmlFor="moneyclaw-key">
              <span>{wallet.moneyClawEnvName}</span>
              <input
                id="moneyclaw-key"
                {...secretInputProps}
                value={moneyClawKeyDraft}
                onChange={(event) => {
                  setMoneyClawKeyDraft(event.target.value);
                  setMoneyClawSaveError("");
                  if (moneyClawSaveState === "saved") setMoneyClawSaveState("idle");
                }}
                placeholder="mcl_..."
                className={maskedSecretValueClass}
              />
            </label>

            <label className={styles.modalToggle}>
              <input
                type="checkbox"
                checked={shareMoneyClawKey}
                onChange={(event) => setShareMoneyClawKey(event.target.checked)}
              />
              <span>
                <strong>{shareMoneyClawKey ? "Use for all agents" : "Use only for this agent"}</strong>
                <small>{shareMoneyClawKey
                  ? "Agents will share one MoneyClaw account, wallet, inbox, and balance."
                  : "Use this when each agent has its own MoneyClaw account, wallet, inbox, and balance."}</small>
              </span>
            </label>

            <button
              type="button"
              className={styles.modalSaveButton}
              disabled={moneyClawSaveState === "checking" || !moneyClawKeyDraft.trim()}
              onClick={() => void saveMoneyClawKey()}
            >
              {moneyClawSaveState === "saved" ? <Check aria-hidden="true" /> : null}
              {moneyClawSaveState === "checking" ? "Checking..." : moneyClawSaveState === "saved" ? "Saved!" : "Check"}
            </button>

            {moneyClawSaveError ? <p className={styles.modalError}>{moneyClawSaveError}</p> : null}

            <div className={styles.terminalAlternative}>
              <strong>Alternatively, run this in Terminal</strong>
              <code>{shareMoneyClawKey
                ? `scripts/hive-env-add ${wallet.moneyClawEnvName}`
                : "Per-agent MoneyClaw keys should be saved here so they stay attached to this agent's env overlay."}</code>
            </div>
          </section>
        </div>
      ), portalTarget) : null}
    </article>
  );
}

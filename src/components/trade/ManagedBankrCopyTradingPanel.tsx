"use client";

import React from "react";

import { BBtn, Badge } from "./primitives";
import {
  SharedHiveEnvCredentialInput,
  type SharedHiveEnvCredential,
  type SharedHiveEnvCredentialSaveResult,
} from "@/features/env/SharedHiveEnvCredentialInput";
import type {
  BankrCopyConnectionKind,
  BankrCopyDashboard,
  BankrCopyPerformancePublication,
  BankrCopyPerformanceShare,
  BankrCopySubscription,
} from "@/lib/services/trading/bankr-copy-trading-contract";
import {
  BANKR_COPY_TRADING_API_KEY_ENV_NAMES,
  BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT,
  BANKR_COPY_TRADING_LEGACY_FEE_ACKNOWLEDGEMENT,
  BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT,
} from "@/lib/services/trading/bankr-copy-trading-contract";
import styles from "./ManagedBankrCopyTradingPanel.module.css";

type ApiResponse = Partial<BankrCopyDashboard> & {
  ok: boolean;
  error?: string;
  wallet?: { evmAddress: string; baseUsdcBalance: number };
  apiKeyEnv?: string;
  subscription?: BankrCopySubscription;
  performancePublication?: BankrCopyPerformancePublication;
  performanceRevocation?: { revoked: boolean; revokedAt: string };
  transfer?: { transactionHash: string; amountUsd: number };
};

type SetupStep = 1 | 2 | 3;
type BankrWalletPath = "existing" | "create";

const initialRisk = {
  maxTradeUsd: 5,
  maxDailyUsd: 25,
  scalePercent: 20,
  maxSlippageBps: 100,
};

async function api(body?: unknown): Promise<ApiResponse> {
  const response = await fetch("/api/trading/bankr-copy", body === undefined ? {
    headers: { accept: "application/json" },
    cache: "no-store",
  } : {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => null);
  if (!response) return { ok: false, error: "The local HivemindOS API is unreachable." };
  return response.json().catch(() => ({ ok: false, error: "The local API returned an unreadable response." })) as Promise<ApiResponse>;
}

export function ManagedBankrCopyTradingPanel() {
  const [dashboard, setDashboard] = React.useState<BankrCopyDashboard | null>(null);
  const [walletPath, setWalletPath] = React.useState<BankrWalletPath>("existing");
  const [verifiedApiKeyEnv, setVerifiedApiKeyEnv] = React.useState("");
  const [verifiedWallet, setVerifiedWallet] = React.useState("");
  const [verifiedWalletBalance, setVerifiedWalletBalance] = React.useState<number | null>(null);
  const [targetWallet, setTargetWallet] = React.useState("");
  const [risk, setRisk] = React.useState(initialRisk);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [showSetup, setShowSetup] = React.useState(false);
  const [setupStep, setSetupStep] = React.useState<SetupStep>(1);
  const [riskAcknowledged, setRiskAcknowledged] = React.useState(false);
  const [feeAcknowledged, setFeeAcknowledged] = React.useState(false);
  const activationIdempotencyKey = React.useRef("");

  const refresh = React.useCallback(async () => {
    const result = await api();
    if (!result.ok) {
      setError(result.error || "Could not load hosted copy trading.");
      return;
    }
    const next = result as unknown as BankrCopyDashboard;
    setDashboard(next);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void api().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error || "Could not load hosted copy trading.");
        return;
      }
      const next = result as unknown as BankrCopyDashboard;
      setDashboard(next);
    });
    return () => { cancelled = true; };
  }, []);

  const saveBankrCredential = async (credential: SharedHiveEnvCredential): Promise<SharedHiveEnvCredentialSaveResult> => {
    setError("");
    const result = await api({
      action: "verify",
      apiKeyEnv: credential.envKey,
      ...(credential.source === "manual" ? { apiKey: credential.value, saveToHiveEnv: true } : {}),
    });
    if (!result.ok || !result.wallet) {
      const message = result.error || "Bankr could not verify this key for Wallet API trading.";
      return { ok: false, error: message };
    }
    setVerifiedWallet(result.wallet.evmAddress);
    setVerifiedWalletBalance(result.wallet.baseUsdcBalance);
    setVerifiedApiKeyEnv(result.apiKeyEnv || credential.envKey);
    setSetupStep(2);
    return { ok: true };
  };

  const startMonitor = async () => {
    setBusy("start");
    setError("");
    setNotice("");
    activationIdempotencyKey.current ||= `ctstart_${crypto.randomUUID()}`;
    const result = await api({
      action: "start",
      activationIdempotencyKey: activationIdempotencyKey.current,
      targetWallet,
      connectionKind,
      ...(connectionKind === "existing" ? { apiKeyEnv: verifiedApiKeyEnv } : {}),
      riskAcknowledgement: riskAcknowledged ? BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT : "",
      feeAcknowledgement: feeAcknowledged ? BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT : "",
      ...risk,
    });
    setBusy("");
    if (!result.ok) {
      setError(result.error || "The hosted monitor could not be created.");
      return;
    }
    activationIdempotencyKey.current = "";
    setVerifiedApiKeyEnv("");
    setVerifiedWallet("");
    setVerifiedWalletBalance(null);
    setWalletPath("existing");
    setTargetWallet("");
    setRisk(initialRisk);
    setRiskAcknowledged(false);
    setFeeAcknowledged(false);
    setSetupStep(1);
    setNotice("Activation started. Bankr is paying and HivemindOS is independently verifying the $1 usage minimum; the live monitor activates automatically after settlement.");
    setShowSetup(false);
    await refresh();
  };

  const mutate = async (action: "pause" | "resume" | "cancel", subscriptionId: string) => {
    setBusy(`${action}:${subscriptionId}`);
    setError("");
    const result = await api({ action, subscriptionId });
    setBusy("");
    if (!result.ok) {
      setError(result.error || `Could not ${action} this monitor.`);
      return;
    }
    setNotice(action === "cancel" ? "Monitor canceled and its hosted Bankr credential was erased." : `Monitor ${action === "pause" ? "paused" : "resumed"}.`);
    await refresh();
  };

  const hasSubscriptions = Boolean(dashboard?.subscriptions.length);
  const setupVisible = !hasSubscriptions || showSetup;
  const connectionKind: BankrCopyConnectionKind = walletPath === "create" && dashboard?.partnerProvisioningConfigured
    ? "provisioned"
    : "existing";
  const targetWalletValid = /^0x[0-9a-fA-F]{40}$/.test(targetWallet.trim());
  const riskValid = isWithin(risk.maxTradeUsd, 5, 10_000)
    && isWithin(risk.maxDailyUsd, 5, 50_000)
    && risk.maxDailyUsd >= risk.maxTradeUsd
    && isWithin(risk.scalePercent, 1, 100)
    && isWithin(risk.maxSlippageBps, 10, 500);
  const canContinueWallet = Boolean(
    dashboard?.managedExecutionAvailable
    && (connectionKind === "provisioned" ? dashboard.partnerProvisioningConfigured : verifiedWallet),
  );
  const canContinueRisk = targetWalletValid && riskValid;
  const canSubscribe = Boolean(
    dashboard?.managedExecutionAvailable
    && dashboard.available
    && canContinueRisk
    && canContinueWallet
    && riskAcknowledged
    && feeAcknowledged
    && (connectionKind === "provisioned" || (verifiedWalletBalance ?? 0) >= dashboard.usageMinimumUsd),
  );

  const selectWalletPath = (path: BankrWalletPath) => {
    if (path === walletPath) return;
    setWalletPath(path);
    setVerifiedWallet("");
    setVerifiedWalletBalance(null);
    setVerifiedApiKeyEnv("");
    setError("");
  };

  const openSetup = () => {
    setSetupStep(1);
    setRiskAcknowledged(false);
    setFeeAcknowledged(false);
    setError("");
    setShowSetup(true);
  };

  const closeSetup = () => {
    setSetupStep(1);
    setShowSetup(false);
  };

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Hosted · always on</span>
          <h3>Bankr copy trading</h3>
          <p>HivemindOS monitors the target on Base; Bankr executes from a separate wallet under your limits.</p>
        </div>
        <div className={styles.badges}>
          <Badge tone="honey">$1 minimum + {dashboard?.feePercent ?? 0.5}%</Badge>
          {dashboard && !dashboard.managedExecutionAvailable ? <Badge>Managed unavailable</Badge> : null}
          <Badge tone={dashboard?.liveEnabled ? "live" : undefined}>{dashboard?.liveEnabled ? "Live" : "Live paused"}</Badge>
        </div>
      </div>

      {dashboard && !dashboard.managedExecutionAvailable ? <div className={styles.error}>Managed Bankr execution is unavailable on the hosted gateway right now.</div> : null}
      {dashboard?.pendingRecoveryCount ? <div className={styles.notice}>{dashboard.pendingRecoveryCount} paid subscription activation {dashboard.pendingRecoveryCount === 1 ? "is" : "are"} queued for automatic recovery. HivemindOS retries whenever this dashboard refreshes.</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      {dashboard?.subscriptions.map(({ subscription, performanceShare, events, usageToday, statusError }) => (
        <SubscriptionCard
          key={subscription.id}
          dashboard={dashboard}
          subscription={subscription}
          performanceShare={performanceShare}
          events={events}
          usageToday={usageToday}
          statusError={statusError}
          busy={busy}
          onMutate={mutate}
          onRefresh={refresh}
          onError={setError}
          onNotice={setNotice}
        />
      ))}

      {hasSubscriptions && !showSetup ? (
        <BBtn sm onClick={openSetup}>Add another target</BBtn>
      ) : null}

      {setupVisible ? (
        <div className={styles.setup}>
          <div className={styles.wizardProgress}>
            <span>Step {setupStep} of 3</span>
            <div className={styles.progressTrack} aria-label={`Step ${setupStep} of 3`}>
              {([1, 2, 3] as const).map((step) => (
                <i key={step} data-state={step < setupStep ? "complete" : step === setupStep ? "current" : "upcoming"} />
              ))}
            </div>
          </div>

          {setupStep === 1 ? (
            <div className={styles.wizardStep}>
              <div className={styles.stepHead}><span>1</span><div><b>Choose the Bankr wallet</b><small>Use your Bankr wallet or create a separate execution wallet.</small></div></div>
              <div className={styles.choiceGrid}>
                <button type="button" data-active={walletPath === "existing" ? "true" : undefined} disabled={!dashboard?.managedExecutionAvailable} onClick={() => selectWalletPath("existing")}>
                  <b>I already use Bankr</b>
                  <span>Connect a restricted Wallet API key.</span>
                </button>
                <button
                  type="button"
                  data-active={walletPath === "create" ? "true" : undefined}
                  disabled={!dashboard?.managedExecutionAvailable}
                  onClick={() => selectWalletPath("create")}
                >
                  <b>Create a Bankr wallet</b>
                  <span>{dashboard?.partnerProvisioningConfigured ? "Create a dedicated wallet automatically." : "Create it directly with Bankr, then connect the new Wallet API key here."}</span>
                </button>
              </div>

              {connectionKind === "existing" ? (
                <div className={styles.keyRow}>
                  {walletPath === "create" ? (
                    <p className={styles.walletNote}>
                      Bankr creates the wallet and keeps its signing key non-exportable. <a href="https://bankr.bot/api" target="_blank" rel="noreferrer">Create wallet with Bankr</a>, generate a dedicated Wallet API key, then connect it below.
                    </p>
                  ) : null}
                  <span className={styles.keyLabel}>Bankr Wallet API key</span>
                  <SharedHiveEnvCredentialInput
                    preferredEnvKeys={BANKR_COPY_TRADING_API_KEY_ENV_NAMES}
                    defaultEnvKey={BANKR_COPY_TRADING_API_KEY_ENV_NAMES[0]}
                    disabled={!dashboard?.managedExecutionAvailable}
                    valuePlaceholder="bk_…"
                    saveCredential={saveBankrCredential}
                  />
                  <details className={styles.keyHelp}>
                    <summary>How to create a safe key</summary>
                    <p>Create a dedicated key at <a href="https://bankr.bot/api" target="_blank" rel="noreferrer">bankr.bot/api</a> with Wallet API on, read-only off, Bankr spend limits set, and only the published fee wallet in the EVM recipient allowlist. Continue verifies a selected variable without exposing its value to the browser. Save verifies and stores a newly entered value in Shared Hive Env.</p>
                    {dashboard?.feeRecipient ? <p>Allowed EVM recipient: <code>{dashboard.feeRecipient}</code></p> : null}
                  </details>
                </div>
              ) : (
                <p className={styles.walletNote}>Bankr holds the non-exportable signing key and handles account recovery. No recovery phrase is exposed.</p>
              )}

              <div className={styles.wizardActions}>
                {hasSubscriptions ? <BBtn sm onClick={closeSetup}>Cancel</BBtn> : <span />}
                {connectionKind === "provisioned" ? <BBtn variant="primary" disabled={!canContinueWallet} onClick={() => setSetupStep(2)}>Continue</BBtn> : <span />}
              </div>
            </div>
          ) : null}

          {setupStep === 2 ? (
            <div className={styles.wizardStep}>
              <div className={styles.stepHead}><span>2</span><div><b>Choose the target and limits</b><small>The monitor can copy any eligible new trade as soon as the $1 usage payment is verified.</small></div></div>
              {verifiedWallet ? (
                <div className={(verifiedWalletBalance ?? 0) >= (dashboard?.usageMinimumUsd ?? 1) ? styles.balanceNote : styles.balanceWarning}>
                  <div><span>Bankr wallet on Base</span><b>{shortAddress(verifiedWallet)} · ${(verifiedWalletBalance ?? 0).toFixed(2)} USDC</b></div>
                  <BBtn sm onClick={() => void navigator.clipboard?.writeText(verifiedWallet)}>Copy address</BBtn>
                  {(verifiedWalletBalance ?? 0) < (dashboard?.usageMinimumUsd ?? 1) ? <p>Fund at least ${(dashboard?.usageMinimumUsd ?? 1).toFixed(2)} Base USDC before activation. The wallet also needs enough USDC for copied trades.</p> : null}
                </div>
              ) : null}
              <div className={styles.formGrid}>
                <label className={styles.wide}><span>Target Base wallet</span><input value={targetWallet} onChange={(event) => setTargetWallet(event.target.value)} placeholder="0x…" /></label>
                <NumberField label="Max per trade" value={risk.maxTradeUsd} min={5} max={10_000} step={1} onChange={(value) => setRisk((current) => ({ ...current, maxTradeUsd: value }))} suffix="USD" />
                <NumberField label="Max per day" value={risk.maxDailyUsd} min={5} max={50_000} step={5} onChange={(value) => setRisk((current) => ({ ...current, maxDailyUsd: value }))} suffix="USD" />
                <NumberField label="Copy scale" value={risk.scalePercent} min={1} max={100} step={1} onChange={(value) => setRisk((current) => ({ ...current, scalePercent: value }))} suffix="%" />
                <NumberField label="Max slippage" value={risk.maxSlippageBps} min={10} max={500} step={10} onChange={(value) => setRisk((current) => ({ ...current, maxSlippageBps: value }))} suffix="bps" />
              </div>
              {targetWallet && !targetWalletValid ? <p className={styles.fieldError}>Enter a complete Base wallet address.</p> : null}
              {!riskValid ? <p className={styles.fieldError}>Keep each value within its shown range, with the daily cap at least as high as the trade cap.</p> : null}
              <div className={styles.wizardActions}>
                <BBtn sm onClick={() => setSetupStep(1)}>Back</BBtn>
                <BBtn variant="primary" disabled={!canContinueRisk} onClick={() => setSetupStep(3)}>Continue</BBtn>
              </div>
            </div>
          ) : null}

          {setupStep === 3 ? (
            <div className={styles.wizardStep}>
              <div className={styles.stepHead}><span>3</span><div><b>Review and start live</b><small>The rolling minimum is paid directly from this Bankr wallet, with no card subscription.</small></div></div>
              <div className={styles.reviewGrid}>
                <ReviewItem label="Bankr wallet" value={connectionKind === "existing" ? shortAddress(verifiedWallet) : "Created on activation"} />
                <ReviewItem label="Target" value={shortAddress(targetWallet.trim())} />
                <ReviewItem label="Trade cap" value={`$${risk.maxTradeUsd} USD`} />
                <ReviewItem label="Daily cap" value={`$${risk.maxDailyUsd} USD`} />
                <ReviewItem label="Copy scale" value={`${risk.scalePercent}%`} />
                <ReviewItem label="Max slippage" value={`${risk.maxSlippageBps} bps`} />
              </div>
              <div className={styles.priceSummary}>
                <div><b>${(dashboard?.usageMinimumUsd ?? 1).toFixed(2)} every {dashboard?.usagePeriodDays ?? 30} days, credited toward fees</b><span>Uncapped {dashboard?.feePercent ?? 0.5}% of actual verified copied notional · up to ${(risk.maxTradeUsd * (dashboard?.feePercent ?? 0.5) / 100).toFixed(2)} on a trade at your current cap · skipped and failed trades cost $0</span></div>
              </div>
              <div className={styles.consentList}>
                <label><input type="checkbox" checked={riskAcknowledged} onChange={(event) => setRiskAcknowledged(event.target.checked)} /><span>{BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT}</span></label>
                <label><input type="checkbox" checked={feeAcknowledged} onChange={(event) => setFeeAcknowledged(event.target.checked)} /><span>{BANKR_COPY_TRADING_FEE_ACKNOWLEDGEMENT}</span></label>
              </div>
              {connectionKind === "existing" && (verifiedWalletBalance ?? 0) < (dashboard?.usageMinimumUsd ?? 1) ? <p className={styles.fieldError}>Fund the Bankr wallet with at least ${(dashboard?.usageMinimumUsd ?? 1).toFixed(2)} Base USDC, then go back and reconnect the key to refresh its balance.</p> : null}
              <div className={styles.wizardActions}>
                <BBtn sm disabled={busy === "start"} onClick={() => setSetupStep(2)}>Back</BBtn>
                <BBtn variant="primary" disabled={!canSubscribe || busy === "start"} onClick={startMonitor}>{busy === "start" ? "Activating…" : "Pay $1 & start live"}</BBtn>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.boundary}>Local copy-trading controls remain below for self-hosted wallets. Bankr-managed monitors above run in the hosted Worker even when this app is closed.</div>
    </section>
  );
}

function SubscriptionCard(props: {
  dashboard: BankrCopyDashboard;
  subscription: BankrCopySubscription;
  performanceShare?: BankrCopyPerformanceShare;
  events: BankrCopyDashboard["subscriptions"][number]["events"];
  usageToday?: { signalCount: number; reservedUsd: number; maxDailyUsd: number };
  statusError?: string;
  busy: string;
  onMutate: (action: "pause" | "resume" | "cancel", id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const { subscription } = props;
  const [fundingWalletId, setFundingWalletId] = React.useState(props.dashboard.fundingWallets[0]?.id || "");
  const [amountUsd, setAmountUsd] = React.useState(25);
  const [funding, setFunding] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [liveAcknowledged, setLiveAcknowledged] = React.useState(false);
  const [feeAcknowledged, setFeeAcknowledged] = React.useState(false);
  const [performanceBusy, setPerformanceBusy] = React.useState<"publish" | "revoke" | "">("");
  const [publicPerformanceUrl, setPublicPerformanceUrl] = React.useState("");
  const [limits, setLimits] = React.useState({
    maxTradeUsd: subscription.maxTradeUsd,
    maxDailyUsd: subscription.maxDailyUsd,
    scalePercent: subscription.scalePercent,
    maxSlippageBps: subscription.maxSlippageBps,
  });
  const isPerTrade = subscription.billingModel === "bankr-per-trade";
  const isUsageMinimum = subscription.billingModel === "bankr-usage-minimum";
  const minimumTradeLimit = isUsageMinimum ? 5 : 0.1;
  const maximumTradeLimit = isUsageMinimum ? 10_000 : 100;
  const maximumDailyLimit = isUsageMinimum ? 50_000 : 500;
  const paperTrialComplete = props.events.some((event) => event.receiptStatus === "paper");
  const paperTrialPaused = isPerTrade && subscription.mode === "paper" && subscription.status === "paused" && paperTrialComplete;
  const limitsValid = isWithin(limits.maxTradeUsd, minimumTradeLimit, maximumTradeLimit)
    && isWithin(limits.maxDailyUsd, minimumTradeLimit, maximumDailyLimit)
    && limits.maxDailyUsd >= limits.maxTradeUsd
    && isWithin(limits.scalePercent, 1, 100)
    && isWithin(limits.maxSlippageBps, 10, 500);

  const updateSubscription = async (mode?: "paper" | "live") => {
    setUpdating(true);
    props.onError("");
    const result = await api({
      action: "update",
      subscriptionId: subscription.id,
      ...(mode ? { mode } : {}),
      ...(mode === "live" ? {
        riskAcknowledgement: BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT,
        ...(isPerTrade ? { feeAcknowledgement: BANKR_COPY_TRADING_LEGACY_FEE_ACKNOWLEDGEMENT } : {}),
      } : {}),
      ...limits,
    });
    setUpdating(false);
    if (!result.ok) {
      props.onError(result.error || "Could not update this copy-trading monitor.");
      return;
    }
    if (result.subscription) {
      setLimits({
        maxTradeUsd: result.subscription.maxTradeUsd,
        maxDailyUsd: result.subscription.maxDailyUsd,
        scalePercent: result.subscription.scalePercent,
        maxSlippageBps: result.subscription.maxSlippageBps,
      });
    }
    setLiveAcknowledged(false);
    setFeeAcknowledged(false);
    props.onNotice(mode === "live" ? "Live copy trading and direct per-trade fees are enabled under the updated hard limits." : mode === "paper" ? "The monitor is back in paper mode." : "Copy-trading limits updated.");
    await props.onRefresh();
  };
  const fund = async () => {
    setFunding(true);
    props.onError("");
    const result = await api({
      action: "fund",
      subscriptionId: subscription.id,
      fundingWalletId,
      amountUsd,
      confirmation: "FUND_BANKR_COPY_WALLET",
    });
    setFunding(false);
    if (!result.ok) { props.onError(result.error || "Funding failed."); return; }
    props.onNotice(`Sent $${amountUsd.toFixed(2)} USDC to the Bankr execution wallet.`);
    await props.onRefresh();
  };
  const publishPerformance = async () => {
    setPerformanceBusy("publish");
    props.onError("");
    const result = await api({ action: "publish-performance", subscriptionId: subscription.id });
    setPerformanceBusy("");
    if (!result.ok || !result.performancePublication?.publicUrl) {
      props.onError(result.error || "The public performance link could not be created.");
      return;
    }
    setPublicPerformanceUrl(result.performancePublication.publicUrl);
    props.onNotice(result.performancePublication.rotated
      ? "The previous performance link was revoked and a new link is ready to share."
      : "The verified performance link is ready to share with Bankr or a public dashboard.");
    await props.onRefresh();
  };
  const revokePerformance = async () => {
    setPerformanceBusy("revoke");
    props.onError("");
    const result = await api({ action: "revoke-performance", subscriptionId: subscription.id });
    setPerformanceBusy("");
    if (!result.ok || !result.performanceRevocation) {
      props.onError(result.error || "The public performance link could not be revoked.");
      return;
    }
    setPublicPerformanceUrl("");
    props.onNotice("The public performance link is revoked.");
    await props.onRefresh();
  };
  return (
    <article className={styles.subscription}>
      <div className={styles.subscriptionHead}>
        <div><b>{shortAddress(subscription.targetWallet)} target</b><span>{subscription.bankrConnectionKind === "provisioned" ? "Hivemind-provisioned Bankr wallet" : "Connected Bankr wallet"}</span></div>
        <Badge tone={subscription.status === "active" ? "live" : undefined}>{subscription.status}</Badge>
      </div>
      <div className={styles.metrics}>
        <span><small>Mode</small><b>{subscription.mode}</b></span>
        <span><small>Trade cap</small><b>${subscription.maxTradeUsd}</b></span>
        <span><small>Daily cap</small><b>${subscription.maxDailyUsd}</b></span>
        <span><small>Today</small><b>${props.usageToday?.reservedUsd ?? 0}</b></span>
        <span><small>Service fee</small><b>{isUsageMinimum ? `$${subscription.billing.usageMinimumUsd ?? 1} credit · ${subscription.billing.feePercent ?? props.dashboard.feePercent}%` : subscription.billingModel === "prepaid-period" ? "Prepaid" : `${subscription.billing.feePercent ?? props.dashboard.feePercent}%`}</b></span>
      </div>
      {isUsageMinimum ? <UsagePeriodStatus subscription={subscription} /> : null}
      <div className={styles.performanceShare}>
        <div>
          <span className={styles.eyebrow}>Verified performance feed</span>
          <b>{props.performanceShare?.enabled ? "Public link active" : "Not published"}</b>
          <p>Publishes only HivemindOS-verified copied executions and service fees. Wallet transfers are excluded, and PnL stays unavailable when cost basis or current prices cannot be proven.</p>
          {publicPerformanceUrl ? <code>{publicPerformanceUrl}</code> : null}
        </div>
        <div className={styles.performanceActions}>
          {publicPerformanceUrl ? (
            <>
              <BBtn sm onClick={() => void navigator.clipboard?.writeText(publicPerformanceUrl)}>Copy link</BBtn>
              <a href={publicPerformanceUrl} target="_blank" rel="noreferrer">Open</a>
            </>
          ) : null}
          <BBtn sm disabled={Boolean(performanceBusy) || subscription.status === "canceled"} onClick={publishPerformance}>
            {performanceBusy === "publish" ? "Publishing…" : props.performanceShare?.enabled ? "Rotate link" : "Publish performance"}
          </BBtn>
          {props.performanceShare?.enabled ? <BBtn sm disabled={Boolean(performanceBusy)} onClick={revokePerformance}>{performanceBusy === "revoke" ? "Revoking…" : "Revoke"}</BBtn> : null}
        </div>
      </div>
      <details className={styles.management}>
        <summary>{isUsageMinimum ? "Manage limits" : "Manage mode & limits"}</summary>
        <div className={styles.managementBody}>
          <div className={styles.formGrid}>
            <NumberField label="Max per trade" value={limits.maxTradeUsd} min={minimumTradeLimit} max={maximumTradeLimit} step={isUsageMinimum ? 1 : 0.1} onChange={(value) => setLimits((current) => ({ ...current, maxTradeUsd: value }))} suffix="USD" />
            <NumberField label="Max per day" value={limits.maxDailyUsd} min={minimumTradeLimit} max={maximumDailyLimit} step={isUsageMinimum ? 5 : 1} onChange={(value) => setLimits((current) => ({ ...current, maxDailyUsd: value }))} suffix="USD" />
            <NumberField label="Copy scale" value={limits.scalePercent} min={1} max={100} step={1} onChange={(value) => setLimits((current) => ({ ...current, scalePercent: value }))} suffix="%" />
            <NumberField label="Max slippage" value={limits.maxSlippageBps} min={10} max={500} step={10} onChange={(value) => setLimits((current) => ({ ...current, maxSlippageBps: value }))} suffix="bps" />
          </div>
          {!limitsValid ? <p className={styles.fieldError}>Keep every limit inside its shown range, with the daily cap at least as high as the trade cap.</p> : null}
          <div className={styles.modeControls}>
            <BBtn sm disabled={!limitsValid || updating} onClick={() => updateSubscription()}>{updating ? "Updating…" : "Save limits"}</BBtn>
            {!isUsageMinimum && subscription.mode === "paper" ? (
              props.dashboard.liveEnabled ? (
                <div className={styles.liveGate}>
                  <label>
                    <input type="checkbox" checked={liveAcknowledged} onChange={(event) => setLiveAcknowledged(event.target.checked)} />
                    <span>{BANKR_COPY_TRADING_RISK_ACKNOWLEDGEMENT}</span>
                  </label>
                  {isPerTrade ? <label>
                    <input type="checkbox" checked={feeAcknowledged} onChange={(event) => setFeeAcknowledged(event.target.checked)} />
                    <span>I authorize the published {subscription.billing.feePercent ?? props.dashboard.feePercent}% fee (${(subscription.billing.minimumFeeUsd ?? 0.02).toFixed(2)}–${(subscription.billing.maximumFeeUsd ?? 0.5).toFixed(2)}) after each verified live copied trade.</span>
                  </label> : null}
                  <BBtn variant="primary" sm disabled={!paperTrialComplete || !liveAcknowledged || (isPerTrade && !feeAcknowledged) || !limitsValid || updating} onClick={() => updateSubscription("live")}>Enable live</BBtn>
                  {!paperTrialComplete ? <p>Complete one new paper-mode copy event before live execution can be enabled.</p> : null}
                </div>
              ) : <p className={styles.help}>Live execution is currently paused globally. Paper monitoring continues normally.</p>
            ) : !isUsageMinimum ? <BBtn sm disabled={!limitsValid || updating} onClick={() => updateSubscription("paper")}>Return to paper</BBtn> : null}
          </div>
        </div>
      </details>
      {paperTrialPaused ? <div className={styles.notice}>Paper test complete. Review the event, then open <b>Manage mode &amp; limits</b> to accept the live risk and fee terms, or cancel this monitor.</div> : null}
      {props.statusError ? <div className={styles.error}>{props.statusError}</div> : null}
      <div className={styles.funding}>
        <div><span className={styles.eyebrow}>Fund the Bankr wallet</span><code>{subscription.bankrWallet}</code><p>Send Base USDC for copied trades, the rolling $1 minimum, and any verified percentage fee above the remaining credit. Bankr sponsors Base gas. You can also copy this address and fund it from any wallet.</p></div>
        <BBtn sm onClick={() => void navigator.clipboard?.writeText(subscription.bankrWallet)}>Copy address</BBtn>
        <select value={fundingWalletId} onChange={(event) => setFundingWalletId(event.target.value)}><option value="">Funding wallet</option>{props.dashboard.fundingWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name}</option>)}</select>
        <input type="number" min="1" max="500" value={amountUsd} onChange={(event) => setAmountUsd(Number(event.target.value))} aria-label="USDC funding amount" />
        <BBtn variant="primary" sm disabled={!fundingWalletId || funding} onClick={fund}>{funding ? "Sending…" : "Send USDC"}</BBtn>
      </div>
      <div className={styles.actions}>
        {paperTrialPaused
          ? <BBtn sm disabled>Paper test complete</BBtn>
          : <BBtn sm disabled={Boolean(props.busy)} onClick={() => props.onMutate(subscription.status === "paused" ? "resume" : "pause", subscription.id)}>{subscription.status === "paused" ? "Resume" : "Pause"}</BBtn>}
        <BBtn sm disabled={Boolean(props.busy)} onClick={() => props.onMutate("cancel", subscription.id)}>Cancel & erase key</BBtn>
      </div>
      {props.events.length ? <div className={styles.events}>{props.events.slice(0, 5).map((event) => <div key={event.id}><span>{event.receiptStatus || event.status}</span><b>${event.executedNotionalUsd ?? event.maxTradeUsd}</b><code>{shortAddress(event.sourceTransactionHash)}</code>{event.fee ? <small>Fee ${event.fee.grossAmountUsd?.toFixed(2) ?? event.fee.amountUsd.toFixed(2)} gross{event.fee.usageCreditAppliedUsd ? ` · $${event.fee.usageCreditAppliedUsd.toFixed(2)} credit` : ""}{event.fee.amountUsd > 0 ? ` · $${event.fee.amountUsd.toFixed(2)} charged` : ""} · {event.fee.status}{event.fee.transactionHash ? ` · ${shortAddress(event.fee.transactionHash)}` : ""}</small> : null}{event.receiptError ? <small>{event.receiptError}</small> : null}{event.fee?.error ? <small>{event.fee.error}</small> : null}</div>)}</div> : <p className={styles.help}>Monitoring is active. New source trades appear here after the initial cursor baseline.</p>}
    </article>
  );
}

function UsagePeriodStatus({ subscription }: { subscription: BankrCopySubscription }) {
  const usage = subscription.billing.usagePeriod;
  if (!usage) return <div className={styles.usageStatus}><b>Usage payment pending</b><span>Bankr has not submitted this monitor’s $1 activation payment yet.</span></div>;
  const settled = usage.status === "collected";
  return <div className={settled ? styles.usageStatus : styles.usageWarning}>
    <div><b>{settled ? `$${usage.creditRemainingUsd.toFixed(2)} fee credit remaining` : `Usage payment: ${usage.status.replaceAll("_", " ")}`}</b><span>{settled ? `Current period ends ${formatDate(usage.endsAt)}.` : usage.error || "Waiting for the $1 Base USDC payment to settle."}</span></div>
    {usage.transactionHash ? <a href={`https://base.blockscout.com/tx/${usage.transactionHash}`} target="_blank" rel="noreferrer">View payment</a> : null}
  </div>;
}

function NumberField(props: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return <label><span>{props.label}</span><div className={styles.number}><input type="number" value={props.value} min={props.min} max={props.max} step={props.step} onChange={(event) => props.onChange(Number(event.target.value))} /><small>{props.suffix}</small></div></label>;
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

function isWithin(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "after 30 days";
}

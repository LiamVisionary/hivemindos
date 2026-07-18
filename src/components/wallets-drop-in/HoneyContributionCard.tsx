"use client";

import { useCallback, useEffect, useState } from "react";
import { SkeletonText, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";

type ContributionTier = {
  id: string;
  label: string;
  minimumHoney: number;
  multiplierBps: number;
  multiplier: number;
};

export type HoneyContributionStatus = {
  linked: boolean;
  publicLabel: string | null;
  honey: number;
  sources: {
    verifiedWork: number;
    peerRecognition: number;
    historicalTipSeed: number;
  };
  reviewedContributions: number;
  tier: ContributionTier | null;
  nextTier: (ContributionTier & { honeyNeeded: number }) | null;
  quotaMultiplierBps: number;
  quotaMultiplier: number;
};

export type HoneyContributionStatusAction = () => Promise<({
  ok?: boolean;
  error?: string;
} & Partial<HoneyContributionStatus>) | null | undefined>;

export type HoneyTelegramLinkAction = (code: string) => Promise<{
  ok?: boolean;
  linked?: boolean;
  publicLabel?: string;
  error?: string;
} | null | undefined>;

export type HoneyTelegramLinkIntentAction = () => Promise<{
  ok?: boolean;
  deepLink?: string;
  expiresAt?: string;
  error?: string;
} | null | undefined>;

type HoneyWalletLinkOption = {
  address: string;
  name: string | null;
};

type HoneyWalletLinkStatus = {
  linked: boolean;
  address: string | null;
  gatewayLinked: boolean;
  wallets: HoneyWalletLinkOption[];
};

export type HoneyWalletLinkStatusAction = () => Promise<({
  ok?: boolean;
  error?: string;
} & Partial<HoneyWalletLinkStatus>) | null | undefined>;

export type HoneyWalletLinkAction = (address: string) => Promise<{
  ok?: boolean;
  address?: string;
  gatewayLinked?: boolean;
  gatewayError?: string;
  error?: string;
} | null | undefined>;

export type HoneyContributionActions = {
  onLoadHoneyContributionStatus?: HoneyContributionStatusAction;
  onLoadHoneyWalletLinkStatus?: HoneyWalletLinkStatusAction;
  onLinkHoneyWallet?: HoneyWalletLinkAction;
  onLinkTelegramHoney?: HoneyTelegramLinkAction;
  onCreateTelegramHoneyLinkIntent?: HoneyTelegramLinkIntentAction;
};

export function HoneyContributionCard({
  onLoad,
  onLoadWalletLinkStatus,
  onLinkWallet,
  onLink,
  onCreateLinkIntent,
}: {
  onLoad?: HoneyContributionStatusAction;
  onLoadWalletLinkStatus?: HoneyWalletLinkStatusAction;
  onLinkWallet?: HoneyWalletLinkAction;
  onLink?: HoneyTelegramLinkAction;
  onCreateLinkIntent?: HoneyTelegramLinkIntentAction;
}) {
  const [status, setStatus] = useState<HoneyContributionStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(onLoad));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletLink, setWalletLink] = useState<HoneyWalletLinkStatus | null>(null);
  const [walletLoading, setWalletLoading] = useState(Boolean(onLoadWalletLinkStatus));
  const [selectedWalletAddress, setSelectedWalletAddress] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tapBusy, setTapBusy] = useState(false);
  const [tapWaiting, setTapWaiting] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!onLoad) return;
    setLoading(true);
    setError("");
    try {
      const result = await onLoad();
      setStatus(statusFromResult(result));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Contribution status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [onLoad]);

  const loadWalletLinkStatus = useCallback(async () => {
    if (!onLoadWalletLinkStatus) return;
    setWalletLoading(true);
    setWalletError("");
    try {
      const result = await onLoadWalletLinkStatus();
      const next = walletLinkStatusFromResult(result);
      setWalletLink(next);
      setSelectedWalletAddress((current) => (
        next.wallets.some((wallet) => wallet.address === current)
          ? current
          : defaultWalletSelection(next)
      ));
    } catch (cause) {
      setWalletError(cause instanceof Error ? cause.message : "Wallet link status could not be loaded.");
    } finally {
      setWalletLoading(false);
    }
  }, [onLoadWalletLinkStatus]);

  useEffect(() => {
    if (!onLoad) return;
    let cancelled = false;
    const loadInitialStatus = async () => {
      try {
        const result = await onLoad();
        if (!cancelled) setStatus(statusFromResult(result));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Contribution status could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadInitialStatus();
    return () => {
      cancelled = true;
    };
  }, [onLoad]);

  useEffect(() => {
    if (!onLoadWalletLinkStatus) return;
    let cancelled = false;
    const loadInitialWalletLinkStatus = async () => {
      try {
        const result = await onLoadWalletLinkStatus();
        if (cancelled) return;
        const next = walletLinkStatusFromResult(result);
        setWalletLink(next);
        setSelectedWalletAddress(defaultWalletSelection(next));
      } catch (cause) {
        if (!cancelled) setWalletError(cause instanceof Error ? cause.message : "Wallet link status could not be loaded.");
      } finally {
        if (!cancelled) setWalletLoading(false);
      }
    };
    void loadInitialWalletLinkStatus();
    return () => {
      cancelled = true;
    };
  }, [onLoadWalletLinkStatus]);

  const linkWallet = async () => {
    if (!onLinkWallet || !selectedWalletAddress || walletBusy) return;
    setWalletBusy(true);
    setMessage("");
    setError("");
    setWalletError("");
    try {
      const result = await onLinkWallet(selectedWalletAddress);
      if (!result?.ok) throw new Error(result?.error || "Wallet could not be verified.");
      if (!result.gatewayLinked) throw new Error(result.gatewayError || "The official Honey service did not verify this wallet.");
      setMessage(`Wallet ${shortWalletAddress(result.address || selectedWalletAddress)} verified for official Honey.`);
      await loadWalletLinkStatus();
    } catch (cause) {
      setWalletError(cause instanceof Error ? cause.message : "Wallet could not be verified.");
    } finally {
      setWalletBusy(false);
    }
  };

  const startTapLink = async () => {
    if (!onCreateLinkIntent || tapBusy || tapWaiting) return;
    setTapBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await onCreateLinkIntent();
      if (!result?.ok || !result.deepLink) throw new Error(result?.error || "Telegram link could not be started.");
      window.open(result.deepLink, "_blank", "noopener");
      setTapWaiting(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram link could not be started.");
    } finally {
      setTapBusy(false);
    }
  };

  // While the member is over in Telegram pressing Start, poll the linked
  // status so the card flips to connected the moment the bot completes it.
  useEffect(() => {
    if (!tapWaiting || !onLoad) return;
    let cancelled = false;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 3 * 60_000) {
        setTapWaiting(false);
        setError("Still not connected — tap Connect Telegram to try again, or use the /linkhoney code below.");
        return;
      }
      try {
        const next = statusFromResult(await onLoad());
        if (cancelled || !next.linked) return;
        setStatus(next);
        setTapWaiting(false);
        setMessage(`Connected ${next.publicLabel || "your Telegram account"} to this HONEY workspace.`);
      } catch {
        // Transient status failures shouldn't end the wait; keep polling.
      }
    }, 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tapWaiting, onLoad]);

  const connect = async () => {
    if (!onLink || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const result = await onLink(code.trim());
      if (!result?.ok || !result.linked) throw new Error(result?.error || "Telegram could not be connected.");
      setCode("");
      setMessage(`Connected ${result.publicLabel || "your Telegram account"} to this HONEY workspace.`);
      await loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram could not be connected.");
    } finally {
      setBusy(false);
    }
  };

  const walletVerified = walletLink?.gatewayLinked === true;

  return (
    <div className="fb-card pad" style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div>
        <span className="fb-eyebrow">HONEY · one cumulative total</span>
        <div style={{ marginTop: 5, fontSize: 15, fontWeight: 500 }}>Grow your HONEY into free agent usage</div>
      </div>
      <p style={{ margin: 0, maxWidth: 720, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
        HONEY from verified work, peer recognition, and the historical launch seed accrues into one lifetime total. HIVE stake and HONEY benefits use whichever multiplier is higher; they never stack.
      </p>

      {loading ? (
        <div role="status" aria-label="Loading HONEY contribution status" style={{ padding: "6px 0" }}>
          <SkeletonText lines={3} />
        </div>
      ) : status ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <ContributionMetric label="lifetime HONEY" value={formatHoney(status.honey)} />
            <ContributionMetric label="reviewed missions" value={String(status.reviewedContributions)} />
            <ContributionMetric
              label="free agent allowance"
              value={`${formatMultiplier(status.quotaMultiplier)}×`}
              tone={status.quotaMultiplier > 1 ? "var(--honey)" : undefined}
            />
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, color: "var(--fg-2)", fontSize: 12.5, lineHeight: 1.55 }}>
            {status.tier ? (
              <><strong style={{ fontWeight: 600 }}>{status.tier.label}</strong> is active from your HONEY total.</>
            ) : (
              <>The first benefit unlocks at 10 HONEY.</>
            )}
            {status.nextTier ? ` Earn ${formatHoney(status.nextTier.honeyNeeded)} more to reach ${status.nextTier.label} at ${formatMultiplier(status.nextTier.multiplier)}×.` : " You have reached the maximum 2× HONEY benefit."}
            <div style={{ marginTop: 6, color: "var(--fg-3)" }}>
              Sources: verified work {formatHoney(status.sources.verifiedWork)} · peer recognition {formatHoney(status.sources.peerRecognition)} · historical seed {formatHoney(status.sources.historicalTipSeed)}. These labels are provenance only; every HONEY counts equally.
            </div>
          </div>
          {status.linked ? (
            <div style={{ color: "var(--live)", fontSize: 12.5 }}>
              Contribution identity connected{status.publicLabel ? ` as ${status.publicLabel}` : ""}.
            </div>
          ) : null}
        </>
      ) : null}

      {!loading && !status?.linked ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>1. Verify a wallet</div>
            <p style={{ margin: 0, maxWidth: 720, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
              Choose a local wallet HivemindOS can sign with. The one-time proof confirms you control the address; it does not move funds or expose the key.
            </p>
            {walletLoading ? (
              <div role="status" aria-label="Loading wallets" style={{ maxWidth: 520 }}><SkeletonText lines={1} /></div>
            ) : walletVerified ? (
              <div style={{ color: "var(--live)", fontSize: 12.5 }}>
                Wallet verified{walletLink.address ? ` · ${shortWalletAddress(walletLink.address)}` : ""}.
              </div>
            ) : walletLink?.wallets.length ? (
              <div style={{ display: "flex", gap: 9, alignItems: "flex-end", flexWrap: "wrap" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 280 }}>
                  <span style={{ color: "var(--fg-3)", fontSize: 11 }}>Wallet to verify</span>
                  <select className="fb-select" value={selectedWalletAddress} onChange={(event) => setSelectedWalletAddress(event.target.value)}>
                    <option value="" disabled>Choose a wallet</option>
                    {walletLink.wallets.map((wallet) => (
                      <option key={wallet.address} value={wallet.address}>{walletOptionLabel(wallet)}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="fb-btn primary" disabled={walletBusy || !selectedWalletAddress} onClick={() => void linkWallet()}>
                  {walletBusy ? <><Spinner size={13} /> Verifying</> : walletLink.linked ? "Retry wallet verification" : "Sign & link wallet"}
                </button>
              </div>
            ) : (
              <div style={{ color: "var(--danger)", fontSize: 12.5 }}>
                No signable EVM wallet is stored locally. Create or import one in Wallets first.
              </div>
            )}
            {walletError ? <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>{walletError}</div> : null}
          </div>

          {walletVerified ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <div style={{ color: "var(--fg-2)", fontSize: 12.5, fontWeight: 600 }}>2. Connect Telegram</div>
              {onCreateLinkIntent ? (
                <>
                  <p style={{ margin: 0, maxWidth: 720, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
                    Tap the button, then press <strong>Start</strong> in Telegram — that&apos;s it. Any HONEY already banked to your Telegram account transfers automatically.
                  </p>
                  {tapWaiting ? (
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", color: "var(--fg-2)", fontSize: 12.5 }}>
                      <Spinner size={13} /> Waiting for you to press Start in Telegram…
                      <button type="button" className="fb-btn" onClick={() => setTapWaiting(false)}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" className="fb-btn primary" disabled={tapBusy} onClick={() => void startTapLink()} style={{ alignSelf: "flex-start" }}>
                      {tapBusy ? <><Spinner size={13} /> Starting</> : "Connect Telegram"}
                    </button>
                  )}
                </>
              ) : null}
              <details>
                <summary style={{ color: "var(--fg-3)", fontSize: 12, cursor: "pointer" }}>
                  {onCreateLinkIntent ? "Prefer a code? Send /linkhoney to the bot and enter it here" : "Send /linkhoney to the HIVE Telegram bot, then enter its one-time code here"}
                </summary>
                <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 250 }}>
                    <span style={{ color: "var(--fg-3)", fontSize: 11 }}>One-time Telegram code</span>
                    <input
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      placeholder="HNY_XXXXXXXXXX"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={14}
                      style={{ border: "1px solid var(--line-2)", borderRadius: 9, background: "var(--panel-hi)", color: "var(--fg)", padding: "9px 11px", fontFamily: "var(--f-mono)", fontSize: 12.5 }}
                    />
                  </label>
                  <button type="button" className="fb-btn primary" disabled={busy || !/^HNY_[A-F0-9]{10}$/.test(code.trim())} onClick={() => void connect()} style={{ alignSelf: "flex-end" }}>
                    {busy ? <><Spinner size={13} /> Connecting</> : "Connect with code"}
                  </button>
                </div>
              </details>
            </div>
          ) : null}
        </>
      ) : null}
      {message ? <div style={{ color: "var(--live)", fontSize: 12.5 }}>{message}</div> : null}
      {error ? <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div> : null}
    </div>
  );
}

function ContributionMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "11px 12px", background: "var(--panel-hi)" }}>
      <div style={{ color: tone || "var(--fg)", fontFamily: "var(--f-mono)", fontSize: 16, fontWeight: 600 }}>{value}</div>
      <div style={{ color: "var(--fg-4)", fontSize: 10.5, marginTop: 4 }}>{label}</div>
    </div>
  );
}

function statusFromResult(result: Awaited<ReturnType<HoneyContributionStatusAction>>): HoneyContributionStatus {
  if (!result?.ok || typeof result.linked !== "boolean") {
    throw new Error(result?.error || "Contribution status could not be loaded.");
  }
  return {
    linked: result.linked,
    publicLabel: result.publicLabel ?? null,
    honey: result.honey ?? 0,
    sources: result.sources ?? { verifiedWork: 0, peerRecognition: 0, historicalTipSeed: 0 },
    reviewedContributions: result.reviewedContributions ?? 0,
    tier: result.tier ?? null,
    nextTier: result.nextTier ?? null,
    quotaMultiplierBps: result.quotaMultiplierBps ?? 10_000,
    quotaMultiplier: result.quotaMultiplier ?? 1,
  };
}

function walletLinkStatusFromResult(result: Awaited<ReturnType<HoneyWalletLinkStatusAction>>): HoneyWalletLinkStatus {
  if (!result?.ok || typeof result.linked !== "boolean" || typeof result.gatewayLinked !== "boolean" || !Array.isArray(result.wallets)) {
    throw new Error(result?.error || "Wallet link status could not be loaded.");
  }
  return {
    linked: result.linked,
    address: typeof result.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(result.address) ? result.address.toLowerCase() : null,
    gatewayLinked: result.gatewayLinked,
    wallets: result.wallets.flatMap((wallet) => (
      wallet && typeof wallet.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(wallet.address)
        ? [{ address: wallet.address.toLowerCase(), name: typeof wallet.name === "string" && wallet.name.trim() ? wallet.name.trim() : null }]
        : []
    )),
  };
}

function defaultWalletSelection(status: HoneyWalletLinkStatus): string {
  const linkedWallet = status.wallets.find((wallet) => wallet.address === status.address);
  if (linkedWallet) return linkedWallet.address;
  return status.wallets.length === 1 ? status.wallets[0]?.address ?? "" : "";
}

function walletOptionLabel(wallet: HoneyWalletLinkOption) {
  return wallet.name ? `${wallet.name} · ${shortWalletAddress(wallet.address)}` : shortWalletAddress(wallet.address);
}

function shortWalletAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatHoney(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMultiplier(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

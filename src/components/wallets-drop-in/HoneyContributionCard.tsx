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

export type HoneyContributionActions = {
  onLoadHoneyContributionStatus?: HoneyContributionStatusAction;
  onLinkTelegramHoney?: HoneyTelegramLinkAction;
};

export function HoneyContributionCard({
  onLoad,
  onLink,
}: {
  onLoad?: HoneyContributionStatusAction;
  onLink?: HoneyTelegramLinkAction;
}) {
  const [status, setStatus] = useState<HoneyContributionStatus | null>(null);
  const [loading, setLoading] = useState(Boolean(onLoad));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
          <p style={{ margin: 0, maxWidth: 720, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
            First link a HivemindOS wallet by signing the one-time proof message. That proves you control the address; it does not move funds or expose the key. Then send <code>/linkhoney</code> to the HIVE Telegram bot and enter its one-time code here.
          </p>
          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
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
              {busy ? <><Spinner size={13} /> Connecting</> : "Connect Telegram"}
            </button>
          </div>
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

function formatHoney(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMultiplier(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

"use client";
import React from "react";
import { CLAWBANK_OPEN_EVENT, CLAWBANK_UPDATED_EVENT } from "@/lib/utils/clawbank-events";

/**
 * Read-only ClawBank account status for the Rails panel. ClawBank is
 * deliberately NOT a WalletRailId — no routing, no agent attachment; this card
 * only surfaces readiness (credential, KYC, trading, wallet) from
 * GET /api/clawbank and offers the guided setup when unconfigured. Money- and
 * entity-moving ClawBank actions stay behind the confirmation-gated agent
 * tools (clawbank_* MCP tools / /api/clawbank/* routes).
 */

type ClawBankStatusPayload = {
  ok?: boolean;
  configured?: boolean;
  ready?: boolean;
  error?: string;
  me?: {
    email?: string;
    kycApproved?: boolean;
    tradingEnabled?: boolean;
    bridgeCustomerConfigured?: boolean;
    wallet?: { address?: string; chain?: string; provisioned?: boolean };
  } | null;
};

function shortAddr(address: string) {
  return address.length <= 14 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ClawBankStatusCard() {
  const [status, setStatus] = React.useState<ClawBankStatusPayload | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/clawbank", { cache: "no-store", signal });
      const data = await res.json().catch(() => null) as ClawBankStatusPayload | null;
      setStatus(data ?? { ok: false, error: "ClawBank status is unavailable." });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus({ ok: false, error: "ClawBank status is unavailable." });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    // Deferred like ConnectionsPanel's initial refresh: the set-state-in-effect
    // rule forbids kicking a state-setting fetch synchronously in the effect body.
    const timer = window.setTimeout(() => void refresh(controller.signal), 0);
    const onUpdated = () => void refresh();
    window.addEventListener(CLAWBANK_UPDATED_EVENT, onUpdated);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      window.removeEventListener(CLAWBANK_UPDATED_EVENT, onUpdated);
    };
  }, [refresh]);

  const configured = Boolean(status?.configured);
  const ready = Boolean(status?.ready);
  const me = status?.me ?? null;
  const badge = loading ? null : !configured ? { tone: "honey", text: "Set up" } : ready ? { tone: "live", text: "Ready" } : { tone: "honey", text: "Check failed" };

  return (
    <div className="fw-railcard">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span className="fb-tile" style={{ width: 42, height: 42 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drop-in uses plain img tiles */}
          <img src="/icons/runtimes/clawbank.svg" alt="" aria-hidden width={24} height={24} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16 }}>ClawBank</span>
            {badge ? <span className={`fb-badge ${badge.tone}`}>{badge.text}</span> : null}
          </div>
          <div style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>Banking · status only, not a payment rail</div>
          <p style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, margin: "8px 0 0" }}>
            Bank account, self-custody wallet, trading, LLC formation, and USD off-ramp for agents. Actions run through confirmation-gated agent tools.
          </p>
        </div>
      </div>
      {loading ? (
        <div role="status" aria-label="Checking ClawBank status" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-3)", fontSize: 12 }}>
          <span className="fw-loader"><i /><i /><i /></span> Checking account status
        </div>
      ) : (
        <div className="fw-kv">
          <div><span>Credential</span><strong className="fw-mono" style={{ color: configured ? "var(--fg)" : "var(--honey)" }}>{configured ? "Present" : "Missing"}</strong></div>
          <div><span>KYC</span><strong style={{ color: me?.kycApproved ? "var(--live)" : "var(--fg-2)" }}>{me ? (me.kycApproved ? "Approved" : "Pending") : "—"}</strong></div>
          <div><span>Trading</span><strong style={{ color: me?.tradingEnabled ? "var(--live)" : "var(--fg-2)" }}>{me ? (me.tradingEnabled ? "Enabled" : "Off") : "—"}</strong></div>
          <div><span>Wallet</span><strong className="fw-mono">{me?.wallet?.address ? `${shortAddr(me.wallet.address)}${me.wallet.chain ? ` · ${me.wallet.chain}` : ""}` : "—"}</strong></div>
        </div>
      )}
      {!loading && configured && !ready && status?.error ? (
        <span style={{ fontSize: 11, color: "var(--honey)" }}>{status.error}</span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <span style={{ fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--f-mono)", minWidth: 0, overflowWrap: "anywhere" }}>
          {loading ? "" : configured ? (me?.email || "Connected") : "Give your agents a bank."}
        </span>
        {!loading && !configured ? (
          <button type="button" className="fb-btn primary sm" onClick={() => window.dispatchEvent(new Event(CLAWBANK_OPEN_EVENT))}>
            Set up ClawBank
          </button>
        ) : (
          <button type="button" className="fb-btn ghost sm" onClick={() => { setLoading(true); void refresh(); }}>
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}

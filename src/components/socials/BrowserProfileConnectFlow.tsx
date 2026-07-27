"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MonitorSmartphone, RefreshCcw } from "lucide-react";

/**
 * Managed browser-profile connect flow (Facebook Marketplace rail), shared by
 * the Socials connect modal and the Marketplace view. Three steps:
 *
 *   1. intro — explains the managed profile; the session will live on the
 *      machine serving this dashboard (v1: connecting from another machine
 *      means opening the dashboard there).
 *   2. signing-in — a headed browser window opened under the persistent
 *      profile; we poll the probe endpoint until the session reads signed-in.
 *   3. connected — offer the initial catalog import, then finish.
 *
 * All calls go through /api/marketplace/connect; no secrets ever transit this
 * component — the sign-in happens inside the opened browser window.
 */

type FlowStep = "intro" | "signing-in" | "connected" | "error";

export type BrowserProfileConnectResult = { accountId: string; importCatalog: boolean };

const PROBE_INTERVAL_MS = 3_000;

/** Small local spinner (mirrors the app's canonical inline spinner look; keyframes injected once). */
function InlineSpinner({ size = 13 }: { size?: number }) {
  return (
    <>
      <style>{`@keyframes bpcSpin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .bpc-spin { animation: none !important; opacity: 0.6; } }`}</style>
      <span
        className="bpc-spin"
        aria-hidden
        style={{
          display: "inline-block", width: size, height: size, borderRadius: "50%",
          border: "2px solid color-mix(in srgb, currentColor 24%, transparent)",
          borderTopColor: "currentColor", animation: "bpcSpin 0.66s linear infinite",
          verticalAlign: "-0.14em", flexShrink: 0,
        }}
      />
    </>
  );
}

function StepRow({ state, children }: { state: "done" | "active" | "todo"; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, opacity: state === "todo" ? 0.55 : 1 }}>
      <span style={{ width: 18, height: 18, display: "inline-grid", placeItems: "center", flexShrink: 0 }} role="status" aria-label={state === "active" ? "In progress" : undefined}>
        {state === "done" ? <Check aria-hidden width={15} height={15} /> : state === "active" ? <InlineSpinner /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", opacity: 0.4 }} />}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function BrowserProfileConnectFlow({
  provider,
  providerLabel,
  accountId: existingAccountId,
  onDone,
  onCancel,
}: {
  provider: string;
  providerLabel: string;
  /** Reconnect flow for an existing account (skips creation). */
  accountId?: string;
  onDone: (result: BrowserProfileConnectResult) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<FlowStep>("intro");
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(existingAccountId ?? "");
  const [machineName, setMachineName] = useState("");
  const [probeDetail, setProbeDetail] = useState<string | null>(null);
  const [importCatalog, setImportCatalog] = useState(true);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const startLogin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketplace/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-login", provider, ...(accountId ? { accountId } : {}) }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        error?: string;
        account?: { id: string; machine?: { machineName?: string } };
      };
      if (!aliveRef.current) return;
      if (!payload.ok || !payload.account) {
        setError(payload.error ?? `HTTP ${res.status}`);
        setStep("error");
        return;
      }
      setAccountId(payload.account.id);
      setMachineName(payload.account.machine?.machineName ?? "");
      setStep("signing-in");
    } catch (fetchError) {
      if (!aliveRef.current) return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      setStep("error");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [provider, accountId]);

  // Poll the probe while the user signs in inside the headed window.
  useEffect(() => {
    if (step !== "signing-in" || !accountId) return;
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/marketplace/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // passive: read-only sign-in check — never navigates the tab the user is signing in on.
          body: JSON.stringify({ action: "probe", accountId, passive: true }),
        });
        const payload = (await res.json()) as { ok?: boolean; status?: string; detail?: string; error?: string };
        if (cancelled) return;
        if (payload.ok && payload.status === "connected") {
          setStep("connected");
          setProbeDetail(null);
          return;
        }
        setProbeDetail(payload.detail ?? payload.error ?? null);
      } catch {
        // transient — keep polling
      }
    };
    const timer = window.setInterval(() => void probe(), PROBE_INTERVAL_MS);
    const kickoff = window.setTimeout(() => void probe(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(kickoff);
    };
  }, [step, accountId]);

  const finish = async () => {
    setBusy(true);
    try {
      await onDone({ accountId, importCatalog });
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {step === "intro" || step === "error" ? (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 11, background: "color-mix(in srgb, currentColor 8%, transparent)", flexShrink: 0 }}>
              <MonitorSmartphone aria-hidden width={19} height={19} />
            </span>
            <div style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.9 }}>
              You sign in to {providerLabel} once, inside a dedicated browser window that opens on this machine. The signed-in
              session stays in a managed browser profile here — agents reuse it for listings and messages, and your password is
              never seen or stored by HivemindOS.
            </div>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.65 }}>
            The session lives on the machine you connect from, so that machine handles the marketplace work. To host it on a
            different machine, open this dashboard there and connect instead.
          </div>
          {step === "error" && error ? (
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--danger, #e58e85)" }}>{error}</div>
          ) : null}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} style={{ padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid color-mix(in srgb, currentColor 22%, transparent)", color: "inherit", fontSize: 12.5, cursor: "pointer" }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void startLogin()} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 10, background: "var(--honey, #e7b45c)", border: "1px solid var(--honey, #e7b45c)", color: "var(--btn-fg, #1a1305)", fontSize: 13, fontWeight: 500, cursor: busy ? "default" : "pointer" }}>
              {busy ? <InlineSpinner /> : null}
              {step === "error" ? "Try again" : "Open sign-in window"}
            </button>
          </div>
        </>
      ) : null}

      {step === "signing-in" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <StepRow state="done">Managed browser profile ready{machineName ? ` on ${machineName}` : ""}</StepRow>
            <StepRow state="done">Sign-in window opened</StepRow>
            <StepRow state="active">Waiting for you to sign in to {providerLabel} in that window…</StepRow>
          </div>
          {probeDetail ? <div style={{ fontSize: 12, lineHeight: 1.55, opacity: 0.65 }}>{probeDetail}</div> : null}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel} style={{ padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid color-mix(in srgb, currentColor 22%, transparent)", color: "inherit", fontSize: 12.5, cursor: "pointer" }}>
              Close
            </button>
            <button type="button" disabled={busy} onClick={() => void startLogin()} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 10, background: "transparent", border: "1px solid color-mix(in srgb, currentColor 30%, transparent)", color: "inherit", fontSize: 12.5, cursor: "pointer" }}>
              <RefreshCcw aria-hidden width={13} height={13} />
              Reopen the window
            </button>
          </div>
        </>
      ) : null}

      {step === "connected" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <StepRow state="done">Signed in to {providerLabel}</StepRow>
            <StepRow state="done">Session saved in the managed profile{machineName ? ` on ${machineName}` : ""}</StepRow>
          </div>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={importCatalog} onChange={(event) => setImportCatalog(event.target.checked)} style={{ marginTop: 2 }} />
            <span>
              Import my existing Marketplace listings
              <span style={{ display: "block", fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>
                The agent catalogues everything already listed on your account and monitors all of it.
              </span>
            </span>
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button type="button" disabled={busy} onClick={() => void finish()} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 10, background: "var(--honey, #e7b45c)", border: "1px solid var(--honey, #e7b45c)", color: "var(--btn-fg, #1a1305)", fontSize: 13, fontWeight: 500, cursor: busy ? "default" : "pointer" }}>
              {busy ? <InlineSpinner /> : <Check aria-hidden width={14} height={14} />}
              Finish
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

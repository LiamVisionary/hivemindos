"use client";

import React from "react";

import { ConnectionSetupModal } from "@/features/integrations/ConnectionsPanel";
import type { CompanyIntegrationBinding } from "@/lib/types/company";
import type { ConnectionsPayload } from "@/lib/types/integrations";
import { Panel, SectionLabel, Spinner } from "./primitives";

type ErrorPayload = { ok?: boolean; error?: string };

export function CompanyConnectionsPanel({ companyId, companyName, bindings, onRefresh }: {
  companyId: string;
  companyName: string;
  bindings?: CompanyIntegrationBinding[];
  onRefresh?: () => void;
}) {
  const savedConnectionId = bindings?.find((binding) => binding.providerKey === "meta-messaging")?.connectionId ?? "";
  const [payload, setPayload] = React.useState<ConnectionsPayload | null>(null);
  const [selected, setSelected] = React.useState(savedConnectionId);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [setupOpen, setSetupOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/integrations/connections", { cache: "no-store" });
        const data = await response.json().catch(() => null) as (ConnectionsPayload & ErrorPayload) | null;
        if (!response.ok || !data || data.ok === false) throw new Error(data?.error || "Could not load integrations.");
        if (!cancelled) setPayload(data);
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load integrations.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const provider = payload?.providers.find((entry) => entry.key === "meta-messaging");
  const accounts = provider?.connectionOptions ?? [];
  const selectedAccount = accounts.find((account) => account.id === selected);
  const changed = selected !== savedConnectionId;

  function handleSetupUpdated(next: ConnectionsPayload, note?: string) {
    const priorIds = new Set(accounts.map((account) => account.id));
    const nextProvider = next.providers.find((entry) => entry.key === "meta-messaging");
    const newAccount = nextProvider?.connectionOptions?.find((account) => account.verified && !priorIds.has(account.id));
    setPayload(next);
    if (newAccount) {
      setSelected(newAccount.id);
      setMessage(`${newAccount.label} is connected. Save it for ${companyName} below.`);
    } else if (!nextProvider?.connectionOptions?.some((account) => account.id === selected && account.verified)) {
      setSelected("");
      setMessage(note || "The Meta connection changed. Choose the account this company should use.");
    } else if (note) {
      setMessage(note);
    }
  }

  async function save() {
    if (busy || !changed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-integration-binding", id: companyId, providerKey: "meta-messaging", connectionId: selected || undefined }),
      });
      const data = await response.json().catch(() => null) as ErrorPayload | null;
      if (!response.ok || !data || data.ok === false) throw new Error(data?.error || "Could not save the company connection.");
      setMessage(selectedAccount ? `${companyName} will use ${selectedAccount.label}.` : `Meta messaging removed from ${companyName}.`);
      onRefresh?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the company connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <SectionLabel right={<span style={{ color: "var(--fg-4)" }}>company-scoped</span>}>Connections</SectionLabel>
      <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
        <div style={{ display: "grid", gap: 12, padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span aria-hidden style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", color: "#8aa4ff", border: "1px solid color-mix(in srgb, #5b7ce2 45%, transparent)", background: "color-mix(in srgb, #5b7ce2 14%, transparent)", fontFamily: "var(--f-mono)", fontSize: 11 }}>Me</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 600 }}>Meta inbox setup</div>
              <p style={{ margin: "5px 0 0", color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
                Save and assign a Facebook Page or Instagram professional inbox to this company. This does not add a working outreach channel yet: message sync and replies are not implemented, and Meta&rsquo;s API cannot start cold DMs to arbitrary prospects.
              </p>
            </div>
          </div>

          {loading ? (
            <div role="status" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11 }}><Spinner size={13} /> Checking connected Meta inboxes…</div>
          ) : (
            <label style={{ display: "grid", gap: 7, color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.05 }}>
              Account used by {companyName}
              <select value={selected} onChange={(event) => { setSelected(event.target.value); setMessage(""); }} style={{ width: "100%", padding: "10px 11px", borderRadius: 8, border: "1px solid var(--line-2)", background: "var(--panel)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13, textTransform: "none", letterSpacing: 0 }}>
                <option value="">Do not use Meta messaging</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id} disabled={!account.verified}>
                    {account.label}{account.detail ? ` — ${account.detail}` : ""}{account.verified ? "" : " — needs attention"}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!loading && accounts.length === 0 ? <div style={{ color: "var(--honey)", fontSize: 12, lineHeight: 1.55 }}>Connect a Meta business inbox here, then select it for this company.</div> : null}

          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void save()} disabled={busy || loading || !changed || Boolean(selected && !selectedAccount?.verified)} className="zhc-btn-ghost" style={{ cursor: busy || loading || !changed ? "not-allowed" : "pointer", border: "1px solid var(--honey-line)", background: "var(--honey-soft)", color: "var(--honey)", borderRadius: 8, padding: "8px 13px", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, opacity: busy || loading || !changed ? 0.55 : 1 }}>
              {busy ? "Saving…" : "Save for company"}
            </button>
            <button type="button" onClick={() => setSetupOpen(true)} disabled={loading || !provider} className="zhc-btn-ghost" style={{ cursor: loading || !provider ? "not-allowed" : "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-2)", borderRadius: 8, padding: "8px 13px", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 500, opacity: loading || !provider ? 0.55 : 1 }}>
              {accounts.length ? "Connect another Meta account" : "Connect Meta account"}
            </button>
          </div>

          <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.55 }}>
            For WEBS first contact, use verified email, phone, or a manual social message. A future Meta reply channel can only continue conversations after the prospect messages your connected account.
          </div>
          {message ? <div role="status" style={{ color: message.includes("Could not") || message.includes("not connected") ? "var(--danger)" : "var(--fg-2)", fontSize: 11.5 }}>{message}</div> : null}
        </div>
      </div>
      {setupOpen && provider ? (
        <ConnectionSetupModal
          provider={provider}
          initialTab="connect"
          onClose={() => setSetupOpen(false)}
          onUpdated={handleSetupUpdated}
        />
      ) : null}
    </Panel>
  );
}

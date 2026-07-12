"use client";

import { useState } from "react";
import { Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";

export type HoneyTelegramLinkAction = (code: string) => Promise<{
  ok?: boolean;
  linked?: boolean;
  publicLabel?: string;
  error?: string;
} | null | undefined>;

export function HoneyTelegramLinkCard({ onLink }: { onLink?: HoneyTelegramLinkAction }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Telegram could not be connected.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fb-card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <span className="fb-eyebrow">Telegram · contribution identity</span>
        <div style={{ marginTop: 5, fontSize: 15, fontWeight: 500 }}>Connect reviewed Telegram work to HONEY</div>
      </div>
      <p style={{ margin: 0, maxWidth: 680, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.55 }}>
        Send <code>/linkhoney</code> to the HIVE Telegram bot, then enter the one-time code here. A signature-verified wallet must already be linked to this workspace.
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
      {message ? <div style={{ color: "var(--live)", fontSize: 12.5 }}>{message}</div> : null}
      {error ? <div role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</div> : null}
    </div>
  );
}

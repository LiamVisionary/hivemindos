"use client";

/* SlideOver.tsx — a right-docked panel with backdrop. Hosts the launch composer
   and the publish flow. Closes on backdrop click or Escape. */

import React from "react";
import { Icon } from "./icons";

export function SlideOver({ open, onClose, title, sub, wide, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  wide?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="so-backdrop" onClick={onClose} />
      <div className={"so-panel sim-root" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="so-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 4, lineHeight: 1.45 }}>{sub}</div>}
          </div>
          <button className="so-x" onClick={onClose} aria-label="Close"><Icon name="close" size={15} sw={2} /></button>
        </div>
        <div className="so-body fr-scroll">{children}</div>
        {footer && <div className="so-foot">{footer}</div>}
      </div>
    </>
  );
}

// ── small form helpers (shared by composer + publish) ───────────────────────
export function FLbl({ children }: { children: React.ReactNode }) { return <span className="so-lbl">{children}</span>; }
export function FInput({ value, onChange, mono, placeholder }: { value: string; onChange?: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return <input className={"fb-field" + (mono ? " fb-mono" : "")} value={value} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} />;
}
export function FArea({ value, onChange, rows = 3, placeholder }: { value: string; onChange?: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className="fb-textarea" rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} style={{ resize: "vertical" }} />;
}
export function FPills({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => <button key={o} type="button" className="so-pill" data-on={value === o ? "" : undefined} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  );
}

// ── the editable X thread (used by composer + publish) ──────────────────────
export function XEditor({ initial, report }: { initial?: string[]; report?: (text: string) => void }) {
  const [tweets, setTweets] = React.useState<string[]>(initial || [
    "the hive is humming — 24 agents shipped, 412 vault files reconciled, zero pages",
  ]);
  React.useEffect(() => { report?.(`Draft X thread (${tweets.length} tweet${tweets.length === 1 ? "" : "s"}): ${tweets.join(" / ")}`); }, [tweets, report]);
  const update = (i: number, v: string) => setTweets((arr) => arr.map((t, j) => j === i ? v : t));
  const add = () => setTweets((arr) => [...arr, ""]);
  const remove = (i: number) => setTweets((arr) => arr.length === 1 ? arr : arr.filter((_, j) => j !== i));
  return (
    <section style={{ display: "grid", gap: 10, padding: "14px 16px", borderRadius: 12, border: "1px solid rgb(207,217,222)", background: "#fff", color: "#0f1419", fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#536471", letterSpacing: "0.12em", textTransform: "uppercase" }}>Drafting · @hivemindos</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "#536471" }}>{tweets.length} tweet{tweets.length === 1 ? "" : "s"}</span>
      </div>
      {tweets.map((t, i) => (
        <div key={i} style={{ position: "relative", display: "grid", gridTemplateColumns: "40px 1fr", gap: 12, alignItems: "start" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 999, background: "#1d9bf0", color: "#fff", fontSize: 12, fontWeight: 700 }}>HM</div>
          {i < tweets.length - 1 && <span style={{ position: "absolute", left: 19, top: 44, bottom: -6, width: 2, background: "rgb(207,217,222)" }} />}
          <div style={{ minWidth: 0 }}>
            <textarea value={t} onChange={(e) => update(i, e.target.value)} placeholder={i === 0 ? "What's happening?" : "Continue the thread…"} rows={i === 0 ? 3 : 2}
              style={{ width: "100%", border: 0, outline: 0, resize: "none", background: "transparent", color: "#0f1419", fontFamily: "inherit", fontSize: i === 0 ? 17 : 14, lineHeight: 1.32 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid rgb(239,243,244)", paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontSize: 12, color: t.length > 280 ? "#f91880" : "#536471" }}>{t.length}/280</span>
              {tweets.length > 1 && <button onClick={() => remove(i)} aria-label="Remove tweet" style={{ width: 24, height: 24, padding: 0, borderRadius: 999, cursor: "pointer", background: "transparent", border: "1px solid rgb(207,217,222)", color: "#536471" }}>×</button>}
            </div>
          </div>
        </div>
      ))}
      <button onClick={add} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, cursor: "pointer", border: "1px solid rgb(207,217,222)", background: "#fff", color: "#1d9bf0", fontSize: 13, fontWeight: 700, width: "fit-content" }}>＋ Add tweet</button>
    </section>
  );
}

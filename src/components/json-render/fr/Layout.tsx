"use client";

/* jsonui/Layout.tsx — json-render layout + data-display components, fr-styled.
   Exported as a Registry slice; merged into the full catalog in ./registry. */

import { useState } from "react";
import { type CompProps, type Registry, FR_GAP, FR_ALIGN, FR_JUSTIFY, useFrBound, FrPlaceholder } from "./render";

export const layoutComponents: Registry = {
  // ----- layout ------------------------------------------------------------
  Card({ props, children }: CompProps) {
    const p = props as any;
    const mw = ({ sm: 320, md: 480, lg: 640, full: "100%" } as Record<string, number | string>)[p.maxWidth] || "100%";
    return (
      <div style={{ maxWidth: mw, margin: p.centered ? "0 auto" : undefined, borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--panel)", padding: 16, display: "grid", gap: 12 }}>
        {(p.title || p.description) && (
          <div style={{ display: "grid", gap: 3 }}>
            {p.title && <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em", color: "var(--fg)" }}>{p.title}</div>}
            {p.description && <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{p.description}</div>}
          </div>
        )}
        {children}
      </div>
    );
  },

  Stack({ props, children }: CompProps) {
    const p = props as any;
    const horizontal = p.direction === "horizontal" || p.direction === "row";
    return (
      <div style={{ display: "flex", flexDirection: horizontal ? "row" : "column", gap: FR_GAP[p.gap] != null ? FR_GAP[p.gap] : 12, alignItems: FR_ALIGN[p.align] || (horizontal ? "center" : "stretch"), justifyContent: FR_JUSTIFY[p.justify] || "flex-start", flexWrap: "wrap" }}>{children}</div>
    );
  },

  Grid({ props, children }: CompProps) {
    const p = props as any;
    return <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, Math.min(6, p.columns || 2))}, minmax(0,1fr))`, gap: FR_GAP[p.gap] || 12 }}>{children}</div>;
  },

  Separator({ props }: CompProps) {
    const p = props as any;
    return p.orientation === "vertical"
      ? <span style={{ width: 1, alignSelf: "stretch", background: "var(--line)" }} />
      : <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />;
  },

  Tabs({ props, bind, emit, st, children }: CompProps) {
    const p = props as any;
    const tabs: { label: string; value: string }[] = p.tabs || [];
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || p.defaultValue || (tabs[0] && tabs[0].value));
    const idx = Math.max(0, tabs.findIndex((t) => t.value === val));
    const kids = Array.isArray(children) ? children : [children];
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 99, background: "var(--panel-2)", border: "1px solid var(--line)", width: "fit-content", maxWidth: "100%", overflowX: "auto" }}>
          {tabs.map((t) => {
            const on = t.value === val;
            return <button key={t.value} type="button" onClick={() => { setVal(t.value); emit("change", t.value); }} style={{ padding: "6px 14px", borderRadius: 99, border: 0, cursor: "pointer", whiteSpace: "nowrap", background: on ? "var(--honey)" : "transparent", color: on ? "#1a1305" : "var(--fg-2)", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, transition: "all 140ms ease" }}>{t.label}</button>;
          })}
        </div>
        <div>{kids[idx] || kids}</div>
      </div>
    );
  },

  Accordion({ props }: CompProps) {
    const p = props as any;
    const items: { title: string; content: string }[] = p.items || [];
    const multiple = p.type === "multiple";
    const [open, setOpen] = useState<Record<number, boolean>>({});
    return (
      <div style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", overflow: "hidden" }}>
        {items.map((it, i) => {
          const isOpen = !!open[i];
          return (
            <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : 0 }}>
              <button type="button" onClick={() => setOpen((o) => (multiple ? { ...o, [i]: !o[i] } : (o[i] ? {} : { [i]: true })))} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", padding: "12px 14px", border: 0, background: isOpen ? "var(--panel-2)" : "transparent", cursor: "pointer", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 500, textAlign: "left" }}>
                {it.title}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 180ms ease", flexShrink: 0 }}><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {isOpen && <div style={{ padding: "0 14px 13px", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.6 }}>{it.content}</div>}
            </div>
          );
        })}
      </div>
    );
  },

  Collapsible({ props, children }: CompProps) {
    const p = props as any;
    const [open, setOpen] = useState(!!p.defaultOpen);
    return (
      <div style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", overflow: "hidden" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "11px 14px", border: 0, background: "var(--panel)", cursor: "pointer", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 500, textAlign: "left" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms ease" }}><path d="M9 6l6 6-6 6" /></svg>
          {p.title}
        </button>
        {open && <div style={{ padding: "0 14px 13px", display: "grid", gap: 10 }}>{children}</div>}
      </div>
    );
  },

  Dialog({ props, st, children }: CompProps) {
    const p = props as any;
    if (!st.get(p.openPath)) return null;
    return (
      <div onClick={() => st.set(p.openPath, false)} style={{ position: "fixed", inset: 0, zIndex: 300, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)", padding: 24 }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 100%)", borderRadius: "var(--radius-lg)", border: "1px solid var(--line-2)", background: "var(--panel)", boxShadow: "0 40px 90px -30px rgba(0,0,0,0.8)", padding: 22, display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>{p.title}</div>
            {p.description && <div style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>{p.description}</div>}
          </div>
          <div style={{ display: "grid", gap: 12 }}>{children}</div>
        </div>
      </div>
    );
  },

  Drawer({ props, st, children }: CompProps) {
    const p = props as any;
    if (!st.get(p.openPath)) return null;
    return (
      <div onClick={() => st.set(p.openPath, false)} style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", borderRadius: "var(--radius-lg) var(--radius-lg) 0 0", border: "1px solid var(--line-2)", borderBottom: 0, background: "var(--panel)", boxShadow: "0 -30px 80px -30px rgba(0,0,0,0.8)", padding: "16px 22px 26px", display: "grid", gap: 14, animation: "fr-fade-up .26s ease" }}>
          <div style={{ width: 40, height: 4, borderRadius: 99, background: "var(--line-3)", justifySelf: "center" }} />
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.01em" }}>{p.title}</div>
            {p.description && <div style={{ fontSize: 13, color: "var(--fg-3)", lineHeight: 1.5 }}>{p.description}</div>}
          </div>
          <div style={{ display: "grid", gap: 12 }}>{children}</div>
        </div>
      </div>
    );
  },

  Carousel({ props }: CompProps) {
    const p = props as any;
    const items: { title?: string; description?: string }[] = p.items || [];
    return (
      <div className="fr-scroll" style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, scrollSnapType: "x mandatory" }}>
        {items.map((it, i) => (
          <div key={i} style={{ flex: "0 0 78%", maxWidth: 280, scrollSnapAlign: "start", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "var(--panel)", padding: 15, display: "grid", gap: 6 }}>
            {it.title && <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14 }}>{it.title}</div>}
            {it.description && <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.55 }}>{it.description}</div>}
          </div>
        ))}
      </div>
    );
  },

  // ----- data display ------------------------------------------------------
  Table({ props }: CompProps) {
    const p = props as any;
    const cols: string[] = p.columns || [];
    const rows: string[][] = p.rows || [];
    return (
      <div style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", overflow: "hidden" }}>
        {p.caption && <div style={{ padding: "9px 13px", borderBottom: "1px solid var(--line)", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", letterSpacing: "0.04em" }}>{p.caption}</div>}
        <div style={{ overflowX: "auto" }} className="fr-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr>{cols.map((c, i) => <th key={i} style={{ textAlign: "left", padding: "9px 13px", borderBottom: "1px solid var(--line)", background: "var(--panel-2)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--fg-3)", whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci} style={{ padding: "9px 13px", borderTop: ri ? "1px solid var(--line)" : 0, color: ci === 0 ? "var(--fg)" : "var(--fg-2)", whiteSpace: "nowrap" }}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    );
  },

  Heading({ props }: CompProps) {
    const p = props as any;
    const sz = ({ h1: 24, h2: 20, h3: 16.5, h4: 14 } as Record<string, number>)[p.level || "h2"];
    return <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: sz, letterSpacing: "-0.02em", color: "var(--fg)", lineHeight: 1.2 }}>{p.text}</div>;
  },

  Text({ props }: CompProps) {
    const p = props as any;
    const v = p.variant || "body";
    if (v === "code") return <code style={{ fontFamily: "var(--f-mono)", fontSize: 12, padding: "2px 6px", borderRadius: 5, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--fg)" }}>{p.text}</code>;
    const map: Record<string, React.CSSProperties> = {
      body: { fontSize: 13.5, color: "var(--fg-2)", lineHeight: 1.6 },
      lead: { fontSize: 15.5, color: "var(--fg)", lineHeight: 1.55 },
      caption: { fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 },
      muted: { fontSize: 12.5, color: "var(--fg-4)", lineHeight: 1.55 },
    };
    return <p style={{ margin: 0, ...(map[v] || map.body) }}>{p.text}</p>;
  },

  Image({ props }: CompProps) {
    const p = props as any;
    if (p.src) /* eslint-disable-next-line @next/next/no-img-element */
      return <img src={p.src} alt={p.alt || ""} style={{ maxWidth: "100%", width: p.width || undefined, height: p.height || undefined, borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", display: "block", objectFit: "cover" }} />;
    return <FrPlaceholder label={p.alt || "image"} h={p.height || 140} />;
  },

  Avatar({ props }: CompProps) {
    const p = props as any;
    const sz = ({ sm: 28, md: 38, lg: 52 } as Record<string, number>)[p.size || "md"];
    const initials = String(p.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return (
      <span style={{ width: sz, height: sz, borderRadius: "50%", flex: "0 0 auto", display: "grid", placeItems: "center", overflow: "hidden", background: "var(--honey-soft)", border: "1px solid var(--honey-line)", color: "var(--honey)", fontFamily: "var(--f-display)", fontWeight: 600, fontSize: sz * 0.36 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {p.src ? <img src={p.src} alt={p.name} width={sz} height={sz} style={{ objectFit: "cover" }} /> : initials}
      </span>
    );
  },

  Badge({ props }: CompProps) {
    const p = props as any;
    const map = ({
      default: { c: "var(--honey)", bg: "var(--honey-soft)", br: "var(--honey-line)" },
      secondary: { c: "var(--fg-2)", bg: "var(--panel-2)", br: "var(--line-2)" },
      destructive: { c: "var(--danger)", bg: "var(--danger-soft)", br: "color-mix(in srgb, var(--danger) 42%, transparent)" },
      outline: { c: "var(--fg-2)", bg: "transparent", br: "var(--line-2)" },
    } as Record<string, { c: string; bg: string; br: string }>)[p.variant || "default"];
    return <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 99, fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: map.c, background: map.bg, border: `1px solid ${map.br}` }}>{p.text || p.label}</span>;
  },

  Alert({ props }: CompProps) {
    const p = props as any;
    const t = p.type || "info";
    const map = ({
      info: { c: "var(--fg-2)", bg: "var(--panel-2)", br: "var(--line-2)" },
      success: { c: "var(--live)", bg: "var(--live-soft)", br: "color-mix(in srgb, var(--live) 38%, transparent)" },
      warning: { c: "var(--honey)", bg: "var(--honey-soft)", br: "var(--honey-line)" },
      error: { c: "var(--danger)", bg: "var(--danger-soft)", br: "color-mix(in srgb, var(--danger) 42%, transparent)" },
    } as Record<string, { c: string; bg: string; br: string }>)[t];
    const icon = ({ info: "M12 8h.01M11 12h1v4h1", success: "M20 6L9 17l-5-5", warning: "M12 9v4M12 17h.01", error: "M15 9l-6 6M9 9l6 6" } as Record<string, string>)[t];
    return (
      <div style={{ display: "flex", gap: 11, padding: "12px 14px", borderRadius: "var(--radius-sm)", background: map.bg, border: `1px solid ${map.br}` }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={map.c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" opacity="0.32" /><path d={icon} /></svg>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 13, color: map.c }}>{p.title}</div>
          {p.message && <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55, marginTop: 3 }}>{p.message}</div>}
        </div>
      </div>
    );
  },

  Progress({ props }: CompProps) {
    const p = props as any;
    const max = p.max || 100;
    const pct = Math.max(0, Math.min(100, (p.value / max) * 100));
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {(p.label || p.value != null) && (
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>
            <span>{p.label}</span><span style={{ color: "var(--fg-2)" }}>{Math.round(pct)}%</span>
          </div>
        )}
        <span className="fr-meter" style={{ display: "block", height: 6 }}><i style={{ width: pct + "%", background: "var(--honey)" }} /></span>
        {p.detail && <span style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.5 }}>{p.detail}</span>}
      </div>
    );
  },

  Skeleton({ props }: CompProps) {
    const p = props as any;
    return <span className="fr-skel" style={{ width: p.width || "100%", height: p.height || 14, borderRadius: p.rounded ? 99 : 7 }} />;
  },

  Spinner({ props }: CompProps) {
    const p = props as any;
    const sz = ({ sm: 16, md: 22, lg: 30 } as Record<string, number>)[p.size || "md"];
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 9, color: "var(--fg-3)", fontSize: 12.5 }}>
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" style={{ animation: "fr-spin 0.8s linear infinite" }}><circle cx="12" cy="12" r="9" stroke="var(--line-2)" strokeWidth="2.4" /><path d="M21 12a9 9 0 0 0-9-9" stroke="var(--honey)" strokeWidth="2.4" strokeLinecap="round" /></svg>
        {p.label && <span>{p.label}</span>}
      </span>
    );
  },

  Tooltip({ props }: CompProps) {
    const p = props as any;
    const [show, setShow] = useState(false);
    return (
      <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
        <span style={{ borderBottom: "1px dashed var(--line-3)", cursor: "help", color: "var(--fg-2)", fontSize: 13.5 }}>{p.text}</span>
        {show && <span style={{ position: "absolute", bottom: "calc(100% + 7px)", left: "50%", transform: "translateX(-50%)", zIndex: 40, whiteSpace: "nowrap", padding: "6px 10px", borderRadius: 8, background: "var(--panel-hi)", border: "1px solid var(--line-2)", boxShadow: "0 12px 30px -14px rgba(0,0,0,0.7)", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)" }}>{p.content}</span>}
      </span>
    );
  },

  Popover({ props }: CompProps) {
    const p = props as any;
    const [open, setOpen] = useState(false);
    return (
      <span style={{ position: "relative", display: "inline-flex" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ padding: "7px 13px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", background: open ? "var(--panel-hi)" : "var(--panel)", color: "var(--fg)", cursor: "pointer", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500 }}>{p.trigger}</button>
        {open && <span style={{ position: "absolute", top: "calc(100% + 7px)", left: 0, zIndex: 40, width: 240, padding: "12px 14px", borderRadius: "var(--radius-sm)", background: "var(--panel)", border: "1px solid var(--line-2)", boxShadow: "0 18px 44px -18px rgba(0,0,0,0.7)", fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55 }}>{p.content}</span>}
      </span>
    );
  },
};

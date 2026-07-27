"use client";

/* jsonui/Controls.tsx — json-render form + action components, fr-styled.
   All two-way controls honor { $bindState } via useFrBound; events fire through
   emit(). Exported as a Registry slice; merged in ./registry. */

import { useEffect, useRef, useState } from "react";
import { type CompProps, type Registry, useFrBound } from "./render";

const fieldLabel: React.CSSProperties = { fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--fg-3)" };
const inputBase: React.CSSProperties = { width: "100%", padding: "9px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13.5, outline: "none", transition: "border-color 150ms ease, box-shadow 150ms ease" };
const onFocus = (e: React.FocusEvent<HTMLElement>) => { (e.target as HTMLElement).style.borderColor = "var(--honey-line)"; (e.target as HTMLElement).style.boxShadow = "0 0 0 3px var(--honey-soft)"; };
const onBlur = (e: React.FocusEvent<HTMLElement>) => { (e.target as HTMLElement).style.borderColor = "var(--line-2)"; (e.target as HTMLElement).style.boxShadow = "none"; };

async function writeClipboardText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.top = "-999px";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("Clipboard copy failed.");
}

function CheckGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}

function validate(checks: any[] | undefined | null, value: string): string | null {
  if (!checks) return null;
  for (const c of checks) {
    if (c.type === "required" && (!value || !String(value).trim())) return c.message || "Required";
    if (c.type === "email" && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return c.message || "Invalid email";
    if (c.type === "minLength" && value && String(value).length < ((c.args && c.args.length) || 0)) return c.message || "Too short";
  }
  return null;
}

export const controlComponents: Registry = {
  Input({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || "");
    const [err, setErr] = useState<string | null>(null);
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {p.label && <span style={fieldLabel}>{p.label}</span>}
        <input type={p.type || "text"} value={val} placeholder={p.placeholder || ""}
          onChange={(e) => { setVal(e.target.value); if (err) setErr(null); }} onFocus={onFocus}
          onBlur={(e) => { onBlur(e); setErr(validate(p.checks, val)); }}
          onKeyDown={(e) => { if (e.key === "Enter") emit("submit", val); }}
          style={{ ...inputBase, borderColor: err ? "color-mix(in srgb, var(--danger) 50%, transparent)" : "var(--line-2)" }} />
        {err && <span style={{ fontSize: 11, color: "var(--danger)" }}>{err}</span>}
      </label>
    );
  },

  Textarea({ props, bind, st }: CompProps) {
    const p = props as any;
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || "");
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {p.label && <span style={fieldLabel}>{p.label}</span>}
        <textarea value={val} placeholder={p.placeholder || ""} rows={p.rows || 3} onChange={(e) => setVal(e.target.value)} onFocus={onFocus} onBlur={onBlur} style={{ ...inputBase, resize: "vertical", lineHeight: 1.55 }} />
      </label>
    );
  },

  Select({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const opts: string[] = p.options || [];
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || "");
    return (
      <label style={{ display: "grid", gap: 6 }}>
        {p.label && <span style={fieldLabel}>{p.label}</span>}
        <div style={{ position: "relative" }}>
          <select value={val} onChange={(e) => { setVal(e.target.value); emit("change", e.target.value); }} onFocus={onFocus} onBlur={onBlur} style={{ ...inputBase, appearance: "none", paddingRight: 34, cursor: "pointer" }}>
            {p.placeholder && <option value="" disabled>{p.placeholder}</option>}
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}><path d="M6 9l6 6 6-6" /></svg>
        </div>
      </label>
    );
  },

  Checkbox({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const [on, setOn] = useFrBound<boolean>(bind, "checked", st, !!p.checked);
    return (
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <span onClick={() => { setOn(!on); emit("change", !on); }} style={{ width: 19, height: 19, flex: "0 0 auto", borderRadius: 6, border: `1px solid ${on ? "var(--honey)" : "var(--line-3)"}`, background: on ? "var(--honey)" : "var(--panel-2)", display: "grid", placeItems: "center", transition: "all 140ms ease" }}>
          {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1305" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>}
        </span>
        <span style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{p.label}</span>
      </label>
    );
  },

  Radio({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const opts: string[] = p.options || [];
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || "");
    return (
      <div style={{ display: "grid", gap: 9 }}>
        {p.label && <span style={fieldLabel}>{p.label}</span>}
        {opts.map((o) => {
          const on = o === val;
          return (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => { setVal(o); emit("change", o); }}>
              <span style={{ width: 18, height: 18, flex: "0 0 auto", borderRadius: "50%", border: `1px solid ${on ? "var(--honey)" : "var(--line-3)"}`, display: "grid", placeItems: "center", transition: "all 140ms ease" }}>
                {on && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--honey)" }} />}
              </span>
              <span style={{ fontSize: 13.5, color: on ? "var(--fg)" : "var(--fg-2)" }}>{o}</span>
            </label>
          );
        })}
      </div>
    );
  },

  Switch({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const [on, setOn] = useFrBound<boolean>(bind, "checked", st, !!p.checked);
    return (
      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer" }}>
        <span style={{ fontSize: 13.5, color: "var(--fg-2)" }}>{p.label}</span>
        <span onClick={() => { setOn(!on); emit("change", !on); }} style={{ position: "relative", width: 40, height: 23, flex: "0 0 auto", borderRadius: 99, background: on ? "var(--honey)" : "var(--panel-hi)", border: `1px solid ${on ? "var(--honey)" : "var(--line-2)"}`, transition: "all 160ms ease" }}>
          <span style={{ position: "absolute", top: 2, left: on ? 19 : 2, width: 17, height: 17, borderRadius: "50%", background: on ? "#1a1305" : "var(--fg-3)", transition: "left 160ms cubic-bezier(.2,.8,.2,1)" }} />
        </span>
      </label>
    );
  },

  Slider({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const min = p.min != null ? p.min : 0;
    const max = p.max != null ? p.max : 100;
    const [val, setVal] = useFrBound<number>(bind, "value", st, p.value != null ? p.value : min);
    const pct = ((val - min) / (max - min)) * 100;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          {p.label && <span style={fieldLabel}>{p.label}</span>}
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--honey)" }}>{val}</span>
        </div>
        <input type="range" min={min} max={max} step={p.step || 1} value={val} onChange={(e) => { const n = Number(e.target.value); setVal(n); emit("change", n); }}
          style={{ width: "100%", accentColor: "var(--honey)", background: `linear-gradient(90deg, var(--honey) ${pct}%, var(--line-2) ${pct}%)`, height: 4, borderRadius: 99, appearance: "none", cursor: "pointer" }} />
      </div>
    );
  },

  // ----- actions -----------------------------------------------------------
  Button({ props, emit }: CompProps) {
    const p = props as any;
    const [copied, setCopied] = useState(false);
    const copyTimerRef = useRef<number | null>(null);
    const map = ({
      primary: { bg: "var(--honey)", c: "#1a1305", br: "var(--honey)" },
      secondary: { bg: "var(--panel-2)", c: "var(--fg)", br: "var(--line-2)" },
      danger: { bg: "var(--danger-soft)", c: "var(--danger)", br: "color-mix(in srgb, var(--danger) 44%, transparent)" },
    } as Record<string, { bg: string; c: string; br: string }>)[p.variant || "primary"];
    const safeUrl = typeof p.url === "string" && /^(https?:\/\/|mailto:|#)/i.test(p.url.trim()) ? p.url.trim() : "";
    const copyText = typeof p.copyText === "string" ? p.copyText : "";
    const label = copied ? (typeof p.copiedLabel === "string" && p.copiedLabel.trim() ? p.copiedLabel : "Copied!") : p.label;

    useEffect(() => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    }, []);

    const markCopied = () => {
      setCopied(true);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    };

    return (
      <button type="button" disabled={p.disabled}
        aria-live={copyText ? "polite" : undefined}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 16px", borderRadius: 99, border: `1px solid ${map.br}`, background: map.bg, color: map.c, cursor: p.disabled ? "default" : "pointer", opacity: p.disabled ? 0.45 : 1, fontFamily: "var(--f-body)", fontSize: 13, fontWeight: 500, transition: "filter 140ms ease, transform 140ms ease" }}
        onClick={() => {
          if (safeUrl) window.open(safeUrl, "_blank", "noopener,noreferrer");
          if (copyText) void writeClipboardText(copyText).then(markCopied).catch(() => undefined);
          emit("press");
        }}
        onMouseEnter={(e) => { if (!p.disabled) { e.currentTarget.style.filter = "brightness(1.06)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; e.currentTarget.style.transform = "none"; }}>
        {copied ? <CheckGlyph /> : null}
        {label}
      </button>
    );
  },

  Link({ props, emit }: CompProps) {
    const p = props as any;
    return (
      <a href={p.href || "#"} onClick={(e) => { e.preventDefault(); emit("press"); }} style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--honey)", fontSize: 13.5, fontWeight: 500, textDecoration: "none", cursor: "pointer" }}>
        {p.label}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
      </a>
    );
  },

  DropdownMenu({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const [open, setOpen] = useState(false);
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || "");
    const items: { label: string; value: string }[] = p.items || [];
    const cur = items.find((i) => i.value === val);
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
      const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
      document.addEventListener("mousedown", onDoc); return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    return (
      <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg)", cursor: "pointer", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500 }}>
          {cur ? cur.label : p.label}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 140ms" }}><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {open && (
          <span style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, minWidth: 170, padding: 5, borderRadius: "var(--radius-sm)", background: "color-mix(in srgb, var(--panel) 94%, transparent)", backdropFilter: "blur(10px)", border: "1px solid var(--line-2)", boxShadow: "0 18px 44px -18px rgba(0,0,0,0.7)", display: "grid", gap: 1 }}>
            {items.map((it) => (
              <button key={it.value} type="button" onClick={() => { setVal(it.value); emit("select", it.value); setOpen(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 9, padding: "8px 10px", borderRadius: 7, border: 0, background: "transparent", color: it.value === val ? "var(--honey)" : "var(--fg-2)", cursor: "pointer", textAlign: "left", fontFamily: "var(--f-body)", fontSize: 13 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-2)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {it.label}
                {it.value === val && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--honey)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 6" /></svg>}
              </button>
            ))}
          </span>
        )}
      </span>
    );
  },

  Toggle({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const [on, setOn] = useFrBound<boolean>(bind, "pressed", st, !!p.pressed);
    const outline = p.variant === "outline";
    return (
      <button type="button" onClick={() => { setOn(!on); emit("change", !on); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: "var(--radius-sm)", cursor: "pointer", border: `1px solid ${on ? "var(--honey-line)" : (outline ? "var(--line-2)" : "transparent")}`, background: on ? "var(--honey-soft)" : (outline ? "transparent" : "var(--panel-2)"), color: on ? "var(--honey)" : "var(--fg-2)", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, transition: "all 140ms ease" }}>{p.label}</button>
    );
  },

  ToggleGroup({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const items: { label: string; value: string }[] = p.items || [];
    const multiple = p.type === "multiple";
    const [val, setVal] = useFrBound<string>(bind, "value", st, p.value || (multiple ? "" : (items[0] && items[0].value)));
    const sel = multiple ? String(val || "").split(",").filter(Boolean) : [val];
    const toggle = (v: string) => {
      if (multiple) { const next = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]; const s = next.join(","); setVal(s); emit("change", s); }
      else { setVal(v); emit("change", v); }
    };
    return (
      <div style={{ display: "inline-flex", gap: 3, padding: 3, borderRadius: "var(--radius-sm)", background: "var(--panel-2)", border: "1px solid var(--line)" }}>
        {items.map((it) => {
          const on = sel.includes(it.value);
          return <button key={it.value} type="button" onClick={() => toggle(it.value)} style={{ padding: "7px 13px", borderRadius: 7, border: 0, cursor: "pointer", background: on ? "var(--honey)" : "transparent", color: on ? "#1a1305" : "var(--fg-2)", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, transition: "all 130ms ease" }}>{it.label}</button>;
        })}
      </div>
    );
  },

  ButtonGroup({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const btns: { label: string; value: string }[] = p.buttons || [];
    const [val, setVal] = useFrBound<string>(bind, "selected", st, p.selected || "");
    return (
      <div style={{ display: "inline-flex", borderRadius: "var(--radius-sm)", border: "1px solid var(--line-2)", overflow: "hidden" }}>
        {btns.map((b, i) => {
          const on = b.value === val;
          return <button key={b.value} type="button" onClick={() => { setVal(b.value); emit("change", b.value); }} style={{ padding: "8px 15px", border: 0, borderLeft: i ? "1px solid var(--line-2)" : 0, cursor: "pointer", background: on ? "var(--honey-soft)" : "var(--panel)", color: on ? "var(--honey)" : "var(--fg-2)", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500, transition: "all 130ms ease" }}>{b.label}</button>;
        })}
      </div>
    );
  },

  Pagination({ props, bind, emit, st }: CompProps) {
    const p = props as any;
    const total = p.totalPages || 1;
    const [page, setPage] = useFrBound<number>(bind, "page", st, p.page || 1);
    const go = (pg: number) => { const n = Math.max(1, Math.min(total, pg)); setPage(n); emit("change", n); };
    const nums = Array.from({ length: total }, (_, i) => i + 1).filter((n) => n === 1 || n === total || Math.abs(n - page) <= 1);
    const out: (number | string)[] = []; let prev = 0;
    nums.forEach((n) => { if (n - prev > 1) out.push("…"); out.push(n); prev = n; });
    const btn = (active: boolean): React.CSSProperties => ({ minWidth: 32, height: 32, padding: "0 8px", borderRadius: "var(--radius-sm)", border: `1px solid ${active ? "var(--honey-line)" : "var(--line-2)"}`, background: active ? "var(--honey-soft)" : "var(--panel)", color: active ? "var(--honey)" : "var(--fg-2)", cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 12 });
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} style={{ ...btn(false), opacity: page <= 1 ? 0.4 : 1 }}>‹</button>
        {out.map((n, i) => n === "…" ? <span key={"e" + i} style={{ color: "var(--fg-4)", padding: "0 2px" }}>…</span> : <button key={n} type="button" onClick={() => go(n as number)} style={btn(n === page)}>{n}</button>)}
        <button type="button" onClick={() => go(page + 1)} disabled={page >= total} style={{ ...btn(false), opacity: page >= total ? 0.4 : 1 }}>›</button>
      </div>
    );
  },
};

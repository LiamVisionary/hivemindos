"use client";

/* primitives.tsx — shared presentational atoms for the Trade desk: token coin
   chips, the interactive sparkline (now fed REAL price/value history rather than
   a synthetic seed), badges, buttons, the asset dropdown, review rows, and the
   display-currency menu. */

import React from "react";
import { BIcon } from "./icons";
import { FX_META, availableCurrencies, trUsd2, trAmt } from "./format";
import { chainBadgeSrc } from "@/lib/utils/personal-wallet-grouping";

// ── badges & buttons ─────────────────────────────────────────────────────────
export function Badge({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return <span className={"fb-badge" + (tone ? " " + tone : "")}>{children}</span>;
}

export function BBtn({ variant = "ghost", sm, children, ...rest }: { variant?: string; sm?: boolean; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={"fb-btn " + variant + (sm ? " sm" : "")} {...rest}>{children}</button>;
}

// ── provider badge (which rail powers a capability) ──────────────────────────
// Maps a crypto-capability provider to its real brand icon. Providers without a
// shipped icon render their short name as text. Shown icon-only in the tile's
// top corner with a hover tooltip for the name.
const CRYPTO_PROVIDER_META: Record<string, { label: string; icon?: string; text?: string }> = {
  bankr: { label: "Bankr", icon: "/icons/runtimes/bankr.svg" },
  hyperliquid: { label: "Hyperliquid", icon: "/icons/runtimes/hyperliquid.svg?v=2" },
  moneyclaw: { label: "MoneyClaw", icon: "/icons/runtimes/clawbank.svg" },
  venice: { label: "Venice", icon: "/icons/runtimes/venice-keys.svg" },
  usepod: { label: "UsePod", icon: "/icons/runtimes/usepod.webp" },
  veil: { label: "Veil", icon: "/icons/runtimes/veil.svg" },
  x402: { label: "x402", text: "x402" },
  nansen: { label: "Nansen", text: "Nansen" },
};

export function ProviderBadge({ provider, label }: { provider?: string; label?: string }) {
  if (!provider) return null;
  const meta = CRYPTO_PROVIDER_META[provider] ?? { label: label || provider, text: (label || provider).slice(0, 5) };
  return (
    <span className="tk-provbadge" title={meta.label} aria-label={`Powered by ${meta.label}`}>
      {meta.icon
        ? <img src={meta.icon} alt={meta.label} height={20} style={{ height: 20, width: "auto", borderRadius: 4, display: "block" }} />
        : <span className="txt">{meta.text ?? meta.label}</span>}
    </span>
  );
}

// ── token color ──────────────────────────────────────────────────────────────
const BRAND_COLORS: Record<string, string> = {
  ETH: "#627eea", WETH: "#627eea", USDC: "#2775ca", USDT: "#26a17b",
  BTC: "#f7931a", cbBTC: "#f7931a", WBTC: "#f7931a", SOL: "#9945ff",
  HYPE: "#2fe0c0", HIVE: "#e7b45c", BANKR: "#8b5cf6",
};
export function tokenColor(sym: string): string {
  if (BRAND_COLORS[sym]) return BRAND_COLORS[sym];
  // deterministic hue from the symbol so unknown tokens get a stable color.
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360;
  return `hsl(${h} 52% 55%)`;
}

export function Coin({ sym, size = 30, stock, logoUrl }: { sym: string; size?: number; stock?: boolean; logoUrl?: string | null }) {
  // Try the real token logo first (from the balance provider); on a missing or
  // broken image, fall back to the generated letter coin. Tracking the failed
  // URL (rather than a boolean reset via effect) means a new logoUrl re-attempts
  // automatically without a setState-in-effect.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  if (logoUrl && logoUrl !== failedUrl) {
    return (
      <img
        src={logoUrl}
        alt={sym}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailedUrl(logoUrl)}
        style={{ width: size, height: size, flex: "0 0 auto", borderRadius: stock ? Math.round(size * 0.28) : "50%", objectFit: "cover", display: "block", background: "var(--panel-hi)" }}
      />
    );
  }
  const color = stock ? "var(--panel-hi)" : tokenColor(sym);
  const label = sym === "cbBTC" ? "₿" : sym === "USDC" ? "$" : sym.slice(0, stock ? 4 : 3);
  const fs = stock ? size * 0.3 : (label.length > 2 ? size * 0.3 : size * 0.42);
  return (
    <span style={{
      width: size, height: size, flex: "0 0 auto",
      borderRadius: stock ? Math.round(size * 0.28) : "50%",
      display: "grid", placeItems: "center", background: color,
      border: stock ? "1px solid var(--line-2)" : "none",
      color: stock ? "var(--fg)" : "#fff",
      fontFamily: stock ? "var(--f-mono)" : "var(--f-display)", fontWeight: 700,
      fontSize: fs, letterSpacing: stock ? "0.02em" : "-0.02em", lineHeight: 1,
    }}>{label}</span>
  );
}

// ── interactive sparkline (real history) ─────────────────────────────────────
// `fluid` makes the chart fill its container's width (measured, so the geometry
// renders at real pixels with no aspect-ratio distortion) instead of the fixed
// `w` — used by the portfolio hero so the line lines up with the allocation bar
// below it. `w` is the initial/SSR width until the container is measured.
export function Spark({ data, w = 96, h = 30, color = "var(--fg-3)", up, fmt, win = "24h", fluid = false }: {
  data: number[]; w?: number; h?: number; color?: string; up?: boolean; fmt?: (v: number) => string; win?: "24h" | "7d" | "30d"; fluid?: boolean;
}) {
  const id = "sp" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hi, setHi] = React.useState<number | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!fluid) return;
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setMeasured(el.getBoundingClientRect().width || null);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fluid]);
  const W = fluid ? (measured ?? w) : w;
  const values = Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : [];
  const pad = 3;
  const stroke = up === undefined ? color : up ? "var(--live)" : "var(--danger)";
  const fmtv = fmt || ((v: number) => trUsd2(v));

  // No real series → a faint flat baseline (never a faked wiggle).
  if (values.length < 2) {
    return (
      <div ref={wrapRef} style={{ width: fluid ? "100%" : W }}>
        <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden style={{ display: "block" }}>
          <line x1={pad} y1={h / 2} x2={W - pad} y2={h / 2} stroke="var(--line-2)" strokeWidth="1.4" strokeDasharray="2 3" />
        </svg>
      </div>
    );
  }

  const min = Math.min(...values), max = Math.max(...values), span = (max - min) || 1;
  const step = (W - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, pad + (1 - (v - min) / span) * (h - pad * 2)] as const);
  const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = line + ` L${(W - pad).toFixed(1)} ${h} L${pad} ${h} Z`;
  const spanH = win === "30d" ? 30 * 24 : win === "7d" ? 7 * 24 : 24;
  const tlabel = (i: number) => {
    const back = (values.length - 1 - i) * spanH / (values.length - 1);
    if (back < 0.5) return "now";
    if (back >= 24) return "−" + Math.round(back / 24) + "d";
    return "−" + Math.round(back) + "h";
  };
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - pad) / step);
    setHi(Math.max(0, Math.min(values.length - 1, i)));
  };
  return (
    <div ref={wrapRef} className="spark-wrap" style={{ width: fluid ? "100%" : W, height: h, cursor: "crosshair" }} onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
      <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        {hi != null ? (
          <g>
            <line x1={pts[hi][0]} y1="0" x2={pts[hi][0]} y2={h} stroke="var(--line-3)" strokeWidth="1" />
            <circle cx={pts[hi][0]} cy={pts[hi][1]} r="3.2" fill={stroke} stroke="var(--panel)" strokeWidth="1.5" />
          </g>
        ) : null}
      </svg>
      {hi != null ? (
        <div className="spark-tip" style={{ left: Math.max(0, Math.min(W, pts[hi][0])) }}>
          <b>{fmtv(values[hi])}</b><span>{tlabel(hi)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ── review row ───────────────────────────────────────────────────────────────
export function ReviewLine({ k, v, live, icon }: { k: React.ReactNode; v: React.ReactNode; live?: boolean; icon?: React.ComponentProps<typeof BIcon>["name"] }) {
  return (
    <div className="tk-rl">
      <span className="k">{icon ? <BIcon name={icon} size={13} /> : null}{k}</span>
      <span className={"v" + (live ? " live" : "")}>{v}</span>
    </div>
  );
}

// ── asset dropdown ───────────────────────────────────────────────────────────
export function AssetMenu({ value, options, balances, values, logos, onPick, stock, getName }: {
  value: string;
  options: string[];
  balances?: Record<string, number>;
  /** USD value held per symbol — rendered in the user's display currency. */
  values?: Record<string, number>;
  /** Real token logo URL per symbol (from the balance provider). */
  logos?: Record<string, string | null | undefined>;
  onPick: (sym: string) => void;
  stock?: boolean;
  getName?: (sym: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span className="tk-asset" ref={ref}>
      <button type="button" className="tk-assetbtn" onClick={() => setOpen((o) => !o)}>
        <Coin sym={value} size={24} stock={stock} logoUrl={logos?.[value]} />
        <span className="sym">{value}</span>
        <span className="car"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg></span>
      </button>
      {open ? (
        <div className="tk-menu fr-scroll">
          {options.map((sym) => {
            const bal = balances ? balances[sym] : undefined;
            const usd = values ? values[sym] : undefined;
            const showUsd = usd != null && usd > 0;
            return (
              <button key={sym} type="button" data-active={sym === value ? "" : undefined} onClick={() => { onPick(sym); setOpen(false); }}>
                <Coin sym={sym} size={28} stock={stock} logoUrl={logos?.[sym]} />
                <span className="mn"><b>{sym}</b><span>{getName ? getName(sym) : sym}</span></span>
                {bal !== undefined || showUsd ? (
                  <span className="mamt">
                    {bal !== undefined ? trAmt(sym, bal) : null}
                    {showUsd ? <span className="musd">{trUsd2(usd)}</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

// ── chain dropdown ───────────────────────────────────────────────────────────
function ChainGlyph({ chainKey, size = 24 }: { chainKey?: string; size?: number }) {
  const src = chainBadgeSrc(chainKey || "");
  if (src) return <img src={src} alt="" width={size} height={size} style={{ borderRadius: "50%", display: "block", flex: "0 0 auto" }} />;
  return <span style={{ width: size, height: size, borderRadius: "50%", background: "var(--panel-hi)", border: "1px solid var(--line-2)", flex: "0 0 auto" }} />;
}

/** Chain selector for a trade action — same look as AssetMenu but for chains.
 *  Disabled (static) when the acting wallet has only one chain. */
export function ChainMenu({ value, options, onPick }: {
  value: string;
  options: Array<{ key: string; label: string; network: string }>;
  onPick: (network: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", key); };
  }, [open]);
  if (!options.length) return null;
  const current = options.find((o) => o.network === value) ?? options[0];
  const single = options.length <= 1;
  return (
    <span className="tk-asset" ref={ref}>
      <button type="button" className="tk-assetbtn" onClick={() => { if (!single) setOpen((o) => !o); }} disabled={single} aria-label="Select chain">
        <ChainGlyph chainKey={current.key} />
        <span className="sym">{current.label}</span>
        {!single ? <span className="car"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg></span> : null}
      </button>
      {open && !single ? (
        <div className="tk-menu fr-scroll">
          {options.map((o) => (
            <button key={o.network} type="button" data-active={o.network === value ? "" : undefined} onClick={() => { onPick(o.network); setOpen(false); }}>
              <ChainGlyph chainKey={o.key} size={28} />
              <span className="mn"><b>{o.label}</b><span>Trade on {o.label}</span></span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

// ── display-currency dropdown ────────────────────────────────────────────────
export function CurrencyMenu({ currency, rates, onCurrency }: { currency: string; rates: Record<string, number>; onCurrency: (c: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  const list = availableCurrencies(rates);
  const cur = FX_META[currency] ?? FX_META.USD;
  return (
    <span className="dk-cur" ref={ref}>
      <button type="button" className="dk-curbtn" data-open={open ? "" : undefined} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Display currency">
        <span className="cs">{cur.symbol}</span>
        <span className="cc">{currency}</span>
        <span className="car"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 9l6 6 6-6" /></svg></span>
      </button>
      {open ? (
        <div className="dk-curmenu" role="listbox">
          <div className="mh">Display currency</div>
          {list.map((c) => (
            <button key={c} type="button" role="option" aria-selected={c === currency} data-active={c === currency ? "" : undefined} onClick={() => { onCurrency(c); setOpen(false); }}>
              <span className="s">{FX_META[c].symbol}</span>
              <span className="n"><b>{c}</b><span>{FX_META[c].name}</span></span>
              <span className="ck"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

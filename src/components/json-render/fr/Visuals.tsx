"use client";

/* jsonui/Visuals.tsx — Chart (inline SVG), Diagram (Mermaid, lazy-loaded), and
   Flashcards (stateful) json-render components. Dependency-free except Mermaid,
   which is dynamically imported only when a Diagram actually renders. Merged into
   REGISTRY (./registry). Styling mirrors the fr catalog: inline styles + theme
   CSS variables, mono eyebrows, honey accent. */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { type CompProps, type Registry } from "./render";

const EYEBROW: React.CSSProperties = { fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 500, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--fg-3)" };

const CHART_PALETTE = [
  "var(--honey)",
  "var(--live)",
  "var(--danger)",
  "color-mix(in srgb, var(--honey) 55%, var(--live))",
  "color-mix(in srgb, var(--live) 60%, var(--fg-3))",
  "color-mix(in srgb, var(--danger) 55%, var(--honey))",
];

type Datum = { label: string; value: number };
type Series = { name?: string; color?: string; data: Datum[] };

function coerceDatum(raw: unknown): Datum | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rawLabel = o.label ?? o.name ?? o.x ?? o.category;
  const rawValue = o.value ?? o.y ?? o.count;
  const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(num)) return null;
  return { label: String(rawLabel ?? ""), value: num };
}

function coerceSeries(props: Record<string, unknown>): Series[] {
  const rawSeries = props.series;
  if (Array.isArray(rawSeries) && rawSeries.length) {
    const out: Series[] = [];
    rawSeries.forEach((s) => {
      if (!s || typeof s !== "object") return;
      const so = s as Record<string, unknown>;
      const data = Array.isArray(so.data) ? so.data.map(coerceDatum).filter((d): d is Datum => !!d) : [];
      if (data.length) out.push({ name: typeof so.name === "string" ? so.name : undefined, color: typeof so.color === "string" ? so.color : undefined, data });
    });
    if (out.length) return out;
  }
  const rawData = props.data;
  if (Array.isArray(rawData)) {
    const data = rawData.map(coerceDatum).filter((d): d is Datum => !!d);
    if (data.length) return [{ data }];
  }
  return [];
}

function formatValue(value: number, format: unknown): string {
  try {
    if (format === "percent") return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value);
    if (format === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
    if (Math.abs(value) >= 10000) return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  } catch {
    return String(value);
  }
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = (span / count) / step;
  const mult = err >= 7.5 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1;
  const niceStep = mult * step;
  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let t = start; t <= max + niceStep * 0.001; t += niceStep) ticks.push(Number(t.toFixed(10)));
  return ticks.length ? ticks : [min, max];
}

function CartesianChart({ type, series, height, logScale, valueFormat }: {
  type: "bar" | "line" | "area";
  series: Series[];
  height: number;
  logScale: boolean;
  valueFormat: unknown;
}) {
  const W = 560;
  const H = Math.max(150, height);
  const pad = { left: 52, right: 16, top: 14, bottom: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const categories = series.reduce<string[]>((acc, s) => (s.data.length > acc.length ? s.data.map((d) => d.label) : acc), []);
  const allValues = series.flatMap((s) => s.data.map((d) => d.value));
  const rawMax = Math.max(...allValues, 0);
  const rawMin = Math.min(...allValues, 0);

  const positives = allValues.filter((v) => v > 0);
  const useLog = logScale && positives.length > 0;
  const logMin = useLog ? Math.min(...positives) / 2 : 0;

  const yMax = type === "line" ? Math.max(...allValues) : rawMax;
  const yMin = useLog ? logMin : type === "line" ? Math.min(...allValues) : Math.min(0, rawMin);

  const project = (v: number) => {
    if (useLog) {
      const lv = Math.log10(Math.max(v, logMin));
      const lmin = Math.log10(logMin);
      const lmax = Math.log10(Math.max(yMax, logMin * 10));
      return pad.top + plotH - ((lv - lmin) / (lmax - lmin || 1)) * plotH;
    }
    return pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  };

  const ticks = useLog ? niceLogTicks(logMin, yMax) : niceTicks(yMin, yMax, 4);
  const catW = plotW / Math.max(categories.length, 1);
  const baselineY = useLog ? pad.top + plotH : project(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" style={{ display: "block", maxWidth: "100%", height: "auto", overflow: "visible" }}>
      {ticks.map((t, i) => {
        const y = project(t);
        if (!Number.isFinite(y)) return null;
        return (
          <g key={`grid-${i}`}>
            <line x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.left - 8} y={y + 3.5} textAnchor="end" style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fill: "var(--fg-3)" }}>{formatValue(t, valueFormat)}</text>
          </g>
        );
      })}

      {type !== "bar" && series.map((s, si) => {
        const color = s.color || CHART_PALETTE[si % CHART_PALETTE.length];
        const pts = s.data.map((d, i) => `${pad.left + catW * (i + 0.5)},${project(d.value)}`);
        if (!pts.length) return null;
        const areaPath = `M ${pad.left + catW * 0.5},${baselineY} L ${pts.join(" L ")} L ${pad.left + catW * (s.data.length - 0.5)},${baselineY} Z`;
        return (
          <g key={`s-${si}`}>
            {type === "area" && <path d={areaPath} fill={color} opacity={0.16} />}
            <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.data.map((d, i) => <circle key={i} cx={pad.left + catW * (i + 0.5)} cy={project(d.value)} r={2.6} fill={color} />)}
          </g>
        );
      })}

      {type === "bar" && series.map((s, si) => {
        const color = s.color || CHART_PALETTE[si % CHART_PALETTE.length];
        const groupW = catW * 0.68;
        const barW = groupW / series.length;
        return (
          <g key={`b-${si}`}>
            {s.data.map((d, i) => {
              const x = pad.left + catW * i + (catW - groupW) / 2 + barW * si;
              const y = project(d.value);
              const h = Math.max(0, baselineY - y);
              return <rect key={i} x={x} y={Math.min(y, baselineY)} width={Math.max(1, barW - 2)} height={Math.max(1, Math.abs(h))} rx={2} fill={color} />;
            })}
          </g>
        );
      })}

      {categories.map((label, i) => {
        const long = categories.length > 8;
        const x = pad.left + catW * (i + 0.5);
        if (long && i % Math.ceil(categories.length / 8) !== 0) return null;
        return <text key={`x-${i}`} x={x} y={H - pad.bottom + 15} textAnchor="middle" style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, fill: "var(--fg-3)" }}>{label.length > 10 ? `${label.slice(0, 9)}…` : label}</text>;
      })}
    </svg>
  );
}

function niceLogTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  const start = Math.floor(Math.log10(Math.max(min, 1e-9)));
  const end = Math.ceil(Math.log10(Math.max(max, min * 10)));
  for (let e = start; e <= end; e++) ticks.push(Math.pow(10, e));
  return ticks;
}

function PieChart({ series, height, donut, valueFormat }: { series: Series[]; height: number; donut: boolean; valueFormat: unknown }) {
  const data = series[0]?.data ?? [];
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const H = Math.max(150, height);
  const cx = H / 2 + 6;
  const cy = H / 2;
  const r = H / 2 - 12;
  const inner = donut ? r * 0.58 : 0;
  let angle = -Math.PI / 2;
  const polar = (radius: number, a: number) => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${H + 12} ${H}`} width={H + 12} height={H} role="img" style={{ flex: "0 0 auto", maxWidth: "100%" }}>
        {total <= 0 ? <circle cx={cx} cy={cy} r={r} fill="var(--panel-2)" /> : data.map((d, i) => {
          const frac = Math.max(0, d.value) / total;
          const a0 = angle;
          const a1 = angle + frac * Math.PI * 2;
          angle = a1;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const [x0, y0] = polar(r, a0);
          const [x1, y1] = polar(r, a1);
          const color = CHART_PALETTE[i % CHART_PALETTE.length];
          if (inner > 0) {
            const [ix0, iy0] = polar(inner, a0);
            const [ix1, iy1] = polar(inner, a1);
            return <path key={i} d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`} fill={color} stroke="var(--bg-soft)" strokeWidth={1} />;
          }
          return <path key={i} d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={color} stroke="var(--bg-soft)" strokeWidth={1} />;
        })}
      </svg>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-2)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, flex: "0 0 auto", background: CHART_PALETTE[i % CHART_PALETTE.length] }} />
            <span style={{ wordBreak: "break-word" }}>{d.label}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-3)" }}>{formatValue(d.value, valueFormat)}{total > 0 ? ` · ${Math.round((Math.max(0, d.value) / total) * 100)}%` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const visualComponents: Registry = {
  Chart({ props }: CompProps) {
    const p = props as Record<string, unknown>;
    const series = coerceSeries(p);
    const type = (["bar", "line", "area", "pie", "donut"].includes(String(p.type)) ? p.type : "bar") as "bar" | "line" | "area" | "pie" | "donut";
    const height = typeof p.height === "number" ? p.height : 220;
    const legend = series.length > 1 && series.some((s) => s.name);
    return (
      <figure style={{ display: "grid", gap: 9, margin: 0, minWidth: 0 }}>
        {typeof p.title === "string" && p.title ? <figcaption style={{ color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13.5, fontWeight: 600 }}>{p.title}</figcaption> : null}
        {series.length === 0 ? (
          <div style={{ ...EYEBROW, padding: "18px 0", textAlign: "center", color: "var(--fg-4)" }}>no chart data</div>
        ) : type === "pie" || type === "donut" ? (
          <PieChart series={series} height={height} donut={type === "donut"} valueFormat={p.valueFormat} />
        ) : (
          <CartesianChart type={type} series={series} height={height} logScale={!!p.logScale} valueFormat={p.valueFormat} />
        )}
        {legend ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {series.map((s, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--fg-2)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color || CHART_PALETTE[i % CHART_PALETTE.length] }} />
                {s.name || `Series ${i + 1}`}
              </span>
            ))}
          </div>
        ) : null}
        {typeof p.caption === "string" && p.caption ? <p style={{ ...EYEBROW, margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 11.5, color: "var(--fg-3)" }}>{p.caption}</p> : null}
      </figure>
    );
  },

  Diagram({ props }: CompProps) {
    const p = props as Record<string, unknown>;
    const code = String((typeof p.code === "string" && p.code) || (typeof p.mermaid === "string" && p.mermaid) || "").trim();
    const reactId = useId().replace(/[^a-zA-Z0-9]/g, "");
    const hostRef = useRef<HTMLDivElement>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
      let cancelled = false;
      if (!code || !hostRef.current) return;
      setError(false);
      (async () => {
        try {
          const mermaid = (await import("mermaid")).default;
          const dark = typeof document !== "undefined" && !document.documentElement.classList.contains("hive-light");
          mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
          const { svg } = await mermaid.render(`fr-mermaid-${reactId}`, code);
          if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
        } catch {
          if (!cancelled) setError(true);
        }
      })();
      return () => { cancelled = true; };
    }, [code, reactId]);

    if (!code) return <div style={{ ...EYEBROW, padding: "12px 0", color: "var(--fg-4)" }}>no diagram source</div>;

    return (
      <figure style={{ display: "grid", gap: 8, margin: 0, minWidth: 0 }}>
        {typeof p.caption === "string" && p.caption ? <figcaption style={EYEBROW}>{p.caption}</figcaption> : null}
        {error ? (
          <pre className="fr-scroll" style={{ margin: 0, overflow: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--bg-soft)", color: "var(--fg-2)", padding: 12, fontFamily: "var(--f-mono)", fontSize: 12, whiteSpace: "pre-wrap" }}><code>{code}</code></pre>
        ) : (
          <div ref={hostRef} className="fr-scroll" style={{ overflow: "auto", display: "flex", justifyContent: "center", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)", background: "var(--bg-soft)", padding: 14 }} />
        )}
      </figure>
    );
  },

  Flashcards({ props }: CompProps) {
    const p = props as Record<string, unknown>;
    const cards = useMemo(() => (Array.isArray(p.cards) ? p.cards : []).map((raw) => {
      const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return { front: String(c.front ?? c.question ?? c.term ?? ""), back: String(c.back ?? c.answer ?? c.definition ?? "") };
    }).filter((c) => c.front || c.back), [p.cards]);
    const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
    const [pos, setPos] = useState(0);
    const [flipped, setFlipped] = useState(false);

    useEffect(() => { setOrder(cards.map((_, i) => i)); setPos(0); setFlipped(false); }, [cards.length]);

    if (!cards.length) return <div style={{ ...EYEBROW, padding: "12px 0", color: "var(--fg-4)" }}>no cards</div>;
    const idx = order[Math.min(pos, order.length - 1)] ?? 0;
    const card = cards[idx];
    const go = (delta: number) => { setFlipped(false); setPos((v) => (v + delta + order.length) % order.length); };
    const shuffle = () => {
      const next = [...order];
      for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(((i + 1) * 0.6180339887 + pos * 0.31) % (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
      setOrder(next); setPos(0); setFlipped(false);
    };

    return (
      <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          {typeof p.title === "string" && p.title ? <span style={{ color: "var(--fg)", fontSize: 13.5, fontWeight: 600 }}>{p.title}</span> : <span />}
          <span style={{ ...EYEBROW }}>{pos + 1} / {cards.length}</span>
        </div>
        <button type="button" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "Show front" : "Reveal answer"}
          style={{ display: "grid", placeItems: "center", minHeight: 128, padding: "22px 20px", borderRadius: "var(--radius)", border: `1px solid ${flipped ? "var(--honey-line)" : "var(--line-2)"}`, background: flipped ? "var(--honey-soft)" : "var(--panel-2)", color: flipped ? "var(--honey)" : "var(--fg)", cursor: "pointer", textAlign: "center", transition: "all 160ms ease" }}>
          <span style={{ ...EYEBROW, marginBottom: 8 }}>{flipped ? "Answer" : "Card"}</span>
          <span style={{ fontFamily: "var(--f-body)", fontSize: 16, lineHeight: 1.45, fontWeight: flipped ? 500 : 600, wordBreak: "break-word" }}>{flipped ? card.back : card.front}</span>
          <span style={{ ...EYEBROW, marginTop: 10, opacity: 0.7 }}>tap to {flipped ? "hide" : "flip"}</span>
        </button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <FcBtn onClick={() => go(-1)}>‹ Prev</FcBtn>
          <FcBtn onClick={() => setFlipped((f) => !f)} primary>{flipped ? "Hide" : "Flip"}</FcBtn>
          <FcBtn onClick={() => go(1)}>Next ›</FcBtn>
          <FcBtn onClick={shuffle}>Shuffle</FcBtn>
        </div>
      </div>
    );
  },
};

function FcBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{ padding: "8px 15px", borderRadius: 99, border: `1px solid ${primary ? "var(--honey)" : "var(--line-2)"}`, background: primary ? "var(--honey)" : "var(--panel-2)", color: primary ? "#1a1305" : "var(--fg-2)", cursor: "pointer", fontFamily: "var(--f-body)", fontSize: 12.5, fontWeight: 500 }}>{children}</button>
  );
}

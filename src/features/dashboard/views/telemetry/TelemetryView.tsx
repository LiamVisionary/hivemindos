"use client";

// Telemetry — the fleet resource monitor. Recreated from the "Telemetry"
// Claude Design handoff (honey/clay), wired to REAL per-machine collector
// metrics: RAM, CPU, disk, network, swap/cache, top processes, load, uptime,
// and round-trip latency reported by each machine's collector /health endpoint
// (src/app/api/fleet/discover → scripts/agent-telemetry-collector.mjs
// systemStats). Sparklines are drawn from a live in-memory sample buffer that
// fills as discovery polls come in — no simulated data anywhere. Metrics a
// given platform can't measure (e.g. temperature / disk I/O on macOS) render as
// "—" rather than a fabricated number.
//
// Styling reuses the Zero Human Companies design system (scoped .zhc-root
// tokens + the canonical animated loading primitives) so both dark and the
// hive-light/clay theme come for free.

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { FleetMachine } from "@/components/fleet/fleet-data";
import { Panel, Skeleton, Spinner } from "@/features/dashboard/views/zero-human-companies/primitives";
import "@/features/dashboard/views/zero-human-companies/theme.css";

const HISTORY_LENGTH = 48;

export type TelemetryViewProps = {
  machines: FleetMachine[];
  loading: boolean;
  theme: "light" | "dark";
  /** Epoch ms of the last fleet-discovery refresh (for the "updated" pill). */
  checkedAt?: number | null;
  /** Manual refresh — wired to the fleet-discovery poll. */
  onRefresh?: () => void | Promise<void>;
  /** Open the Fleet view focused on a machine (the card "Open details" action). */
  onOpenMachine?: (machineId: string) => void;
  /** Live poll cadence in seconds, shown in the streaming pill. */
  pollSeconds?: number;
};

// ── formatting helpers ──────────────────────────────────────────────────────

function fmtUptime(sec?: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtGb(n?: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(n >= 100 ? 0 : digits);
}

function fmtRss(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function fmtRelative(ts?: number | null, now?: number): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  const delta = Math.max(0, (now ?? Date.now()) - ts);
  const s = Math.round(delta / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  return `${h}h ago`;
}

/** Combine per-machine history arrays index-wise (aligned from the most recent
 *  sample) into one fleet series, over the shortest common length. */
function aggregateHistory(arrays: Array<number[] | undefined>, mode: "avg" | "sum"): number[] | null {
  const valid = arrays.filter((a): a is number[] => Array.isArray(a) && a.length >= 2);
  if (!valid.length) return null;
  const minLen = Math.min(...valid.map((a) => a.length));
  if (minLen < 2) return null;
  const out: number[] = [];
  for (let i = 0; i < minLen; i += 1) {
    let sum = 0;
    for (const arr of valid) sum += arr[arr.length - minLen + i];
    out.push(mode === "avg" ? sum / valid.length : sum);
  }
  return out;
}

function pctColor(pct?: number | null): string {
  if (pct == null) return "var(--fg-3)";
  if (pct >= 85) return "var(--danger)";
  if (pct >= 65) return "var(--honey)";
  return "var(--live)";
}

function isOnline(m: FleetMachine): boolean {
  return m.uptime === "online" || Boolean(m.system?.checkedAt);
}

function machineOs(m: FleetMachine): string {
  const s = m.system;
  if (s?.platform) {
    const plat = s.platform === "darwin" ? "macOS" : s.platform === "linux" ? "Linux" : s.platform;
    return `${plat}${s.osRelease ? ` ${s.osRelease}` : ""}${s.arch ? ` · ${s.arch}` : ""}`;
  }
  return m.os || "—";
}

type Tone = { dot: string; live: boolean; label: string };

function machineTone(m: FleetMachine): Tone {
  if (!isOnline(m)) return { dot: "var(--fg-4)", live: false, label: "offline" };
  const working = m.agents?.some((a) => a.state === "working");
  const ramPct = m.system?.ramPct;
  if (ramPct != null && ramPct >= 85) return { dot: "var(--danger)", live: false, label: "pressure" };
  if (working) return { dot: "var(--live)", live: true, label: "working" };
  return { dot: "var(--live)", live: false, label: "healthy" };
}

// ── sparkline (inline SVG — repo precedent: AnalyticsPanel.Sparkline) ────────

function Sparkline({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  const gradientId = useMemo(() => `tlm-spark-${Math.random().toString(36).slice(2)}`, []);
  const w = 240;
  const h = height;
  const pad = 3;
  if (!data.length) return <div style={{ height: h }} />;
  const series = data.length === 1 ? [data[0], data[0]] : data;
  // Center the data around its midpoint with a minimum span, so a nearly-flat
  // real series (or just the first couple of live samples) reads as a calm,
  // proportional line instead of a full-height zig-zag. The buffer fills with
  // real movement over successive polls and the span tracks it.
  const rawMin = Math.min(...series);
  const rawMax = Math.max(...series);
  const mid = (rawMin + rawMax) / 2;
  const span = Math.max(rawMax - rawMin, Math.abs(rawMax) * 0.2, 0.001) * 1.25;
  const min = mid - span / 2;
  const max = mid + span / 2;
  const range = max - min || 1;
  const stepX = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;
  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const line = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${(w - pad).toFixed(1)},${h - pad}`;
  const lastX = x(series.length - 1);
  const lastY = y(series[series.length - 1]);
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.26} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.1} fill={color} />
    </svg>
  );
}

// ── small building blocks ───────────────────────────────────────────────────

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 4, borderRadius: 999, background: "var(--line-2)", overflow: "hidden", marginTop: 8 }}>
      <div style={{ height: "100%", borderRadius: 999, width: `${Math.max(0, Math.min(100, pct))}%`, background: color, transition: "width 600ms cubic-bezier(.2,.7,.3,1)" }} />
    </div>
  );
}

function MetricHead({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <span className="mcap" style={{ letterSpacing: "0.12em", color: "var(--fg-3)" }}>{label}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: valueColor ?? "var(--fg-2)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 999, border: "1px solid var(--line-2)", background: "var(--panel-2)", fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--f-mono)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

// ── machine card ────────────────────────────────────────────────────────────

function MachineCard({
  m, history, onOpen,
}: { m: FleetMachine; history: Map<string, number[]>; onOpen?: (id: string) => void }) {
  const s = m.system;
  const tone = machineTone(m);
  const online = isOnline(m);
  const ramPct = s?.ramPct ?? null;
  const cpuPct = s?.cpuPct ?? null;
  const diskPct = s?.diskPct ?? null;
  const pressure = ramPct != null && ramPct >= 82;
  const topProc = s?.topProcesses?.[0];
  const procCount = s?.procCount;

  // Prefer the collector's real rolling history (dense, immediate); fall back to
  // the client-accumulated buffer for machines on an older collector.
  const hasHist = (arr?: number[]): arr is number[] => Array.isArray(arr) && arr.length >= 2;
  const memHist = hasHist(s?.history?.ram) ? s!.history!.ram : (history.get(`mem-${m.id}`) ?? []);
  const cpuHist = hasHist(s?.history?.cpu) ? s!.history!.cpu : (history.get(`cpu-${m.id}`) ?? []);
  const netHist = hasHist(s?.history?.netRx) ? s!.history!.netRx : (history.get(`net-${m.id}`) ?? []);

  const cardBorder = pressure ? "var(--honey-line)" : "var(--line)";

  return (
    <div style={{ border: `1px solid ${cardBorder}`, borderRadius: 16, background: "var(--panel)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, padding: "16px 18px 14px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span className={"dot" + (tone.live ? " live" : "")} style={{ color: tone.dot, width: 9, height: 9 }} />
            <span style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 17, color: "var(--fg)" }}>{m.name}</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--fg-3)", border: "1px solid var(--line-2)", borderRadius: 6, padding: "1px 6px" }}>{m.role}</span>
            {pressure ? (
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--honey)", border: "1px solid var(--honey-line)", background: "var(--honey-soft)", borderRadius: 6, padding: "1px 6px" }}>Memory pressure</span>
            ) : null}
          </div>
          <div style={{ color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {machineOs(m)}{m.location ? ` · ${m.location}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)" }}>up {fmtUptime(s?.uptimeSec)}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 5 }}>
            {procCount != null ? `${procCount} processes` : online ? "—" : "collector offline"}
          </div>
        </div>
      </div>

      {online && s ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
            {/* Memory */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", borderRight: "1px solid var(--line)" }}>
              <MetricHead label="Memory" value={ramPct != null ? `${Math.round(ramPct)}%` : "—"} valueColor={pctColor(ramPct)} />
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: "var(--fg)", marginTop: 6 }}>
                {fmtGb(s.ramUsedGb)} <span style={{ color: "var(--fg-3)", fontSize: 12 }}>/ {fmtGb(s.ramTotalGb, 0)} GB</span>
              </div>
              <Bar pct={ramPct ?? 0} color={pctColor(ramPct)} />
              <div style={{ marginTop: 8 }}><Sparkline data={memHist} color={ramPct != null && ramPct >= 85 ? "var(--danger)" : "var(--honey)"} /></div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 2 }}>
                swap {s.swapUsedGb != null ? `${fmtGb(s.swapUsedGb)} GB` : "—"} · cache {s.cacheGb != null ? `${fmtGb(s.cacheGb)} GB` : "—"}
              </div>
            </div>

            {/* CPU */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)" }}>
              <MetricHead label="CPU load" value={cpuPct != null ? `${Math.round(cpuPct)}%` : "—"} valueColor={pctColor(cpuPct)} />
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: "var(--fg)", marginTop: 6 }}>
                {s.cpuCores ?? "—"} cores <span style={{ color: "var(--fg-3)", fontSize: 12 }}>· {s.loadAvg1m != null ? s.loadAvg1m.toFixed(2) : "—"} load</span>
              </div>
              <Bar pct={cpuPct ?? 0} color={pctColor(cpuPct)} />
              <div style={{ marginTop: 8 }}><Sparkline data={cpuHist} color={cpuPct != null && cpuPct >= 85 ? "var(--danger)" : "var(--honey)"} /></div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.tempC != null ? `${s.tempC}°C · ` : ""}{s.cpuModel || "—"}
              </div>
            </div>

            {/* Network */}
            <div style={{ padding: "14px 18px", borderRight: "1px solid var(--line)" }}>
              <MetricHead label="Network" value={s.rttMs != null ? `${s.rttMs}ms` : "—"} valueColor="var(--live)" />
              <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--fg)" }}>↓ {s.netRxMBs != null ? s.netRxMBs.toFixed(1) : "—"}<span style={{ color: "var(--fg-3)", fontSize: 11 }}> MB/s</span></div>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--fg-2)" }}>↑ {s.netTxMBs != null ? s.netTxMBs.toFixed(1) : "—"}<span style={{ color: "var(--fg-3)", fontSize: 11 }}> MB/s</span></div>
              </div>
              <div style={{ marginTop: 12 }}><Sparkline data={netHist} color="var(--live)" /></div>
            </div>

            {/* Disk */}
            <div style={{ padding: "14px 18px" }}>
              <MetricHead label="Disk" value={diskPct != null ? `${Math.round(diskPct)}%` : "—"} />
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: "var(--fg)", marginTop: 6 }}>
                {s.diskUsedGb != null ? `${fmtGb(s.diskUsedGb, 0)} GB` : "—"} <span style={{ color: "var(--fg-3)", fontSize: 12 }}>/ {s.diskTotalGb != null ? `${fmtGb(s.diskTotalGb, 0)} GB` : "—"}</span>
              </div>
              <Bar pct={diskPct ?? 0} color="var(--fg-3)" />
              <div style={{ display: "flex", gap: 14, marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>
                <span>r {s.diskReadMBs != null ? s.diskReadMBs.toFixed(1) : "—"} MB/s</span>
                <span>w {s.diskWriteMBs != null ? s.diskWriteMBs.toFixed(1) : "—"} MB/s</span>
              </div>
            </div>
          </div>

          {/* footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 18px", background: "var(--bg-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Top RSS</span>
              {topProc ? (
                <>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topProc.name}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--honey)" }}>{fmtRss(topProc.rssMb)}</span>
                </>
              ) : (
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)" }}>—</span>
              )}
            </div>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(m.id)}
                className="zhc-btn-ghost"
                style={{ border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-2)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontFamily: "var(--f-body)", cursor: "pointer" }}
              >
                Open details
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div style={{ padding: "22px 18px", display: "flex", alignItems: "center", gap: 10, color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 12 }}>
          <span className="dot" style={{ color: "var(--fg-4)" }} />
          No collector telemetry from this machine yet.
        </div>
      )}
    </div>
  );
}

// ── KPI tile ────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, unit, sub, spark, sparkColor, delta, deltaColor,
}: {
  label: string; value: string; unit: string; sub: string;
  spark: number[]; sparkColor: string; delta: string; deltaColor: string;
}) {
  return (
    <div style={{ position: "relative", border: "1px solid var(--line)", borderRadius: 20, background: "var(--panel)", boxShadow: "var(--shadow)", padding: "16px 18px 8px", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div className="mcap" style={{ letterSpacing: "0.12em", color: "var(--fg-3)" }}>{label}</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: deltaColor }}>{delta}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
        <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 30, lineHeight: 1, letterSpacing: "-0.5px", color: "var(--fg)" }}>{value}</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-3)" }}>{unit}</div>
      </div>
      <div style={{ color: "var(--fg-3)", fontSize: 11.5, marginTop: 5 }}>{sub}</div>
      <div style={{ marginTop: 6 }}><Sparkline data={spark} color={sparkColor} height={38} /></div>
    </div>
  );
}

// ── loading skeleton ────────────────────────────────────────────────────────

function TelemetrySkeleton() {
  return (
    <div role="status" aria-label="Loading fleet telemetry" style={{ display: "grid", gap: 22 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))", gap: 14 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 20, background: "var(--panel)", padding: "16px 18px", display: "grid", gap: 10 }}>
            <Skeleton width={90} height={9} />
            <Skeleton width={120} height={28} />
            <Skeleton width="100%" height={38} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", padding: 18, display: "grid", gap: 12 }}>
              <Skeleton width={160} height={16} />
              <Skeleton width="100%" height={72} />
            </div>
          ))}
        </div>
        <div style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", padding: 18, display: "grid", gap: 12 }}>
          <Skeleton width={140} height={16} />
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} width="100%" height={26} />)}
        </div>
      </div>
    </div>
  );
}

// ── main view ───────────────────────────────────────────────────────────────

export function TelemetryView({ machines, loading, theme, checkedAt, onRefresh, onOpenMachine, pollSeconds = 15 }: TelemetryViewProps) {
  const historyRef = useRef<Map<string, number[]>>(new Map());
  const [, setTick] = useState(0);
  const [now, setNow] = useState<number | null>(null);

  const reporting = useMemo(() => machines.filter((m) => m.system && isOnline(m)), [machines]);

  // Signature that changes whenever any machine reports a fresh sample.
  const sampleSignature = useMemo(
    () => machines.map((m) => `${m.id}:${m.system?.checkedAt ?? 0}`).join("|"),
    [machines],
  );

  // Fleet aggregate KPIs (real — averaged/summed across reporting machines).
  const fleet = useMemo(() => {
    const memUsed = reporting.reduce((sum, m) => sum + (m.system?.ramUsedGb ?? 0), 0);
    const memTotal = reporting.reduce((sum, m) => sum + (m.system?.ramTotalGb ?? 0), 0);
    const cpuVals = reporting.map((m) => m.system?.cpuPct).filter((v): v is number => v != null);
    const diskVals = reporting.map((m) => m.system?.diskPct).filter((v): v is number => v != null);
    const netTotal = reporting.reduce((sum, m) => sum + (m.system?.netRxMBs ?? 0), 0);
    const cores = reporting.reduce((sum, m) => sum + (m.system?.cpuCores ?? 0), 0);
    const procs = reporting.reduce((sum, m) => sum + (m.system?.procCount ?? 0), 0);
    return {
      memUsed, memTotal,
      memPct: memTotal > 0 ? (memUsed / memTotal) * 100 : 0,
      cpuAvg: cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : 0,
      diskAvg: diskVals.length ? diskVals.reduce((a, b) => a + b, 0) / diskVals.length : 0,
      netTotal, cores, procs,
    };
  }, [reporting]);

  // Append a real sample to each series on every fresh discovery poll.
  useEffect(() => {
    if (!reporting.length) return;
    const hist = historyRef.current;
    const push = (key: string, value: number) => {
      const arr = hist.get(key) ?? [];
      arr.push(value);
      if (arr.length > HISTORY_LENGTH) arr.splice(0, arr.length - HISTORY_LENGTH);
      hist.set(key, arr);
    };
    for (const m of reporting) {
      const s = m.system;
      if (!s) continue;
      if (s.ramPct != null) push(`mem-${m.id}`, s.ramPct);
      if (s.cpuPct != null) push(`cpu-${m.id}`, s.cpuPct);
      push(`net-${m.id}`, s.netRxMBs ?? 0);
    }
    push("kpi-mem", fleet.memPct);
    push("kpi-cpu", fleet.cpuAvg);
    push("kpi-net", fleet.netTotal);
    push("kpi-disk", fleet.diskAvg);
    setTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleSignature]);

  // Tick the "updated Xs ago" label without re-polling.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const hist = historyRef.current;

  // Fleet-wide top processes by RSS (real — from each collector's ps walk).
  const topProcesses = useMemo(() => {
    const flat: Array<{ name: string; machine: string; rssMb: number }> = [];
    for (const m of reporting) {
      for (const p of m.system?.topProcesses ?? []) {
        flat.push({ name: p.name, machine: m.name, rssMb: p.rssMb });
      }
    }
    flat.sort((a, b) => b.rssMb - a.rssMb);
    return flat.slice(0, 7);
  }, [reporting]);
  const maxRss = topProcesses[0]?.rssMb ?? 1;

  // Resource notices — derived from real thresholds, no fabricated events.
  const notices = useMemo(() => {
    const out: Array<{ color: string; glow: string; title: string; body: string }> = [];
    for (const m of reporting) {
      const s = m.system!;
      if (s.ramPct != null && s.ramPct >= 82) {
        out.push({
          color: "var(--honey)", glow: "var(--honey-soft)",
          title: `${m.name} · memory pressure`,
          body: `RAM at ${Math.round(s.ramPct)}% (${fmtGb(s.ramUsedGb)} / ${fmtGb(s.ramTotalGb, 0)} GB).${s.topProcesses?.[0] ? ` ${s.topProcesses[0].name} is the largest resident set.` : ""}`,
        });
      }
      if (s.swapUsedGb != null && s.swapUsedGb >= 1) {
        out.push({
          color: "var(--danger)", glow: "var(--danger-soft)",
          title: `${m.name} · swap active`,
          body: `${fmtGb(s.swapUsedGb)} GB swapped to disk. Sustained swap means the machine is over-committed on RAM.`,
        });
      }
      if (s.diskPct != null && s.diskPct >= 90) {
        out.push({
          color: "var(--danger)", glow: "var(--danger-soft)",
          title: `${m.name} · disk almost full`,
          body: `Root volume at ${Math.round(s.diskPct)}% (${fmtGb(s.diskUsedGb, 0)} / ${fmtGb(s.diskTotalGb, 0)} GB).`,
        });
      }
      if (s.tempC != null && s.tempC >= 85) {
        out.push({
          color: "var(--honey)", glow: "var(--honey-soft)",
          title: `${m.name} · running hot`,
          body: `CPU temperature at ${s.tempC}°C.`,
        });
      }
    }
    const offline = machines.filter((m) => !m.system || !isOnline(m));
    for (const m of offline) {
      out.push({
        color: "var(--fg-4)", glow: "var(--line-2)",
        title: `${m.name} · collector offline`,
        body: "No resource telemetry from this machine — its collector isn't reporting on the tailnet.",
      });
    }
    if (out.length === 0) {
      out.push({
        color: "var(--live)", glow: "var(--live-soft)",
        title: "All nodes within budget",
        body: "No memory, swap, disk, or thermal pressure across the tailnet. Collectors are reporting clean.",
      });
    }
    return out;
  }, [reporting, machines]);

  const nodeCount = reporting.length;
  const showSkeleton = loading && reporting.length === 0;

  // Fleet KPI sparklines prefer the collectors' real rolling history (aggregated
  // across nodes), falling back to the client-accumulated buffer.
  const kpiMemHist = aggregateHistory(reporting.map((m) => m.system?.history?.ram), "avg") ?? (hist.get("kpi-mem") ?? []);
  const kpiCpuHist = aggregateHistory(reporting.map((m) => m.system?.history?.cpu), "avg") ?? (hist.get("kpi-cpu") ?? []);
  const kpiNetHist = aggregateHistory(reporting.map((m) => m.system?.history?.netRx), "sum") ?? (hist.get("kpi-net") ?? []);

  const kpis = [
    {
      label: "Memory in use", value: fmtGb(fleet.memUsed), unit: `/ ${Math.round(fleet.memTotal)} GB`,
      sub: `${Math.round(fleet.memPct)}% of fleet RAM committed`, spark: kpiMemHist,
      sparkColor: fleet.memPct >= 85 ? "var(--danger)" : "var(--honey)",
      delta: nodeCount ? `${nodeCount} nodes` : "no nodes", deltaColor: "var(--fg-3)",
    },
    {
      label: "CPU load", value: `${Math.round(fleet.cpuAvg)}`, unit: "% avg",
      sub: `${nodeCount} nodes · ${fleet.cores} cores`, spark: kpiCpuHist,
      sparkColor: fleet.cpuAvg >= 85 ? "var(--danger)" : "var(--honey)",
      delta: fleet.cpuAvg >= 60 ? "high" : "nominal", deltaColor: fleet.cpuAvg >= 60 ? "var(--honey)" : "var(--live)",
    },
    {
      label: "Network", value: fleet.netTotal.toFixed(1), unit: "MB/s ↓",
      sub: "aggregate throughput · all nodes", spark: kpiNetHist,
      sparkColor: "var(--live)", delta: "live", deltaColor: "var(--live)",
    },
    {
      label: "Disk", value: `${Math.round(fleet.diskAvg)}`, unit: "% avg",
      sub: `across ${nodeCount} volumes`, spark: hist.get("kpi-disk") ?? [],
      sparkColor: fleet.diskAvg >= 85 ? "var(--danger)" : "var(--fg-3)",
      delta: "steady", deltaColor: "var(--fg-3)",
    },
  ];

  return (
    <div
      className="zhc-root frfade"
      data-theme={theme}
      style={{ position: "relative", height: "100%", background: "var(--bg)", color: "var(--fg)", borderRadius: 14, overflow: "hidden", border: "1px solid var(--line)" }}
    >
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 60% at 12% -10%, color-mix(in srgb, var(--honey) 8%, transparent), transparent 55%), radial-gradient(120% 60% at 88% -10%, color-mix(in srgb, var(--live) 5%, transparent), transparent 55%)" }} />
      <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.06, pointerEvents: "none" }}>
        <defs>
          <pattern id="tlmHex" width="48" height="55" patternUnits="userSpaceOnUse">
            <polygon points="24,1 47,14 47,40 24,53 1,40 1,14" fill="none" stroke="var(--honey-line)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tlmHex)" />
      </svg>

      {/* Inner scroll region — .commandMain is a fixed-height, overflow:hidden
          shell, so this view owns its own scroll while the backdrop stays put. */}
      <div className="frsc" style={{ position: "relative", zIndex: 1, height: "100%", overflowY: "auto", padding: "24px 30px 60px" }}>
        {/* header */}
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
          <div>
            <div className="mcap" style={{ color: "var(--honey)", letterSpacing: "0.14em" }}>Private swarm command · Resources</div>
            <h1 style={{ margin: "6px 0 0", fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 34, letterSpacing: "-0.5px", lineHeight: 1, color: "var(--fg)" }}>Telemetry</h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Pill>
              <span className="dot live" style={{ color: "var(--live)" }} />
              {loading ? "Refreshing" : `Updated ${fmtRelative(checkedAt, now ?? undefined)}`}
            </Pill>
            <Pill>{nodeCount} {nodeCount === 1 ? "machine" : "machines"} · {fleet.procs} processes</Pill>
            {onRefresh ? (
              <button
                type="button"
                onClick={() => void onRefresh()}
                disabled={loading}
                className="zhc-btn-ghost"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg-2)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontFamily: "var(--f-body)", cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1 }}
              >
                {loading ? <Spinner size={12} /> : null}
                Refresh
              </button>
            ) : null}
          </div>
        </header>

        {showSkeleton ? (
          <TelemetrySkeleton />
        ) : reporting.length === 0 ? (
          <div style={{ border: "1px dashed var(--line-2)", borderRadius: 16, padding: "48px 24px", textAlign: "center", color: "var(--fg-3)" }}>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 16, color: "var(--fg-2)", marginBottom: 6 }}>No collector telemetry yet</div>
            <div style={{ fontSize: 13 }}>No machine on the tailnet is reporting resource metrics. Start a collector, or press Refresh once one is online.</div>
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))", gap: 14, marginBottom: 22 }}>
              {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
            </div>

            {/* two-column body */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 18, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                {machines.map((m) => <MachineCard key={m.id} m={m} history={hist} onOpen={onOpenMachine} />)}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 0 }}>
                {/* top processes */}
                <div style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
                  <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 15, color: "var(--fg)" }}>Top processes by memory</div>
                    <div style={{ color: "var(--fg-3)", fontSize: 11.5, marginTop: 3 }}>Resident set size · across {nodeCount} {nodeCount === 1 ? "machine" : "machines"}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {topProcesses.length ? topProcesses.map((p, i) => (
                      <div key={`${p.machine}-${p.name}-${i}`} style={{ padding: "11px 18px", borderBottom: "1px solid var(--line)" }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ fontFamily: "var(--f-body)", fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>{p.name}</span>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}> · {p.machine}</span>
                          </div>
                          <span style={{ fontFamily: "var(--f-mono)", fontSize: 12.5, color: p.rssMb >= maxRss * 0.6 ? "var(--honey)" : "var(--fg-2)", flex: "0 0 auto" }}>{fmtRss(p.rssMb)}</span>
                        </div>
                        <div style={{ height: 3, borderRadius: 999, background: "var(--line-2)", overflow: "hidden", marginTop: 7 }}>
                          <div style={{ height: "100%", borderRadius: 999, width: `${(p.rssMb / maxRss) * 100}%`, background: p.rssMb >= maxRss * 0.6 ? "var(--honey)" : "var(--fg-3)", transition: "width 600ms ease" }} />
                        </div>
                      </div>
                    )) : (
                      <div style={{ padding: "16px 18px", color: "var(--fg-3)", fontSize: 12.5 }}>No process data reported yet.</div>
                    )}
                  </div>
                </div>

                {/* resource notices */}
                <div style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
                  <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid var(--line)" }}>
                    <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 15, color: "var(--fg)" }}>Resource notices</div>
                    <div style={{ color: "var(--fg-3)", fontSize: 11.5, marginTop: 3 }}>What needs attention right now</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {notices.map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 11, padding: "13px 18px", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: a.color, marginTop: 6, flex: "0 0 auto", boxShadow: `0 0 0 3px ${a.glow}` }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>{a.title}</div>
                          <div style={{ color: "var(--fg-2)", fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{a.body}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "12px 18px", background: "var(--bg-soft)", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--live)", flex: "0 0 auto" }} />
                    Read-only collectors · tailnet-only · stored locally
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TelemetryView;

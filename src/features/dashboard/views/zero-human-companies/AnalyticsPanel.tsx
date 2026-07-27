"use client";
// Zero Human Companies — generic per-company "Analytics" tab. Self-fetches the
// company's linked provider summary (PostHog / Plausible / GA4 / HivemindOS
// funnel) from /api/companies/{id}/analytics, mirroring the Emails tab: lazy
// load, refresh nonce, and four honest states — loading / error / unconfigured
// (guided setup) / credential-missing / live. No CockpitHandlers wiring needed.
import React from "react";
import { Panel, Ring, SectionLabel, Spinner, Skeleton } from "./primitives";
import { AnalyticsProviderCards } from "./AnalyticsProviderCards";
import type { Colony } from "./types";
import type {
  AnalyticsProviderKey,
  AnalyticsProviderStatus,
  AnalyticsSummary,
  AnalyticsSummaryResult,
  CompanyAnalyticsConfig,
} from "@/lib/services/company-analytics/types";

function num(n?: number): string {
  if (n === undefined) return "—";
  return n.toLocaleString("en-US");
}

/** Time windows preloaded when the panel opens so switching is instant. */
const RANGES = [7, 30, 90];

/** Site favicon via Google's public s2 service (no key, returns a globe fallback),
 *  degrading to a glyph for non-domain sources (direct / unknown) or on load error. */
function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = React.useState(false);
  const isDomain = /\./.test(domain) && !domain.startsWith("(");
  if (!isDomain || failed) {
    return (
      <span aria-hidden style={{ width: 14, flexShrink: 0, textAlign: "center", color: "var(--fg-4)", fontSize: 11 }}>
        {domain === "direct" ? "↳" : "◍"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny cross-origin favicon; next/image would need per-domain remotePatterns
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ borderRadius: 3, flexShrink: 0, display: "block" }}
    />
  );
}

// Cloned from Cockpit's local KStat (not exported) — a single at-a-glance number.
function Stat({
  value,
  label,
  tone,
  last,
}: {
  value: string | number;
  label: string;
  tone?: "honey" | null;
  last?: boolean;
}) {
  const color = tone === "honey" ? "var(--honey-2)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", minWidth: 72, padding: "0 16px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 600, color, lineHeight: 1, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

function AnalyticsPlaceholder({
  icon,
  title,
  body,
  tone = "muted",
}: {
  icon: string;
  title: string;
  body: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "34px 16px", textAlign: "center" }}>
      <span aria-hidden style={{ fontSize: 30 }}>{icon}</span>
      <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 600, color: tone === "warn" ? "var(--danger-2)" : "var(--fg-2)" }}>{title}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", maxWidth: 480, lineHeight: 1.55 }}>{body}</span>
    </div>
  );
}

/** Shape-matched skeleton echoing the live dashboard's ring + stat tiles. */
function AnalyticsLoadingSkeleton() {
  return (
    <div role="status" aria-label="Loading analytics" style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", padding: "10px 0" }}>
      <Skeleton width={64} height={64} radius={999} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <Skeleton width={58} height={22} />
          <Skeleton width={44} height={9} />
        </div>
      ))}
    </div>
  );
}

/** Compact daily-visitors trend line. Draws a filled area + stroke + last-point dot. */
function Sparkline({ points }: { points: { date: string; visitors: number }[] }) {
  const w = 150;
  const h = 36;
  const pad = 3;
  const vals = points.map((p) => p.visitors);
  const max = Math.max(1, ...vals);
  const stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coord = (v: number, i: number): [number, number] => [
    pad + i * stepX,
    h - pad - (v / max) * (h - pad * 2),
  ];
  const linePts = points.map((p, i) => coord(p.visitors, i).join(",")).join(" ");
  const [lx, ly] = coord(vals[vals.length - 1], points.length - 1);
  const areaPts = `${pad},${h - pad} ${linePts} ${w - pad},${h - pad}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }} title={`${points.length} days`}>
      <svg width={w} height={h} style={{ overflow: "visible" }} aria-hidden>
        <polygon points={areaPts} fill="var(--honey-2)" opacity={0.1} />
        <polyline points={linePts} fill="none" stroke="var(--honey-2)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={lx} cy={ly} r={2.4} fill="var(--honey-2)" />
      </svg>
      <span className="mono-cap" style={{ color: "var(--fg-4)" }}>daily visitors</span>
    </div>
  );
}

/** A ranked breakdown (top events / pages / sources) with a proportional track bar.
 *  `withIcons` renders a site favicon per row (used for Top sources). */
function RankList({ label, items, withIcons }: { label: string; items: AnalyticsSummary["topEvents"]; withIcons?: boolean }) {
  if (!items || items.length === 0) return null;
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div style={{ marginTop: 18 }}>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items.map((e) => (
          <div key={e.name} style={{ position: "relative", display: "flex", alignItems: "center", gap: 9, padding: "3px 8px", borderRadius: 6, overflow: "hidden", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)" }}>
            <span aria-hidden style={{ position: "absolute", inset: 0, width: `${Math.max(3, (e.count / max) * 100)}%`, background: "var(--line-2)", opacity: 0.6, borderRadius: 6 }} />
            {withIcons && <span style={{ position: "relative", display: "inline-flex" }}><Favicon domain={e.name} /></span>}
            <span style={{ position: "relative", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.name}>{e.name}</span>
            <span style={{ position: "relative", color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{num(e.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveDashboard({ summary, providerLabel }: { summary: AnalyticsSummary; providerLabel: string }) {
  const stats: { value: string | number; label: string; tone?: "honey" | null }[] = [];
  if (summary.visitors !== undefined) stats.push({ value: num(summary.visitors), label: "visitors" });
  if (summary.pageviews !== undefined) stats.push({ value: num(summary.pageviews), label: "pageviews" });
  if (summary.sessions !== undefined) stats.push({ value: num(summary.sessions), label: "sessions" });
  if (summary.conversions !== undefined) stats.push({ value: num(summary.conversions), label: "conversions" });
  if (summary.revenueDisplay || summary.revenueUsd !== undefined) {
    stats.push({ value: summary.revenueDisplay ?? `$${num(summary.revenueUsd)}`, label: "revenue", tone: "honey" });
  }

  const hasRing = typeof summary.conversionRatePct === "number";
  const hasTrend = Boolean(summary.timeseries && summary.timeseries.length > 1);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        {hasRing && (
          <Ring pct={summary.conversionRatePct} size={64} color="var(--honey-2)">
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>
              {Math.round(summary.conversionRatePct as number)}%
            </span>
          </Ring>
        )}
        {stats.length > 0 && (
          <div style={{ display: "flex", alignItems: "stretch" }}>
            {stats.map((s, i) => (
              <Stat key={s.label} value={s.value} label={s.label} tone={s.tone} last={i === stats.length - 1} />
            ))}
          </div>
        )}
        {hasTrend && <div style={{ marginLeft: "auto" }}><Sparkline points={summary.timeseries!} /></div>}
        {stats.length === 0 && !hasRing && !hasTrend && (
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            Connected to {providerLabel}, but no numbers came back for this window yet.
          </span>
        )}
      </div>

      {summary.funnel && summary.funnel.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 8 }}>Funnel</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.funnel.map((step) => (
              <div key={step.name} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)" }}>
                <span style={{ flex: 1 }}>{step.name}</span>
                <span style={{ color: "var(--fg)" }}>{num(step.count)}</span>
                {typeof step.conversionPct === "number" && <span style={{ color: "var(--fg-4)" }}>{Math.round(step.conversionPct)}%</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 28px" }}>
        <RankList label="Top events" items={summary.topEvents} />
        <RankList label="Top pages" items={summary.topPages} />
        <RankList label="Top sources" items={summary.topSources} withIcons />
      </div>
    </>
  );
}

export function AnalyticsPanel({ colony: c }: { colony: Colony }) {
  const [cache, setCache] = React.useState<Record<number, { data?: AnalyticsSummaryResult; error?: string }>>({});
  const [refreshing, setRefreshing] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);
  const [manage, setManage] = React.useState(false);
  const [days, setDays] = React.useState(7);
  const prevCompany = React.useRef(c.id);

  // Preload every range when the section opens so switching 7/30/90d is instant
  // (reads the cache — no stale-then-swap flash). A company switch drops the cache
  // (old numbers are wrong); a manual refresh keeps the current view up while it
  // refetches all ranges in the background.
  React.useEffect(() => {
    let ignore = false;
    if (prevCompany.current !== c.id) {
      prevCompany.current = c.id;
      setCache({});
    }
    setRefreshing(true);
    const fetchRange = async (r: number) => {
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/analytics?days=${r}`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as AnalyticsSummaryResult & { error?: string };
        if (ignore) return;
        // A "state:error" body (HTTP 400) is a valid result; only a non-error non-ok
        // response is a hard load failure.
        const entry =
          !res.ok && payload.state !== "error"
            ? { error: payload.error || "Could not load analytics." }
            : { data: payload };
        setCache((prev) => ({ ...prev, [r]: entry }));
      } catch (err) {
        if (ignore) return;
        setCache((prev) => ({ ...prev, [r]: { error: err instanceof Error ? err.message : "Could not load analytics." } }));
      }
    };
    void (async () => {
      await fetchRange(days); // visible range first for fast first paint…
      if (!ignore) await Promise.all(RANGES.filter((r) => r !== days).map(fetchRange)); // …then preload the rest
      if (!ignore) setRefreshing(false);
    })();
    return () => {
      ignore = true;
    };
    // Intentionally not keyed on `days`: switching range reads the preloaded cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id, nonce]);

  const entry = cache[days];
  const data = entry?.data ?? null;
  const error = entry?.error ?? "";
  const loading = !entry; // active range not fetched yet → show a loading state at once
  const busy = loading || refreshing;

  const providerLabel = data && data.state !== "unconfigured" ? data.providerLabel : undefined;
  const configuredProvider: AnalyticsProviderKey | undefined =
    data && data.state !== "unconfigured" ? data.provider : undefined;
  const configuredConfig: CompanyAnalyticsConfig | undefined =
    data && data.state !== "unconfigured" ? data.config : undefined;

  const renderCards = (providers: AnalyticsProviderStatus[]) => (
    <AnalyticsProviderCards
      companyId={c.id}
      providers={providers}
      activeProvider={configuredProvider}
      activeConfig={configuredConfig}
      onChanged={() => setNonce((n) => n + 1)}
    />
  );

  return (
    <Panel>
      <SectionLabel
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {providerLabel && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{providerLabel}</span>}
            {providerLabel && (
              <span style={{ display: "inline-flex", border: "1px solid var(--line-2)", borderRadius: 7, overflow: "hidden" }}>
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDays(r)}
                    aria-pressed={days === r}
                    title={cache[r] ? `Last ${r} days` : `Last ${r} days (loading…)`}
                    style={{ position: "relative", padding: "3px 8px", fontFamily: "var(--f-mono)", fontSize: 10, cursor: "pointer", border: "none", background: days === r ? "var(--panel-hi)" : "transparent", color: days === r ? "var(--fg)" : "var(--fg-4)", opacity: cache[r] ? 1 : 0.6 }}
                  >
                    {r}d
                  </button>
                ))}
              </span>
            )}
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              disabled={busy}
              title="Refresh analytics"
              aria-label="Refresh analytics"
              style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, cursor: busy ? "default" : "pointer", border: "1px solid var(--line-2)", borderRadius: 7, background: "transparent", color: "var(--fg-4)", opacity: busy ? 0.5 : 1, fontSize: 12 }}
            >
              {busy ? <Spinner size={12} /> : "↻"}
            </button>
          </span>
        }
      >
        Analytics
      </SectionLabel>

      {loading && !data ? (
        <AnalyticsLoadingSkeleton />
      ) : error ? (
        <AnalyticsPlaceholder icon="⚠️" title="Couldn't load analytics" body={error} tone="warn" />
      ) : data?.state === "unconfigured" ? (
        <>
          <AnalyticsPlaceholder
            icon="🔌"
            title="No analytics connected yet"
            body={
              <>
                Connect a provider and pick its project right here on the cards below — the credential is checked live and
                stored once in your shared hive env, so every company can use it. The HivemindOS-funnel provider needs no key.
              </>
            }
          />
          {renderCards(data.providers)}
        </>
      ) : data?.state === "credential-missing" ? (
        <>
          <AnalyticsPlaceholder
            icon="🔑"
            title={`${data.providerLabel} is linked, but not connected yet`}
            body={
              <>
                Connect <b>{data.providerLabel}</b> on its card below (or add <code>{data.credentialEnvKey}</code> to your
                shared hive env) to pull live numbers. {data.detail}
              </>
            }
            tone="warn"
          />
          {renderCards(data.providers)}
        </>
      ) : data?.state === "error" ? (
        <>
          <AnalyticsPlaceholder icon="⚠️" title={`${data.providerLabel ?? "Analytics"} query failed`} body={data.error} tone="warn" />
          {data.providers ? renderCards(data.providers) : null}
        </>
      ) : data?.state === "live" ? (
        <>
          <LiveDashboard summary={data.summary} providerLabel={data.providerLabel} />
          <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <button
              type="button"
              onClick={() => setManage((v) => !v)}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5, padding: 0 }}
            >
              {manage ? "▾ Hide providers" : "▸ Manage / switch provider"}
            </button>
            {manage && renderCards(data.providers)}
          </div>
        </>
      ) : (
        <AnalyticsPlaceholder icon="📊" title="No analytics" body="Nothing to show yet." />
      )}
    </Panel>
  );
}

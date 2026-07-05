"use client";
// Zero Human Companies — generic per-company "Analytics" tab. Self-fetches the
// company's linked provider summary (PostHog / Plausible / GA4 / HivemindOS
// funnel) from /api/companies/{id}/analytics, mirroring the Emails tab: lazy
// load, refresh nonce, and four honest states — loading / error / unconfigured
// (guided setup) / credential-missing / live. No CockpitHandlers wiring needed.
import React from "react";
import { Panel, Ring, SectionLabel } from "./primitives";
import type { Colony } from "./types";
import type {
  AnalyticsProviderStatus,
  AnalyticsSummary,
  AnalyticsSummaryResult,
} from "@/lib/services/company-analytics/types";

function num(n?: number): string {
  if (n === undefined) return "—";
  return n.toLocaleString("en-US");
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

function ProviderChips({ providers }: { providers: AnalyticsProviderStatus[] }) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", marginTop: 14 }}>
      {providers.map((p) => {
        const ready = !p.requiresCredential || p.credentialPresent;
        const color = ready ? "var(--cyan-2)" : "var(--fg-4)";
        const keyLabel = !p.requiresCredential ? "no key needed" : p.credentialPresent ? "key set" : "no key";
        return (
          <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 13px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="dot" style={{ color }} />
              <span style={{ flex: 1, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{p.label}</span>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color }}>{keyLabel}</span>
            </div>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", lineHeight: 1.45 }}>{p.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

function LiveDashboard({ summary, providerLabel }: { summary: AnalyticsSummary; providerLabel: string }) {
  const stats: { value: string | number; label: string; tone?: "honey" | null }[] = [];
  if (summary.visitors !== undefined) stats.push({ value: num(summary.visitors), label: "visitors" });
  if (summary.conversions !== undefined) stats.push({ value: num(summary.conversions), label: "conversions" });
  if (summary.revenueDisplay || summary.revenueUsd !== undefined) {
    stats.push({ value: summary.revenueDisplay ?? `$${num(summary.revenueUsd)}`, label: "revenue", tone: "honey" });
  }

  const hasRing = typeof summary.conversionRatePct === "number";

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
        {stats.length === 0 && !hasRing && (
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

      {summary.topEvents && summary.topEvents.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 8 }}>Top events</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {summary.topEvents.map((e) => (
              <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-2)" }}>
                <span style={{ flex: 1 }}>{e.name}</span>
                <span style={{ color: "var(--fg)" }}>{num(e.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function AnalyticsPanel({ colony: c }: { colony: Colony }) {
  const [data, setData] = React.useState<AnalyticsSummaryResult | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/companies/${encodeURIComponent(c.id)}/analytics?days=7`, { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as AnalyticsSummaryResult & { error?: string };
        if (ignore) return;
        // A "state:error" body is a valid analytics result (HTTP 400) — surface it
        // as the error state, not a generic load failure.
        if (!res.ok && payload.state !== "error") throw new Error(payload.error || "Could not load analytics.");
        setData(payload);
        setError("");
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Could not load analytics.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [c.id, nonce]);

  const providerLabel = data && data.state !== "unconfigured" ? data.providerLabel : undefined;

  return (
    <Panel>
      <SectionLabel
        right={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {providerLabel && <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{providerLabel} · last 7d</span>}
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              disabled={loading}
              title="Refresh analytics"
              aria-label="Refresh analytics"
              style={{ display: "inline-grid", placeItems: "center", width: 24, height: 24, cursor: loading ? "default" : "pointer", border: "1px solid var(--line-2)", borderRadius: 7, background: "transparent", color: "var(--fg-4)", opacity: loading ? 0.5 : 1, fontSize: 12 }}
            >
              {loading ? "…" : "↻"}
            </button>
          </span>
        }
      >
        Analytics
      </SectionLabel>

      {loading && !data ? (
        <AnalyticsPlaceholder icon="📊" title="Loading analytics…" body="Fetching this company's at-a-glance numbers from its provider." />
      ) : error ? (
        <AnalyticsPlaceholder icon="⚠️" title="Couldn't load analytics" body={error} tone="warn" />
      ) : data?.state === "unconfigured" ? (
        <>
          <AnalyticsPlaceholder
            icon="🔌"
            title="No analytics connected yet"
            body={
              <>
                Pick a provider in <b>Edit → Analytics provider</b> and set its project id. Connect the provider&apos;s API
                key once in <b>Settings → Connections</b> (or via <code>hive-env-add</code>) — every company then reads from
                it. The HivemindOS-funnel provider needs no key.
              </>
            }
          />
          <ProviderChips providers={data.providers} />
        </>
      ) : data?.state === "credential-missing" ? (
        <AnalyticsPlaceholder
          icon="🔑"
          title={`${data.providerLabel} is linked, but its key isn't set`}
          body={
            <>
              Connect <b>{data.providerLabel}</b> in <b>Settings → Connections</b> (or add{" "}
              <code>{data.credentialEnvKey}</code> to your shared hive env) to pull live numbers. {data.detail}
            </>
          }
          tone="warn"
        />
      ) : data?.state === "error" ? (
        <AnalyticsPlaceholder icon="⚠️" title={`${data.providerLabel ?? "Analytics"} query failed`} body={data.error} tone="warn" />
      ) : data?.state === "live" ? (
        <LiveDashboard summary={data.summary} providerLabel={data.providerLabel} />
      ) : (
        <AnalyticsPlaceholder icon="📊" title="No analytics" body="Nothing to show yet." />
      )}
    </Panel>
  );
}

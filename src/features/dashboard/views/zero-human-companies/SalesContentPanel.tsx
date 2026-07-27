"use client";

import React from "react";
import { RefreshCw } from "lucide-react";

import { Panel, SectionLabel, Skeleton, SkeletonText, Spinner } from "./primitives";
import type { Colony } from "./types";
import type {
  SalesContentAction,
  SalesContentMachineResult,
  SalesContentSignal,
  SalesContentSourceRuntimeStatus,
} from "@/lib/services/sales-content/types";

type SalesContentResponse = {
  ok?: boolean;
  error?: string;
  machine?: SalesContentMachineResult;
};

function toneFor(status: SalesContentSourceRuntimeStatus["status"]): string {
  if (status === "ready" || status === "configured") return "var(--live)";
  if (status === "missing-credential") return "var(--danger-2)";
  if (status === "planned") return "var(--honey)";
  return "var(--fg-4)";
}

function Cap({ value, label, tone }: { value: number | string; label: string; tone?: string }) {
  return (
    <div style={{ minWidth: 92, paddingRight: 16, borderRight: "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 600, color: tone ?? "var(--fg)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

function LoadingSalesContent() {
  return (
    <Panel>
      <SectionLabel right={<span role="status" aria-label="Loading sales and content signals"><Spinner size={12} /> syncing</span>}>sales/content machine</SectionLabel>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} width={92} height={46} radius={10} />)}
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>
          {[0, 1, 2].map((index) => (
            <div key={index} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, background: "var(--panel-2)" }}>
              <SkeletonText lines={3} />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SourceCard({ source }: { source: SalesContentSourceRuntimeStatus }) {
  const color = toneFor(source.status);
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)", padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={"dot" + (source.ready ? " live" : "")} style={{ color }} />
        <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>{source.row.label}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color, border: "1px solid var(--line)", borderRadius: 999, padding: "2px 7px", textTransform: "uppercase" }}>{source.status}</span>
      </div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.45 }}>{source.detail}</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {source.row.capabilities.slice(0, 4).map((capability) => (
          <span key={capability} style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 5, padding: "2px 5px" }}>{capability}</span>
        ))}
      </div>
    </div>
  );
}

function SignalCard({ signal }: { signal: SalesContentSignal }) {
  const color = signal.score >= 76 ? "var(--danger-2)" : signal.score >= 55 ? "var(--honey)" : "var(--fg-3)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)", padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, border: "1px solid var(--line-2)", display: "grid", placeItems: "center", fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, color, background: "var(--panel-hi)", fontVariantNumeric: "tabular-nums" }}>{signal.score}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--fg)", lineHeight: 1.25 }}>{signal.title}</div>
          <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45, marginTop: 5 }}>{signal.summary}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
        <span>{signal.suggestedRole}</span>
        <span>confidence {Math.round(signal.confidence * 100)}%</span>
        {signal.approvalRequired ? <span style={{ color: "var(--honey)" }}>approval-gated</span> : null}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: SalesContentAction }) {
  const color = action.priority === "high" ? "var(--danger-2)" : action.priority === "medium" ? "var(--honey)" : "var(--fg-3)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)", padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>{action.title}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color, border: "1px solid var(--line)", borderRadius: 999, padding: "2px 7px", textTransform: "uppercase" }}>{action.priority}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>{action.body}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{action.role}</span>
        {action.skills.slice(0, 3).map((skill) => (
          <span key={skill} style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: 5, padding: "2px 5px" }}>{skill}</span>
        ))}
        {action.approvalRequired ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--honey)" }}>approval-gated</span> : null}
      </div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ border: "1px dashed var(--line-2)", borderRadius: 12, background: "var(--panel-2)", padding: "24px 16px", textAlign: "center", display: "flex", flexDirection: "column", gap: 7, alignItems: "center" }}>
      <span style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--fg-2)" }}>{title}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", maxWidth: 520, lineHeight: 1.5 }}>{body}</span>
    </div>
  );
}

export function SalesContentPanel({ colony: c }: { colony: Colony }) {
  const [data, setData] = React.useState<SalesContentMachineResult | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(c.id)}/sales-content`, { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as SalesContentResponse;
        if (ignore) return;
        if (!response.ok || payload.ok === false || !payload.machine) throw new Error(payload.error || "Could not load sales/content signals.");
        setData(payload.machine);
        setError("");
      } catch (caught) {
        if (!ignore) setError(caught instanceof Error ? caught.message : "Could not load sales/content signals.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [c.id, nonce]);

  if (loading && !data) return <LoadingSalesContent />;

  const readySources = data?.sources.filter((source) => source.ready).length ?? 0;
  const plannedSources = data?.sources.filter((source) => source.status === "planned").length ?? 0;
  const topSignals = data?.signals.slice(0, 6) ?? [];
  const topActions = data?.actions.slice(0, 6) ?? [];
  const recentEvents = data?.events.slice(0, 8) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Panel>
        <SectionLabel
          right={
            <button
              type="button"
              onClick={() => setNonce((value) => value + 1)}
              disabled={loading}
              className="zhc-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: loading ? "not-allowed" : "pointer", border: "1px solid var(--line-2)", borderRadius: 8, background: "transparent", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5, padding: "5px 10px", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? <Spinner size={12} /> : <RefreshCw size={12} strokeWidth={1.8} />}
              Refresh
            </button>
          }
        >
          sales/content machine
        </SectionLabel>

        {error ? (
          <EmptyState title="Signal sync failed" body={error} />
        ) : data ? (
          <>
            <div style={{ display: "flex", gap: 0, flexWrap: "wrap", marginBottom: 18 }}>
              <Cap value={readySources} label="ready sources" tone="var(--live)" />
              <Cap value={plannedSources} label="planned" tone="var(--honey)" />
              <Cap value={data.events.length} label="events" />
              <Cap value={data.signals.length} label="signals" tone={data.signals.length ? "var(--honey)" : undefined} />
              <Cap value={data.actions.length} label="actions" />
            </div>

            {data.gaps.length > 0 ? (
              <div style={{ display: "grid", gap: 7, marginBottom: 18 }}>
                {data.gaps.slice(0, 4).map((gap) => (
                  <div key={gap} style={{ border: "1px solid var(--honey-line)", borderRadius: 10, background: "var(--honey-soft)", color: "var(--honey)", fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.45, padding: "8px 10px" }}>{gap}</div>
                ))}
              </div>
            ) : null}

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {data.sources.map((source) => <SourceCard key={source.row.id} source={source} />)}
            </div>
          </>
        ) : null}
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{topSignals.length} ranked</span>}>signals</SectionLabel>
        {topSignals.length ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {topSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}
          </div>
        ) : (
          <EmptyState title="No ranked signals yet" body="Replies, queued outreach, conversion data, traffic sources, and pricing objections appear here after a refresh finds evidence." />
        )}
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>feeds the next dispatch</span>}>recommended work</SectionLabel>
        {topActions.length ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {topActions.map((action) => <ActionCard key={action.id} action={action} />)}
          </div>
        ) : (
          <EmptyState title="No action cards yet" body="The company can keep running from its apex goal; action cards appear once the machine has evidence worth prioritizing." />
        )}
      </Panel>

      <Panel>
        <SectionLabel>recent events</SectionLabel>
        {recentEvents.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {recentEvents.map((event) => (
              <div key={event.id} style={{ display: "grid", gap: 5, border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-2)", padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>{event.title}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)", border: "1px solid var(--line)", borderRadius: 5, padding: "2px 5px" }}>{event.kind}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{new Date(event.occurredAt).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-3)" }}>{event.summary}</div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No events recorded" body="The local event store is empty for this company." />
        )}
      </Panel>
    </div>
  );
}

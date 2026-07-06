"use client";

import React from "react";
import { GitBranch, RotateCcw } from "lucide-react";

import type { CompanyProposal, CompanyRun } from "@/lib/types/company-runs";
import { Panel, SectionLabel, Skeleton, Spinner } from "./primitives";

type LedgerState = {
  runs: CompanyRun[];
  proposals: CompanyProposal[];
  updatedAt?: string;
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  runs?: CompanyRun[];
  proposals?: CompanyProposal[];
  updatedAt?: string;
};

const statusColor: Record<string, string> = {
  running: "var(--live)",
  completed: "var(--cyan)",
  blocked: "var(--honey)",
  failed: "var(--danger)",
  canceled: "var(--fg-4)",
  pending: "var(--honey)",
  approved: "var(--cyan)",
  rejected: "var(--danger)",
  applied: "var(--live)",
  superseded: "var(--fg-4)",
};

function when(value?: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function labelOf(value: string): string {
  return value.replace(/-/g, " ");
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const color = tone ? statusColor[tone] ?? "var(--fg-3)" : "var(--fg-3)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid color-mix(in srgb, ${color} 45%, var(--line))`, borderRadius: 999, color, background: `color-mix(in srgb, ${color} 10%, transparent)`, padding: "2px 7px", fontFamily: "var(--f-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.05, textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

function TraceSkeleton() {
  return (
    <div role="status" aria-label="Loading company traces" style={{ display: "grid", gap: 12 }}>
      {[0, 1, 2].map((index) => (
        <div key={index} style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2)", padding: 14, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Skeleton width={88} height={18} radius={999} />
            <Skeleton width={index === 1 ? "42%" : "56%"} height={13} />
          </div>
          <Skeleton width="88%" height={11} />
          <Skeleton width="64%" height={11} />
        </div>
      ))}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: CompanyProposal }) {
  return (
    <div style={{ border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: 12, padding: 13, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone={proposal.status}>{proposal.status}</Pill>
        <Pill>{labelOf(proposal.kind)}</Pill>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{when(proposal.updatedAt || proposal.createdAt)}</span>
      </div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)", lineHeight: 1.35 }}>{proposal.title}</div>
      {proposal.summary ? <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, textWrap: "pretty" }}>{proposal.summary}</div> : null}
      {proposal.evidence?.length ? (
        <div style={{ display: "grid", gap: 5 }}>
          {proposal.evidence.slice(0, 2).map((line, index) => (
            <div key={`${proposal.id}-evidence-${index}`} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", lineHeight: 1.45 }}>- {line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunCard({
  run,
  onReplay,
  busy,
}: {
  run: CompanyRun;
  onReplay: (run: CompanyRun) => void;
  busy: boolean;
}) {
  const canReplay = run.status === "completed" || run.status === "blocked" || run.status === "failed";
  return (
    <div style={{ border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: 12, padding: 14, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill tone={run.status}>{run.status}</Pill>
        <Pill>{labelOf(run.kind)}</Pill>
        {run.replayOfRunId ? <Pill tone="approved"><GitBranch size={11} /> replay</Pill> : null}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{when(run.updatedAt || run.createdAt)}</span>
      </div>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 650, color: "var(--fg)", lineHeight: 1.35 }}>{run.title}</div>
      {run.summary ? <div style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, textWrap: "pretty" }}>{run.summary}</div> : null}
      {run.output ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {typeof run.output.taskCount === "number" ? <Pill>{run.output.taskCount} tasks</Pill> : null}
          {typeof run.output.delegatedCount === "number" ? <Pill>{run.output.delegatedCount} delegated</Pill> : null}
          {typeof run.output.feeStatus === "string" ? <Pill tone={run.output.feeStatus === "collected" ? "applied" : "pending"}>fee {run.output.feeStatus}</Pill> : null}
        </div>
      ) : null}
      {run.events?.length ? (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 9, display: "grid", gap: 7 }}>
          {run.events.slice(-3).map((event) => (
            <div key={event.id} style={{ display: "grid", gap: 2 }}>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-2)" }}>{event.title}</div>
              {event.detail ? <div style={{ fontSize: 11.5, color: "var(--fg-4)", lineHeight: 1.45 }}>{event.detail}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {canReplay ? (
        <div>
          <button type="button" disabled={busy} onClick={() => onReplay(run)} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: busy ? "default" : "pointer", border: "1px solid var(--honey-line)", background: "var(--honey-soft)", color: "var(--honey)", borderRadius: 8, padding: "6px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.05, opacity: busy ? 0.6 : 1 }}>
            {busy ? <Spinner size={12} /> : <RotateCcw size={13} />} Request replay
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CompanyRunsPanel({ companyId }: { companyId: string }) {
  const [ledger, setLedger] = React.useState<LedgerState>({ runs: [], proposals: [] });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busyRunId, setBusyRunId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/runs`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not load company traces.");
      setLedger({ runs: json.runs ?? [], proposals: json.proposals ?? [], updatedAt: json.updatedAt });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load company traces.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  const requestReplay = React.useCallback(async (run: CompanyRun) => {
    setBusyRunId(run.id);
    try {
      const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-replay", runId: run.id, title: `Replay ${run.title}` }),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not request replay.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not request replay.");
    } finally {
      setBusyRunId(null);
    }
  }, [companyId, load]);

  const pending = ledger.proposals.filter((proposal) => proposal.status === "pending").length;
  const completed = ledger.runs.filter((run) => run.status === "completed").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <SectionLabel right={
          <button type="button" onClick={() => void load()} disabled={loading} className="zhc-btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: loading ? "default" : "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)", borderRadius: 8, padding: "5px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>
            {loading ? <><Spinner size={11} /> syncing</> : "refresh"}
          </button>
        }>runs / proposal boundary</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 650, color: "var(--fg)" }}>{ledger.runs.length}</div>
            <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 4 }}>recorded runs</div>
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 650, color: "var(--cyan)" }}>{completed}</div>
            <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 4 }}>completed</div>
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel-2)", borderRadius: 12, padding: 12 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 24, fontWeight: 650, color: pending ? "var(--honey)" : "var(--fg)" }}>{pending}</div>
            <div className="mcap" style={{ color: "var(--fg-4)", marginTop: 4 }}>pending proposals</div>
          </div>
        </div>
        {error ? <div style={{ marginTop: 12, fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--danger)", lineHeight: 1.5 }}>{error}</div> : null}
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{ledger.proposals.length} total</span>}>proposals</SectionLabel>
        {loading ? <TraceSkeleton /> : ledger.proposals.length === 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "12px 0" }}>No proposals recorded for this company yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {ledger.proposals.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{ledger.runs.length} total</span>}>execution traces</SectionLabel>
        {loading ? <TraceSkeleton /> : ledger.runs.length === 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "12px 0" }}>No runs recorded yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {ledger.runs.map((run) => <RunCard key={run.id} run={run} onReplay={requestReplay} busy={busyRunId === run.id} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}

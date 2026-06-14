"use client";
// Zero Human Companies — single colony cockpit (tabbed).
import React from "react";
import { STATE_COLOR, Ring, RoleGlyph, StatusPill, BurnBar, SectionLabel, Panel } from "./primitives";
import { IssueBoard } from "./IssueBoard";
import { STATUS_TONE } from "./data";
import type { Agent, Approval, Colony } from "./types";

export type CockpitHandlers = {
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string) => void;
  onFreeze: (frozen: boolean) => void;
  onDelete: () => void;
  /** Decompose the apex goal + dispatch it to the crew for autonomous execution. */
  onDispatch: () => void;
  /** Approval/company id currently mutating, to disable its controls. */
  busyId: string | null;
};

function dispatchedAgo(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Org chart ────────────────────────────────────────────────────────────
function OrgChart({ colony, wide }: { colony: Colony; wide?: boolean }) {
  const queen = colony.agents.find((a) => a.role === "Queen");
  const reports = colony.agents.filter((a) => a.role !== "Queen");
  if (wide) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {queen && <AgentNode agent={queen} head />}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {reports.map((a) => <AgentNode key={a.id ?? a.name} agent={a} flat />)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {queen && <AgentNode agent={queen} head />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 14, borderLeft: "1px solid var(--line-2)", marginLeft: 18 }}>
        {reports.map((a) => <AgentNode key={a.id ?? a.name} agent={a} />)}
      </div>
    </div>
  );
}

function AgentNode({ agent: a, head, flat }: { agent: Agent; head?: boolean; flat?: boolean }) {
  const sc = STATE_COLOR[a.state] || "var(--fg-4)";
  const overBudget = a.budgetPct >= 80;
  return (
    <div style={{
      position: "relative", display: "flex", gap: 11, alignItems: "flex-start",
      padding: head ? "12px 12px" : "10px 11px", borderRadius: 12,
      border: head ? "1px solid color-mix(in srgb, var(--honey) 34%, transparent)" : "1px solid var(--line)",
      background: head ? "color-mix(in srgb, var(--honey) 8%, var(--bg-2))" : "var(--bg-2)",
    }}>
      {!head && !flat && <span style={{ position: "absolute", left: -14, top: 22, width: 12, height: 1, background: "var(--line-2)" }} />}
      <RoleGlyph role={a.role} size={head ? 34 : 28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: head ? 14 : 13, fontWeight: 700 }}>{a.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: head ? "var(--honey-2)" : "var(--cyan-2)", textTransform: "uppercase", letterSpacing: 0.06 }}>{head ? "Queen · CEO" : a.role}</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--f-mono)", fontSize: 9.5, color: sc, textTransform: "uppercase" }}>
            <span className={"dot" + (a.state === "working" ? " live" : "")} style={{ color: sc }} />{a.state}
          </span>
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "var(--fg-3)", marginTop: 4, textWrap: "pretty" }}>{a.task}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{a.runtime}</span>
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, maxWidth: 110, height: 4, borderRadius: 999, background: "var(--bg-4)", overflow: "hidden" }}>
              <span style={{ display: "block", width: a.budgetPct + "%", height: "100%", background: overBudget ? "var(--danger)" : "var(--honey)" }} />
            </span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: overBudget ? "var(--danger-2)" : "var(--fg-4)" }}>{a.budgetPct}% cap</span>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Apex strip ─────────────────────────────────────────────────────────────
function ApexStrip({ colony: c }: { colony: Colony }) {
  const fresh = c.status === "setup";
  const alignColor = fresh ? "var(--fg-3)" : c.alignment >= 75 ? "var(--cyan)" : c.alignment >= 55 ? "var(--honey)" : "var(--danger)";
  const drifting = !fresh && c.alignment < 55;
  return (
    <Panel style={{ display: "flex", alignItems: "center", gap: 22, borderColor: drifting ? "color-mix(in srgb, var(--danger) 38%, transparent)" : "var(--line)", background: drifting ? "color-mix(in srgb, var(--danger) 7%, var(--panel-bg))" : "var(--panel-bg)" }}>
      <Ring pct={c.alignment} size={76} stroke={6} color={alignColor}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, lineHeight: 1, color: "var(--fg)" }}>{c.alignment}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 7.5, color: "var(--fg-4)", letterSpacing: 0.08 }}>ALIGNED</div>
        </div>
      </Ring>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono-cap" style={{ color: "var(--fg-4)", marginBottom: 6 }}>apex goal · board mandate</div>
        <div style={{ fontFamily: "var(--f-display)", fontSize: 21, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.15, textWrap: "balance" }}>{c.apex.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>{c.apex.metric}</span>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 16, fontWeight: 600, color: "var(--fg)", fontVariantNumeric: "tabular-nums" }}>{c.apex.current}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>→ target {c.apex.target}</span>
        </div>
      </div>
      {fresh ? (
        <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px 0 18px", borderLeft: "1px solid var(--line)", maxWidth: 180 }}>
          <span className="mono-cap" style={{ color: "var(--fg-3)" }}>bootstrapping</span>
          <span style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6, lineHeight: 1.4 }}>Queen is drafting the first work block. Alignment starts tracking once work begins.</span>
        </div>
      ) : drifting ? (
        <div style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 4px 0 18px", borderLeft: "1px solid var(--line)", maxWidth: 180 }}>
          <span className="mono-cap" style={{ color: "var(--danger-2)" }}>⚠ drift detected</span>
          <span style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 6, lineHeight: 1.4 }}>{100 - c.alignment}% of active work is unlinked to this goal.</span>
        </div>
      ) : null}
    </Panel>
  );
}

// ── Approvals ──────────────────────────────────────────────────────────────
function btn(color: string, solid: boolean, disabled?: boolean): React.CSSProperties {
  return {
    flex: 1, padding: "6px 0", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase",
    border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
    background: solid ? `color-mix(in srgb, ${color} 16%, transparent)` : "transparent",
    color, opacity: disabled ? 0.5 : 1,
  };
}

function ApprovalCard({ ap, onApprove, onReject, busy }: { ap: Approval; onApprove: () => void; onReject: () => void; busy: boolean }) {
  const riskColor: Record<string, string> = { high: "var(--danger)", med: "var(--honey)", low: "var(--cyan)" };
  return (
    <div style={{ borderRadius: 11, border: `1px solid color-mix(in srgb, ${riskColor[ap.risk]} 30%, var(--line))`, background: "var(--bg-2)", padding: "13px 14px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700, color: riskColor[ap.risk], textTransform: "uppercase", letterSpacing: 0.06, border: `1px solid color-mix(in srgb, ${riskColor[ap.risk]} 40%, transparent)`, borderRadius: 4, padding: "1px 5px" }}>{ap.kind}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>req. {ap.agent}</span>
      </div>
      <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500, lineHeight: 1.4, textWrap: "pretty", flex: 1 }}>{ap.title}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button disabled={busy} onClick={onApprove} style={btn("var(--cyan)", true, busy)}>{busy ? "…" : "approve"}</button>
        <button disabled={busy} onClick={onReject} style={btn("var(--fg-3)", false, busy)}>reject</button>
      </div>
    </div>
  );
}

// ── Governance + activity ────────────────────────────────────────────────
function GovernanceFeed({ colony }: { colony: Colony }) {
  const icon: Record<string, string> = { patch: "⊘", reflect: "✸", escalate: "↑", alert: "⚠" };
  const color: Record<string, string> = { patch: "var(--cyan-2)", reflect: "var(--honey-2)", escalate: "var(--honey)", alert: "var(--danger-2)" };
  const lbl: Record<string, string> = { patch: "archetype patch", reflect: "self-improvement", escalate: "escalation", alert: "audit alert" };
  return (
    <Panel>
      <SectionLabel>recursive governance</SectionLabel>
      {colony.governance.length === 0 ? (
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "8px 0" }}>No governance events yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {colony.governance.map((g, i) => (
            <div key={`${g.kind}-${g.agent}-${g.since}-${i}`} style={{ display: "flex", gap: 10 }}>
              <span style={{ width: 22, height: 22, flexShrink: 0, display: "grid", placeItems: "center", borderRadius: 6, background: `color-mix(in srgb, ${color[g.kind]} 14%, transparent)`, color: color[g.kind], fontSize: 12 }}>{icon[g.kind]}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="mono-cap" style={{ color: color[g.kind] }}>{lbl[g.kind]}</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{g.agent} · {g.since}</span>
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45, color: "var(--fg-2)", marginTop: 3, textWrap: "pretty" }}>{g.text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ActivityTicker({ colony }: { colony: Colony }) {
  const [tick, setTick] = React.useState(0);
  const lines = colony.activity;
  // Re-subscribe whenever the activity content changes (not just its length).
  React.useEffect(() => {
    if (lines.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 2200);
    return () => clearInterval(id);
  }, [lines]);
  return (
    <Panel pad={0} style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot live" style={{ color: "var(--cyan)" }} />
        <span className="mono-cap" style={{ color: "var(--fg-3)" }}>live activity</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>recent events</span>
      </div>
      <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
        {lines.length === 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>No recent activity recorded.</div>
        ) : lines.map((l, i) => (
          <div key={`${i}-${l}`} style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.5, whiteSpace: "pre", color: i === (tick % lines.length) ? "var(--cyan-2)" : "var(--fg-3)", opacity: i === (tick % lines.length) ? 1 : 0.7, transition: "color 300ms, opacity 300ms" }}>{l}</div>
        ))}
      </div>
    </Panel>
  );
}

function TreasurySection({ colony: c, handlers }: { colony: Colony; handlers: CockpitHandlers }) {
  const busy = handlers.busyId === c.id;
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "minmax(280px, 360px) minmax(0,1fr)", alignItems: "start" }}>
        <Panel>
          <SectionLabel>treasury · USDC burn</SectionLabel>
          <BurnBar today={c.burn.today} cap={c.burn.cap} week={c.burn.week} runway={c.burn.runway} />
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.6 }}>
            Per-agent daily caps enforced at dispatch. Work pauses before overspend — never after the invoice.
          </div>
        </Panel>
        <Panel>
          <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>% of daily cap used</span>}>per-agent caps</SectionLabel>
          {c.agents.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)" }}>No agents on this company yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {c.agents.map((a) => {
                const over = a.budgetPct >= 80;
                return (
                  <div key={a.id ?? a.name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <RoleGlyph role={a.role} size={22} />
                    <span style={{ width: 92, fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    <span style={{ flex: 1, height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
                      <span style={{ display: "block", width: a.budgetPct + "%", height: "100%", background: over ? "var(--danger)" : "var(--honey)" }} />
                    </span>
                    <span style={{ width: 40, textAlign: "right", fontFamily: "var(--f-mono)", fontSize: 11, color: over ? "var(--danger-2)" : "var(--fg-3)", fontVariantNumeric: "tabular-nums" }}>{a.budgetPct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {/* kill switch + disband — the company's hard governance controls */}
      <Panel style={c.frozen ? { borderColor: "color-mix(in srgb, var(--danger) 40%, transparent)", background: "color-mix(in srgb, var(--danger) 7%, var(--bg-1))" } : undefined}>
        <SectionLabel color={c.frozen ? "var(--danger-2)" : "var(--fg-3)"}>kill switch · human override</SectionLabel>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", lineHeight: 1.6 }}>
            {c.frozen
              ? "❄️ Frozen — every member agent's spend is blocked across all rails until you unfreeze."
              : "Freezing halts all spend for every agent in this company immediately. Use it to stop a runaway colony."}
          </div>
          <button
            disabled={busy}
            onClick={() => handlers.onFreeze(!c.frozen)}
            style={{
              padding: "8px 16px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer",
              fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, letterSpacing: 0.06, textTransform: "uppercase",
              border: `1px solid color-mix(in srgb, ${c.frozen ? "var(--cyan)" : "var(--danger)"} 50%, transparent)`,
              background: `color-mix(in srgb, ${c.frozen ? "var(--cyan)" : "var(--danger)"} 14%, transparent)`,
              color: c.frozen ? "var(--cyan-2)" : "var(--danger-2)", opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? "…" : c.frozen ? "Unfreeze company" : "Freeze company"}
          </button>
          {confirmDelete ? (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <button disabled={busy} onClick={handlers.onDelete} style={{ padding: "8px 14px", borderRadius: 9, cursor: busy ? "not-allowed" : "pointer", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", border: "1px solid color-mix(in srgb, var(--danger) 55%, transparent)", background: "color-mix(in srgb, var(--danger) 20%, transparent)", color: "var(--danger-2)", opacity: busy ? 0.5 : 1 }}>confirm disband</button>
              <button onClick={() => setConfirmDelete(false)} style={{ padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-3)" }}>cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ padding: "8px 14px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--f-mono)", fontSize: 11, textTransform: "uppercase", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-4)" }}>Disband</button>
          )}
        </div>
      </Panel>
    </div>
  );
}

function KStat({ n, label, tone, last }: { n: number; label: string; tone?: "honey" | null; last?: boolean }) {
  const c = tone === "honey" ? "var(--honey-2)" : "var(--fg)";
  return (
    <div style={{ textAlign: "left", minWidth: 64, padding: "0 16px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div style={{ fontFamily: "var(--f-display)", fontSize: 26, fontWeight: 600, color: c, lineHeight: 1, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums" }}>{n}</div>
      <div className="mono-cap" style={{ color: "var(--fg-4)", marginTop: 5 }}>{label}</div>
    </div>
  );
}

// ── The cockpit ────────────────────────────────────────────────────────────
export function Cockpit({
  colony: c, colonies, showBudget, onBack, onSwitch, onAddAgents, handlers,
}: {
  colony: Colony; colonies: Colony[]; showBudget: boolean;
  onBack: () => void; onSwitch: (id: string) => void; onAddAgents: () => void;
  handlers: CockpitHandlers;
}) {
  const wb = c.workBlock;
  const wbPct = wb.total > 0 ? Math.round((wb.done / wb.total) * 100) : 0;
  const [tab, setTab] = React.useState("board");

  const tabs: { key: string; label: string; badge?: number | null }[] = [
    { key: "board", label: "Board" },
    { key: "team", label: "Team" },
    { key: "approvals", label: "Approvals", badge: c.approvals.length || null },
    { key: "governance", label: "Governance" },
    ...(showBudget ? [{ key: "treasury", label: "Treasury" }] : []),
  ];
  const active = tabs.some((x) => x.key === tab) ? tab : "board";

  return (
    <div style={{ padding: "22px 36px 56px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* breadcrumb + switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={onBack} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8, cursor: "pointer", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11, padding: "6px 11px" }}>← all companies</button>
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, overflowX: "auto" }} className="scrollbar-thin">
          {colonies.map((x) => (
            <button key={x.id} onClick={() => onSwitch(x.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", background: x.id === c.id ? "var(--bg-3)" : "transparent", border: `1px solid ${x.id === c.id ? "var(--line-2)" : "var(--line)"}`, borderRadius: 8, cursor: "pointer", padding: "5px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5, color: x.id === c.id ? "var(--fg)" : "var(--fg-4)" }}>
              <span className="dot" style={{ color: STATUS_TONE[x.status].dot }} />{x.ticker}
            </button>
          ))}
        </div>
      </div>

      {/* identity header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <RoleGlyph role="Queen" size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: 34, fontWeight: 600, letterSpacing: -1, lineHeight: 1 }}>{c.name}</h1>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-4)", padding: "2px 7px", border: "1px solid var(--line)", borderRadius: 5 }}>{c.ticker}</span>
            <StatusPill status={c.status} />
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 9, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            <span>{c.sector}</span><span style={{ opacity: 0.5 }}>·</span>
            <span>founded {c.founded}</span><span style={{ opacity: 0.5 }}>·</span>
            <span>{c.agents.length} agents · 0 humans</span>
            {c.runtimeMix.length > 0 && <><span style={{ opacity: 0.5 }}>·</span><span>{c.runtimeMix.join(" / ")}</span></>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 0, paddingTop: 2 }}>
          <KStat n={c.issues.filter((i) => i.status === "done").length} label="shipped" />
          <KStat n={c.agents.filter((a) => a.state === "working").length} label="at work" />
          <KStat n={c.approvals.length} label="to approve" tone={c.approvals.length ? "honey" : null} last />
        </div>
      </div>

      <ApexStrip colony={c} />

      {/* segmented section control */}
      <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-1)", alignSelf: "flex-start", flexWrap: "wrap" }}>
        {tabs.map((x) => {
          const on = x.key === active;
          return (
            <button key={x.key} onClick={() => setTab(x.key)} style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", border: "1px solid " + (on ? "var(--line-2)" : "transparent"), background: on ? "var(--bg-3)" : "transparent", color: on ? "var(--fg)" : "var(--fg-3)", borderRadius: 8, padding: "7px 14px", fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 600, letterSpacing: 0.1, textTransform: "uppercase", transition: "background 140ms ease, color 140ms ease" }}>
              {x.label}
              {x.badge ? (
                <span style={{ display: "inline-grid", placeItems: "center", minWidth: 17, height: 17, padding: "0 5px", borderRadius: 999, background: "var(--honey-2)", color: "var(--bg-0)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700 }}>{x.badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {active === "board" && (
        <Panel>
          {/* autonomous-execution CTA: decompose the apex goal + dispatch to the crew */}
          {(() => {
            const dispatchBusy = handlers.busyId === c.id;
            const launchedAgo = dispatchedAgo(c.lastDispatchedAt);
            const noGoal = !c.hasApexGoal;
            const disabled = dispatchBusy || c.frozen || c.agents.length === 0 || noGoal;
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <span className="mono-cap" style={{ color: "var(--honey-2)" }}>autonomous execution</span>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 5, lineHeight: 1.5 }}>
                    {c.frozen
                      ? "Company is frozen — unfreeze it in Treasury to dispatch work."
                      : c.agents.length === 0
                        ? "Staff the company first, then launch work toward the apex goal."
                        : noGoal
                          ? "Set an apex goal for this company before launching work."
                          : "Decompose the apex goal into tasks and dispatch them to the crew. Online agents claim and run the work autonomously, spending within the company budget."}
                    {launchedAgo ? <span style={{ color: "var(--fg-4)" }}> · last launched {launchedAgo}</span> : null}
                  </div>
                </div>
                <button
                  disabled={disabled}
                  onClick={handlers.onDispatch}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
                    padding: "9px 16px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer",
                    fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.06,
                    border: "1px solid color-mix(in srgb, var(--honey) 50%, transparent)",
                    background: disabled ? "var(--bg-3)" : "var(--honey-2)",
                    color: disabled ? "var(--fg-4)" : "var(--bg-0)", opacity: disabled ? 0.6 : 1,
                  }}
                >
                  {dispatchBusy ? "Launching…" : launchedAgo ? "Re-launch work" : "▶ Launch work toward goal"}
                </button>
              </div>
            );
          })()}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <span className="mono-cap" style={{ color: "var(--fg-4)", whiteSpace: "nowrap" }}>active work block · {wb.state}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", whiteSpace: "nowrap" }}>single-active · forces focus</span>
              </div>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 600, letterSpacing: -0.4, marginTop: 4 }}>{wb.name}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 600, color: "var(--fg)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{wb.done}<span style={{ color: "var(--fg-4)", fontSize: 15 }}>/{wb.total}</span></div>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 3 }}>eta {wb.eta}</div>
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden", marginBottom: 20 }}>
            <div style={{ width: wbPct + "%", height: "100%", background: "var(--cyan)", transition: "width 600ms ease" }} />
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 4 }} className="scrollbar-thin">
            <IssueBoard colony={c} />
          </div>
        </Panel>
      )}

      {active === "team" && (
        <Panel>
          <SectionLabel right={
            <button onClick={onAddAgents} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", border: "1px solid color-mix(in srgb, var(--honey) 45%, transparent)", borderRadius: 8, background: "color-mix(in srgb, var(--honey) 12%, transparent)", color: "var(--honey-2)", fontFamily: "var(--f-mono)", fontSize: 10.5, fontWeight: 600, padding: "5px 11px", textTransform: "uppercase", letterSpacing: 0.06 }}>+ add agent</button>
          }>org · {c.agents.length} agents · reports → Queen</SectionLabel>
          {c.agents.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "16px 0" }}>No agents yet — use “+ add agent” to staff this company from your roster.</div>
          ) : (
            <OrgChart colony={c} wide />
          )}
        </Panel>
      )}

      {active === "approvals" && (
        <Panel>
          <SectionLabel right={c.approvals.length > 0 ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--honey-2)" }}>{c.approvals.length} waiting</span> : null}>needs your approval · human-in-the-loop</SectionLabel>
          {c.approvals.length === 0 ? (
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)", padding: "20px 0" }}>✓ nothing pending — the colony is self-governing within policy.</div>
          ) : (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {c.approvals.map((ap) => (
                <ApprovalCard
                  key={ap.id}
                  ap={ap}
                  busy={handlers.busyId === ap.id}
                  onApprove={() => handlers.onApprove(ap.id)}
                  onReject={() => handlers.onReject(ap.id)}
                />
              ))}
            </div>
          )}
        </Panel>
      )}

      {active === "governance" && (
        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", alignItems: "start" }}>
          <GovernanceFeed colony={c} />
          <ActivityTicker colony={c} />
        </div>
      )}

      {active === "treasury" && <TreasurySection colony={c} handlers={handlers} />}
    </div>
  );
}

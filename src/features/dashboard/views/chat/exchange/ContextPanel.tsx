import { frColTone } from "./primitives";
import type { ExchangeConversation, ExchangeThread } from "./types";

function Section({ label, children, right }: { label: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="fr-eyebrow">{label}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

const pill = (color: string, background: string, border?: string): React.CSSProperties => ({
  padding: "2px 9px",
  borderRadius: 999,
  border: `1px solid ${border || "transparent"}`,
  background,
  color,
  fontFamily: "var(--f-mono)",
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

function Meta({ k, v, tone }: { k: string; v?: string; tone?: string }) {
  const color = tone === "danger" ? "var(--danger)" : tone === "live" ? "var(--live)" : "var(--fg-2)";
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", padding: "8px 10px" }}>
      <div className="fr-eyebrow">{k}</div>
      <div style={{ overflow: "hidden", color, fontFamily: "var(--f-mono)", fontSize: 12, marginTop: 4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v || "—"}</div>
    </div>
  );
}

function TaskCard({ thread, conv }: { thread: ExchangeThread; conv: ExchangeConversation }) {
  const column = frColTone(thread.column);
  return (
    <Section label="Current task">
      <div style={{ display: "grid", gap: 11, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--panel)", padding: "14px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{thread.taskId || conv.role || "chat"}</span>
          <span style={pill(column.c, column.bg, column.br)}>{(thread.column || "working").replace("-", " ")}</span>
          <span style={pill("var(--fg-3)", "var(--panel-2)", "var(--line-2)")}>{thread.priority || conv.runtime || "normal"}</span>
        </div>
        <div style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.35 }}>{thread.task || `Chat with ${conv.name}`}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 2 }}>
          <Meta k="runtime" v={conv.runtime} />
          <Meta k="machine" v={conv.machine} tone={thread.blocked ? "danger" : "live"} />
          <Meta k="branch" v={thread.branch || thread.cwd} />
          <Meta k="elapsed" v={thread.elapsed} />
        </div>
      </div>
    </Section>
  );
}

function ScopeCard({ thread, conv }: { thread: ExchangeThread; conv: ExchangeConversation }) {
  return (
    <Section label="Scope">
      <div style={{ display: "grid", gap: 10, border: "1px solid var(--line)", borderRadius: "var(--radius)", background: "var(--panel)", padding: "14px 15px" }}>
        <span style={{ ...pill("var(--honey)", "var(--honey-soft)", "var(--honey-line)"), justifySelf: "start" }}>general chat</span>
        <div style={{ color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{conv.name}</div>
        <div style={{ color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 11.5 }}>{thread.scope || conv.sub || "Hive"}</div>
        <div style={{ color: "var(--fg-3)", fontSize: 13, lineHeight: 1.55, marginTop: 2 }}>Not tied to a task. Routes across the whole hive — mention an agent or a project to scope it.</div>
      </div>
    </Section>
  );
}

function Telemetry({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Section label="Run telemetry">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
        {rows.map(([key, value]) => (
          <div key={key} style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", background: "var(--panel-2)", padding: "9px 11px" }}>
            <div className="fr-eyebrow">{key}</div>
            <div style={{ overflow: "hidden", color: key.toLowerCase() === "tokens" ? "var(--honey)" : "var(--fg-2)", fontFamily: "var(--f-mono)", fontSize: 12.5, fontWeight: 500, marginTop: 4, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || "—"}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function LiveStdout({ output, live }: { output?: string; live?: boolean }) {
  return (
    <Section label="Live stdout" right={<span className="fr-eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: live ? "var(--live)" : "var(--fg-4)" }}><span className={live ? "fr-dot live" : "fr-dot"} style={{ color: live ? "var(--live)" : "var(--fg-4)" }} /> {live ? "streaming" : "idle"}</span>}>
      <pre className="fr-scroll" style={{ maxHeight: 156, overflow: "auto", border: `1px solid ${live ? "color-mix(in srgb, var(--live) 24%, var(--line))" : "var(--line)"}`, borderRadius: "var(--radius-sm)", background: "var(--bg-soft)", color: output ? "var(--fg-2)" : "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5, lineHeight: 1.65, margin: 0, padding: "11px 13px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{output || "— no recent output —"}</pre>
    </Section>
  );
}

const actionButton: React.CSSProperties = {
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "var(--f-mono)",
  fontSize: 10.5,
  fontWeight: 500,
  letterSpacing: "0.08em",
  padding: "10px 12px",
  textTransform: "uppercase",
  transition: "filter 140ms ease",
};

function QuickActions({ actions, blocked, onAction }: { actions: string[]; blocked?: boolean; onAction: (action: string) => void }) {
  const [primary = "Check status", ...rest] = actions.length ? actions : ["Check status", "Refresh runtime"];
  return (
    <Section label="Quick actions">
      <div style={{ display: "grid", gap: 7 }}>
        <button type="button" onClick={() => onAction(primary)} style={{ ...actionButton, border: `1px solid ${blocked ? "var(--honey-line)" : "color-mix(in srgb, var(--danger) 40%, transparent)"}`, background: blocked ? "var(--honey-soft)" : "var(--danger-soft)", color: blocked ? "var(--honey)" : "var(--danger)" }}>{primary}</button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {rest.map((action) => <button key={action} type="button" onClick={() => onAction(action)} style={{ ...actionButton, border: "1px solid var(--line-2)", background: "var(--panel-2)", color: "var(--fg-2)" }}>{action}</button>)}
        </div>
      </div>
    </Section>
  );
}

export function ContextPanel({
  conv,
  isAgent,
  live,
  output,
  rows,
  thread,
  onAction,
}: {
  conv: ExchangeConversation;
  isAgent: boolean;
  live?: boolean;
  output?: string;
  rows: Array<[string, string]>;
  thread: ExchangeThread;
  onAction: (action: string) => void;
}) {
  return (
    <>
      {isAgent ? <TaskCard thread={thread} conv={conv} /> : <ScopeCard thread={thread} conv={conv} />}
      <Telemetry rows={rows} />
      <LiveStdout output={output} live={live} />
      <QuickActions actions={thread.actions || (isAgent ? ["Check status", "Refresh runtime"] : ["End chat", "Pin", "Export"])} blocked={thread.blocked} onAction={onAction} />
    </>
  );
}

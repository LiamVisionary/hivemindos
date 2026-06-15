"use client";
// Zero Human Companies — modals: shell, inputs, crew builder (select existing
// real agents), and the 2-step create-company flow. The crew builder and create
// flow surface the staged crew + form to the container, which persists them via
// /api/companies.
import React from "react";
import { createPortal } from "react-dom";
import { RoleGlyph, SectionLabel } from "./primitives";
import { assignAgent } from "./data";
import type { Agent, Colony, CreateForm, MetricUnit, PoolAgent, Theme } from "./types";

// ── shared input primitives ──────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono-cap" style={{ color: "var(--fg-4)" }}>{label}</span>
      {children}
      {hint ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{hint}</span> : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg-2)",
  border: "1px solid var(--line-2)", borderRadius: 9, padding: "9px 11px", colorScheme: "dark",
  color: "var(--fg)", fontFamily: "var(--f-body)", fontSize: 13.5, outline: "none",
};

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focus, setFocus] = React.useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ ...inputStyle, borderColor: focus ? "var(--honey-2)" : "var(--line-2)", ...(props.style || {}) }}
    />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ ...inputStyle, appearance: "none", cursor: "pointer", borderColor: focus ? "var(--honey-2)" : "var(--line-2)" }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// Metric types drive card layout + formatting: currency/users → headline "money/DAU"
// card; number/percent → the standard apex progress-ring card.
const METRIC_TYPE_OPTIONS: { value: MetricUnit; label: string; placeholder: string }[] = [
  { value: "number", label: "Number", placeholder: "5,000" },
  { value: "percent", label: "Percentage", placeholder: "95" },
  { value: "currency", label: "Currency (USD)", placeholder: "40k" },
  { value: "users", label: "Users (DAU/MAU)", placeholder: "50,000" },
];

// ── modal shell ──────────────────────────────────────────────────────────
// Rendered through a portal to <body> (wrapped in a themed .zhc-root so the
// scoped CSS tokens still resolve), so the fixed overlay is never clipped or
// re-anchored by the dashboard panel's overflow/transform context.
function Modal({
  title, subtitle, onClose, width = 880, children, footer, theme = "dark",
}: {
  title: string; subtitle?: string; onClose: () => void; width?: number;
  children: React.ReactNode; footer?: React.ReactNode; theme?: Theme;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="zhc-root" data-theme={theme} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2147483000, display: "grid", placeItems: "center", padding: 24, background: "rgba(2,4,8,0.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", animation: "zhcFade 160ms ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(" + width + "px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 16, border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "0 30px 80px rgba(0,0,0,0.6)", overflow: "hidden", animation: "zhcRise 200ms cubic-bezier(.2,.7,.3,1)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>{title}</div>
            {subtitle ? <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 3 }}>{subtitle}</div> : null}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, display: "grid", placeItems: "center", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: 8, background: "transparent", color: "var(--fg-3)", fontSize: 15 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 20 }} className="scrollbar-thin">{children}</div>
        {footer ? <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--line)" }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: "9px 16px", borderRadius: 9, cursor: "pointer", border: "1px solid var(--line-2)", background: "transparent", color: "var(--fg-2)", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, letterSpacing: 0.06 }}>{children}</button>
  );
}

function PrimaryBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: "9px 18px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer", border: "1px solid color-mix(in srgb, var(--honey) 50%, transparent)", background: disabled ? "var(--bg-3)" : "var(--honey-2)", color: disabled ? "var(--fg-4)" : "var(--bg-0)", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 700, letterSpacing: 0.06, opacity: disabled ? 0.6 : 1 }}>{children}</button>
  );
}

// ── crew builder: select existing agents (left) + staged crew (right) ─────
const ROLE_TINT: Record<string, string> = {
  Engineer: "var(--cyan-2)", Product: "var(--honey-2)", Designer: "#f0abfc", QA: "#fdba74",
  DevOps: "var(--honey-2)", Auditor: "var(--cyan-2)", Growth: "#86efac", Research: "var(--cyan-2)", Treasury: "var(--honey-2)",
};

function AgentPickRow({ agent, onAdd }: { agent: PoolAgent; onAdd: (a: PoolAgent) => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button onClick={() => onAdd(agent)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ textAlign: "left", cursor: "pointer", display: "flex", gap: 11, alignItems: "center", width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid " + (hover ? "var(--line-2)" : "var(--line)"), background: hover ? "var(--bg-2)" : "transparent", transition: "background 140ms, border-color 140ms" }}>
      <RoleGlyph role={agent.role} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>{agent.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: ROLE_TINT[agent.role] || "var(--fg-3)" }}>{agent.role}</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 4 }}>{agent.runtime}{agent.model ? ` · ${agent.model}` : ""}{agent.walletCap ? ` · cap $${agent.walletCap}/day` : ""}</div>
      </div>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: hover ? "var(--honey-2)" : "var(--fg-4)", flexShrink: 0 }}>+</span>
    </button>
  );
}

function CrewRow({ a, onChange, onRemove, locked }: { a: Agent; onChange: (next: Agent) => void; onRemove: () => void; locked: boolean }) {
  const cap = a._cap ?? 0;
  const wallet = a.walletCap ?? 0;
  const overWallet = wallet > 0 && cap > wallet;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)" }}>
      <RoleGlyph role={a.role} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>{a.name}</span>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: a.role === "Queen" ? "var(--honey-2)" : (ROLE_TINT[a.role] || "var(--fg-3)") }}>{a.role === "Queen" ? "Queen · CEO" : a.role}</span>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 3 }}>{a.runtime}{a.model ? ` · ${a.model}` : ""}</div>
      </div>
      {/* company budget — distinct from the agent's general wallet cap */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, width: 116 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Company budget for this agent (per day)">
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>$</span>
          <input type="number" value={cap === 0 ? "" : cap} min={0} step={5} placeholder="0" onChange={(e) => onChange({ ...a, _cap: e.target.value === "" ? 0 : Math.max(0, Math.floor(+e.target.value || 0)) })} style={{ width: 66, background: "var(--bg-3)", border: "1px solid " + (overWallet ? "var(--danger)" : "var(--line-2)"), borderRadius: 7, color: overWallet ? "var(--danger-2)" : "var(--fg-2)", colorScheme: "dark", fontFamily: "var(--f-mono)", fontSize: 11, padding: "5px 8px", outline: "none", textAlign: "left" }} />
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>/day</span>
        </div>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: overWallet ? "var(--danger-2)" : "var(--fg-4)" }}>{overWallet ? "over wallet cap" : wallet > 0 ? "wallet $" + wallet : "company budget"}</span>
      </div>
      {locked ? (
        <span style={{ width: 26, textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--fg-4)" }} title="CEO is required">♛</span>
      ) : (
        <button onClick={onRemove} aria-label="Remove" style={{ width: 26, height: 26, display: "grid", placeItems: "center", cursor: "pointer", border: "1px solid var(--line)", borderRadius: 7, background: "transparent", color: "var(--fg-4)", fontSize: 12 }}>✕</button>
      )}
    </div>
  );
}

function CrewBuilder({
  crew, setCrew, agentPool, seedQueen, queenName,
}: {
  crew: Agent[]; setCrew: (c: Agent[]) => void; agentPool: PoolAgent[];
  /** create flow: the first hire becomes the Queen/CEO. */
  seedQueen: boolean;
  /** browse flow: existing company's Queen name that new hires report to. */
  queenName?: string | null;
}) {
  const onCrew = new Set(crew.map((a) => a.id ?? a.name));
  const available = agentPool.filter((a) => !onCrew.has(a.id));
  const addAgent = (poolAgent: PoolAgent) => {
    if (seedQueen && crew.length === 0) {
      setCrew([...crew, assignAgent(poolAgent, undefined, null, "Queen")]);
      return;
    }
    const reportsTo = seedQueen ? (crew[0]?.name ?? null) : (queenName ?? null);
    setCrew([...crew, assignAgent(poolAgent, undefined, reportsTo)]);
  };
  const updateAt = (i: number, next: Agent) => setCrew(crew.map((a, idx) => (idx === i ? next : a)));
  const removeAt = (i: number) => setCrew(crew.filter((_, idx) => idx !== i));
  const totalCap = crew.reduce((n, a) => n + (a._cap || 0), 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 18, alignItems: "start" }}>
      <div>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{available.length} available</span>}>select an agent</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 392, overflowY: "auto", paddingRight: 4 }} className="scrollbar-thin">
          {available.map((a) => <AgentPickRow key={a.id} agent={a} onAdd={addAgent} />)}
          {available.length === 0 && (
            <div style={{ borderRadius: 10, border: "1px dashed var(--line-2)", padding: "22px 12px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              {agentPool.length === 0 ? "no agents configured — add agents in the Fleet view first" : "all available agents are on the crew"}
            </div>
          )}
        </div>
      </div>
      <div>
        <SectionLabel right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{crew.length} agents · ${totalCap}/day company budget</span>}>the crew</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {crew.map((a, i) => <CrewRow key={a.id ?? a.name} a={a} locked={seedQueen && a.role === "Queen"} onChange={(next) => updateAt(i, next)} onRemove={() => removeAt(i)} />)}
          {crew.length === 0 && <div style={{ borderRadius: 10, border: "1px dashed var(--line-2)", padding: "22px 12px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>select agents on the left to staff this company{seedQueen ? " — the first hire becomes the Queen/CEO" : ""}</div>}
        </div>
      </div>
    </div>
  );
}

// ── standalone agent browser (from cockpit Team tab) ──────────────────────
export function AgentBrowserModal({
  colony, agentPool, busy, theme, onClose, onConfirm,
}: {
  colony: Colony; agentPool: PoolAgent[]; busy?: boolean; theme?: Theme;
  onClose: () => void; onConfirm: (agents: Agent[]) => void;
}) {
  const [crew, setCrew] = React.useState<Agent[]>([]);
  const queen = colony.agents.find((a) => a.role === "Queen");
  // Agents already on this company can't be added again.
  const memberIds = new Set(colony.agents.map((a) => a.id).filter(Boolean) as string[]);
  const pool = agentPool.filter((a) => !memberIds.has(a.id));
  return (
    <Modal
      title="Select agents"
      subtitle={colony.name + " · assign existing agents to the crew"}
      theme={theme}
      onClose={onClose}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            {crew.length ? `${crew.length} new agent${crew.length > 1 ? "s" : ""} will report to ${queen ? queen.name : "the Queen"}` : "no agents selected yet"}
          </span>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={!crew.length || busy} onClick={() => onConfirm(crew)}>{busy ? "Adding…" : `Add ${crew.length || ""} to crew`}</PrimaryBtn>
        </>
      }
    >
      <CrewBuilder crew={crew} setCrew={setCrew} agentPool={pool} seedQueen={false} queenName={queen?.name ?? null} />
    </Modal>
  );
}

// ── identity form (shared by create step 0 + edit) ────────────────────────
type FormState = Required<Pick<CreateForm, "name">> & {
  ticker: string; sector: string; apexTitle: string; apexMetric: string; apexTarget: string; metricUnit: MetricUnit; _tickerTouched?: boolean;
};

/** Collect a company's name/ticker/sector + apex goal. Used by both the create
 *  flow's first step and the standalone edit modal. */
function IdentityFields({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  const set = (k: "name" | "sector" | "apexTitle" | "apexMetric" | "apexTarget", v: string) =>
    setForm((f) => ({ ...f, [k]: v, ...(k === "name" && !f._tickerTouched ? { ticker: v.replace(/[^a-z]/gi, "").slice(0, 4).toUpperCase() } : {}) }));
  const targetPlaceholder = METRIC_TYPE_OPTIONS.find((o) => o.value === form.metricUnit)?.placeholder ?? "5,000";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
        <Field label="Company name"><TextInput value={form.name} placeholder="e.g. Aperture Labs" onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="Ticker"><TextInput value={form.ticker} placeholder="APRT" maxLength={5} onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase(), _tickerTouched: true }))} /></Field>
      </div>
      <Field label="Sector"><TextInput value={form.sector} placeholder="e.g. Developer Tools" onChange={(e) => set("sector", e.target.value)} /></Field>
      <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />
      <Field label="Apex goal" hint="The single strategic mandate every agent aligns to."><TextInput value={form.apexTitle} placeholder="e.g. Become the default agent API layer" onChange={(e) => set("apexTitle", e.target.value)} /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 12 }}>
        <Field label="Tracked metric"><TextInput value={form.apexMetric} placeholder="e.g. weekly active SDKs" onChange={(e) => set("apexMetric", e.target.value)} /></Field>
        <Field label="Metric type" hint="Sets formatting & card layout">
          <Select value={form.metricUnit} onChange={(v) => setForm((f) => ({ ...f, metricUnit: v as MetricUnit }))} options={METRIC_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        </Field>
      </div>
      <Field label="Target" hint={form.metricUnit === "currency" ? "USD — the $ is added for you" : form.metricUnit === "percent" ? "The % is added for you" : form.metricUnit === "users" ? "Daily active users (DAU)" : "A plain number target"}>
        <TextInput value={form.apexTarget} placeholder={targetPlaceholder} onChange={(e) => set("apexTarget", e.target.value)} />
      </Field>
    </div>
  );
}

/** Snapshot the editable identity/goal fields out of the form, trimmed. */
function readForm(form: FormState): CreateForm {
  return {
    name: form.name.trim(), ticker: form.ticker.trim(), sector: form.sector.trim(),
    apexTitle: form.apexTitle.trim(), apexMetric: form.apexMetric.trim(), apexTarget: form.apexTarget.trim(),
    metricUnit: form.metricUnit,
  };
}

// ── create-company flow (2 steps) ─────────────────────────────────────────
export function CreateCompanyModal({
  agentPool, busy, theme, onClose, onCreate,
}: {
  agentPool: PoolAgent[]; busy?: boolean; theme?: Theme;
  onClose: () => void; onCreate: (form: CreateForm, crew: Agent[]) => void;
}) {
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>({ name: "", ticker: "", sector: "", apexTitle: "", apexMetric: "", apexTarget: "", metricUnit: "number" });
  const [crew, setCrew] = React.useState<Agent[]>([]);
  const canNext = form.name.trim().length > 0;
  const create = () => onCreate(readForm(form), crew.map((a) => ({ ...a })));

  const steps = ["Identity", "Founding crew"];
  return (
    <Modal
      title="Found a company"
      subtitle="Stand up a new zero-human company"
      theme={theme}
      onClose={onClose}
      width={step === 0 ? 620 : 900}
      footer={
        <>
          <div style={{ display: "flex", gap: 7, flex: 1 }}>
            {steps.map((s, i) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 10.5, color: i === step ? "var(--fg)" : "var(--fg-4)" }}>
                <span style={{ width: 16, height: 16, display: "grid", placeItems: "center", borderRadius: 999, border: "1px solid " + (i === step ? "var(--honey-2)" : "var(--line-2)"), color: i === step ? "var(--honey-2)" : "var(--fg-4)", fontSize: 9 }}>{i + 1}</span>
                {s}
              </span>
            ))}
          </div>
          {step > 0 && <GhostBtn onClick={() => setStep(step - 1)}>Back</GhostBtn>}
          {step === 0
            ? <PrimaryBtn disabled={!canNext} onClick={() => setStep(1)}>Next · staff the crew</PrimaryBtn>
            : <PrimaryBtn disabled={crew.length === 0 || busy} onClick={create}>{busy ? "Founding…" : `Found ${form.name || "company"}`}</PrimaryBtn>}
        </>
      }
    >
      {step === 0 ? (
        <IdentityFields form={form} setForm={setForm} />
      ) : (
        <CrewBuilder crew={crew} setCrew={setCrew} agentPool={agentPool} seedQueen />
      )}
    </Modal>
  );
}

// ── edit-company flow (identity + apex goal; crew is managed separately) ───
export function EditCompanyModal({
  initial, busy, theme, onClose, onSave,
}: {
  initial: CreateForm; busy?: boolean; theme?: Theme;
  onClose: () => void; onSave: (form: CreateForm) => void;
}) {
  const [form, setForm] = React.useState<FormState>({
    name: initial.name ?? "",
    ticker: initial.ticker ?? "",
    sector: initial.sector ?? "",
    apexTitle: initial.apexTitle ?? "",
    apexMetric: initial.apexMetric ?? "",
    apexTarget: initial.apexTarget ?? "",
    metricUnit: initial.metricUnit ?? "number",
    // The company already has a ticker — don't auto-rewrite it when the name changes.
    _tickerTouched: true,
  });
  const canSave = form.name.trim().length > 0;
  return (
    <Modal
      title="Edit company"
      subtitle={`Update ${initial.name || "this company"}'s identity & apex goal`}
      theme={theme}
      onClose={onClose}
      width={620}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>Manage the crew from the company’s Team tab.</span>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={!canSave || busy} onClick={() => onSave(readForm(form))}>{busy ? "Saving…" : "Save changes"}</PrimaryBtn>
        </>
      }
    >
      <IdentityFields form={form} setForm={setForm} />
    </Modal>
  );
}

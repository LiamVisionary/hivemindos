"use client";
// Zero Human Companies — modals: shell, inputs, crew builder (select existing
// real agents), and the 2-step create-company flow. The crew builder and create
// flow surface the staged crew + form to the container, which persists them via
// /api/companies.
import React from "react";
import { createPortal } from "react-dom";
import { openNativeDirectory } from "@/lib/native/filesystem";
import { RoleGlyph, SectionLabel } from "./primitives";
import { assignAgent } from "./data";
import type {
  Agent,
  AgentState,
  Colony,
  CompanyEditForm,
  CompanyMemberEdit,
  CompanyStatus,
  CreateForm,
  MetricUnit,
  PoolAgent,
  Role,
  Theme,
} from "./types";

// ── shared input primitives ──────────────────────────────────────────────
/** A registry project as the "Code project" picker needs it. */
type ProjectPickerEntry = { id: string; name: string; localPath?: string; repoName?: string };

/** Display-only: collapse the macOS/Linux home prefix so option labels stay scannable. */
function shortenHomePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

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

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focus, setFocus] = React.useState(false);
  return (
    <textarea
      {...props}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{ ...inputStyle, minHeight: 76, resize: "vertical", lineHeight: 1.45, borderColor: focus ? "var(--honey-2)" : "var(--line-2)", ...(props.style || {}) }}
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

const ROLE_OPTIONS: Role[] = ["Queen", "Engineer", "Product", "Designer", "QA", "DevOps", "Auditor", "Growth", "Research", "Treasury"];
const STATE_OPTIONS: { value: AgentState | ""; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "working", label: "Working" },
  { value: "reviewing", label: "Reviewing" },
  { value: "scheduled", label: "Scheduled" },
  { value: "ready", label: "Ready" },
  { value: "idle", label: "Idle" },
  { value: "blocked", label: "Blocked" },
  { value: "setup", label: "Setup" },
];
const STATUS_OPTIONS: { value: CompanyStatus | ""; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "shipping", label: "Shipping" },
  { value: "drift", label: "Drift" },
  { value: "review", label: "Review" },
  { value: "setup", label: "Setup" },
  { value: "paused", label: "Paused" },
];

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function clampedNumber(value: string, max?: number): number | undefined {
  const numeric = optionalNumber(value);
  if (numeric === undefined) return undefined;
  const rounded = Math.round(Math.max(0, numeric) * 100) / 100;
  return max === undefined ? rounded : Math.min(max, rounded);
}

// ── modal shell ──────────────────────────────────────────────────────────
// Rendered through a portal to <body> (wrapped in a themed .zhc-root so the
// scoped CSS tokens still resolve), so the fixed overlay is never clipped or
// re-anchored by the dashboard panel's overflow/transform context.
export function Modal({
  title, subtitle, onClose, width = 880, children, footer, theme = "dark", zIndex = 2147483000,
}: {
  title: string; subtitle?: string; onClose: () => void; width?: number;
  children: React.ReactNode; footer?: React.ReactNode; theme?: Theme; zIndex?: number;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="zhc-root" data-theme={theme} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex, display: "grid", placeItems: "center", padding: 24, background: "rgba(2,4,8,0.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", animation: "zhcFade 160ms ease" }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: "min(" + width + "px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column", borderRadius: 16, border: "1px solid var(--line-2)", background: "var(--bg-1)", boxShadow: "0 30px 80px rgba(0,0,0,0.6)", overflow: "hidden", animation: "zhcRise 200ms cubic-bezier(.2,.7,.3,1)" }}>
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
function IdentityFields<T extends FormState>({ form, setForm }: { form: T; setForm: React.Dispatch<React.SetStateAction<T>> }) {
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
  agentPool, initialCrew, busy, theme, onClose, onCreate,
}: {
  agentPool: PoolAgent[]; initialCrew?: Agent[]; busy?: boolean; theme?: Theme;
  onClose: () => void; onCreate: (form: CreateForm, crew: Agent[]) => void;
}) {
  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>({ name: "", ticker: "", sector: "", apexTitle: "", apexMetric: "", apexTarget: "", metricUnit: "number" });
  const [crew, setCrew] = React.useState<Agent[]>(() => (initialCrew ?? []).map((member) => ({ ...member })));
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

// ── edit-company flow (full metadata + treasury + member controls) ─────────
type EditFormState = FormState & {
  charter: string;
  blurb: string;
  projectId: string;
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  totalBudgetUsd?: number;
  status: CompanyStatus | "";
  alignment?: number;
  apexCurrent: string;
  apexProgress?: number;
  frozen: boolean;
  revenueKind: "users" | "revenue" | "";
  revenueLabel: string;
  revenueValue: string;
  revenueTarget: string;
  revenueMau: string;
  revenuePct?: number;
  revenueDelta: string;
  revenueUp: boolean;
  revenueIsApex: boolean;
  members: CompanyMemberEdit[];
};

function normalizeMemberEdit(member: CompanyMemberEdit): CompanyMemberEdit {
  return {
    ...member,
    name: member.name || member.agentId,
    task: member.task ?? "",
    state: member.state ?? "",
    reportsTo: member.reportsTo ?? null,
  };
}

function initialEditState(initial: CompanyEditForm): EditFormState {
  return {
    name: initial.name ?? "",
    ticker: initial.ticker ?? "",
    sector: initial.sector ?? "",
    apexTitle: initial.apexTitle ?? "",
    apexMetric: initial.apexMetric ?? "",
    apexTarget: initial.apexTarget ?? "",
    metricUnit: initial.metricUnit ?? "number",
    _tickerTouched: true,
    charter: initial.charter ?? "",
    blurb: initial.blurb ?? "",
    projectId: initial.projectId ?? "",
    dailyBudgetUsd: initial.dailyBudgetUsd,
    monthlyBudgetUsd: initial.monthlyBudgetUsd,
    totalBudgetUsd: initial.totalBudgetUsd,
    status: initial.status ?? "",
    alignment: initial.alignment,
    apexCurrent: initial.apexCurrent ?? "",
    apexProgress: initial.apexProgress,
    frozen: Boolean(initial.frozen),
    revenueKind: initial.revenueKind ?? "",
    revenueLabel: initial.revenueLabel ?? "",
    revenueValue: initial.revenueValue ?? "",
    revenueTarget: initial.revenueTarget ?? "",
    revenueMau: initial.revenueMau ?? "",
    revenuePct: initial.revenuePct,
    revenueDelta: initial.revenueDelta ?? "",
    revenueUp: initial.revenueUp ?? true,
    revenueIsApex: initial.revenueIsApex ?? false,
    members: (initial.members ?? []).map(normalizeMemberEdit),
  };
}

function memberPayload(member: CompanyMemberEdit): CompanyMemberEdit {
  return {
    agentId: member.agentId,
    name: member.name,
    role: member.role,
    companyCap: member.companyCap,
    task: member.task?.trim(),
    state: member.state,
    reportsTo: member.reportsTo ?? null,
    runtime: member.runtime,
    model: member.model,
  };
}

function readEditForm(form: EditFormState): CompanyEditForm {
  return {
    ...readForm(form),
    charter: form.charter.trim(),
    blurb: form.blurb.trim(),
    projectId: form.projectId.trim(),
    dailyBudgetUsd: form.dailyBudgetUsd,
    monthlyBudgetUsd: form.monthlyBudgetUsd,
    totalBudgetUsd: form.totalBudgetUsd,
    status: form.status,
    alignment: form.alignment,
    apexCurrent: form.apexCurrent.trim(),
    apexProgress: form.apexProgress,
    frozen: form.frozen,
    revenueKind: form.revenueKind,
    revenueLabel: form.revenueLabel.trim(),
    revenueValue: form.revenueValue.trim(),
    revenueTarget: form.revenueTarget.trim(),
    revenueMau: form.revenueMau.trim(),
    revenuePct: form.revenuePct,
    revenueDelta: form.revenueDelta.trim(),
    revenueUp: form.revenueUp,
    revenueIsApex: form.revenueIsApex,
    members: form.members.map(memberPayload),
  };
}

function EditSection({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-1)", padding: 16 }}>
      <SectionLabel right={right}>{title}</SectionLabel>
      {children}
    </div>
  );
}

function NumericInput({
  value, onChange, placeholder, step = 1, max,
}: {
  value?: number; onChange: (value: number | undefined) => void; placeholder?: string; step?: number; max?: number;
}) {
  return (
    <TextInput
      type="number"
      min={0}
      max={max}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => onChange(clampedNumber(event.target.value, max))}
    />
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ accentColor: "var(--honey-2)" }} />
      <span>{label}</span>
    </label>
  );
}

function MemberEditRow({
  member, onChange, onRemove,
}: {
  member: CompanyMemberEdit; onChange: (member: CompanyMemberEdit) => void; onRemove: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(170px, 1.2fr) minmax(120px, 0.8fr) minmax(120px, 0.8fr) minmax(90px, 0.6fr) minmax(220px, 1.3fr) auto", alignItems: "end", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <RoleGlyph role={member.role} size={30} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 600, color: "var(--fg)", lineHeight: 1.25 }}>{member.name}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 3, lineHeight: 1.35 }}>
            {member.runtime || "Agent"}{member.model ? ` · ${member.model}` : ""}
          </div>
        </div>
      </div>
      <Field label="Role">
        <Select value={member.role} onChange={(value) => onChange({ ...member, role: value as Role })} options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))} />
      </Field>
      <Field label="State">
        <Select value={member.state ?? ""} onChange={(value) => onChange({ ...member, state: value as AgentState | "" })} options={STATE_OPTIONS} />
      </Field>
      <Field label="Cap">
        <NumericInput value={member.companyCap} step={5} placeholder="0" onChange={(value) => onChange({ ...member, companyCap: value })} />
      </Field>
      <Field label="Task">
        <TextInput value={member.task ?? ""} placeholder="Current work caption" onChange={(event) => onChange({ ...member, task: event.target.value })} />
      </Field>
      <button
        onClick={onRemove}
        aria-label={`Remove ${member.name}`}
        style={{ width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", border: "1px solid var(--line-2)", borderRadius: 8, background: "transparent", color: "var(--fg-4)", fontSize: 13 }}
      >
        ✕
      </button>
    </div>
  );
}

export function EditCompanyModal({
  initial, busy, theme, onClose, onSave,
}: {
  initial: CompanyEditForm; busy?: boolean; theme?: Theme;
  onClose: () => void; onSave: (form: CompanyEditForm) => void;
}) {
  const [form, setForm] = React.useState<EditFormState>(() => initialEditState(initial));
  // Registered code projects for the "Code project" picker (structured config —
  // never a free-text id). An id missing from the registry stays selectable so
  // opening + saving the modal can't silently unlink it.
  const [projects, setProjects] = React.useState<ProjectPickerEntry[]>([]);
  const [projectLinkBusy, setProjectLinkBusy] = React.useState(false);
  const [projectLinkError, setProjectLinkError] = React.useState<string | null>(null);
  const [manualProjectOpen, setManualProjectOpen] = React.useState(false);
  const [manualProject, setManualProject] = React.useState({ name: "", path: "" });
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          projects?: { id?: string; name?: string; localPath?: string; gitlawbRepo?: { repoName?: string } }[];
        };
        if (cancelled || !json?.ok || !Array.isArray(json.projects)) return;
        setProjects(json.projects
          .filter((project) => project.id)
          .map((project) => ({
            id: project.id!,
            name: project.name || project.id!,
            localPath: project.localPath,
            repoName: project.gitlawbRepo?.repoName,
          })));
      } catch {
        // Registry unreachable — the picker still offers None + the current link.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const projectOptions = React.useMemo(() => {
    const options = [
      { value: "", label: "None" },
      ...projects.map((project) => ({
        value: project.id,
        // The name alone is meaningless in a registry of look-alike entries —
        // show where each project actually lives.
        label: project.localPath ? `${project.name} · ${shortenHomePath(project.localPath)}` : `${project.name} · no folder linked`,
      })),
    ];
    if (form.projectId && !options.some((option) => option.value === form.projectId)) {
      options.push({ value: form.projectId, label: `${form.projectId} (not in registry)` });
    }
    return options;
  }, [projects, form.projectId]);
  const selectedProject = projects.find((project) => project.id === form.projectId);

  const registerProject = async (name: string, localPath?: string) => {
    if (projectLinkBusy) return;
    setProjectLinkBusy(true);
    setProjectLinkError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, localPath }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; project?: { id?: string; name?: string; localPath?: string } };
      if (!res.ok || !json?.ok || !json.project?.id) {
        setProjectLinkError(json?.error || "Could not register the project.");
        return;
      }
      const entry: ProjectPickerEntry = { id: json.project.id, name: json.project.name || json.project.id, localPath: json.project.localPath };
      setProjects((current) => [entry, ...current.filter((project) => project.id !== entry.id)]);
      setForm((current) => ({ ...current, projectId: entry.id }));
      setManualProject({ name: "", path: "" });
      setManualProjectOpen(false);
    } catch (error) {
      setProjectLinkError(error instanceof Error ? error.message : "Could not register the project.");
    } finally {
      setProjectLinkBusy(false);
    }
  };

  const browseForProjectFolder = async () => {
    if (projectLinkBusy) return;
    setProjectLinkError(null);
    const result = await openNativeDirectory({ prompt: "Choose the folder of this company's code repo:" });
    if (result === null) {
      // Browser runtime: no native dialog — fall back to the labeled manual row.
      setManualProjectOpen(true);
      return;
    }
    if (result.cancelled) return;
    if (!result.ok || !result.path) {
      setProjectLinkError(result.error || "Could not choose a folder.");
      return;
    }
    const path = result.path.replace(/\/+$/, "");
    const name = path.split("/").filter(Boolean).at(-1) || path;
    await registerProject(name, path);
  };
  const canSave = form.name.trim().length > 0;
  const updateMember = (agentId: string, next: CompanyMemberEdit) => setForm((current) => ({
    ...current,
    members: current.members.map((member) => (member.agentId === agentId ? next : member)),
  }));
  const removeMember = (agentId: string) => setForm((current) => ({
    ...current,
    members: current.members.filter((member) => member.agentId !== agentId),
  }));

  return (
    <Modal
      title="Edit company"
      subtitle={`Update ${initial.name || "this company"}'s identity, treasury, metrics, and crew fields`}
      theme={theme}
      onClose={onClose}
      width={1040}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            Saves company metadata, treasury caps, revenue metrics, and member fields.
          </span>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={!canSave || busy} onClick={() => onSave(readEditForm(form))}>{busy ? "Saving…" : "Save changes"}</PrimaryBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <EditSection title="identity · mandate">
          <IdentityFields form={form} setForm={setForm} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
            <Field label="Charter">
              <TextArea value={form.charter} placeholder="Founder-set direction" onChange={(event) => setForm((current) => ({ ...current, charter: event.target.value }))} />
            </Field>
            <Field label="Blurb">
              <TextArea value={form.blurb} placeholder="One-line company tagline" onChange={(event) => setForm((current) => ({ ...current, blurb: event.target.value }))} />
            </Field>
          </div>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <Field label="Code project" hint="The repo this company's product work lives in. New tasks carry it, so work routes to machines that have the repo checked out and shows its code proof.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                <Select value={form.projectId} onChange={(value) => setForm((current) => ({ ...current, projectId: value }))} options={projectOptions} />
                <GhostBtn onClick={browseForProjectFolder}>{projectLinkBusy ? "Linking…" : "Link a folder…"}</GhostBtn>
              </div>
            </Field>
            {selectedProject ? (
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)", wordBreak: "break-all" }}>
                {selectedProject.localPath ?? "No folder linked yet — tasks can't route by checkout until one is."}
                {selectedProject.repoName ? ` · GitLawb repo: ${selectedProject.repoName}` : ""}
              </div>
            ) : null}
            {projectLinkError ? (
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--danger-2)" }}>{projectLinkError}</div>
            ) : null}
            {manualProjectOpen ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 8, alignItems: "end" }}>
                <Field label="Project name">
                  <TextInput value={manualProject.name} placeholder="maps-agency" onChange={(event) => setManualProject((current) => ({ ...current, name: event.target.value }))} />
                </Field>
                <Field label="Absolute folder path (advanced)" hint="Folder browsing needs the desktop app; in the browser, paste the repo path.">
                  <TextInput value={manualProject.path} placeholder="/Users/you/code/projects/my-repo" onChange={(event) => setManualProject((current) => ({ ...current, path: event.target.value }))} />
                </Field>
                <PrimaryBtn disabled={!manualProject.name.trim() || projectLinkBusy} onClick={() => registerProject(manualProject.name.trim(), manualProject.path.trim() || undefined)}>
                  {projectLinkBusy ? "Registering…" : "Register"}
                </PrimaryBtn>
              </div>
            ) : null}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px", gap: 12, marginTop: 16 }}>
            <Field label="Current metric value">
              <TextInput value={form.apexCurrent} placeholder="0" onChange={(event) => setForm((current) => ({ ...current, apexCurrent: event.target.value }))} />
            </Field>
            <Field label="Goal progress">
              <NumericInput value={form.apexProgress} max={100} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, apexProgress: value }))} />
            </Field>
          </div>
        </EditSection>

        <EditSection title="treasury · governance">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <Field label="Daily budget USD">
              <NumericInput value={form.dailyBudgetUsd} step={5} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, dailyBudgetUsd: value }))} />
            </Field>
            <Field label="Monthly budget USD">
              <NumericInput value={form.monthlyBudgetUsd} step={25} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, monthlyBudgetUsd: value }))} />
            </Field>
            <Field label="Lifetime budget USD">
              <NumericInput value={form.totalBudgetUsd} step={50} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, totalBudgetUsd: value }))} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 1fr", gap: 12, marginTop: 16, alignItems: "end" }}>
            <Field label="Status override">
              <Select value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value as CompanyStatus | "" }))} options={STATUS_OPTIONS} />
            </Field>
            <Field label="Alignment">
              <NumericInput value={form.alignment} max={100} placeholder="Auto" onChange={(value) => setForm((current) => ({ ...current, alignment: value }))} />
            </Field>
            <div style={{ display: "flex", alignItems: "center", minHeight: 37 }}>
              <ToggleRow label="Freeze company spend" checked={form.frozen} onChange={(checked) => setForm((current) => ({ ...current, frozen: checked }))} />
            </div>
          </div>
        </EditSection>

        <EditSection title="revenue · headline metric">
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 1fr", gap: 12 }}>
            <Field label="Metric kind">
              <Select
                value={form.revenueKind}
                onChange={(value) => setForm((current) => ({ ...current, revenueKind: value as "users" | "revenue" | "" }))}
                options={[
                  { value: "", label: "None" },
                  { value: "revenue", label: "Revenue" },
                  { value: "users", label: "Users" },
                ]}
              />
            </Field>
            <Field label="Label">
              <TextInput value={form.revenueLabel} placeholder="MRR, DAU, pipeline" onChange={(event) => setForm((current) => ({ ...current, revenueLabel: event.target.value }))} />
            </Field>
            <Field label="Value">
              <TextInput value={form.revenueValue} placeholder="$0, 250 users" onChange={(event) => setForm((current) => ({ ...current, revenueValue: event.target.value }))} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 130px 130px", gap: 12, marginTop: 16 }}>
            <Field label="Target">
              <TextInput value={form.revenueTarget} placeholder="$10k, 5,000 users" onChange={(event) => setForm((current) => ({ ...current, revenueTarget: event.target.value }))} />
            </Field>
            <Field label="MAU">
              <TextInput value={form.revenueMau} placeholder="Optional" onChange={(event) => setForm((current) => ({ ...current, revenueMau: event.target.value }))} />
            </Field>
            <Field label="Progress">
              <NumericInput value={form.revenuePct} max={100} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, revenuePct: value }))} />
            </Field>
            <Field label="Trend">
              <Select value={form.revenueUp ? "up" : "down"} onChange={(value) => setForm((current) => ({ ...current, revenueUp: value === "up" }))} options={[{ value: "up", label: "Up" }, { value: "down", label: "Down" }]} />
            </Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, marginTop: 16, alignItems: "end" }}>
            <Field label="Delta">
              <TextInput value={form.revenueDelta} placeholder="+12% this week" onChange={(event) => setForm((current) => ({ ...current, revenueDelta: event.target.value }))} />
            </Field>
            <div style={{ minHeight: 37, display: "flex", alignItems: "center" }}>
              <ToggleRow label="Use as apex metric" checked={form.revenueIsApex} onChange={(checked) => setForm((current) => ({ ...current, revenueIsApex: checked }))} />
            </div>
          </div>
        </EditSection>

        <EditSection title="crew · member fields" right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>{form.members.length} members</span>}>
          {form.members.length === 0 ? (
            <div style={{ borderRadius: 10, border: "1px dashed var(--line-2)", padding: "18px 12px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              No crew members are assigned.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {form.members.map((member) => (
                <MemberEditRow
                  key={member.agentId}
                  member={member}
                  onChange={(next) => updateMember(member.agentId, next)}
                  onRemove={() => removeMember(member.agentId)}
                />
              ))}
            </div>
          )}
        </EditSection>
      </div>
    </Modal>
  );
}

function editableMemberFor(colony: Colony, agentId: string): CompanyMemberEdit | null {
  const saved = colony.edit.members?.find((member) => member.agentId === agentId);
  const agent = colony.agents.find((item) => item.id === agentId);
  if (saved) {
    return normalizeMemberEdit({
      ...saved,
      companyCap: saved.companyCap ?? agent?._cap,
      runtime: saved.runtime ?? agent?.runtime,
      model: saved.model ?? agent?.model,
    });
  }
  if (!agent?.id) return null;
  return {
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    companyCap: agent._cap,
    task: agent.task,
    state: agent.state,
    reportsTo: null,
    runtime: agent.runtime,
    model: agent.model,
  };
}

function editableMembersForCompany(colony: Colony): CompanyMemberEdit[] {
  const activeMembers = colony.agents
    .map((agent) => agent.id ? editableMemberFor(colony, agent.id) : null)
    .filter((member): member is CompanyMemberEdit => Boolean(member));
  const activeIds = new Set(activeMembers.map((member) => member.agentId));
  const savedOnlyMembers = (colony.edit.members ?? [])
    .filter((member) => !activeIds.has(member.agentId))
    .map(normalizeMemberEdit);
  return [...activeMembers, ...savedOnlyMembers];
}

type TreasuryFormState = {
  dailyBudgetUsd?: number;
  monthlyBudgetUsd?: number;
  totalBudgetUsd?: number;
  frozen: boolean;
  members: CompanyMemberEdit[];
};

function initialTreasuryForm(colony: Colony): TreasuryFormState {
  return {
    dailyBudgetUsd: colony.edit.dailyBudgetUsd,
    monthlyBudgetUsd: colony.edit.monthlyBudgetUsd,
    totalBudgetUsd: colony.edit.totalBudgetUsd,
    frozen: Boolean(colony.edit.frozen ?? colony.frozen),
    members: editableMembersForCompany(colony),
  };
}

function TreasuryMemberCapRow({
  member, agent, onChangeCap,
}: {
  member: CompanyMemberEdit; agent?: Agent; onChangeCap: (value: number | undefined) => void;
}) {
  const used = agent?.budgetPct ?? 0;
  const over = used >= 80;
  const cap = member.companyCap ?? agent?._cap;
  const walletCap = agent?.walletCap ?? 0;
  const overWallet = walletCap > 0 && (cap ?? 0) > walletCap;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
      <div style={{ flex: "1 1 210px", minWidth: 180, display: "flex", alignItems: "center", gap: 10 }}>
        <RoleGlyph role={member.role} size={30} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 650, color: "var(--fg)", lineHeight: 1.25 }}>{member.name}</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", marginTop: 3, lineHeight: 1.35 }}>
            {member.role}{member.runtime ? ` · ${member.runtime}` : ""}{member.model ? ` · ${member.model}` : ""}
          </div>
        </div>
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 190 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7, fontFamily: "var(--f-mono)", fontVariantNumeric: "tabular-nums", marginBottom: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: over ? "var(--danger-2)" : "var(--honey-2)" }}>{used}% used</span>
          <span style={{ fontSize: 10, color: "var(--fg-4)" }}>{cap ? `$${cap}/day cap` : "uncapped"}</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, border: "1px solid color-mix(in srgb, var(--fg) 14%, transparent)", background: "color-mix(in srgb, var(--fg) 11%, var(--bg-3))", overflow: "hidden" }} aria-label={`${member.name} used ${used}% of daily cap`}>
          <span style={{ display: "block", width: used + "%", minWidth: used > 0 ? 3 : 0, height: "100%", background: over ? "var(--danger)" : "var(--honey-2)" }} />
        </div>
        {walletCap > 0 ? (
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: overWallet ? "var(--danger-2)" : "var(--fg-4)", marginTop: 5 }}>
            {overWallet ? `Above wallet cap of $${walletCap}/day` : `Wallet cap $${walletCap}/day`}
          </div>
        ) : null}
      </div>
      <div style={{ flex: "0 1 150px", minWidth: 132 }}>
        <Field label="Daily cap">
          <NumericInput value={member.companyCap} step={5} placeholder="0" onChange={onChangeCap} />
        </Field>
      </div>
    </div>
  );
}

export function TreasurySettingsModal({
  colony, busy, theme, onClose, onSave,
}: {
  colony: Colony; busy?: boolean; theme?: Theme;
  onClose: () => void; onSave: (form: CompanyEditForm) => void;
}) {
  const [form, setForm] = React.useState<TreasuryFormState>(() => initialTreasuryForm(colony));
  const totalDailyCaps = form.members.reduce((sum, member) => sum + (member.companyCap ?? 0), 0);
  const updateCap = (agentId: string, value: number | undefined) => setForm((current) => ({
    ...current,
    members: current.members.map((member) => (member.agentId === agentId ? { ...member, companyCap: value } : member)),
  }));
  const save = () => {
    onSave({
      ...colony.edit,
      dailyBudgetUsd: form.dailyBudgetUsd,
      monthlyBudgetUsd: form.monthlyBudgetUsd,
      totalBudgetUsd: form.totalBudgetUsd,
      frozen: form.frozen,
      members: form.members.map(memberPayload),
    });
  };

  return (
    <Modal
      title="Configure treasury"
      subtitle={`${colony.name} · company budgets and agent spend caps`}
      theme={theme}
      onClose={onClose}
      width={860}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            Saves only company budgets, spend freeze, and member daily caps.
          </span>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={busy} onClick={save}>{busy ? "Saving…" : "Save treasury"}</PrimaryBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <EditSection title="company budget">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            <Field label="Daily budget USD">
              <NumericInput value={form.dailyBudgetUsd} step={5} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, dailyBudgetUsd: value }))} />
            </Field>
            <Field label="Monthly budget USD">
              <NumericInput value={form.monthlyBudgetUsd} step={25} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, monthlyBudgetUsd: value }))} />
            </Field>
            <Field label="Lifetime budget USD">
              <NumericInput value={form.totalBudgetUsd} step={50} placeholder="0" onChange={(value) => setForm((current) => ({ ...current, totalBudgetUsd: value }))} />
            </Field>
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <ToggleRow label="Freeze company spend" checked={form.frozen} onChange={(checked) => setForm((current) => ({ ...current, frozen: checked }))} />
          </div>
        </EditSection>

        <EditSection title="agent spend caps" right={<span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)" }}>${totalDailyCaps}/day allocated</span>}>
          {form.members.length === 0 ? (
            <div style={{ borderRadius: 10, border: "1px dashed var(--line-2)", padding: "18px 12px", textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
              No crew members are assigned.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {form.members.map((member) => (
                <TreasuryMemberCapRow
                  key={member.agentId}
                  member={member}
                  agent={colony.agents.find((agent) => agent.id === member.agentId)}
                  onChangeCap={(value) => updateCap(member.agentId, value)}
                />
              ))}
            </div>
          )}
        </EditSection>
      </div>
    </Modal>
  );
}

export function AgentMemberSettingsModal({
  colony, agentId, busy, theme, onClose, onSave,
}: {
  colony: Colony; agentId: string; busy?: boolean; theme?: Theme;
  onClose: () => void; onSave: (form: CompanyEditForm) => void;
}) {
  const initial = React.useMemo(() => editableMemberFor(colony, agentId), [agentId, colony]);
  const [member, setMember] = React.useState<CompanyMemberEdit | null>(initial);

  if (!member) return null;

  const save = () => {
    const existing = editableMembersForCompany(colony);
    const nextMembers = existing.some((item) => item.agentId === member.agentId)
      ? existing.map((item) => (item.agentId === member.agentId ? member : item))
      : [...existing, member];
    onSave({ ...colony.edit, members: nextMembers.map(memberPayload) });
  };

  return (
    <Modal
      title="Edit agent"
      subtitle={`${member.name} · ${colony.name}`}
      theme={theme}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-4)" }}>
            Updates this agent’s company role, work state, task caption, and daily cap.
          </span>
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn disabled={busy} onClick={save}>{busy ? "Saving…" : "Save agent"}</PrimaryBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg-2)", padding: "12px 14px" }}>
          <RoleGlyph role={member.role} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>{member.name}</div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 4 }}>
              {member.runtime || "Agent"}{member.model ? ` · ${member.model}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Role">
            <Select value={member.role} onChange={(value) => setMember((current) => current ? { ...current, role: value as Role } : current)} options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))} />
          </Field>
          <Field label="State">
            <Select value={member.state ?? ""} onChange={(value) => setMember((current) => current ? { ...current, state: value as AgentState | "" } : current)} options={STATE_OPTIONS} />
          </Field>
        </div>
        <Field label="Daily company cap">
          <NumericInput value={member.companyCap} step={5} placeholder="0" onChange={(value) => setMember((current) => current ? { ...current, companyCap: value } : current)} />
        </Field>
        <Field label="Task caption">
          <TextArea value={member.task ?? ""} placeholder="Current work caption" onChange={(event) => setMember((current) => current ? { ...current, task: event.target.value } : current)} />
        </Field>
      </div>
    </Modal>
  );
}


// TaskDetailModal + its deliverable rendering live in FileViewer.tsx
// (colocated with DeliverableChip / FileViewerModal) to avoid a
// Modals <-> FileViewer import cycle. The classification helpers above are shared.

"use client";

import * as React from "react";
import { AeonOrb, Btn, Eyebrow, Icon, Pill, Stat, aeonStyles as styles } from "./parts";
import { AeonFleet } from "./fleet";
import { AeonOverview } from "./overview";
import { AeonWork, type SkillActionKind } from "./work";
import { AeonActivity } from "./activity";
import { AeonDeliverables } from "./deliverables";
import { AeonSettings } from "./settings";
import {
  AEON_AGENTS, AEON_ANALYTICS, AEON_DELIVERABLES, AEON_MACHINES, AEON_MEMORY, AEON_OUTPUTS,
  AEON_PATHS, AEON_PULSE, AEON_RUNS, AEON_SECRETS, AEON_SKILLS,
  CONVERT_BRIEF_OPTIONS, CONVERT_MODEL_OPTIONS, CONVERT_SCHEDULE_OPTIONS,
  type AeonAgent, type AeonDeliverable, type AeonMachine, type AeonSkill, type ConvertScheduleMode,
} from "./aeon-data";

export type AeonDetailView = "overview" | "work" | "activity" | "deliverables" | "settings";
type IconName = Parameters<typeof Icon>[0]["name"];

const DETAIL_TABS: { id: AeonDetailView; label: string; detail: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", detail: "Status & next actions", icon: "bot" },
  { id: "work", label: "Work", detail: "Skills & automation", icon: "sparkles" },
  { id: "activity", label: "Activity", detail: "Runs & outputs", icon: "activity" },
  { id: "deliverables", label: "Deliverables", detail: "Artifacts & handoff", icon: "layers" },
  { id: "settings", label: "Settings", detail: "Repo, keys, memory", icon: "key" },
];

function accentStyle(hex: string): React.CSSProperties {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return {
    "--aeon": hex,
    "--aeon-deep": hex,
    "--aeon-soft": `rgba(${r},${g},${b},0.14)`,
    "--aeon-line": `rgba(${r},${g},${b},0.30)`,
    "--aeon-glow": `rgba(${r},${g},${b},0.34)`,
    "--cyan-2": hex,
    "--cyan-3": hex,
  } as React.CSSProperties;
}

// ---------- modal shell ----------
function Modal({ title, eyebrow, subtitle, onClose, children, wide }: { title: string; eyebrow?: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center", padding: 18, background: "rgba(2,6,12,0.7)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} className={`${styles.scroll} ${styles.rise}`} style={{ width: "100%", maxWidth: wide ? 720 : 560, maxHeight: "calc(100vh - 36px)", overflow: "auto",
        background: "var(--bg-1)", border: "1px solid var(--aeon-line)", borderRadius: "var(--r-lg)", padding: 22, boxShadow: "0 30px 90px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            {eyebrow && <Eyebrow color="var(--cyan-2)">{eyebrow}</Eyebrow>}
            <h3 style={{ margin: "4px 0 4px", fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 700, color: "var(--fg)" }}>{title}</h3>
            {subtitle && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--fg-3)", maxWidth: 460 }}>{subtitle}</p>}
          </div>
          <Btn size="icon" variant="ghost" onClick={onClose}><Icon name="x" size={18} /></Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

function ComposeModal({ skill, onClose, onCreate }: { skill: AeonSkill | null; onClose: () => void; onCreate: (skill: AeonSkill | null, cfg: { summary: string; duty: boolean }) => void }) {
  const [sched, setSched] = React.useState<ConvertScheduleMode>("daily");
  const [brief, setBrief] = React.useState("description");
  const [model, setModel] = React.useState("");
  const [duty, setDuty] = React.useState(true);
  const summary = sched === "manual" ? "Manual dispatch" : sched === "hourly" ? "Every hour" : sched === "daily" ? "Daily at 09:00" : sched === "weekdays" ? "Weekdays at 09:00" : "Weekly · Mon 09:00";
  const cron = sched === "manual" ? "manual" : sched === "hourly" ? "0 * * * *" : sched === "weekdays" ? "0 9 * * 1-5" : sched === "weekly" ? "0 9 * * 1" : "0 9 * * *";
  const opt = (active: boolean): React.CSSProperties => ({ padding: 11, borderRadius: 9, textAlign: "left", cursor: "pointer", border: `1px solid ${active ? "var(--aeon-line)" : "var(--line)"}`, background: active ? "var(--aeon-soft)" : "rgba(2,6,23,0.3)" });
  return (
    <Modal wide eyebrow="Automate with AEON" title={skill ? skill.name : "Create automation"}
      subtitle={skill ? (skill.desc || "Mirror this skill into AEON and arm it as a scheduled workflow.") : "Pick a skill, choose a cadence, and AEON arms it as a scheduled workflow — no YAML or Actions."} onClose={onClose}>
      <div style={{ display: "grid", gap: 18 }}>
        <section style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong style={{ fontSize: 13, color: "var(--fg)" }}>Run cadence</strong>
            <Pill tone="cyan">{summary}</Pill>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7 }}>
            {CONVERT_SCHEDULE_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setSched(o.value)} style={opt(sched === o.value)}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>{o.label}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-4)", marginTop: 3 }}>{o.detail}</div>
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: "grid", gap: 9 }}>
          <strong style={{ fontSize: 13, color: "var(--fg)" }}>Instructions</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 7 }}>
            {CONVERT_BRIEF_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setBrief(o.value)} style={opt(brief === o.value)}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>{o.label}</div>
                <div style={{ fontSize: 10.5, lineHeight: 1.35, color: "var(--fg-4)", marginTop: 3 }}>{o.detail}</div>
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} style={{ padding: "9px 11px", borderRadius: 9, fontSize: 13, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)", color: "var(--fg)", fontFamily: "var(--f-body)" }}>
              {CONVERT_MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <span className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Duty state</span>
            <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)" }}>
              {[{ v: false, l: "Off duty" }, { v: true, l: "On duty" }].map((o) => (
                <button key={o.l} onClick={() => setDuty(o.v)} style={{ flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: 0, color: duty === o.v ? "var(--cyan-3)" : "var(--fg-4)", background: duty === o.v ? "var(--aeon-soft)" : "transparent" }}>{o.l}</button>
              ))}
            </div>
          </div>
        </section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <code style={{ fontSize: 11.5, fontFamily: "var(--f-mono)", padding: "5px 9px", borderRadius: 7, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line)", color: "var(--fg-2)" }}>{cron}</code>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" icon="rocket" onClick={() => onCreate(skill, { summary, duty })}>Create automation</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SendModal({ deliverable, machines, onClose, onSend }: { deliverable: AeonDeliverable; machines: AeonMachine[]; onClose: () => void; onSend: (m: AeonMachine) => void }) {
  return (
    <Modal wide eyebrow="Target machine" title={deliverable.title} subtitle="Send this artifact to another machine over the tailnet." onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {machines.map((m) => (
          <button key={m.key} onClick={() => onSend(m)} style={{ display: "grid", gap: 9, padding: 14, borderRadius: 11, textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", background: "var(--panel-bg-soft)", transition: "all 140ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aeon-line)"; e.currentTarget.style.background = "var(--aeon-soft)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.background = "var(--panel-bg-soft)"; }}>
            <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 9, color: "var(--cyan-2)", background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)" }}><Icon name="drive" size={18} /></span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--fg)" }}>{m.name}</div>
              <div style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 2 }}>{m.url}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Toast({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div className={styles.rise} style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 80, display: "inline-flex", alignItems: "center", gap: 9,
      padding: "11px 17px", borderRadius: 999, background: "var(--bg-2)", border: "1px solid var(--aeon-line)", boxShadow: "0 18px 50px rgba(0,0,0,0.4)", color: "var(--fg)", fontSize: 13 }}>
      <span style={{ color: "var(--cyan-2)" }}><Icon name="check" size={15} /></span>{msg}
    </div>
  );
}

// ---------- detail shell ----------
interface DetailProps {
  agent: AeonAgent; allSkills: AeonSkill[]; deliverables: AeonDeliverable[]; machines: AeonMachine[];
  onBack: () => void; toast: (m: string) => void;
  onToggleSkill?: (slug: string, nextState: "on-duty" | "paused") => void;
  onRunSkill?: (slug: string) => void;
  onSendDeliverable?: (id: string, machineKey: string) => void;
}

function AeonDetail({ agent, allSkills, deliverables, machines, onBack, toast, onToggleSkill, onRunSkill, onSendDeliverable }: DetailProps) {
  const [tab, setTab] = React.useState<AeonDetailView>("overview");
  const [skills, setSkills] = React.useState(allSkills);
  const [selSkill, setSelSkill] = React.useState<string | null>(null);
  const [compose, setCompose] = React.useState<AeonSkill | null | undefined>(undefined);
  const [sendD, setSendD] = React.useState<AeonDeliverable | null>(null);

  const onDuty = skills.filter((s) => s.state === "on-duty").length;

  const toggleDuty = (slug: string) => setSkills((arr) => arr.map((s) => {
    if (s.slug !== slug) return s;
    const next = s.state === "on-duty" ? "paused" : "on-duty";
    onToggleSkill?.(slug, next);
    return { ...s, state: next };
  }));

  const skillAction = (skill: AeonSkill, kind?: SkillActionKind) => {
    if (kind === "run") { onRunSkill?.(skill.slug); toast(`Running ${skill.name}…`); return; }
    if (kind === "toggle") { toggleDuty(skill.slug); toast(skill.state === "on-duty" ? `${skill.name} off duty` : `${skill.name} on duty`); return; }
    if (skill.state === "on-duty") { toggleDuty(skill.slug); toast(`${skill.name} paused`); }
    else if (skill.state === "paused") { toggleDuty(skill.slug); toast(`${skill.name} resumed`); }
    else if (skill.state === "manual") { onRunSkill?.(skill.slug); toast(`Running ${skill.name}…`); }
    else setCompose(skill);
  };

  const createAutomation = (skill: AeonSkill | null, cfg: { summary: string; duty: boolean }) => {
    setCompose(undefined);
    if (skill) {
      setSkills((arr) => arr.map((s) => s.slug === skill.slug ? { ...s, state: cfg.duty ? "on-duty" : "manual", scheduleLabel: cfg.summary } : s));
      toast(`${skill.name} armed — ${cfg.summary}`);
    } else toast("New automation created");
  };

  const stats: { value: React.ReactNode; label: string; tone?: "honey" | "cyan" }[] = [
    { value: onDuty, label: "on duty", tone: onDuty ? "honey" : "cyan" },
    { value: skills.length, label: "skills", tone: "cyan" },
    { value: agent.runs, label: "runs" },
    { value: deliverables.length, label: "handoffs", tone: "cyan" },
  ];

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto auto 1fr", minHeight: 0 }}>
      <header style={{ position: "relative", padding: "20px clamp(18px,3vw,40px) 16px", borderBottom: "1px solid var(--line)", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: 1, background: "linear-gradient(90deg, transparent, rgba(94,234,212,0.55), transparent)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", minWidth: 0 }}>
            <AeonOrb size={64} state={agent.now.state === "working" ? "working" : onDuty ? "duty" : "idle"} />
            <div style={{ minWidth: 0 }}>
              <Eyebrow color="var(--cyan-2)">Aeon Autopilot</Eyebrow>
              <h1 style={{ margin: "3px 0 6px", fontFamily: "var(--f-display)", fontSize: "clamp(22px,2.6vw,30px)", fontWeight: 700, letterSpacing: 0, color: "var(--fg)", lineHeight: 1 }}>{agent.name}</h1>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Pill tone="muted" icon="git">{agent.mode}</Pill>
                <span style={{ fontSize: 11.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{agent.repo ?? agent.localPath}</span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Btn variant="ghost" icon="chevronL" onClick={onBack}>All AEON Agents</Btn>
            <Btn variant="danger" icon="power" onClick={() => { setSkills((arr) => arr.map((s) => s.state === "on-duty" ? { ...s, state: "paused" } : s)); toast("All AEON automations stopped"); }}>Stop AEON</Btn>
            <Btn variant="secondary" icon="refresh" onClick={() => toast("Refreshed")}>Refresh</Btn>
          </div>
        </div>
        <div style={{ display: "flex", gap: "clamp(20px,4vw,48px)", marginTop: 16, paddingLeft: 80, flexWrap: "wrap" }}>
          {stats.map((s) => <Stat key={s.label} value={s.value} label={s.label} tone={s.tone} />)}
        </div>
      </header>

      <nav className={styles.scroll} style={{ display: "flex", gap: 4, padding: "10px clamp(18px,3vw,40px) 0", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
        {DETAIL_TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2, padding: "8px 14px 13px", cursor: "pointer", border: 0, background: "transparent" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 600, color: active ? "var(--fg)" : "var(--fg-3)" }}>
                <span style={{ color: active ? "var(--cyan-2)" : "var(--fg-4)" }}><Icon name={t.icon} size={15} /></span>{t.label}
                {t.id === "deliverables" && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)", color: "var(--cyan-3)" }}>{deliverables.length}</span>}
              </span>
              <span style={{ fontSize: 11, color: "var(--fg-4)", opacity: active ? 1 : 0.6 }}>{t.detail}</span>
              {active && <span style={{ position: "absolute", left: 12, right: 12, bottom: -1, height: 2, borderRadius: 2, background: "var(--aeon)", boxShadow: "0 0 10px var(--aeon-glow)" }} />}
            </button>
          );
        })}
      </nav>

      <div key={tab} className={styles.scroll} style={{ overflow: "auto", padding: "18px clamp(18px,3vw,40px) 40px", minHeight: 0 }}>
        {tab === "overview" && <AeonOverview agent={{ ...agent, onDuty }} skills={skills} analytics={AEON_ANALYTICS} pulse={AEON_PULSE} onView={setTab} onToggle={toggleDuty} />}
        {tab === "work" && <AeonWork skills={skills} runs={AEON_RUNS} selectedSlug={selSkill} onSelect={(s) => setSelSkill(s === selSkill ? null : s)} onAction={skillAction} onImport={() => setCompose(null)} />}
        {tab === "activity" && <AeonActivity runs={AEON_RUNS} outputs={AEON_OUTPUTS} />}
        {tab === "deliverables" && <AeonDeliverables deliverables={deliverables} onSend={setSendD} />}
        {tab === "settings" && <AeonSettings agent={agent} secrets={AEON_SECRETS} paths={AEON_PATHS} memory={AEON_MEMORY} />}
      </div>

      {compose !== undefined && <ComposeModal skill={compose} onClose={() => setCompose(undefined)} onCreate={createAutomation} />}
      {sendD && <SendModal deliverable={sendD} machines={machines} onClose={() => setSendD(null)} onSend={(m) => { onSendDeliverable?.(sendD.id, m.key); setSendD(null); toast(`Sent ${sendD.title} → ${m.name}`); }} />}
    </div>
  );
}

// ---------- top-level panel ----------
export interface AeonAutopilotPanelProps {
  agents?: AeonAgent[];
  skills?: AeonSkill[];
  deliverables?: AeonDeliverable[];
  machines?: AeonMachine[];
  initialMode?: "fleet" | "detail";
  accent?: string;
  motion?: boolean;
  onToggleSkill?: (slug: string, nextState: "on-duty" | "paused") => void;
  onRunSkill?: (slug: string) => void;
  onSendDeliverable?: (id: string, machineKey: string) => void;
  onCreateWorkspace?: () => void;
}

export function AeonAutopilotPanel({
  agents = AEON_AGENTS, skills = AEON_SKILLS, deliverables = AEON_DELIVERABLES, machines = AEON_MACHINES,
  initialMode = "detail", accent = "#5eead4", motion = true,
  onToggleSkill, onRunSkill, onSendDeliverable, onCreateWorkspace,
}: AeonAutopilotPanelProps = {}) {
  const [mode, setMode] = React.useState<"fleet" | "detail">(initialMode);
  const [agentId, setAgentId] = React.useState(agents[0]?.id);
  const [msg, setMsg] = React.useState("");
  const timer = React.useRef<number | undefined>(undefined);
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];
  const accentVars = React.useMemo(() => accentStyle(accent), [accent]);

  React.useEffect(() => { document.documentElement.setAttribute("data-aeon-motion", motion ? "on" : "off"); }, [motion]);

  const toast = (m: string) => {
    setMsg(m);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(""), 2600);
  };

  return (
    <div className={styles.root} style={{ ...accentVars, height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-0)", color: "var(--fg)", fontFamily: "var(--f-body)", position: "relative", overflow: "hidden" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 16% 4%, rgba(45,212,191,0.08), transparent 38%), radial-gradient(circle at 92% 96%, rgba(255,212,90,0.05), transparent 42%)" }} />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {mode === "fleet"
          ? <AeonFleet agents={agents} onOpen={(a) => { setAgentId(a.id); setMode("detail"); }} onCreate={() => { onCreateWorkspace?.(); toast("Clone / import flow opens here"); }} />
          : <AeonDetail key={`${agent.id}:${skills.map((skill) => `${skill.slug}:${skill.state}`).join("|")}`} agent={agent} allSkills={skills} deliverables={deliverables} machines={machines}
              onBack={() => setMode("fleet")} toast={toast} onToggleSkill={onToggleSkill} onRunSkill={onRunSkill} onSendDeliverable={onSendDeliverable} />}
      </div>
      <Toast msg={msg} />
    </div>
  );
}

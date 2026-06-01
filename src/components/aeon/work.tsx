"use client";

import * as React from "react";
import { Btn, Card, Eyebrow, Icon, Pill, SectionHead, type IconName, type Tone, aeonStyles as styles } from "./parts";
import { AEON_CATEGORIES, CAT, type AeonRun, type AeonSkill, type SkillState } from "./aeon-data";

const STATE_META: Record<SkillState, { tone: Tone; label: string; action: string; icon: IconName }> = {
  "on-duty": { tone: "honey", label: "On duty", action: "Pause", icon: "pause" },
  "paused": { tone: "muted", label: "Paused", action: "Resume", icon: "play" },
  "manual": { tone: "cyan", label: "Automated", action: "Run", icon: "play" },
  "ready": { tone: "sky", label: "AEON skill", action: "Automate", icon: "rocket" },
  "available": { tone: "muted", label: "Shared Brain", action: "Automate with AEON", icon: "rocket" },
};

export type SkillActionKind = "run" | "toggle" | "default";

function SkillCard({ skill, selected, onSelect, onAction }: { skill: AeonSkill; selected: boolean; onSelect: (slug: string) => void; onAction: (s: AeonSkill, k?: SkillActionKind) => void }) {
  const m = STATE_META[skill.state];
  const cat = CAT[skill.cat];
  return (
    <div onClick={() => onSelect(skill.slug)} style={{
      display: "grid", gap: 11, padding: 14, borderRadius: 11, cursor: "pointer",
      border: `1px solid ${selected ? "var(--aeon-line)" : "var(--line)"}`, background: selected ? "var(--aeon-soft)" : "var(--panel-bg-soft)", transition: "all 140ms ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)", lineHeight: 1.25 }}>{skill.name}</div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 10.5, fontFamily: "var(--f-mono)", textTransform: "uppercase", letterSpacing: 0, color: "var(--fg-4)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: cat.color }} />{cat.label}
          </span>
        </div>
        <Pill tone={m.tone} dot={skill.state === "on-duty"}>{m.label}</Pill>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)" }}>{skill.desc}</p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
        <span style={{ fontSize: 10.5, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{skill.scheduleLabel || "Not scheduled"}</span>
        <Btn size="sm" variant={skill.state === "on-duty" || skill.state === "available" || skill.state === "ready" ? "secondary" : "primary"} icon={m.icon}
          onClick={(e) => { e.stopPropagation(); onAction(skill); }}>{m.action}</Btn>
      </div>
    </div>
  );
}

function SkillDetail({ skill, runs, onAction }: { skill: AeonSkill | undefined; runs: AeonRun[]; onAction: (s: AeonSkill, k: SkillActionKind) => void }) {
  if (!skill) return null;
  const myRuns = runs.filter((r) => r.name === skill.slug).slice(0, 4);
  return (
    <div style={{ marginTop: 14, display: "grid", gap: 12, padding: 16, borderRadius: 12, border: "1px solid var(--aeon-line)", background: "rgba(20,184,166,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <Eyebrow color="var(--cyan-2)">Skill detail</Eyebrow>
          <h4 style={{ margin: "3px 0 4px", fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, color: "var(--fg)" }}>{skill.name}</h4>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-3)", maxWidth: 520 }}>{skill.desc}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="primary" icon="play" onClick={() => onAction(skill, "run")}>Run now</Btn>
          <Btn size="sm" variant="secondary" icon="power" onClick={() => onAction(skill, "toggle")}>{skill.state === "on-duty" ? "Off duty" : "On duty"}</Btn>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
        {([["Schedule", skill.schedule || "manual"], ["Model", skill.model || "AEON default"], ["Source", skill.source]] as const).map(([l, v]) => (
          <div key={l} style={{ padding: "8px 11px", borderRadius: 8, background: "rgba(2,6,23,0.32)", border: "1px solid var(--line)" }}>
            <div className={styles.monoCap} style={{ color: "var(--fg-4)" }}>{l}</div>
            <div style={{ fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--f-mono)", marginTop: 3, overflowWrap: "anywhere" }}>{v}</div>
          </div>
        ))}
      </div>
      {myRuns.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className={styles.monoCap} style={{ color: "var(--fg-4)" }}>Recent runs for this skill</div>
          {myRuns.map((r) => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 11px", borderRadius: 8, background: "var(--panel-bg-soft)", border: "1px solid var(--line)" }}>
              <span style={{ fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--f-mono)" }}>{r.when}</span>
              <Pill tone={r.status === "completed" ? "green" : r.status === "failed" ? "rose" : "honey"}>{r.conclusion || r.status}</Pill>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CatChip({ label, color, count, active, onClick }: { label: string; color?: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${active ? "var(--aeon-line)" : "var(--line)"}`, background: active ? "var(--aeon-soft)" : "rgba(2,6,23,0.32)", color: active ? "var(--cyan-3)" : "var(--fg-3)" }}>
      {color && <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />}
      {label}
      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, border: "1px solid var(--line)", color: "var(--fg-4)" }}>{count}</span>
    </button>
  );
}

export function AeonWork({ skills, runs, selectedSlug, onSelect, onAction, onImport }: {
  skills: AeonSkill[]; runs: AeonRun[]; selectedSlug: string | null;
  onSelect: (slug: string | null) => void; onAction: (s: AeonSkill, k?: SkillActionKind) => void; onImport: () => void;
}) {
  const [source, setSource] = React.useState<"aeon" | "shared">("aeon");
  const [cat, setCat] = React.useState<string>("all");
  const [q, setQ] = React.useState("");

  const inSource = (s: AeonSkill) => (source === "shared" ? s.source === "shared-brain" : s.source !== "shared-brain");
  const pool = skills.filter(inSource);
  const cats = AEON_CATEGORIES.filter((c) => pool.some((s) => s.cat === c.id)).map((c) => ({ ...c, count: pool.filter((s) => s.cat === c.id).length }));
  const shown = pool.filter((s) => (cat === "all" || s.cat === cat) && (!q || (s.name + s.desc).toLowerCase().includes(q.toLowerCase())));
  const selected = skills.find((s) => s.slug === selectedSlug && inSource(s));
  const setUp = skills.filter((s) => ["on-duty", "paused", "manual"].includes(s.state)).length;

  return (
    <Card>
      <SectionHead eyebrow="Skills" title={`${pool.length} available · ${setUp} set up`} icon="sparkles"
        action={<div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="secondary" icon="fileUp" onClick={onImport}>Import skill</Btn>
          <Btn size="sm" variant="secondary" icon="clock">Scheduler</Btn>
        </div>} />

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", padding: 3, borderRadius: 9, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)" }}>
          {(["aeon", "shared"] as const).map((v) => (
            <button key={v} onClick={() => { setSource(v); setCat("all"); }} style={{
              padding: "6px 13px", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", border: 0,
              color: source === v ? "var(--cyan-3)" : "var(--fg-3)", background: source === v ? "var(--aeon-soft)" : "transparent" }}>
              {v === "aeon" ? "AEON" : "Shared Brain"}
            </button>
          ))}
        </div>
        <label style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--fg-4)" }}><Icon name="search" size={15} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills…" style={{
            width: "100%", padding: "9px 12px 9px 34px", borderRadius: 9, fontSize: 13, background: "rgba(2,6,23,0.5)", border: "1px solid var(--line-2)", color: "var(--fg)", fontFamily: "var(--f-body)", outline: "none" }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        <CatChip label="All" active={cat === "all"} count={pool.length} onClick={() => setCat("all")} />
        {cats.map((c) => <CatChip key={c.id} label={c.label} color={c.color} count={c.count} active={cat === c.id} onClick={() => setCat(c.id)} />)}
      </div>

      <div style={{ display: "grid", gap: 11, gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))" }}>
        {shown.map((s) => <SkillCard key={s.slug} skill={s} selected={selectedSlug === s.slug} onSelect={onSelect} onAction={onAction} />)}
      </div>
      {!shown.length && <p style={{ fontSize: 13, color: "var(--fg-4)", padding: "16px 2px" }}>No skills match this filter yet.</p>}

      <SkillDetail skill={selected} runs={runs} onAction={onAction} />
    </Card>
  );
}

export { STATE_META };

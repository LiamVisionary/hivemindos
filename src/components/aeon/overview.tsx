"use client";

import * as React from "react";
import { AeonOrb, Btn, Card, Icon, Pill, SectionHead, Sparkline, Stat, TONE, aeonStyles as styles } from "./parts";
import { CAT, type AeonAgent, type AeonAnalytics, type AeonSkill } from "./aeon-data";
import type { AeonDetailView } from "./AeonAutopilotPanel";

function NowDoing({ agent, skills, onView }: { agent: AeonAgent; skills: AeonSkill[]; onView: (v: AeonDetailView) => void }) {
  const n = agent.now;
  const live = n.state === "working";
  const skill = skills.find((s) => s.slug === n.skill);
  const next = skills.filter((s) => s.state === "on-duty")[0];
  return (
    <Card glow pad={0} style={{ gridColumn: "1 / -1" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(120% 140% at 8% 0%, rgba(45,212,191,0.16), transparent 42%), radial-gradient(90% 120% at 100% 100%, rgba(255,212,90,0.08), transparent 46%)" }} />
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "clamp(18px,3vw,40px)", alignItems: "center", padding: "clamp(20px,3vw,30px)" }}>
        <AeonOrb size={150} state={live ? "working" : agent.onDuty ? "duty" : "idle"} />
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill tone={live ? "cyan" : agent.onDuty ? "honey" : "muted"} dot>{live ? "Working now" : agent.onDuty ? "On duty" : "Idle"}</Pill>
            {live && <span className={styles.eq} style={{ color: "var(--cyan-2)", height: 13 }}><i /><i /><i /><i /></span>}
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: "clamp(22px,2.6vw,32px)", fontWeight: 700, letterSpacing: 0, color: "var(--fg)", lineHeight: 1.1 }}>
            {live ? <>Running <span style={{ color: "var(--cyan-2)" }}>{skill ? skill.name : n.skill}</span></>
              : agent.onDuty ? <>Standing watch over <span style={{ color: "var(--honey-2)" }}>{agent.onDuty} automations</span></>
              : "Resting — nothing scheduled"}
          </h2>
          {live ? (
            <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: "var(--fg-3)", fontFamily: "var(--f-mono)", flexWrap: "wrap" }}>
                <span>started {n.since} ago · {skill ? skill.scheduleLabel.split(" · ")[0] : ""}</span>
                <span>{Math.round((n.progress ?? 0) * 100)}%</span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: "rgba(148,163,184,0.2)", border: "1px solid var(--line)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(n.progress ?? 0) * 100}%`, borderRadius: 999, background: "linear-gradient(90deg, var(--aeon-deep), var(--aeon))", boxShadow: "0 0 12px var(--aeon-glow)", transition: "width 600ms ease" }} />
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--fg-3)", maxWidth: 460 }}>
              {next ? <>Next up: <strong style={{ color: "var(--fg-2)" }}>{next.name}</strong> — {next.scheduleLabel}.</> : "Pick a skill and put it on duty to get AEON working in the background."}
              {" "}It arms each one as a scheduled workflow — no YAML or Actions to manage.
            </p>
          )}
        </div>
        <div style={{ display: "grid", gap: 10, alignContent: "center" }}>
          <Btn variant="primary" icon="plus" sheen onClick={() => onView("work")}>Create automation</Btn>
          <Btn variant="secondary" icon="clock" onClick={() => onView("activity")}>View activity</Btn>
        </div>
      </div>
    </Card>
  );
}

function OnDutyRail({ skills, onToggle }: { skills: AeonSkill[]; onToggle: (slug: string) => void }) {
  const list = skills.filter((s) => s.state === "on-duty" || s.state === "paused");
  return (
    <Card>
      <SectionHead eyebrow="Automation power" title="On duty" icon="power"
        action={<Pill tone="honey">{skills.filter((s) => s.state === "on-duty").length} running</Pill>} />
      <div className={styles.scroll} style={{ display: "grid", gap: 8, maxHeight: 250, overflow: "auto", paddingRight: 4 }}>
        {list.map((s) => {
          const running = s.state === "on-duty";
          return (
            <div key={s.slug} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: "11px 13px", borderRadius: 10,
              border: `1px solid ${running ? "rgba(255,212,90,0.22)" : "var(--line)"}`, background: running ? "rgba(255,212,90,0.06)" : "var(--panel-bg-soft)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: CAT[s.cat].color, boxShadow: `0 0 8px ${CAT[s.cat].color}` }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", overflowWrap: "anywhere" }}>{s.name}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)", marginTop: 3 }}>{s.scheduleLabel} · {s.schedule}</div>
              </div>
              <Btn size="sm" variant={running ? "secondary" : "primary"} icon={running ? "pause" : "play"} onClick={() => onToggle(s.slug)}>{running ? "Pause" : "Resume"}</Btn>
            </div>
          );
        })}
        {!list.length && <p style={{ margin: 0, fontSize: 12.5, color: "var(--fg-4)", padding: "8px 2px" }}>No automations configured yet.</p>}
      </div>
    </Card>
  );
}

function PulseCard({ analytics, pulse }: { analytics: AeonAnalytics; pulse: number[] }) {
  return (
    <Card>
      <SectionHead eyebrow="At a glance" title="Pulse · last 7 days" icon="activity" action={<Sparkline data={pulse} w={120} h={32} />} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        <Stat value={analytics.totalRuns} label="Runs" />
        <Stat value={`${analytics.successRate}%`} label="Success" tone="cyan" />
        <Stat value={analytics.failure} label="Failures" tone={analytics.failure ? "rose" : undefined} />
        <Stat value={analytics.uniqueSkills} label="Skills used" />
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {analytics.insights.map((ins, i) => {
          const tone = ins.type === "warning" ? "honey" : ins.type === "success" ? "green" : "muted";
          const c = TONE[tone];
          return (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 12px", borderRadius: 9, background: c.bg, border: `1px solid ${c.bd}` }}>
              <span style={{ color: c.fg, marginTop: 1 }}><Icon name={ins.type === "warning" ? "power" : ins.type === "success" ? "check" : "activity"} size={13} /></span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-2)" }}>{ins.message}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function AeonOverview({ agent, skills, analytics, pulse, onView, onToggle }: {
  agent: AeonAgent; skills: AeonSkill[]; analytics: AeonAnalytics; pulse: number[];
  onView: (v: AeonDetailView) => void; onToggle: (slug: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
      <NowDoing agent={agent} skills={skills} onView={onView} />
      <OnDutyRail skills={skills} onToggle={onToggle} />
      <PulseCard analytics={analytics} pulse={pulse} />
      <Card pad={14} style={{ gridColumn: "1 / -1", background: "var(--panel-bg-soft)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Pill tone="green" icon="shield">Connection ready</Pill>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--fg-3)" }}>
            <Icon name="git" size={14} /><span style={{ fontFamily: "var(--f-mono)" }}>{agent.repo ?? agent.localPath}</span>
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--fg-4)" }}>GitHub OAuth · GH_GLOBAL · Actions armed</span>
        </div>
      </Card>
    </div>
  );
}

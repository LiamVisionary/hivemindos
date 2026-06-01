"use client";

import * as React from "react";
import { AeonOrb, Eyebrow, Icon, Pill, type OrbState, aeonStyles as styles } from "./parts";
import type { AeonAgent } from "./aeon-data";

function stateLabel(agent: AeonAgent): { tone: "cyan" | "honey" | "muted"; text: string; orb: OrbState } {
  const n = agent.now;
  if (n.state === "working") return { tone: "cyan", text: "Working now", orb: "working" };
  if (n.state === "paused") return { tone: "muted", text: "Paused", orb: "paused" };
  if (agent.onDuty > 0) return { tone: "honey", text: `${agent.onDuty} on duty`, orb: "duty" };
  return { tone: "muted", text: "Idle", orb: "idle" };
}

function AgentCard({ agent, onOpen }: { agent: AeonAgent; onOpen: (a: AeonAgent) => void }) {
  const s = stateLabel(agent);
  const [hover, setHover] = React.useState(false);
  return (
    <button
      className={styles.rise}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => onOpen(agent)}
      style={{
        textAlign: "left", display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center",
        padding: 18, borderRadius: "var(--r-lg)", background: "var(--panel-card-grad)", cursor: "pointer",
        border: `1px solid ${hover ? "var(--aeon-line)" : "var(--line)"}`,
        boxShadow: hover ? "0 18px 50px rgba(0,0,0,0.28), 0 0 0 1px var(--aeon-line)" : "0 8px 26px rgba(0,0,0,0.16)",
        transform: hover ? "translateY(-2px)" : "none", transition: "all 180ms ease", position: "relative",
      }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: hover ? 0.5 : 0.28, transition: "opacity 180ms ease",
        background: "radial-gradient(circle at 14% 18%, var(--aeon-soft), transparent 46%)" }} />
      <div style={{ position: "relative" }}><AeonOrb size={86} state={s.orb} /></div>
      <div style={{ position: "relative", display: "grid", gap: 9, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--fg)" }}>{agent.name}</span>
          <Pill tone="muted" icon="git">{agent.mode}</Pill>
        </div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11.5, color: "var(--fg-3)", overflowWrap: "anywhere" }}>{agent.repo ?? agent.localPath}</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", lineHeight: 1.4 }}>{agent.tagline}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
          <Pill tone={s.tone} dot>{s.text}</Pill>
          <span style={{ fontSize: 11, color: "var(--fg-4)", fontFamily: "var(--f-mono)" }}>{agent.skills} skills · {agent.runs} runs</span>
        </div>
      </div>
      <span aria-hidden style={{ position: "absolute", right: 16, top: "50%", transform: `translateY(-50%) translateX(${hover ? 0 : -4}px)`, color: "var(--aeon)", opacity: hover ? 1 : 0, transition: "all 180ms ease" }}>
        <Icon name="chevronR" size={18} />
      </span>
    </button>
  );
}

export function AeonFleet({ agents, onOpen, onCreate }: { agents: AeonAgent[]; onOpen: (a: AeonAgent) => void; onCreate: () => void }) {
  const totalOnDuty = agents.reduce((n, a) => n + a.onDuty, 0);
  return (
    <div className={styles.scroll} style={{ height: "100%", overflow: "auto", padding: "28px clamp(20px, 4vw, 56px) 56px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 22 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <Eyebrow color="var(--cyan-2)">AEON · Autopilot</Eyebrow>
            <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 700, letterSpacing: 0, color: "var(--fg)", lineHeight: 1.05 }}>Your autonomous agents</h1>
            <p style={{ margin: 0, maxWidth: 520, fontSize: 14, lineHeight: 1.6, color: "var(--fg-3)" }}>
              Each AEON repo is a self-running workspace — its own skills, schedules, runs, outputs, keys, and memory. Open one to see what it&apos;s doing.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Pill tone="honey" dot style={{ padding: "7px 12px", fontSize: 12 }}>{totalOnDuty} on duty across fleet</Pill>
            <Pill tone="cyan" style={{ padding: "7px 12px", fontSize: 12 }}>{agents.length} workspaces</Pill>
          </div>
        </div>

        <hr style={{ height: 1, background: "var(--line)", border: 0, margin: 0 }} />

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
          {agents.map((a) => <AgentCard key={a.id} agent={a} onOpen={onOpen} />)}
          <button onClick={onCreate} style={{
            display: "grid", placeItems: "center", gap: 12, minHeight: 158, padding: 20, borderRadius: "var(--r-lg)",
            border: "1px dashed var(--aeon-line)", background: "rgba(94,234,212,0.04)", color: "var(--cyan-3)", cursor: "pointer", transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(94,234,212,0.09)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(94,234,212,0.04)"; }}>
            <span style={{ display: "grid", placeItems: "center", width: 52, height: 52, clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)", background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)" }}>
              <Icon name="plus" size={22} />
            </span>
            <span style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 15 }}>Clone or import an AEON repo</span>
            <span style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "center", maxWidth: 240 }}>Fork the official AEON, clone a URL into <code style={{ fontFamily: "var(--f-mono)" }}>~/.aeon-repos/</code>, or link a local folder.</span>
          </button>
        </div>
      </div>
    </div>
  );
}

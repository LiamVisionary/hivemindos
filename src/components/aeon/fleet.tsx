"use client";

import * as React from "react";
import { AeonOrb, Eyebrow, Icon, Pill, type OrbState, aeonStyles as styles } from "./parts";
import type { AeonAgent } from "./aeon-data";

type FleetHexTone = "default" | "active" | "honey";

const FLEET_HEX_W = 292;
const FLEET_HEX_H = 252;
const FLEET_HEX_INSET = 8;
const FLEET_HEX_X_STEP = FLEET_HEX_W * 0.75 - FLEET_HEX_INSET;
const FLEET_HEX_Y_STEP = FLEET_HEX_H / 2 - FLEET_HEX_INSET;
const FLEET_HEX_ROW_STEP = FLEET_HEX_H - FLEET_HEX_INSET * 2;
const FLEET_HEX_CLIP = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
const FLEET_HEX_POINTS = "73 8 219 8 284 126 219 244 73 244 8 126";
const FLEET_HEX_TONES: Record<FleetHexTone, { bg: string; border: string; glow: string }> = {
  default: {
    bg: "var(--fleet-hex-default-bg)",
    border: "var(--fleet-hex-default-border)",
    glow: "var(--fleet-hex-default-glow)",
  },
  active: {
    bg: "var(--fleet-hex-active-bg)",
    border: "var(--aeon-line)",
    glow: "var(--fleet-hex-active-glow)",
  },
  honey: {
    bg: "var(--fleet-hex-honey-bg)",
    border: "var(--fleet-hex-honey-border)",
    glow: "var(--fleet-hex-honey-glow)",
  },
};

function stateLabel(agent: AeonAgent): { tone: "cyan" | "honey" | "muted"; text: string; orb: OrbState } {
  const n = agent.now;
  if (n.state === "working") return { tone: "cyan", text: "Working now", orb: "working" };
  if (n.state === "paused") return { tone: "muted", text: "Paused", orb: "paused" };
  if (agent.onDuty > 0) return { tone: "honey", text: `${agent.onDuty} on duty`, orb: "duty" };
  return { tone: "muted", text: "Idle", orb: "idle" };
}

function fleetHexPosition(index: number, columns: number) {
  const column = index % Math.max(1, columns);
  const row = Math.floor(index / Math.max(1, columns));
  return {
    x: column * FLEET_HEX_X_STEP,
    y: row * FLEET_HEX_ROW_STEP + (column % 2) * FLEET_HEX_Y_STEP,
  };
}

function fleetHoneycombSize(count: number, columns: number) {
  let width = FLEET_HEX_W;
  let height = FLEET_HEX_H;
  for (let index = 0; index < count; index += 1) {
    const point = fleetHexPosition(index, columns);
    width = Math.max(width, point.x + FLEET_HEX_W);
    height = Math.max(height, point.y + FLEET_HEX_H);
  }
  return { width, height };
}

function repoDisplayName(agent: AeonAgent) {
  const repoLeaf = agent.repo
    ?.trim()
    .replace(/\.git$/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .split("/")
    .filter(Boolean)
    .at(-1);
  const pathLeaf = agent.localPath.split("/").filter(Boolean).at(-1);
  return repoLeaf || pathLeaf || agent.name || "AEON repo";
}

function profileLabel(agent: AeonAgent, repoName: string) {
  return agent.name && agent.name !== repoName ? `Profile: ${agent.name}` : "Repo workspace";
}

function FleetMeta({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
      <span className={styles.monoCap} style={{ fontSize: 9, color: "var(--fg-4)" }}>{label}</span>
      <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
        {value}
      </span>
    </span>
  );
}

function AeonFleetHex({
  tone = "default",
  children,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: FleetHexTone }) {
  const t = FLEET_HEX_TONES[tone];
  const [hover, setHover] = React.useState(false);
  return (
    <button
      {...rest}
      className={styles.rise}
      onMouseEnter={(event) => {
        setHover(true);
        rest.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setHover(false);
        rest.onMouseLeave?.(event);
      }}
      style={{
        width: FLEET_HEX_W,
        height: FLEET_HEX_H,
        appearance: "none",
        WebkitAppearance: "none",
        border: 0,
        padding: 0,
        background: "transparent",
        color: "var(--fg)",
        position: "relative",
        cursor: "pointer",
        textAlign: "center",
        transform: hover ? "translateY(-3px)" : "none",
        transition: "transform 180ms ease",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          inset: 8,
          clipPath: FLEET_HEX_CLIP,
          background: t.bg,
          boxShadow: `0 0 ${hover ? 58 : 38}px ${t.glow}, var(--fleet-hex-inset)`,
          opacity: hover ? 1 : 0.94,
          transition: "box-shadow 180ms ease, opacity 180ms ease",
        }}
      />
      <svg aria-hidden width={FLEET_HEX_W} height={FLEET_HEX_H} viewBox={`0 0 ${FLEET_HEX_W} ${FLEET_HEX_H}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <polygon
          points={FLEET_HEX_POINTS}
          fill="none"
          stroke={hover ? "var(--aeon)" : t.border}
          strokeWidth={hover ? 2 : 1.35}
          strokeDasharray={tone === "honey" ? "7 6" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span style={{ position: "absolute", inset: "27px 36px", display: "grid", placeItems: "center", minWidth: 0 }}>
        {children}
      </span>
    </button>
  );
}

function AgentHive({ agent, onOpen, style }: { agent: AeonAgent; onOpen: (a: AeonAgent) => void; style: React.CSSProperties }) {
  const s = stateLabel(agent);
  const repoName = repoDisplayName(agent);
  const detail = agent.repo ?? agent.localPath;
  const tone: FleetHexTone = s.orb === "working" || agent.onDuty > 0 ? "active" : "default";
  return (
    <AeonFleetHex data-aeon-fleet-hex="repo" tone={tone} onClick={() => onOpen(agent)} aria-label={`Open ${repoName}`} style={style}>
      <div style={{ display: "grid", justifyItems: "center", gap: 9, width: "100%", minWidth: 0 }}>
        <AeonOrb size={66} state={s.orb} />
        <div style={{ display: "grid", gap: 3, justifyItems: "center", minWidth: 0 }}>
          <span style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 750, color: "var(--fg)", lineHeight: 1.05, overflowWrap: "anywhere" }}>
            {repoName}
          </span>
          <span style={{ fontSize: 11, color: "var(--fg-3)", lineHeight: 1.3, overflowWrap: "anywhere" }}>{profileLabel(agent, repoName)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
          <Pill tone={s.tone} dot style={{ fontSize: 10.5, padding: "3px 8px" }}>{s.text}</Pill>
          <Pill tone="muted" icon="git" style={{ fontSize: 10.5, padding: "3px 8px" }}>{agent.mode}</Pill>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>
          <span>{agent.skills} skills</span>
          <span>·</span>
          <span>{agent.runs} runs</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 5, width: "100%", marginTop: 2 }}>
          <FleetMeta label={agent.repo ? "Repo" : "Folder"} value={detail} />
        </div>
      </div>
    </AeonFleetHex>
  );
}

export function AeonFleet({ agents, onOpen, onCreate }: { agents: AeonAgent[]; onOpen: (a: AeonAgent) => void; onCreate: () => void }) {
  const totalOnDuty = agents.reduce((n, a) => n + a.onDuty, 0);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const cellCount = agents.length + 1;
  const [columns, setColumns] = React.useState(3);
  const honeycomb = React.useMemo(() => fleetHoneycombSize(cellCount, columns), [cellCount, columns]);

  React.useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const updateColumns = () => {
      const width = container.clientWidth || FLEET_HEX_W;
      const nextColumns = Math.max(1, Math.min(cellCount, Math.floor((width - FLEET_HEX_W) / FLEET_HEX_X_STEP) + 1));
      setColumns(nextColumns);
    };
    updateColumns();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateColumns);
      return () => window.removeEventListener("resize", updateColumns);
    }
    const observer = new ResizeObserver(updateColumns);
    observer.observe(container);
    return () => observer.disconnect();
  }, [cellCount]);

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

        <div ref={listRef} style={{ width: "100%", overflowX: "auto", padding: "14px 0 18px" }}>
          <div data-aeon-fleet-hive style={{ position: "relative", width: honeycomb.width, height: honeycomb.height, minHeight: FLEET_HEX_H, margin: "0 auto" }}>
            <AeonFleetHex
              data-aeon-fleet-hex="create"
              tone="honey"
              onClick={onCreate}
              aria-label="Clone or import an AEON repo"
              style={{ position: "absolute", left: 0, top: 0 }}
            >
              <div style={{ display: "grid", justifyItems: "center", gap: 12, width: "100%" }}>
                <span style={{ display: "grid", placeItems: "center", width: 54, height: 54, clipPath: "polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)", background: "var(--aeon-soft)", border: "1px solid var(--aeon-line)", color: "var(--cyan-3)" }}>
                  <Icon name="plus" size={24} />
                </span>
                <span style={{ fontFamily: "var(--f-display)", fontWeight: 750, fontSize: 17, color: "var(--cyan-3)", lineHeight: 1.1 }}>Start AEON</span>
                <span style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45, maxWidth: 184 }}>Clone/import repo</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--honey-2)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>
                  New workspace <Icon name="chevronR" size={13} />
                </span>
              </div>
            </AeonFleetHex>
            {agents.map((agent, index) => {
              const point = fleetHexPosition(index + 1, columns);
              return (
                <AgentHive
                  key={agent.id}
                  agent={agent}
                  onOpen={onOpen}
                  style={{ position: "absolute", left: point.x, top: point.y }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

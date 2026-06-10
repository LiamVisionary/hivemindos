import * as React from "react";
import styles from "./agent-call.module.css";

export type AgentCallWaveStyle = "bars" | "wave" | "pulse";
export type OrbState = "ringing" | "answered" | "talking" | "listening" | "failed";
type TranscriptTurn = { who: "agent" | "you"; text: string };

const BAND_COUNT = 24;
const HEX_POINTS = "50,3 91.5,26.5 91.5,73.5 50,97 8.5,73.5 8.5,26.5";

export function useTranscriptLog(agentText: string, userText: string) {
  const [turns, setTurns] = React.useState<TranscriptTurn[]>([]);

  React.useEffect(() => {
    const text = agentText.trim();
    if (!text) return;
    queueMicrotask(() => {
      setTurns((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        if (last?.who === "agent") next[next.length - 1] = { who: "agent", text };
        else next.push({ who: "agent", text });
        return next.slice(-6);
      });
    });
  }, [agentText]);

  React.useEffect(() => {
    const text = userText.trim();
    if (!text) return;
    queueMicrotask(() => {
      setTurns((current) => {
        const next = current.slice();
        const last = next[next.length - 1];
        if (last?.who === "you") next[next.length - 1] = { who: "you", text };
        else next.push({ who: "you", text });
        return next.slice(-6);
      });
    });
  }, [userText]);

  return turns;
}

export function useCallTimer(running: boolean) {
  const [seconds, setSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!running) {
      queueMicrotask(() => setSeconds(0));
      return undefined;
    }
    const interval = window.setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AgentCallHexOrb({ state, level }: { state: OrbState; level: number }) {
  return (
    <span className={styles.hex}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <polygon points={HEX_POINTS} className={styles.hexFill} />
        <polygon points={HEX_POINTS} className={styles.hexStroke} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className={styles.hexIn}>
        <span className={styles.orb} data-state={state} style={{ "--lvl": String(Math.max(0, Math.min(1, level))) } as React.CSSProperties}>
          <span className={styles.orbHalo} />
          {(state === "listening" || state === "answered") ? <span className={styles.orbRipple} /> : null}
          {state === "ringing" ? <span className={styles.orbOrbit} /> : null}
          {state === "ringing" ? <span className={`${styles.orbOrbit} ${styles.orbOrbit2}`} /> : null}
          <span className={`${styles.orbCore} ${state === "failed" ? styles.orbCoreDanger : ""}`}>
            <span className={styles.orbGlint} />
            <span className={styles.orbEq} aria-hidden="true"><i /><i /><i /><i /></span>
          </span>
        </span>
      </span>
    </span>
  );
}

export function AgentCallWaveform({ bands, waveStyle, idle }: { bands: number[]; waveStyle: AgentCallWaveStyle; idle?: boolean }) {
  if (idle) {
    return (
      <div className={`${styles.wf} ${styles.wfBars} ${styles.wfIdle}`} aria-hidden="true">
        {Array.from({ length: BAND_COUNT }, (_, index) => <span key={index} style={{ height: `${8 + (index % 3) * 5}%` }} />)}
      </div>
    );
  }

  if (waveStyle === "wave") {
    const width = 100;
    const height = 40;
    const middle = height / 2;
    const last = Math.max(1, bands.length - 1);
    const top = bands.map((band, index) => `${((index / last) * width).toFixed(2)},${(middle - band * middle * 0.92).toFixed(2)}`);
    const bottom = bands.map((_, index) => {
      const reverseIndex = bands.length - 1 - index;
      return `${((reverseIndex / last) * width).toFixed(2)},${(middle + bands[reverseIndex] * middle * 0.92).toFixed(2)}`;
    });
    return (
      <div className={`${styles.wf} ${styles.wfWave}`} aria-label="Live voice waveform">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><path d={`M${top.join(" L")} L${bottom.join(" L")} Z`} /></svg>
      </div>
    );
  }

  return (
    <div className={`${styles.wf} ${waveStyle === "pulse" ? styles.wfPulse : styles.wfBars}`} aria-label="Live voice waveform">
      {bands.map((band, index) => <span key={index} style={{ height: `${Math.max(6, Math.round(band * 100))}%` }} />)}
    </div>
  );
}

export function AgentCallGauge({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.gauge}>
      <span className={styles.gaugeLabel}>{label}</span>
      <span className={styles.gaugeTrack}>
        <span className={`${styles.gaugeFill} ${tone === "warn" ? styles.gaugeFillWarn : ""}`} style={{ width: `${bounded}%` }} />
      </span>
      <span className={styles.gaugeVal}>{bounded}</span>
    </div>
  );
}

export function AgentCallControlButton({ icon, label, on, danger, big, onClick }: {
  icon: React.ReactNode;
  label: string;
  on?: boolean;
  danger?: boolean;
  big?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={[styles.rb, on ? styles.rbOn : "", danger ? styles.rbDanger : "", big ? styles.rbBig : ""].filter(Boolean).join(" ")}
      onClick={onClick}
      aria-pressed={on ?? undefined}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

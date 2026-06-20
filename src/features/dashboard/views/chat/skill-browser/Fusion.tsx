"use client";

import * as React from "react";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";
import { BBtn, Badge, BIcon, FzIcon } from "./primitives";
import {
  FZ_DUR,
  FZ_PHASES,
  FZ_PROMPT,
  FZ_RECEIPTS,
  FZ_STEPS,
  FZ_TONE_FR,
  capsFromFusionResult,
  machinesFromFusionResult,
  skillFromFusionResult,
  type FusionSkillResponse,
  type FzPhase,
  type FzTone,
} from "./fusion-data";

function fzColor(tone: FzTone) {
  return FZ_TONE_FR[tone] || "var(--fg-2)";
}

type FusionProps = {
  vaultPath?: string;
  onFlash?: (msg: string) => void;
  onCreated?: (result: FusionSkillResult) => void;
  onConvertToAeon?: (result: FusionSkillResult) => void | Promise<void>;
};

export function Fusion({ vaultPath, onFlash, onCreated, onConvertToAeon }: FusionProps) {
  const [phase, setPhase] = React.useState<FzPhase>("idle");
  const [prompt, setPrompt] = React.useState(FZ_PROMPT);
  const [result, setResult] = React.useState<FusionSkillResult | null>(null);
  const [error, setError] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const requestId = React.useRef(0);

  const machines = React.useMemo(() => machinesFromFusionResult(result), [result]);
  const caps = React.useMemo(() => capsFromFusionResult(result), [result]);
  const used = caps.filter((c) => c.used);
  const skill = skillFromFusionResult(result);
  const idx = FZ_PHASES.indexOf(phase);
  const running = phase !== "idle" && phase !== "reveal";

  const clearTimers = React.useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  React.useEffect(() => clearTimers, [clearTimers]);

  const moveThroughVisualPhases = React.useCallback(() => new Promise<void>((resolve) => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setPhase("verify");
      resolve();
      return;
    }
    const seq: FzPhase[] = ["discover", "rank", "fuse", "verify"];
    setPhase("discover");
    let t = 0;
    seq.forEach((p, i) => {
      if (i === 0) return;
      t += FZ_DUR[FZ_PHASES.indexOf(seq[i - 1])];
      timers.current.push(setTimeout(() => setPhase(p), t));
    });
    t += FZ_DUR[FZ_PHASES.indexOf("verify")];
    timers.current.push(setTimeout(resolve, t));
  }), []);

  const run = React.useCallback(() => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    clearTimers();
    setResult(null);
    setError("");
    const visualPhasesDone = moveThroughVisualPhases();
    onFlash?.("Fusion is discovering skills, tools, apps, and agents across the hive.");

    void fetch("/api/fusion/skill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: trimmedPrompt,
        vaultPath: vaultPath?.trim() || undefined,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as FusionSkillResponse | null;
        if (!response.ok || !data?.ok) {
          const message = data && "error" in data ? data.error : undefined;
          throw new Error(message || "Could not create the fusion skill.");
        }
        if (requestId.current !== currentRequest) return;
        setResult(data);
        await visualPhasesDone;
        if (requestId.current !== currentRequest) return;
        clearTimers();
        setPhase("reveal");
        onCreated?.(data);
        onFlash?.(`Fused ${data.fusedCount} parts into ${data.skill.slug}.`);
      })
      .catch((caught: unknown) => {
        if (requestId.current !== currentRequest) return;
        clearTimers();
        setPhase("idle");
        const message = caught instanceof Error ? caught.message : "Could not create the fusion skill.";
        setError(message);
        onFlash?.(message);
      });
  }, [clearTimers, moveThroughVisualPhases, onCreated, onFlash, prompt, vaultPath]);

  const reset = React.useCallback(() => {
    requestId.current += 1;
    clearTimers();
    setPhase("idle");
    setResult(null);
    setError("");
  }, [clearTimers]);

  const stepState = (k: number): "idle" | "active" | "done" => {
    if (k === 0) return idx >= 1 ? "done" : running ? "active" : "idle";
    return idx > k ? "done" : idx === k ? "active" : "idle";
  };

  type Line = { key: string; icon: string; text: string; done: boolean; spin?: boolean };
  const lines: Line[] = [];
  if (idx >= 1) lines.push({ key: "d", icon: "search", text: `Discovered ${caps.length} capabilities across ${machines.length} machines`, done: idx > 1 });
  if (idx >= 2) lines.push({ key: "r", icon: "filter", text: `Ranked ${used.length} best-fit parts by cost, safety, and proof`, done: idx > 2 });
  if (idx >= 3) lines.push({ key: "f", icon: phase === "fuse" ? "refresh" : "fuse", spin: phase === "fuse", text: phase === "fuse" ? `Fusing ${used.length} parts...` : `Fused ${used.length} parts into one skill`, done: idx > 3 });
  if (idx >= 4) lines.push({ key: "v", icon: "verify", text: result ? `Verified and wrote ${result.skill.slug}` : "Verifying generated skill and capability evidence", done: idx > 4 });
  if (idx >= 5) lines.push({ key: "g", icon: "deliver", text: `Delivered ${skill.slug} to the shared brain`, done: false });

  const showBoard = idx >= 1 && idx < 5;
  const showCore = idx >= 3 && idx < 5;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="fb-card pad">
        <div className="sb-fz-agent">
          <div className="sb-fz-id">
            <span className="fb-tile" style={{ width: 38, height: 38, color: "var(--honey)" }}><BIcon name="sparkles" size={18} /></span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: "var(--f-display)" }}>Hive · fusion agent</div>
              <div style={{ fontSize: 11, color: "var(--live)", fontFamily: "var(--f-mono)", marginTop: 2 }}>live · {machines.length} machines connected</div>
            </div>
          </div>
          <div className="sb-fz-machines">
            {machines.map((m) => (
              <span key={m.id} className="sb-fz-mtag" data-live={running ? "" : undefined}><FzIcon name={m.icon} size={12} />{m.name}</span>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--fg-3)", lineHeight: 1.5, margin: "12px 0 0" }}>
          Describe a goal. Fusion discovers every tool, app, agent, and channel across your hive, ranks the best parts, and combines them into one durable skill.
        </p>
        <div className="sb-fz-prompt">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} spellCheck={false} placeholder={FZ_PROMPT} />
          {phase === "reveal" ? (
            <BBtn sm onClick={reset}><BIcon name="refresh" size={13} />Run again</BBtn>
          ) : (
            <BBtn variant="primary" sm disabled={running || !prompt.trim()} onClick={run}>
              <BIcon name={running ? "sync" : "network"} size={14} />{running ? "Fusing..." : "Run fusion"}
            </BBtn>
          )}
        </div>
        {error ? <p className="sb-error"><BIcon name="alert" size={13} />{error}</p> : null}
      </div>

      <div className="sb-fz-rail">
        {FZ_STEPS.map((s, k) => {
          const st = stepState(k);
          return (
            <div key={s.key} className="sb-fz-step" data-state={st}>
              <span className="t" style={{ color: st === "active" ? "var(--honey)" : st === "done" ? "var(--live)" : "var(--fg-2)" }}>
                {st === "done" ? <BIcon name="check" size={13} /> : <FzIcon name={s.icon} size={13} />}{s.label}
              </span>
              <span className="d">{s.detail}</span>
            </div>
          );
        })}
      </div>

      {showBoard ? (
        <div className="fb-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="sb-section">Capabilities discovered across the hive</div>
          <div className="sb-fz-board">
            {caps.map((c) => {
              const machine = machines.find((m) => m.id === c.machine);
              return (
                <div key={c.id} className="sb-fz-cap" data-used={c.used ? "" : undefined} data-dim={idx >= 3 && !c.used ? "" : undefined} data-pull={phase === "fuse" && c.used ? "" : undefined}>
                  <span className="ic" style={{ color: fzColor(c.tone) }}><FzIcon name={c.icon} size={14} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="lbl">{c.label}</div>
                    <div className="sub">{machine ? machine.name : c.machine} · {c.meta}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {showCore ? (
            <div className="sb-fz-core">
              <div className="sb-fz-corehex" data-pulse={phase === "fuse" ? "" : undefined}>
                <span className="ring" />
                <BIcon name="hex" size={64} color="var(--honey)" />
                <span style={{ position: "absolute", color: "var(--honey)" }}><BIcon name="sparkles" size={24} /></span>
              </div>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-3)" }}>
                {phase === "fuse" ? `fusing ${used.length} parts` : "parts fused -> verifying"}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {lines.length ? (
        <div className="sb-fz-log">
          {lines.map((line) => (
            <div key={line.key} className="sb-fz-line" data-done={line.done ? "" : undefined}>
              <span className="ic" style={{ color: line.done ? "var(--live)" : "var(--honey)" }}>
                {line.done ? <BIcon name="check" size={13} /> : <span className={line.spin ? "sb-spin" : undefined}><FzIcon name={line.icon} size={13} /></span>}
              </span>
              {line.text}
            </div>
          ))}
        </div>
      ) : null}

      {phase === "reveal" ? (
        <div className="sb-fz-reveal">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <span className="fb-tile" style={{ width: 42, height: 42, color: "var(--honey)" }}><BIcon name="sparkles" size={20} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fb-eyebrow" style={{ color: "var(--honey)" }}>Skill created</div>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 18, marginTop: 3 }}>{skill.name}</div>
              <div className="sb-slug">{skill.slug}</div>
            </div>
            <Badge tone="live"><BIcon name="check" size={10} />Proved</Badge>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55, margin: 0 }}>{skill.description}</p>
          <div className="sb-caps">
            {used.map((capability) => <span key={capability.id} className="sb-cap" style={{ color: fzColor(capability.tone) }}><FzIcon name={capability.icon} size={10} />{capability.label}</span>)}
          </div>
          <div className="sb-fz-receipts">
            {FZ_RECEIPTS.map((receipt) => (
              <div key={receipt.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ color: "var(--live)" }}><FzIcon name={receipt.icon} size={15} /></span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{receipt.label}</div>
                  <div style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{receipt.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid var(--line)", paddingTop: 13 }}>
            <BBtn sm disabled={!result} onClick={() => result ? void onConvertToAeon?.(result) : undefined}><BIcon name="bot" size={13} />Convert to Aeon duty</BBtn>
            <BBtn
              variant="primary"
              sm
              disabled={!result || refreshing}
              onClick={() => {
                if (!result) return;
                setRefreshing(true);
                onCreated?.(result);
                onFlash?.(`${result.skill.slug} is in the shared brain.`);
                window.setTimeout(() => setRefreshing(false), 500);
              }}
            >
              <BIcon name={refreshing ? "sync" : "check"} size={13} />{refreshing ? "Refreshing..." : "In brain"}
            </BBtn>
          </div>
        </div>
      ) : null}
    </div>
  );
}

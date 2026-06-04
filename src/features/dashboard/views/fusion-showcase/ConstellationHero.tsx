// src/features/dashboard/views/fusion-showcase/ConstellationHero.tsx
// The animated Constellation hero: chat prompt → capabilities bounce onto a
// sunken shelf → bees carry them into orbit → beams fuse into the core →
// checkmark → the field clears to a single created-skill card.
"use client";

import * as React from "react";
import Image from "next/image";
import { Search, GitBranch, CheckCircle2 } from "lucide-react";
import { CAPS, MACHINES, TONE, COPY, CORE_EMBLEM, type Capability, type Machine } from "./fusion-data";
import { Asset, Chip, Corners, Eyebrow, HexNode, MachineTag } from "./hex-node";
import { ChatPanel } from "./ChatPanel";
import { LottieBee } from "./lottie-bee";
import type { Stage } from "./use-fusion-stage";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";
import styles from "./fusion.module.css";

const SW = 600, CX = 300, CY = 206, CORE = 150, AS = 52;
const SHELF_Y = 530, SHELF_TOP = 472, SHELF_H = 100;
const SCENE_OFFSET_Y = 56;

function orbitPos(i: number, n: number) {
  const ang = (-90 + (360 / n) * i) * Math.PI / 180;
  const r = i % 2 ? 198 : 168;
  return { x: CX + Math.cos(ang) * r, y: CY + Math.sin(ang) * r };
}
function shelfPos(i: number, n: number) {
  if (n <= 1) return { x: CX, y: SHELF_Y };
  return { x: 50 + (500 / (n - 1)) * i, y: SHELF_Y };
}

function createdSkillCopy(prompt: string) {
  const normalized = prompt.toLowerCase();
  if (
    normalized.includes("base")
    && normalized.includes("x")
    && normalized.includes("telegram")
    && normalized.includes("image")
  ) {
    return {
      name: "Base News Broadcast Skill",
      slug: "base-news-broadcast-skill",
    };
  }
  return {
    name: "Custom Hive Skill",
    slug: "custom-hive-skill",
  };
}

function CreatedSkillCard({ prompt, capabilities, result }: { prompt: string; capabilities: Capability[]; result?: FusionSkillResult | null }) {
  const used = capabilities.filter((c) => c.used);
  const skill = result?.skill ?? createdSkillCopy(prompt);
  return (
    <div className={styles.shell} style={{
      position: "relative", zIndex: 6, width: 252, padding: "26px 22px 22px",
      display: "grid", gap: 14, justifyItems: "center", textAlign: "center",
      animation: "fz-card-in 900ms cubic-bezier(.2,1.34,.35,1) both",
      border: "1px solid color-mix(in srgb, var(--fz-gold) 48%, transparent)",
      background: "linear-gradient(180deg, rgba(20,26,38,0.96), rgba(10,14,22,0.93))",
      boxShadow: "0 0 calc(60px * var(--fz-glow)) var(--fz-gold-soft), 0 28px 64px rgba(0,0,0,0.55)",
    }}>
      <Corners />
      <HexNode tone="gold" size={124} live>
        <Image src={CORE_EMBLEM} alt="Hive fusion core" width={107} height={107} unoptimized
          style={{ width: "86%", height: "86%", objectFit: "contain", filter: "drop-shadow(0 0 14px var(--fz-gold-soft))" }} />
      </HexNode>
      <div style={{ display: "grid", gap: 5 }}>
        <span className={styles.monoCap} style={{ color: "var(--fz-gold-2)", fontSize: 9 }}>skill created</span>
        <strong style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 21, letterSpacing: "-0.01em", color: "var(--fz-fg)" }}>{skill.name}</strong>
        <code style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fz-fg-3)" }}>{skill.slug}</code>
      </div>
      <div style={{ display: "flex", gap: 7, justifyContent: "center" }}>
        {used.map((c) => <Asset key={c.id} logo={c.logo} icon={c.icon} tone={c.tone} size={32} />)}
      </div>
      <Chip tone="teal" icon={CheckCircle2}>reusable skill</Chip>
    </div>
  );
}

function StatusChips({ result, capabilities }: { result?: FusionSkillResult | null; capabilities: Capability[] }) {
  const discovered = result?.discoveredCount ?? capabilities.length;
  const fused = result?.fusedCount ?? capabilities.filter((capability) => capability.used).length;
  return (
    <div style={{
      display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap",
      animation: "fz-rise 360ms ease 680ms both",
    }}>
      <Chip tone="teal" icon={Search}>{discovered} discovered</Chip>
      <Chip tone="gold" icon={GitBranch}>{fused} fused</Chip>
      <Chip tone="violet" icon={CheckCircle2}>proved</Chip>
    </div>
  );
}

function Beam({ c, i, n }: { c: Capability; i: number; n: number }) {
  const p = orbitPos(i, n);
  const col = c.tone === "black" ? "var(--fz-teal)" : TONE[c.tone];
  return (
    <g>
      <line x1={p.x} y1={p.y} x2={CX} y2={CY} stroke={col} strokeWidth={c.used ? 1.6 : 1} opacity={c.used ? 0.5 : 0.24} />
      <line x1={p.x} y1={p.y} x2={CX} y2={CY} stroke={col} strokeWidth={c.used ? 2 : 1.2} className={styles.flowPath} opacity={c.used ? 0.9 : 0.42} />
      <circle r={c.used ? 3 : 2} fill={c.used ? "var(--fz-gold-2)" : col}>
        <animateMotion dur={(c.used ? 1.4 : 1.9) + "s"} repeatCount="indefinite" path={`M${p.x},${p.y} L${CX},${CY}`} />
      </circle>
    </g>
  );
}

export function ConstellationHero({
  draft,
  onDraftChange,
  onSendPrompt,
  stage,
  started,
  submittedPrompt,
  capabilities = CAPS,
  machines = MACHINES,
  fusionResult,
  fusionError,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSendPrompt: () => void;
  stage: Stage;
  started: boolean;
  submittedPrompt: string;
  capabilities?: Capability[];
  machines?: Machine[];
  fusionResult?: FusionSkillResult | null;
  fusionError?: string;
}) {
  const caps = capabilities;
  const activeMachines = machines;
  const n = caps.length;
  const carrying = stage.at("carry");
  const showConn = stage.at("fuse") && !stage.at("reveal");
  const coreGone = stage.at("verify");
  const reveal = stage.at("reveal");
  const shelfCaps = stage.at("discover") ? caps.slice(0, stage.discoveredCount) : [];

  return (
    <section style={{ display: "grid", gap: 26 }}>
      <div style={{ display: "grid", gap: 14, maxWidth: 880 }}>
        <Eyebrow>{COPY.heroEyebrow}</Eyebrow>
        <h1 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 700, letterSpacing: "-0.025em", fontSize: 46, lineHeight: 1.04, color: "var(--fz-fg)", textWrap: "balance" }}>
          One message. <span style={{ color: "var(--fz-gold-2)" }}>Every capability across your hive</span>, fused into a single skill.
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: "var(--fz-fg-3)", maxWidth: 720 }}>{COPY.heroLede}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 360px) 1fr", gap: 26, alignItems: "stretch" }}>
        <ChatPanel
          draft={draft}
          onDraftChange={onDraftChange}
          onSendPrompt={onSendPrompt}
          stage={stage}
          started={started}
          submittedPrompt={submittedPrompt}
          fusionResult={fusionResult}
          fusionError={fusionError}
          capabilityCount={caps.length}
          machineCount={activeMachines.length}
        />

        <div className={styles.shell} style={{
          position: "relative", padding: 18, minHeight: 712,
          ...(reveal
            ? { display: "flex", alignItems: "center", justifyContent: "center" }
            : { display: "grid", gap: 12, alignContent: "start" }),
        }}>
          <Corners />
          {reveal ? (
            <div style={{ display: "grid", gap: 16, justifyItems: "center" }}>
              <CreatedSkillCard prompt={submittedPrompt} capabilities={caps} result={fusionResult} />
              <StatusChips result={fusionResult} capabilities={caps} />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {activeMachines.map((m) => <MachineTag key={m.id} m={m} active={stage.at("discover")} />)}
              </div>

              <div style={{ position: "relative", width: SW, height: 580, maxWidth: "100%", margin: "0 auto", transform: `translateY(${SCENE_OFFSET_Y}px)` }}>
                {/* beams */}
                <svg viewBox={`0 0 ${SW} 580`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", opacity: showConn ? 1 : 0, transition: "opacity .5s ease" }}>
                  {caps.map((c, i) => <Beam key={c.id} c={c} i={i} n={n} />)}
                </svg>

                {/* sunken shelf */}
                <div className={styles.shelf} style={{ position: "absolute", left: 18, right: 18, top: SHELF_TOP, height: SHELF_H }}>
                  <span className={styles.monoCap} style={{ position: "absolute", left: 16, top: 14, color: "var(--fz-fg-3)", fontSize: 8.5 }}>discovered shelf</span>
                </div>
                {caps.map((c, i) => {
                  const s = shelfPos(i, n);
                  return <div key={"slot" + i} className={styles.shelfCell} style={{ position: "absolute", left: s.x - 21, top: s.y - 21, width: 42, height: 42 }} />;
                })}

                {/* core + checkmark */}
                {!coreGone ? (
                  <div style={{ position: "absolute", left: CX, top: CY, transform: "translate(-50%,-50%)", zIndex: 4 }}>
                    {stage.is("fuse") || stage.is("fused") ? <span style={{ position: "absolute", inset: -18, borderRadius: "50%", border: "2px solid var(--fz-gold)", animation: "fz-pulse-ring 1.7s ease-out infinite" }} /> : null}
                    <HexNode tone="gold" size={CORE} live={stage.at("discover")}>
                      <Image src={CORE_EMBLEM} alt="Hive fusion core" width={126} height={126} unoptimized style={{ width: "84%", height: "84%", objectFit: "contain", filter: "drop-shadow(0 0 14px var(--fz-gold-soft))" }} />
                    </HexNode>
                  </div>
                ) : null}

                {stage.is("verify") ? (
                  <div style={{ position: "absolute", left: CX, top: CY, transform: "translate(-50%,-50%)", zIndex: 5 }}>
                    <svg width={CORE} height={CORE} viewBox="0 0 120 120">
                      <circle cx={60} cy={60} r={50} fill="none" stroke="var(--fz-teal)" strokeWidth={4} strokeDasharray={320} strokeDashoffset={320} style={{ animation: "fz-ring-draw .6s ease forwards" }} />
                      <circle cx={60} cy={60} r={50} fill="color-mix(in srgb, var(--fz-teal) 12%, transparent)" />
                      <path d="M38 61 L53 77 L84 42" fill="none" stroke="var(--fz-teal-2)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={80} strokeDashoffset={80} style={{ animation: "fz-check-draw .5s .35s ease forwards" }} />
                    </svg>
                  </div>
                ) : null}

                {/* capability tiles */}
                {shelfCaps.map((c, i) => {
                  const s = shelfPos(i, n), o = orbitPos(i, n);
                  const target = carrying ? o : s;
                  const dx = o.x - s.x;
                  return (
                    <div key={c.id} style={{
                      position: "absolute", left: 0, top: 0, width: AS, height: AS, zIndex: c.used ? 3 : 2,
                      transform: `translate(${target.x - AS / 2}px, ${target.y - AS / 2}px)`,
                      transition: carrying ? `transform 900ms cubic-bezier(.34,1.32,.42,1) ${i * 300}ms` : "none",
                    }}>
                      {stage.is("carry") ? (
                        <div style={{
                          position: "absolute", left: "50%", top: -34, width: 42, height: 42, pointerEvents: "none",
                          transform: `translateX(-50%) scaleX(${dx < 0 ? -1 : 1})`,
                          animation: `fz-carry-bee 900ms ease ${i * 300}ms both`,
                        }}>
                          <LottieBee size={42} />
                        </div>
                      ) : null}
                      <div
                        className={styles.shelfItem}
                      >
                        <Asset logo={c.logo} icon={c.icon} tone={c.tone} size={AS} live={stage.at("discover") && c.used} />
                        <span style={{ position: "absolute", top: AS + 5, left: "50%", transform: "translateX(-50%)", width: 92, textAlign: "center", fontFamily: "var(--f-mono)", fontSize: 8.5, lineHeight: 1.2, color: "var(--fz-fg-2)", whiteSpace: "nowrap" }}>{c.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

            </>
          )}
        </div>
      </div>
    </section>
  );
}

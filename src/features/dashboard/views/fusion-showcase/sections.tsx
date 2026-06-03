// src/components/fusion/sections.tsx
// Lower page sections: section heads, the tested workflow track, packaged skill
// cards, and the footer CTA.
"use client";

import * as React from "react";
import Image from "next/image";
import { Search, Play, ShieldCheck, Filter, Bot, Clock3, RefreshCcw, ArrowRight, type LucideIcon } from "lucide-react";
import { CAPS, RECEIPTS, SKILLS, TONE, CORE_EMBLEM, type Tone } from "./fusion-data";
import { Asset, Chip, Corners, Eyebrow, HexNode } from "./hex-node";
import styles from "./fusion.module.css";

export function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 700, letterSpacing: "-0.02em", fontSize: 30, lineHeight: 1.12, color: "var(--fz-fg)", maxWidth: 760, textWrap: "balance" }}>{title}</h2>
      {lede ? <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: "var(--fz-fg-3)", maxWidth: 760 }}>{lede}</p> : null}
    </div>
  );
}

export function TestedWorkflow() {
  const used = CAPS.filter((c) => c.used);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className={styles.shell} style={{ padding: "26px 22px", position: "relative" }}>
        <Corners />
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
          <svg style={{ position: "absolute", top: 40, left: 0, width: "100%", height: 8, overflow: "visible", pointerEvents: "none" }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="fz-spine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#e8edf6" />
                <stop offset="0.3" stopColor="var(--fz-violet)" />
                <stop offset="0.55" stopColor="var(--fz-gold)" />
                <stop offset="0.78" stopColor="var(--fz-blue)" />
                <stop offset="1" stopColor="var(--fz-teal)" />
              </linearGradient>
            </defs>
            <line x1="10%" y1={4} x2="90%" y2={4} stroke="url(#fz-spine)" strokeWidth={3} strokeLinecap="round" opacity={0.55} />
            <line x1="10%" y1={4} x2="90%" y2={4} stroke="url(#fz-spine)" strokeWidth={3} strokeLinecap="round" className={styles.flowPath} />
          </svg>
          {used.map((c, i) => (
            <div key={c.id} style={{ position: "relative", zIndex: 1, display: "grid", justifyItems: "center", gap: 10, textAlign: "center" }}>
              <span className={styles.monoCap} style={{ color: "var(--fz-fg-4)", fontSize: 9 }}>{"0" + (i + 1)}</span>
              <Asset logo={c.logo} icon={c.icon} tone={c.tone} size={64} live />
              <strong style={{ fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14, color: "var(--fz-fg)" }}>{c.label}</strong>
              <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.45, color: "var(--fz-fg-4)", minHeight: 50 }}>{c.detail}</p>
              <Chip tone={c.tone}>{c.meta}</Chip>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {RECEIPTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 13, border: "1px solid var(--fz-panel-line)", background: "rgba(8,12,19,0.5)" }}>
              <span style={{ width: 22, height: 22, color: "var(--fz-teal)", flex: "0 0 auto" }}><Icon style={{ width: "100%", height: "100%" }} /></span>
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 13, color: "var(--fz-fg)" }}>{r.label}</strong>
                <small style={{ fontSize: 11, color: "var(--fz-fg-4)" }}>{r.detail}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniArt({ slug }: { slug: string }) {
  const used = CAPS.filter((c) => c.used);
  if (slug === "hive-workflow-fusion") {
    const seq: { icon: LucideIcon; tone: Tone }[] = [
      { icon: Search, tone: "teal" }, { icon: Filter, tone: "gold" }, { icon: Play, tone: "teal" }, { icon: ShieldCheck, tone: "violet" },
    ];
    return (
      <div style={{ display: "grid", gap: 18, placeItems: "center", padding: "8px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {seq.map((s, i) => (
            <React.Fragment key={i}>
              <HexNode tone={s.tone} icon={s.icon} size={46} />
              <ArrowRight width={14} height={14} style={{ color: "var(--fz-fg-4)" }} />
            </React.Fragment>
          ))}
          <HexNode tone="gold" size={52}><span style={{ color: "var(--fz-gold)", fontSize: 20 }}>✦</span></HexNode>
        </div>
        <div style={{ display: "flex", gap: 7 }}>{["discover", "sequence", "receipt"].map((t) => <Chip key={t} tone="gold">{t}</Chip>)}</div>
      </div>
    );
  }
  if (slug === "hive-aeon-fusion") {
    const ring: { icon: LucideIcon; tone: Tone }[] = [
      { icon: Clock3, tone: "gold" }, { icon: Bot, tone: "teal" }, { icon: ShieldCheck, tone: "violet" }, { icon: RefreshCcw, tone: "gold" },
    ];
    return (
      <div style={{ position: "relative", height: 150, display: "grid", placeItems: "center" }}>
        <div style={{ position: "absolute", width: 132, height: 132, borderRadius: 999, border: "1.5px dashed color-mix(in srgb, var(--fz-violet) 35%, transparent)" }} />
        <HexNode tone="violet" icon={Bot} size={58} />
        {ring.map((s, i) => {
          const a = (i / 4) * Math.PI * 2; const r = 66;
          return <div key={i} style={{ position: "absolute", transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)` }}><HexNode tone={s.tone} icon={s.icon} size={34} /></div>;
        })}
        <Chip tone="violet" icon={Clock3} style={{ position: "absolute", bottom: -6 }}>AEON duty</Chip>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 16, placeItems: "center", padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 9 }}>{used.map((c) => <Asset key={c.id} logo={c.logo} icon={c.icon} tone={c.tone} size={42} />)}</div>
      <Chip tone="teal">new skill</Chip>
    </div>
  );
}

export function SkillCards() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
      {SKILLS.map((s) => (
        <article key={s.slug} className={styles.shell} style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden", border: `1px solid color-mix(in srgb, ${TONE[s.tone]} 28%, var(--fz-panel-line))` }}>
          <div style={{ display: "grid", placeItems: "center", padding: "22px 16px", minHeight: 172, borderBottom: "1px solid var(--fz-panel-line)", background: `radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, ${TONE[s.tone]} 14%, transparent), transparent 70%)` }}>
            <MiniArt slug={s.slug} />
          </div>
          <div style={{ display: "grid", gap: 10, padding: 18, alignContent: "start" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 600, color: `color-mix(in srgb, ${TONE[s.tone]} 80%, white)` }}>
              <span>{s.signal}</span>
              <code style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fz-fg-3)", border: "1px solid var(--fz-panel-line)", borderRadius: 6, padding: "3px 6px" }}>{s.slug}</code>
            </div>
            <h3 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 21, letterSpacing: "-0.01em", color: "var(--fz-fg)" }}>{s.name}</h3>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--fz-fg-3)" }}>{s.description}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function FooterCta({ tone = "teal" }: { tone?: Tone }) {
  return (
    <div className={styles.shell} style={{
      position: "relative", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", padding: "26px 28px",
      background: `radial-gradient(120% 160% at 0% 0%, color-mix(in srgb, ${TONE[tone]} 14%, transparent), transparent 60%), linear-gradient(180deg, rgba(16,21,31,0.72), rgba(7,10,16,0.58))`,
    }}>
      <Corners />
      <HexNode tone="gold" size={60}>
        <Image src={CORE_EMBLEM} alt="" width={48} height={48} unoptimized style={{ width: "80%", height: "80%", objectFit: "contain" }} />
      </HexNode>
      <div style={{ display: "grid", gap: 5, flex: 1, minWidth: 240 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.01em", color: "var(--fz-fg)" }}>Stop wiring providers. Start fusing capabilities.</h3>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--fz-fg-3)", maxWidth: 560 }}>Every machine in your hive becomes a part the agent can discover, rank, and fuse on demand — proven end to end.</p>
      </div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 18px", borderRadius: 12, fontFamily: "var(--f-display)", fontWeight: 600, fontSize: 14, color: "var(--fz-ink)", background: "linear-gradient(180deg, var(--fz-gold-2), var(--fz-gold))", boxShadow: "0 0 calc(22px * var(--fz-glow)) var(--fz-gold-soft)" }}>
        Run a fusion <ArrowRight width={15} height={15} />
      </span>
    </div>
  );
}

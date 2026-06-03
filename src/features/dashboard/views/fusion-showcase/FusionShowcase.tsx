// src/components/fusion/FusionShowcase.tsx
// Full Hive Fusion showcase page: top bar + animated Constellation hero +
// lower sections that reveal 1s after the created-skill card first appears.
"use client";

import * as React from "react";
import { COPY } from "./fusion-data";
import { Chip, HexNode } from "./hex-node";
import { ConstellationHero } from "./ConstellationHero";
import { SectionHead, SkillCards, TestedWorkflow, FooterCta } from "./sections";
import { useFusionStage } from "./use-fusion-stage";
import { Link as LinkIcon } from "lucide-react";
import styles from "./fusion.module.css";

function TopBar() {
  const nav = ["Fleet", "Work", "Brain", "Fusion", "Wallets"];
  return (
    <header style={{ display: "flex", alignItems: "center", gap: 18, padding: "16px 4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <HexNode tone="gold" image="/icons/queen-bee-v2.png" size={36} />
        <div style={{ display: "grid", gap: 1 }}>
          <span style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 15, color: "var(--fz-fg)", letterSpacing: "-0.01em" }}>HivemindOS</span>
          <span className={styles.monoCap} style={{ color: "var(--fz-fg-4)", fontSize: 8.5 }}>tail-fern.ts.net</span>
        </div>
      </div>
      <nav style={{ display: "flex", gap: 4, marginLeft: 8 }}>
        {nav.map((nLabel) => (
          <span key={nLabel} style={{
            fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.04em", padding: "6px 12px", borderRadius: 999,
            color: nLabel === "Fusion" ? "var(--fz-gold-2)" : "var(--fz-fg-4)",
            background: nLabel === "Fusion" ? "var(--fz-gold-soft)" : "transparent",
            border: "1px solid " + (nLabel === "Fusion" ? "color-mix(in srgb, var(--fz-gold) 40%, transparent)" : "transparent"),
          }}>{nLabel}</span>
        ))}
      </nav>
      <div style={{ marginLeft: "auto" }}>
        <Chip tone="teal" icon={LinkIcon}>constellation</Chip>
      </div>
    </header>
  );
}

export function FusionShowcase({ embedded = false }: { embedded?: boolean } = {}) {
  const [draft, setDraft] = React.useState("");
  const [submittedPrompt, setSubmittedPrompt] = React.useState("");
  const [runId, setRunId] = React.useState(0);
  const stage = useFusionStage(submittedPrompt || COPY.prompt, runId);
  const [bottomReady, setBottomReady] = React.useState(false);
  const fired = React.useRef(false);
  const started = runId > 0;

  const sendPrompt = React.useCallback(() => {
    const prompt = draft.trim();
    if (!prompt) return;
    fired.current = false;
    setBottomReady(false);
    setSubmittedPrompt(prompt);
    setDraft("");
    setRunId((current) => current + 1);
  }, [draft]);

  React.useEffect(() => {
    if (stage.at("reveal") && !fired.current) {
      fired.current = true;
      const id = setTimeout(() => setBottomReady(true), 1000);
      return () => clearTimeout(id);
    }
  }, [stage.name]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`${styles.root} ${styles.bgHoneycomb} ${styles.scrollbar}`} data-embedded={embedded ? "true" : undefined}>
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 16% 12%, var(--fz-teal-soft), transparent 32%), radial-gradient(circle at 86% 78%, var(--fz-violet-soft), transparent 34%), radial-gradient(circle at 60% 40%, var(--fz-gold-soft), transparent 40%)",
        opacity: "calc(0.6 * var(--fz-glow))",
      }} />
      <div style={{ position: "relative", zIndex: 1, width: "min(1180px, 100%)", margin: "0 auto", padding: embedded ? "28px 30px 40px" : "0 30px 40px", display: "grid", gap: 30 }}>
        {embedded ? null : <TopBar />}
        <ConstellationHero
          draft={draft}
          onDraftChange={setDraft}
          onSendPrompt={sendPrompt}
          stage={stage}
          started={started}
          submittedPrompt={submittedPrompt}
        />
        <div style={{
          display: "grid", gap: 30,
          opacity: bottomReady ? 1 : 0,
          transform: bottomReady ? "translateY(0)" : "translateY(26px)",
          transition: "opacity .75s ease, transform .75s cubic-bezier(.2,.7,.3,1)",
          pointerEvents: bottomReady ? "auto" : "none",
        }}>
          <section style={{ display: "grid", gap: 18 }}>
            <SectionHead eyebrow="Specific tested workflow" title={COPY.workflowTitle} lede={COPY.workflowLede} />
            <TestedWorkflow />
          </section>
          <section style={{ display: "grid", gap: 18 }}>
            <SectionHead eyebrow="Hive fusion skills" title="Three packaged skills turn loose intent into executable agent systems." />
            <SkillCards />
          </section>
          <FooterCta tone="teal" />
        </div>
      </div>
    </div>
  );
}

// src/features/dashboard/views/fusion-showcase/FusionShowcase.tsx
// Full Hive Fusion page: prompt → live capability search → shared-brain skill.
"use client";

import * as React from "react";
import { capabilitiesFromFusionRecords, COPY, machinesFromFusionRecords } from "./fusion-data";
import { Chip, HexNode } from "./hex-node";
import { ConstellationHero } from "./ConstellationHero";
import { useFusionStage } from "./use-fusion-stage";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";
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

type FusionSkillResponse = (FusionSkillResult & { ok: true }) | { ok?: false; error?: string };

export function FusionShowcase({ embedded = false, vaultPath }: { embedded?: boolean; vaultPath?: string } = {}) {
  const [draft, setDraft] = React.useState("");
  const [submittedPrompt, setSubmittedPrompt] = React.useState("");
  const [runId, setRunId] = React.useState(0);
  const [fusionResult, setFusionResult] = React.useState<FusionSkillResult | null>(null);
  const [fusionError, setFusionError] = React.useState("");
  const requestId = React.useRef(0);
  const started = runId > 0;
  const capabilities = React.useMemo(() => capabilitiesFromFusionRecords(fusionResult?.capabilities), [fusionResult]);
  const machines = React.useMemo(() => machinesFromFusionRecords(fusionResult?.capabilities), [fusionResult]);
  const discoveryReady = Boolean(fusionResult || fusionError);
  const stage = useFusionStage(submittedPrompt || COPY.prompt, runId, capabilities.length, discoveryReady);

  const sendPrompt = React.useCallback(() => {
    const prompt = draft.trim();
    if (!prompt) return;
    const nextRequestId = requestId.current + 1;
    requestId.current = nextRequestId;
    setFusionResult(null);
    setFusionError("");
    setSubmittedPrompt(prompt);
    setDraft("");
    setRunId((current) => current + 1);

    void fetch("/api/fusion/skill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        vaultPath: vaultPath?.trim() || undefined,
      }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as FusionSkillResponse | null;
        if (!response.ok || !data?.ok) {
          const message = data && "error" in data ? data.error : undefined;
          throw new Error(message || "Could not create the fusion skill.");
        }
        if (requestId.current !== nextRequestId) return;
        setFusionResult(data);
      })
      .catch((error: unknown) => {
        if (requestId.current !== nextRequestId) return;
        setFusionError(error instanceof Error ? error.message : "Could not create the fusion skill.");
      });
  }, [draft, vaultPath]);

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
          capabilities={capabilities}
          machines={machines}
          fusionResult={fusionResult}
          fusionError={fusionError}
        />
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { UnifiedSkillBrowser, type UnifiedSkillBrowserItem } from "@/features/dashboard/views/chat/UnifiedSkillBrowser";
import { Btn, Card, Eyebrow, Pill, SectionHead, type IconName, type Tone, aeonStyles as styles } from "./parts";
import { AEON_CATEGORIES, CAT, type AeonRun, type AeonSkill, type SkillState } from "./aeon-data";

const STATE_META: Record<SkillState, { tone: Tone; label: string; action: string; icon: IconName }> = {
  "on-duty": { tone: "honey", label: "On duty", action: "Pause", icon: "pause" },
  "paused": { tone: "muted", label: "Paused", action: "Resume", icon: "play" },
  "manual": { tone: "cyan", label: "Automated", action: "Run", icon: "play" },
  "ready": { tone: "sky", label: "AEON skill", action: "Automate", icon: "rocket" },
  "available": { tone: "muted", label: "Shared Brain", action: "Automate with AEON", icon: "rocket" },
};

export type SkillActionKind = "run" | "toggle" | "default";

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

export function AeonWork({ skills, runs, selectedSlug, onSelect, onAction, onImport }: {
  skills: AeonSkill[]; runs: AeonRun[]; selectedSlug: string | null;
  onSelect: (slug: string | null) => void; onAction: (s: AeonSkill, k?: SkillActionKind) => void; onImport: () => void;
}) {
  const skillBySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  const browserItems: UnifiedSkillBrowserItem[] = skills.map((skill) => {
    const state = STATE_META[skill.state];
    const category = CAT[skill.cat];
    return {
      id: skill.slug,
      slug: skill.slug,
      name: skill.name,
      description: skill.desc,
      source: skill.source === "shared-brain" ? "Shared Brain" : "AEON",
      sourceId: skill.source === "shared-brain" ? "shared" : "aeon",
      sourceKind: skill.source,
      category: category.label,
      categoryId: category.id,
      categoryColor: category.color,
      stateLabel: state.label,
      stateTone: state.tone,
      stateIcon: state.icon,
      stateActive: skill.state === "on-duty",
      scheduleLabel: skill.scheduleLabel || "Not scheduled",
      model: skill.model,
      selected: selectedSlug === skill.slug,
    };
  });
  const setUp = skills.filter((s) => ["on-duty", "paused", "manual"].includes(s.state)).length;

  return (
    <Card>
      <SectionHead eyebrow="Skills" title={`${skills.length} available · ${setUp} set up`} icon="sparkles"
        action={<div style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" variant="secondary" icon="fileUp" onClick={onImport}>Import skill</Btn>
          <Btn size="sm" variant="secondary" icon="clock">Scheduler</Btn>
        </div>} />

      <UnifiedSkillBrowser
        items={browserItems}
        sources={[
          { id: "aeon", label: "AEON", predicate: (item) => item.sourceKind !== "shared-brain" },
          { id: "shared", label: "Shared Brain", predicate: (item) => item.sourceKind === "shared-brain" },
        ]}
        categories={AEON_CATEGORIES}
        selectedItemId={selectedSlug}
        onSelectItem={(item) => onSelect(item.slug === selectedSlug ? null : item.slug)}
        emptyTitle="No skills match this filter"
        emptyDescription="Try another source, category, or search."
        renderActions={(item) => {
          const skill = skillBySlug.get(item.slug);
          if (!skill) return null;
          const state = STATE_META[skill.state];
          return (
            <Btn
              size="sm"
              variant={skill.state === "on-duty" || skill.state === "available" || skill.state === "ready" ? "secondary" : "primary"}
              icon={state.icon}
              onClick={() => onAction(skill)}
            >
              {state.action}
            </Btn>
          );
        }}
        renderDetail={(item) => <SkillDetail skill={item ? skillBySlug.get(item.slug) : undefined} runs={runs} onAction={onAction} />}
      />
    </Card>
  );
}

export { STATE_META };

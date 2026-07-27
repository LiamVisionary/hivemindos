// src/components/scheduler/AutomationComposerModal.tsx
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, Paperclip, Plus, Search, X } from "lucide-react";
import type { BeeAgentRole, BeeWorkerClass } from "@/lib/types/agent-runtime";
import { TASK_TEMPLATES, taskTemplateSearchText, type TaskTemplateCadenceKind, type TaskTemplateDefinition } from "@/components/task-modal/task-templates";
import type { NewTaskPayload } from "@/components/task-modal";
import { BeeIcon } from "./bee-icon";
import styles from "./scheduler-tokens.module.css";

export type AutomationAgentOption = {
  id: string;
  name: string;
  beeRole?: BeeAgentRole;
  workerClass?: BeeWorkerClass;
  cls: string;
  machineLabel: string;
  runtimeLabel: string;
};

export type AutomationSkillOption = { slug: string; name: string; description?: string };

interface AutomationComposerModalProps {
  open: boolean;
  editing?: boolean;
  aeon?: boolean;
  initial?: Partial<NewTaskPayload>;
  agents: AutomationAgentOption[];
  machines: string[];
  skillOptions: AutomationSkillOption[];
  onBrowseFolder?: () => Promise<string | null>;
  onClose: () => void;
  onSave: (task: NewTaskPayload) => void | string | Promise<void | string>;
}

type CadenceKind = "interval" | "daily" | "weekdays" | "ondemand" | "cron";
interface CadenceUI {
  kind: CadenceKind;
  everyN: number;
  everyUnit: "min" | "hour";
  time: string;
  days: string[];
  cronExpr: string;
}

interface StepDraft {
  text: string;
  skills: string[];
  paths: string[];
}

interface Draft {
  name: string;
  mode: "prompt" | "steps";
  prompt: string;
  steps: StepDraft[];
  /** Schedule-level attachments (prompt mode). Steps mode attaches per-step. */
  skills: string[];
  paths: string[];
  agentId: string;
  cadence: CadenceUI;
  machine: string;
  runOnAllMachines: boolean;
  usePastRuns: boolean;
  pastRunLimit: number;
}

const emptyStep = (): StepDraft => ({ text: "", skills: [], paths: [] });
const dedupe = (list: string[]) => [...new Set(list)];

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DOW_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const STEP_META: Array<{ n: number; label: string }> = [
  { n: 0, label: "Start" },
  { n: 1, label: "Agent & schedule" },
  { n: 2, label: "Review" },
];

const clampInt = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(value) || lo));

function baseCadence(): CadenceUI {
  return { kind: "interval", everyN: 1, everyUnit: "hour", time: "09:00", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], cronExpr: "0 9 * * *" };
}

function cronToDays(field: string): string[] {
  const nums = field.split(",").flatMap((chunk) => {
    const range = chunk.match(/^(\d)-(\d)$/);
    if (range) {
      const out: number[] = [];
      for (let d = Number(range[1]); d <= Number(range[2]); d += 1) out.push(d % 7);
      return out;
    }
    const n = Number(chunk);
    return Number.isFinite(n) ? [n % 7] : [];
  });
  return WEEK.filter((day) => nums.includes(DOW_NUM[day]));
}

function daysToCron(days: string[]): string {
  const nums = [...new Set(days.map((d) => DOW_NUM[d]).filter((n) => n != null))].sort((a, b) => a - b);
  return nums.join(",");
}

function cronToCadence(expr: string): CadenceUI {
  const base = baseCadence();
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min, hour, dom, , dow] = parts;
    const everyMin = min.match(/^\*\/(\d+)$/);
    if (everyMin && hour === "*" && dom === "*" && dow === "*") return { ...base, kind: "interval", everyN: clampInt(Number(everyMin[1]), 1, 59), everyUnit: "min" };
    const everyHour = hour.match(/^\*\/(\d+)$/);
    if (min === "0" && everyHour && dom === "*" && dow === "*") return { ...base, kind: "interval", everyN: clampInt(Number(everyHour[1]), 1, 24), everyUnit: "hour" };
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
      const time = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
      if (dom === "*" && dow !== "*") return { ...base, kind: "weekdays", time, days: cronToDays(dow).length ? cronToDays(dow) : ["Mon", "Tue", "Wed", "Thu", "Fri"] };
      if (dom === "*" && dow === "*") return { ...base, kind: "daily", time };
    }
  }
  return { ...base, kind: "cron", cronExpr: expr.trim() || "0 9 * * *" };
}

function cadenceFromPayload(cad?: NewTaskPayload["cadence"]): CadenceUI {
  const base = baseCadence();
  if (!cad) return base;
  if (cad.kind === "manual") return { ...base, kind: "ondemand" };
  if (cad.kind === "every15") return { ...base, kind: "interval", everyN: 15, everyUnit: "min" };
  if (cad.kind === "hourly") return { ...base, kind: "interval", everyN: 1, everyUnit: "hour" };
  if (cad.kind === "daily") return { ...base, kind: "interval", everyN: 24, everyUnit: "hour" };
  if (cad.kind === "weekday" || cad.kind === "session") return cronToCadence("30 13 * * 1-5");
  if (cad.kind === "cron") return cronToCadence(cad.expr);
  return base;
}

function cadenceFromTemplateKind(kind?: TaskTemplateCadenceKind): CadenceUI {
  const base = baseCadence();
  if (!kind || kind === "manual") return { ...base, kind: "ondemand" };
  if (kind === "every15") return { ...base, kind: "interval", everyN: 15, everyUnit: "min" };
  if (kind === "hourly") return { ...base, kind: "interval", everyN: 1, everyUnit: "hour" };
  if (kind === "daily") return { ...base, kind: "daily", time: "09:00" };
  if (kind === "weekday" || kind === "session") return cronToCadence("30 13 * * 1-5");
  return base;
}

function cadenceToPayload(c: CadenceUI): NewTaskPayload["cadence"] {
  if (c.kind === "ondemand") return { kind: "manual" };
  if (c.kind === "cron") return { kind: "cron", expr: c.cronExpr.trim() || "0 9 * * *" };
  if (c.kind === "interval") {
    if (c.everyUnit === "min") {
      if (c.everyN === 15) return { kind: "every15" };
      return { kind: "cron", expr: `*/${clampInt(c.everyN, 1, 59)} * * * *` };
    }
    if (c.everyN === 1) return { kind: "hourly" };
    if (c.everyN >= 24) return { kind: "daily" };
    return { kind: "cron", expr: `0 */${clampInt(c.everyN, 1, 23)} * * *` };
  }
  const [h, m] = (c.time || "09:00").split(":").map((n) => Number(n));
  if (c.kind === "daily") return { kind: "cron", expr: `${m || 0} ${h || 0} * * *` };
  const dow = daysToCron(c.days) || "1-5";
  return { kind: "cron", expr: `${m || 0} ${h || 0} * * ${dow}` };
}

function draftFromInitial(initial: Partial<NewTaskPayload> | undefined, agents: AutomationAgentOption[], machines: string[]): Draft {
  const attachments = initial?.attachments ?? [];
  const agentByName = initial?.target?.bee ? agents.find((a) => a.name === initial.target?.bee) : undefined;
  // Always keep `machine` a real machine label; the "every machine" fan-out is
  // the separate runOnAllMachines flag. (Storing the "All machines" sentinel
  // here leaked into the saved payload when the toggle was flipped off on edit.)
  const machine = initial?.target?.machine || agentByName?.machineLabel || machines[0] || "dashboard";
  const mode = initial?.mode ?? "prompt";
  const scheduleSkills = dedupe(attachments.filter((a) => a.kind === "skill").map((a) => a.label));
  const schedulePaths = dedupe(attachments.filter((a) => a.kind === "path").map((a) => a.label));
  // Build per-step drafts from the aligned step text + stepAttachments.
  const steps: StepDraft[] = initial?.steps?.length
    ? initial.steps.map((text, i) => ({
      text,
      skills: dedupe(initial.stepAttachments?.[i]?.skills ?? []),
      paths: dedupe(initial.stepAttachments?.[i]?.paths ?? []),
    }))
    : [emptyStep()];
  // In steps mode, fold any schedule-level attachments onto step 1 so they show
  // below a step (runtime-equivalent — the agent gets the union either way).
  if (mode === "steps" && (scheduleSkills.length || schedulePaths.length) && steps[0]) {
    steps[0] = {
      ...steps[0],
      skills: dedupe([...steps[0].skills, ...scheduleSkills]),
      paths: dedupe([...steps[0].paths, ...schedulePaths]),
    };
  }
  return {
    name: initial?.title ?? "",
    mode,
    prompt: initial?.prompt ?? "",
    steps,
    skills: mode === "steps" ? [] : scheduleSkills,
    paths: mode === "steps" ? [] : schedulePaths,
    agentId: agentByName?.id ?? agents[0]?.id ?? "",
    cadence: cadenceFromPayload(initial?.cadence),
    machine,
    runOnAllMachines: initial?.runOnAllMachines === true,
    usePastRuns: initial?.usePastRuns === true,
    pastRunLimit: clampInt(Number(initial?.pastRunLimit) || 3, 1, 12),
  };
}

function daysPhrase(days: string[]): string {
  const sel: string[] = WEEK.filter((d) => days.includes(d));
  if (sel.length === 0) return "no days";
  if (sel.length === 7) return "every day";
  if (sel.length === 5 && ["Mon", "Tue", "Wed", "Thu", "Fri"].every((d) => sel.includes(d))) return "weekdays";
  if (sel.length === 2 && sel.includes("Sat") && sel.includes("Sun")) return "weekends";
  return sel.join(", ");
}

function cadencePhrase(c: CadenceUI): string {
  if (c.kind === "ondemand") return "on demand";
  if (c.kind === "cron") return `on cron ${c.cronExpr.trim() || "0 9 * * *"}`;
  if (c.kind === "interval") return `every ${c.everyN} ${c.everyUnit === "min" ? "minute" : "hour"}${c.everyN === 1 ? "" : "s"}`;
  if (c.kind === "daily") return `every day at ${c.time}`;
  return `${daysPhrase(c.days)} at ${c.time}`;
}

export function AutomationComposerModal({
  open, editing, aeon, initial, agents, machines, skillOptions, onBrowseFolder, onClose, onSave,
}: AutomationComposerModalProps) {
  // The parent unmounts this modal when it closes, so a mount is always a fresh
  // open — the useState initializer seeds the draft from `initial` (new defaults
  // or the edit target). No reseed effect needed, which keeps render pure.
  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft>(() => draftFromInitial(initial, agents, machines));
  const [error, setError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [tplBrowseOpen, setTplBrowseOpen] = React.useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  // Which anchor the skill picker is open under ("section" = prompt-mode
  // attachments row; a number = that step's paperclip). null = closed.
  const [skillPickerFor, setSkillPickerFor] = React.useState<number | "section" | null>(null);
  // Screen rect of the button that opened the skill picker, so the portaled
  // picker can position itself under it (it renders in a body portal to avoid
  // clipping inside the modal's scroll container).
  const [skillAnchor, setSkillAnchor] = React.useState<DOMRect | null>(null);
  // Which step's paperclip attach menu (Skill / Path) is open.
  const [openStepAtt, setOpenStepAtt] = React.useState<number | null>(null);

  const patch = React.useCallback((next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next })), []);
  const patchCadence = React.useCallback((next: Partial<CadenceUI>) => setDraft((current) => ({ ...current, cadence: { ...current.cadence, ...next } })), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const selectedAgent = agents.find((a) => a.id === draft.agentId) ?? agents[0] ?? null;
  const hasWhat = draft.mode === "prompt" ? draft.prompt.trim().length > 0 : draft.steps.some((s) => s.text.trim());
  const whatText = draft.mode === "steps"
    ? draft.steps.filter((s) => s.text.trim()).map((s) => s.text.trim()).join(" → ") || "run this automation"
    : draft.prompt.trim() || "run this automation";
  // Every attached skill across schedule-level + per-step, for the AEON gate.
  const allSkills = dedupe([...draft.skills, ...draft.steps.flatMap((s) => s.skills)]);

  const applyTemplate = (template: TaskTemplateDefinition) => {
    const tplSkills = dedupe((template.defaultAttachments ?? []).filter((a) => a.kind === "skill").map((a) => a.label));
    const tplPaths = dedupe((template.defaultAttachments ?? []).filter((a) => a.kind === "path").map((a) => a.label));
    const steps: StepDraft[] = template.defaultSteps.length ? template.defaultSteps.map((text) => ({ text, skills: [], paths: [] })) : [emptyStep()];
    // Steps-mode templates: hang the template's attachments under step 1 so they
    // render below a step. Prompt-mode templates keep them schedule-level.
    if (template.defaultMode === "steps" && (tplSkills.length || tplPaths.length) && steps[0]) {
      steps[0] = { ...steps[0], skills: tplSkills, paths: tplPaths };
    }
    patch({
      name: template.defaultTitle,
      mode: template.defaultMode,
      prompt: template.defaultPrompt,
      steps,
      skills: template.defaultMode === "steps" ? [] : tplSkills,
      paths: template.defaultMode === "steps" ? [] : tplPaths,
      cadence: cadenceFromTemplateKind(template.defaultCadenceKind),
    });
  };

  // Schedule-level path (prompt mode).
  const addPath = async () => {
    setOpenStepAtt(null);
    if (!onBrowseFolder) return;
    const chosen = await onBrowseFolder();
    if (!chosen) return;
    setDraft((cur) => (cur.paths.includes(chosen) ? cur : { ...cur, paths: [...cur.paths, chosen] }));
  };
  // Per-step path (steps mode) — browse then attach to that step, in a
  // functional update so an in-flight browse can't clobber other edits.
  const addPathToStep = async (stepIndex: number) => {
    setOpenStepAtt(null);
    if (!onBrowseFolder) return;
    const chosen = await onBrowseFolder();
    if (!chosen) return;
    setDraft((cur) => ({ ...cur, steps: cur.steps.map((s, i) => (i === stepIndex ? { ...s, paths: dedupe([...s.paths, chosen]) } : s)) }));
  };
  // Skill add routes to the anchor the picker was opened from.
  const addSkill = (slug: string) => {
    const target = skillPickerFor;
    setSkillPickerFor(null);
    if (target === "section") {
      setDraft((cur) => (cur.skills.includes(slug) ? cur : { ...cur, skills: [...cur.skills, slug] }));
    } else if (typeof target === "number") {
      setDraft((cur) => ({ ...cur, steps: cur.steps.map((s, i) => (i === target ? { ...s, skills: dedupe([...s.skills, slug]) } : s)) }));
    }
  };
  const removeSkill = (slug: string) => setDraft((cur) => ({ ...cur, skills: cur.skills.filter((s) => s !== slug) }));
  const removePath = (path: string) => setDraft((cur) => ({ ...cur, paths: cur.paths.filter((p) => p !== path) }));
  const removeStepSkill = (stepIndex: number, slug: string) => setDraft((cur) => ({ ...cur, steps: cur.steps.map((s, i) => (i === stepIndex ? { ...s, skills: s.skills.filter((x) => x !== slug) } : s)) }));
  const removeStepPath = (stepIndex: number, path: string) => setDraft((cur) => ({ ...cur, steps: cur.steps.map((s, i) => (i === stepIndex ? { ...s, paths: s.paths.filter((x) => x !== path) } : s)) }));

  const buildPayload = (): NewTaskPayload => {
    // Keep step text aligned with its attachments through the empty-step filter.
    const keptSteps = draft.steps.filter((s) => s.text.trim());
    return {
      title: draft.name.trim(),
      mode: draft.mode,
      steps: keptSteps.map((s) => s.text.trim()),
      stepAttachments: keptSteps.map((s) => ({ skills: dedupe(s.skills), paths: dedupe(s.paths) })),
      prompt: draft.prompt.trim(),
      attachments: [
        ...draft.skills.map((label) => ({ kind: "skill" as const, label })),
        ...draft.paths.map((label) => ({ kind: "path" as const, label })),
      ],
      cadence: cadenceToPayload(draft.cadence),
      target: { machine: draft.runOnAllMachines ? (selectedAgent?.machineLabel ?? "dashboard") : draft.machine, bee: selectedAgent?.name ?? "" },
      templateId: null,
      usePastRuns: draft.usePastRuns,
      pastRunLimit: draft.pastRunLimit,
      aeon: Boolean(aeon),
      runOnAllMachines: draft.runOnAllMachines,
    };
  };

  const stepValid = (index: number): string => {
    if (index === 0) {
      if (!hasWhat) return draft.mode === "prompt" ? "Describe what the automation should do." : "Add at least one step.";
      return "";
    }
    if (index === 1) {
      if (!aeon && !selectedAgent) return "Pick an agent to run this automation.";
      if (draft.cadence.kind === "weekdays" && draft.cadence.days.length === 0) return "Pick at least one weekday.";
      if (draft.cadence.kind === "cron" && !draft.cadence.cronExpr.trim()) return "Enter a cron expression.";
      return "";
    }
    if (aeon && allSkills.length === 0) return "An AEON automation needs one attached skill.";
    return "";
  };

  const goNext = async () => {
    const problem = stepValid(step);
    if (problem) { setError(problem); return; }
    setError("");
    if (step < 2) { setStep(step + 1); return; }
    setSaving(true);
    const result = await onSave(buildPayload());
    setSaving(false);
    if (typeof result === "string" && result) setError(result);
  };

  const modeButton = (mode: "prompt" | "steps", label: string) => (
    <button key={mode} type="button" aria-pressed={draft.mode === mode}
      className={`${styles.schedChip} ${draft.mode === mode ? styles.schedChipActive : ""}`}
      onClick={() => patch({ mode })}>{label}</button>
  );

  const nextLabel = step === 2 ? (editing ? "Save automation" : "Create automation") : "Next →";

  // Attachment chips (schedule-level skills + folder paths) — shown in both
  // prompt and steps mode so what's attached stays visible and removable.
  const attachmentChips = (draft.skills.length || draft.paths.length) ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {draft.skills.map((slug) => (
        <span key={`skill-${slug}`} className={styles.autoTag}>
          <span style={{ color: "var(--hex-active-border)", textTransform: "uppercase", fontSize: 8.5, letterSpacing: "0.08em" }}>skill</span>
          {skillOptions.find((o) => o.slug === slug)?.name ?? slug}
          <button type="button" aria-label={`Remove ${slug}`} onClick={() => removeSkill(slug)} style={tagX}><X size={11} aria-hidden /></button>
        </span>
      ))}
      {draft.paths.map((path) => (
        <span key={`path-${path}`} className={styles.autoTag}>
          <span style={{ color: "var(--hex-active-border)", textTransform: "uppercase", fontSize: 8.5, letterSpacing: "0.08em" }}>path</span>
          {path.length > 32 ? `…${path.slice(-32)}` : path}
          <button type="button" aria-label={`Remove ${path}`} onClick={() => removePath(path)} style={tagX}><X size={11} aria-hidden /></button>
        </span>
      ))}
    </div>
  ) : null;

  return createPortal(
    <>
      <div className={`${styles.autoOverlay} ${styles.autoTheme}`} onClick={onClose} role="presentation">
        <div className={`${styles.autoModal} ${styles.riseIn}`} role="dialog" aria-modal="true" aria-label={editing ? "Edit automation" : "New automation"} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <BeeIcon role="queen" size={40} />
            <div style={{ flex: 1 }}>
              <div className={styles.autoEyebrow}>{editing ? "Edit automation" : "New automation"}</div>
              <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 21, lineHeight: 1.1, marginTop: 3 }}>
                {aeon ? "Arm an AEON skill on a schedule" : "Tell the hive what to do"}
              </div>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} style={iconClose}><X size={14} aria-hidden /></button>
          </div>

          {/* Stepper */}
          <div className={styles.autoStepper}>
            {STEP_META.map((meta) => {
              const active = step === meta.n;
              const done = step > meta.n;
              return (
                <div key={meta.n} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: active ? "var(--hex-honey-border)" : done ? "var(--hex-active-border)" : "var(--muted)" }}>
                  <span className={styles.autoStepBadge} style={{
                    background: active ? "var(--auto-honey)" : done ? "rgba(111,205,186,0.2)" : "rgba(238,232,220,0.12)",
                    color: active ? "var(--auto-honey-ink)" : done ? "var(--hex-active-border)" : "var(--muted)",
                  }}>{meta.n + 1}</span>
                  {meta.label}
                </div>
              );
            })}
          </div>

          {/* Step 0 */}
          {step === 0 ? (
            <>
              <div className={styles.autoField}>
                <label className={styles.autoLabel}>Start from a template</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {TASK_TEMPLATES.slice(0, 5).map((template) => (
                    <button key={template.id} type="button"
                      className={`${styles.autoTplCard} ${draft.name === template.defaultTitle ? styles.autoTplCardActive : ""}`}
                      onClick={() => applyTemplate(template)}>
                      <span style={{ fontFamily: "var(--f-display)", fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>{template.label}</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--muted)" }}>{template.desc}</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => setTplBrowseOpen(true)} className={styles.autoTplCard} style={{ alignItems: "center", justifyContent: "center", borderStyle: "dashed", borderColor: "rgba(111,205,186,0.4)" }}>
                    <Search size={15} aria-hidden style={{ color: "var(--hex-active-border)" }} />
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--hex-active-border)", textAlign: "center", lineHeight: 1.2 }}>Browse all templates</span>
                  </button>
                </div>
              </div>

              <div className={styles.autoField}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <label className={styles.autoLabel}>What it does</label>
                  <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>{modeButton("prompt", "Prompt")}{modeButton("steps", "Steps")}</div>
                </div>
                {draft.mode === "prompt" ? (
                  <textarea value={draft.prompt} onChange={(e) => patch({ prompt: e.target.value })} rows={2}
                    placeholder="Describe the task in plain language. The bee will plan the steps itself."
                    className={`${styles.autoInput} ${styles.autoTextarea}`} />
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {draft.steps.map((stepDraft, index) => (
                      <div key={index} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 20, height: 20, flex: "0 0 auto", display: "inline-grid", placeItems: "center", borderRadius: 999, background: "color-mix(in srgb, var(--hex-honey-border) 16%, transparent)", color: "var(--hex-honey-border)", fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 700 }}>{index + 1}</span>
                          <input value={stepDraft.text} onChange={(e) => setDraft((cur) => ({ ...cur, steps: cur.steps.map((s, i) => (i === index ? { ...s, text: e.target.value } : s)) }))}
                            placeholder={`Step ${index + 1}`} className={styles.autoInput} style={{ fontSize: 13.5, padding: "9px 12px" }} />
                          <button type="button" aria-label={`Add attachment to step ${index + 1}`} title="Add attachment"
                            aria-expanded={openStepAtt === index}
                            onClick={(e) => { setSkillPickerFor(null); setSkillAnchor(e.currentTarget.getBoundingClientRect()); setOpenStepAtt((cur) => (cur === index ? null : index)); }}
                            style={{ ...miniGhost, color: openStepAtt === index || skillPickerFor === index ? "var(--hex-honey-border)" : "var(--muted)" }}>
                            <Paperclip size={13} aria-hidden />
                          </button>
                          {draft.steps.length > 1 ? (
                            <button type="button" aria-label={`Remove step ${index + 1}`} onClick={() => setDraft((cur) => ({ ...cur, steps: cur.steps.filter((_, i) => i !== index) }))} style={miniGhost}><X size={13} aria-hidden /></button>
                          ) : null}
                          {openStepAtt === index ? (
                            <div role="menu" style={{ position: "absolute", right: 30, top: 34, zIndex: 20, display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRadius: 10, border: "1px solid rgba(238,232,220,0.16)", background: "rgba(20,22,28,0.98)", boxShadow: "0 18px 44px rgba(0,0,0,0.5)", minWidth: 130 }}>
                              <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", padding: "3px 8px" }}>Attach to step {index + 1}</span>
                              <button type="button" role="menuitem" className={styles.autoMenuBtn} onClick={() => { setOpenStepAtt(null); setSkillPickerFor(index); }}>Skill</button>
                              {onBrowseFolder ? <button type="button" role="menuitem" className={styles.autoMenuBtn} onClick={() => void addPathToStep(index)}>Path</button> : null}
                            </div>
                          ) : null}
                          {skillPickerFor === index ? (
                            <SkillPicker options={skillOptions} selected={stepDraft.skills} anchor={skillAnchor} onAdd={addSkill} onClose={() => setSkillPickerFor(null)} />
                          ) : null}
                        </div>
                        {stepDraft.skills.length || stepDraft.paths.length ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 28 }}>
                            {stepDraft.skills.map((slug) => (
                              <span key={`s-${index}-${slug}`} className={styles.autoTag}>
                                <span style={{ color: "var(--hex-active-border)", textTransform: "uppercase", fontSize: 8.5, letterSpacing: "0.08em" }}>skill</span>
                                {skillOptions.find((o) => o.slug === slug)?.name ?? slug}
                                <button type="button" aria-label={`Remove ${slug} from step ${index + 1}`} onClick={() => removeStepSkill(index, slug)} style={tagX}><X size={11} aria-hidden /></button>
                              </span>
                            ))}
                            {stepDraft.paths.map((path) => (
                              <span key={`p-${index}-${path}`} className={styles.autoTag}>
                                <span style={{ color: "var(--hex-active-border)", textTransform: "uppercase", fontSize: 8.5, letterSpacing: "0.08em" }}>path</span>
                                {path.length > 32 ? `…${path.slice(-32)}` : path}
                                <button type="button" aria-label={`Remove ${path} from step ${index + 1}`} onClick={() => removeStepPath(index, path)} style={tagX}><X size={11} aria-hidden /></button>
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <button type="button" onClick={() => setDraft((cur) => ({ ...cur, steps: [...cur.steps, emptyStep()] }))} style={dashChipBtn}><Plus size={13} aria-hidden /> add step</button>
                    <p style={{ margin: "2px 0 0", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", lineHeight: 1.5 }}>The agent runs these steps in order, top to bottom, each time it fires. Use <Paperclip size={10} aria-hidden style={{ display: "inline", verticalAlign: "middle" }} /> to attach a skill or path to that step.</p>
                  </div>
                )}
              </div>

              {/* Attachments section — PROMPT mode only. In steps mode, attachments
                  live under each step (added via the per-step paperclip). */}
              {draft.mode === "prompt" ? (
                <div className={styles.autoField}>
                  <label className={styles.autoLabel}>Attachments{aeon ? " · a skill is required" : ""}</label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", position: "relative" }}>
                    <button type="button" onClick={(e) => { setSkillAnchor(e.currentTarget.getBoundingClientRect()); setSkillPickerFor((cur) => (cur === "section" ? null : "section")); }} style={attachBtn}><Plus size={12} aria-hidden /> Skill</button>
                    {onBrowseFolder ? <button type="button" onClick={() => void addPath()} style={attachBtn}><Plus size={12} aria-hidden /> Path</button> : null}
                    {skillPickerFor === "section" ? (
                      <SkillPicker options={skillOptions} selected={draft.skills} anchor={skillAnchor} onAdd={addSkill} onClose={() => setSkillPickerFor(null)} />
                    ) : null}
                  </div>
                  {attachmentChips}
                </div>
              ) : null}

              {/* Inject past runs */}
              <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 14px", borderRadius: 11, border: "1px solid rgba(238,232,220,0.14)", background: "var(--panel-bg-soft)" }}>
                <button type="button" role="switch" aria-checked={draft.usePastRuns} onClick={() => patch({ usePastRuns: !draft.usePastRuns })}
                  className={styles.autoSwitch} style={{ background: draft.usePastRuns ? "var(--status-ok)" : "rgba(238,232,220,0.22)" }}>
                  <span className={styles.autoSwitchKnob} style={{ left: draft.usePastRuns ? 19 : 3 }} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Inject past runs</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)" }}>Feed the agent its recent runs as context each time.</div>
                </div>
                {draft.usePastRuns ? (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)" }}>last</span>
                    <input type="number" min={1} max={12} value={draft.pastRunLimit}
                      onChange={(e) => patch({ pastRunLimit: clampInt(Number(e.target.value), 1, 12) })}
                      className={styles.autoInput} style={{ width: 56, fontFamily: "var(--f-mono)", padding: "7px 9px", fontSize: 13 }} />
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)" }}>runs</span>
                  </div>
                ) : null}
              </div>

              <div className={styles.autoField}>
                <label className={styles.autoLabel}>Name</label>
                <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Morning brief" className={styles.autoInput} />
              </div>
            </>
          ) : null}

          {/* Step 1 */}
          {step === 1 ? (
            <>
              {!aeon ? (
                <div className={styles.autoField}>
                  <label className={styles.autoLabel}>Which agent runs it</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    {agents.slice(0, 7).map((agent) => (
                      <button key={agent.id} type="button" onClick={() => patch({ agentId: agent.id, machine: agent.machineLabel })}
                        className={`${styles.autoCell} ${agent.id === draft.agentId ? styles.autoCellActive : ""}`}>
                        <BeeIcon role={agent.beeRole} workerClass={agent.workerClass} size={30} />
                        <span style={{ fontFamily: "var(--f-display)", fontSize: 11, fontWeight: 600, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", whiteSpace: "nowrap" }}>{agent.name}</span>
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{agent.cls}</span>
                      </button>
                    ))}
                    {agents.length > 7 ? (
                      <button type="button" onClick={() => setAgentPickerOpen(true)} className={styles.autoCell} style={{ borderStyle: "dashed", borderColor: "rgba(231,180,92,0.4)", justifyContent: "center" }}>
                        <Search size={15} aria-hidden style={{ color: "var(--hex-honey-border)" }} />
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 8.5, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--hex-honey-border)" }}>Browse…</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "12px 14px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--hex-honey-border) 28%, transparent)", background: "color-mix(in srgb, var(--hex-honey-border) 7%, transparent)" }}>
                  <BeeIcon role="queen" size={26} />
                  <span style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--muted)" }}>This automation runs on the <span style={{ color: "var(--foreground)" }}>AEON workspace</span> using the attached skill — no separate agent to choose.</span>
                </div>
              )}

              <div className={styles.autoField}>
                <label className={styles.autoLabel}>When it runs</label>
                <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  {([["interval", "Every N"], ["daily", "Daily at"], ["weekdays", "Weekdays"], ["ondemand", "On demand"], ["cron", "Advanced"]] as Array<[CadenceKind, string]>).map(([kind, label]) => (
                    <button key={kind} type="button" aria-pressed={draft.cadence.kind === kind}
                      className={`${styles.schedChip} ${draft.cadence.kind === kind ? styles.schedChipActive : ""}`}
                      onClick={() => patchCadence({ kind })}>{label}</button>
                  ))}
                </div>
                <div style={{ marginTop: 2 }}>
                  {draft.cadence.kind === "interval" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "var(--f-display)", fontSize: 13, color: "var(--muted)" }}>Every</span>
                      <input type="number" min={1} value={draft.cadence.everyN}
                        onChange={(e) => patchCadence({ everyN: clampInt(Number(e.target.value), 1, draft.cadence.everyUnit === "min" ? 59 : 24) })}
                        className={styles.autoInput} style={{ width: 72, fontFamily: "var(--f-mono)", padding: "8px 11px" }} />
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        {([["min", "min"], ["hour", "hr"]] as Array<["min" | "hour", string]>).map(([unit, label]) => (
                          <button key={unit} type="button" aria-pressed={draft.cadence.everyUnit === unit}
                            className={`${styles.schedChip} ${draft.cadence.everyUnit === unit ? styles.schedChipActive : ""}`}
                            onClick={() => patchCadence({ everyUnit: unit, everyN: clampInt(draft.cadence.everyN, 1, unit === "min" ? 59 : 24) })}>{label}</button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {draft.cadence.kind === "weekdays" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {WEEK.map((day) => (
                          <button key={day} type="button" aria-pressed={draft.cadence.days.includes(day)}
                            className={`${styles.schedChip} ${draft.cadence.days.includes(day) ? styles.schedChipActive : ""}`}
                            onClick={() => patchCadence({ days: draft.cadence.days.includes(day) ? draft.cadence.days.filter((d) => d !== day) : [...draft.cadence.days, day] })}>{day}</button>
                        ))}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Quick</span>
                        {([["Weekdays", ["Mon", "Tue", "Wed", "Thu", "Fri"]], ["Every day", [...WEEK]], ["Weekend", ["Sat", "Sun"]]] as Array<[string, string[]]>).map(([label, list]) => (
                          <button key={label} type="button" className={styles.schedChip} onClick={() => patchCadence({ days: [...list] })}>{label}</button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {draft.cadence.kind === "daily" || draft.cadence.kind === "weekdays" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: draft.cadence.kind === "weekdays" ? 4 : 0 }}>
                      <span style={{ fontFamily: "var(--f-display)", fontSize: 13, color: "var(--muted)" }}>At</span>
                      <input type="time" value={draft.cadence.time} onChange={(e) => patchCadence({ time: e.target.value })}
                        className={styles.autoInput} style={{ width: 140, fontFamily: "var(--f-mono)", padding: "8px 11px" }} />
                    </div>
                  ) : null}
                  {draft.cadence.kind === "cron" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <input value={draft.cadence.cronExpr} onChange={(e) => patchCadence({ cronExpr: e.target.value })}
                        placeholder="0 9 * * *" className={styles.autoInput} style={{ fontFamily: "var(--f-mono)", fontSize: 13 }} />
                      <p style={{ margin: 0, fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", lineHeight: 1.5 }}>Standard 5-field cron (min hour day month weekday). Runtime schedules use this expression verbatim.</p>
                    </div>
                  ) : null}
                  {draft.cadence.kind === "ondemand" ? (
                    <p style={{ margin: 0, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>Runs only when you trigger it — no background scheduler fires it automatically.</p>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {/* Step 2 */}
          {step === 2 ? (
            <>
              <div className={styles.autoField}>
                <label className={styles.autoLabel}>Where it runs</label>
                {!aeon ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 10, border: "1px solid rgba(238,232,220,0.16)", background: "var(--panel-bg-soft)" }}>
                    <BeeIcon role={selectedAgent?.beeRole} workerClass={selectedAgent?.workerClass} size={28} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600 }}>{draft.runOnAllMachines ? "Every machine" : (selectedAgent?.machineLabel ?? draft.machine)}</div>
                      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)" }}>{selectedAgent ? `${selectedAgent.name} · ${selectedAgent.runtimeLabel}` : "—"}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>Runs on the AEON workspace.</div>
                )}
                {!aeon ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 10, border: "1px solid rgba(238,232,220,0.14)", background: "var(--panel-bg-soft)" }}>
                    <button type="button" role="switch" aria-checked={draft.runOnAllMachines} onClick={() => patch({ runOnAllMachines: !draft.runOnAllMachines })}
                      className={styles.autoSwitch} style={{ background: draft.runOnAllMachines ? "var(--hex-honey-border)" : "rgba(238,232,220,0.22)" }}>
                      <span className={styles.autoSwitchKnob} style={{ left: draft.runOnAllMachines ? 19 : 3 }} />
                    </button>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Run on every machine</div>
                      <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)", lineHeight: 1.4 }}>Fan-out: mirror this cron onto each fleet machine. Leave off for a single machine.</div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ borderRadius: 12, border: "1px solid color-mix(in srgb, var(--hex-active-border) 30%, transparent)", background: "color-mix(in srgb, var(--hex-active-border) 6%, transparent)", padding: "13px 15px" }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--hex-active-border)", marginBottom: 5 }}>Preview</div>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 14.5, lineHeight: 1.5, color: "var(--foreground)" }}>
                  <strong style={{ color: "var(--hex-honey-border)" }}>{aeon ? "AEON" : (selectedAgent?.name ?? "An agent")}</strong> will {whatText}, <strong style={{ color: "var(--hex-active-border)" }}>{cadencePhrase(draft.cadence)}</strong>, on {draft.runOnAllMachines ? "every machine" : (aeon ? "the AEON workspace" : (selectedAgent?.machineLabel ?? draft.machine))}.
                </div>
              </div>
            </>
          ) : null}

          {error ? <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--status-failed)", lineHeight: 1.4 }}>{error}</div> : null}

          {/* Footer */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--auto-line)", paddingTop: 16 }}>
            <button type="button" onClick={onClose} style={footerGhost}>Cancel</button>
            <div style={{ display: "flex", gap: 10 }}>
              {step > 0 ? <button type="button" onClick={() => { setError(""); setStep(step - 1); }} style={footerGhost}>← Back</button> : null}
              <button type="button" onClick={() => void goNext()} disabled={saving} className={styles.honeyBtn} style={{ padding: "10px 22px", opacity: saving ? 0.7 : 1 }}>
                {saving ? <span className={styles.runSpinner} aria-hidden style={{ borderTopColor: "var(--auto-honey-ink)" }} /> : null}{nextLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      {tplBrowseOpen ? (
        <TemplateBrowseModal onPick={(template) => { applyTemplate(template); setTplBrowseOpen(false); }} onClose={() => setTplBrowseOpen(false)} />
      ) : null}
      {agentPickerOpen ? (
        <AgentPickerModal agents={agents} selectedId={draft.agentId} onPick={(agent) => { patch({ agentId: agent.id, machine: agent.machineLabel }); setAgentPickerOpen(false); }} onClose={() => setAgentPickerOpen(false)} />
      ) : null}
    </>,
    document.body,
  );
}

const SKILL_PICKER_W = 300;
const SKILL_PICKER_H = 280;

// Portaled to <body> with fixed positioning so it never clips inside the modal's
// scroll container. Positioned under its anchor button, flipping up / clamping to
// the viewport when it would overflow. A transparent backdrop closes it on click-away.
function SkillPicker({ options, selected, anchor, onAdd, onClose }: {
  options: AutomationSkillOption[]; selected: string[]; anchor: DOMRect | null; onAdd: (slug: string) => void; onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  if (typeof document === "undefined" || !anchor) return null;
  const needle = query.trim().toLowerCase();
  const filtered = options.filter((o) => !needle || `${o.name} ${o.slug} ${o.description ?? ""}`.toLowerCase().includes(needle));
  const flipUp = anchor.bottom + SKILL_PICKER_H + 8 > window.innerHeight && anchor.top - SKILL_PICKER_H - 8 > 0;
  const top = flipUp ? anchor.top - SKILL_PICKER_H - 6 : anchor.bottom + 6;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - SKILL_PICKER_W - 8));
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200 }} aria-hidden />
      <div role="dialog" aria-label="Add a skill" onClick={(e) => e.stopPropagation()} style={{
        position: "fixed", top, left, zIndex: 201, width: SKILL_PICKER_W, maxHeight: SKILL_PICKER_H, display: "flex", flexDirection: "column",
        borderRadius: 12, border: "1px solid rgba(238,232,220,0.22)", background: "linear-gradient(180deg, rgba(24,27,34,0.99), rgba(14,15,20,0.99))", boxShadow: "0 24px 60px rgba(0,0,0,0.6)", overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderBottom: "1px solid rgba(238,232,220,0.16)" }}>
          <Search size={13} aria-hidden style={{ color: "var(--muted)" }} />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: "var(--foreground)", fontFamily: "var(--f-display)", fontSize: 13 }} />
          {options.length ? <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--muted)", flex: "0 0 auto" }}>{filtered.length}/{options.length}</span> : null}
          <button type="button" aria-label="Close skill picker" onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-grid", placeItems: "center" }}><X size={13} aria-hidden /></button>
        </div>
        <div style={{ overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "10px 8px", fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--muted)" }}>{options.length ? "No skills match." : "No skills available for this runtime."}</div>
          ) : filtered.map((option) => {
            const on = selected.includes(option.slug);
            return (
              <button key={option.slug} type="button" onClick={() => onAdd(option.slug)} disabled={on} className={styles.autoMenuBtn} style={{ display: "flex", alignItems: "center", gap: 8, opacity: on ? 0.5 : 1 }}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.name}</span>
                  {option.description ? <span style={{ display: "block", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.description}</span> : null}
                </span>
                {on ? <Check size={13} aria-hidden style={{ color: "var(--hex-active-border)" }} /> : <Plus size={13} aria-hidden style={{ color: "var(--muted)" }} />}
              </button>
            );
          })}
        </div>
      </div>
    </>,
    document.body,
  );
}

function TemplateBrowseModal({ onPick, onClose }: { onPick: (template: TaskTemplateDefinition) => void; onClose: () => void }) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const filtered = TASK_TEMPLATES.filter((template) => !needle || taskTemplateSearchText(template).includes(needle));
  return (
    <div className={`${styles.autoOverlay} ${styles.autoTheme}`} style={{ zIndex: 120 }} onClick={onClose} role="presentation">
      <div className={`${styles.autoModal} ${styles.autoModalNarrow} ${styles.riseIn}`} role="dialog" aria-modal="true" aria-label="Template library" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px 12px" }}>
          <div style={{ flex: 1 }}>
            <div className={styles.autoEyebrow} style={{ color: "var(--hex-active-border)" }}>Template library</div>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 18, marginTop: 2 }}>Choose a template</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={iconClose}><X size={14} aria-hidden /></button>
        </div>
        <div style={{ padding: "0 20px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(238,232,220,0.18)", background: "var(--panel-bg-soft)" }}>
            <Search size={13} aria-hidden style={{ color: "var(--muted)" }} />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter templates" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: "var(--foreground)", fontFamily: "var(--f-display)", fontSize: 13 }} />
          </div>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)" }}>No templates match “{query}”.</div>
          ) : filtered.map((template) => (
            <button key={template.id} type="button" onClick={() => onPick(template)} style={{
              cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "11px 12px", borderRadius: 11,
              border: "1px solid rgba(238,232,220,0.12)", background: "var(--panel-bg-soft)", textAlign: "left",
            }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 13.5, fontWeight: 700, color: "var(--foreground)" }}>{template.label}</span>
                <span style={{ display: "block", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{template.section} · {template.desc}</span>
              </span>
              <Plus size={15} aria-hidden style={{ color: "var(--hex-active-border)", flex: "0 0 auto" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentPickerModal({ agents, selectedId, onPick, onClose }: { agents: AutomationAgentOption[]; selectedId: string; onPick: (agent: AutomationAgentOption) => void; onClose: () => void }) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const filtered = agents.filter((agent) => !needle || `${agent.name} ${agent.cls} ${agent.machineLabel} ${agent.runtimeLabel}`.toLowerCase().includes(needle));
  return (
    <div className={`${styles.autoOverlay} ${styles.autoTheme}`} style={{ zIndex: 110 }} onClick={onClose} role="presentation">
      <div className={`${styles.autoModal} ${styles.autoModalNarrow} ${styles.riseIn}`} role="dialog" aria-modal="true" aria-label="Choose an agent" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px 12px" }}>
          <div style={{ flex: 1 }}>
            <div className={styles.autoEyebrow}>Your agents</div>
            <div style={{ fontFamily: "var(--f-display)", fontWeight: 700, fontSize: 18, marginTop: 2 }}>Choose an agent</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={iconClose}><X size={14} aria-hidden /></button>
        </div>
        <div style={{ padding: "0 20px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(238,232,220,0.18)", background: "var(--panel-bg-soft)" }}>
            <Search size={13} aria-hidden style={{ color: "var(--muted)" }} />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, class, or machine" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", color: "var(--foreground)", fontFamily: "var(--f-display)", fontSize: 13.5 }} />
          </div>
        </div>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--muted)" }}>No agents match “{query}”.</div>
          ) : filtered.map((agent) => (
            <button key={agent.id} type="button" onClick={() => onPick(agent)} style={{
              cursor: "pointer", display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 11,
              border: `1px solid ${agent.id === selectedId ? "var(--hex-honey-border)" : "rgba(238,232,220,0.12)"}`,
              background: agent.id === selectedId ? "color-mix(in srgb, var(--hex-honey-border) 10%, transparent)" : "var(--panel-bg-soft)", textAlign: "left",
            }}>
              <BeeIcon role={agent.beeRole} workerClass={agent.workerClass} size={34} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontFamily: "var(--f-display)", fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{agent.name}</span>
                <span style={{ display: "block", fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{agent.cls} · {agent.machineLabel}</span>
              </span>
              {agent.id === selectedId ? <Check size={14} aria-hidden style={{ color: "var(--hex-honey-border)", flex: "0 0 auto" }} /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── shared inline styles ──
const iconClose: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(238,232,220,0.2)", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-grid", placeItems: "center" };
const footerGhost: React.CSSProperties = { padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(238,232,220,0.2)", background: "transparent", color: "var(--foreground)", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const attachBtn: React.CSSProperties = { cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(238,232,220,0.2)", background: "var(--panel-bg-soft)", color: "var(--foreground)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" };
const dashChipBtn: React.CSSProperties = { alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 9, border: "1px dashed color-mix(in srgb, var(--hex-honey-border) 45%, transparent)", background: "transparent", color: "var(--hex-honey-border)", fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer" };
const miniGhost: React.CSSProperties = { width: 26, height: 26, flex: "0 0 auto", border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-grid", placeItems: "center" };
const tagX: React.CSSProperties = { width: 18, height: 18, border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", display: "inline-grid", placeItems: "center" };

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, Film, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/design-system/ui/button";
import {
  HYPERFRAMES_ASPECT_PRESETS,
  HYPERFRAMES_NEGATIVE_PRESETS,
  HYPERFRAMES_TECHNIQUE_PRESETS,
  HYPERFRAMES_WORKFLOW_MATRIX,
  hyperframesRenderRequest,
  parseHyperframesPrompt,
  serializeHyperframesPrompt,
  validateHyperframesPrompt,
  type HyperframesAspectRatio,
  type HyperframesDecisionId,
  type HyperframesPromptDraft,
  type HyperframesWorkflowId,
} from "@/lib/services/chat/hyperframes-prompt";
import type { HyperframesRuntimeStatus } from "@/lib/services/hyperframes-runtime";
import styles from "./HyperframesPromptBuilder.module.css";

type SendPromptOptions = {
  visiblePrompt?: string;
  promptResponse?: { label: string; value?: string };
};

type Props = {
  sourceRequest: string;
  disabled?: boolean;
  sendPromptMessage?: (prompt: string, options?: SendPromptOptions) => void | Promise<void>;
};

type RuntimeResponse = {
  ok?: boolean;
  runtime?: HyperframesRuntimeStatus;
  error?: string;
};

function lines(value: string) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function formatTime(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function updateDecisionSource(draft: HyperframesPromptDraft, decision: HyperframesDecisionId) {
  return {
    ...draft.decisionSources,
    [decision]: "provided" as const,
  };
}

function statusTone(component: HyperframesRuntimeStatus["components"][number]) {
  return component.ready ? styles.ready : styles.missing;
}

export function HyperframesPromptBuilder({ disabled, sendPromptMessage, sourceRequest }: Props) {
  const [draft, setDraft] = useState<HyperframesPromptDraft>(() => parseHyperframesPrompt(sourceRequest));
  const [runtimeStatus, setRuntimeStatus] = useState<HyperframesRuntimeStatus | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState<"install" | "uninstall" | "status" | null>("status");
  const [runtimeError, setRuntimeError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const validation = useMemo(() => validateHyperframesPrompt(draft), [draft]);
  const finalPrompt = useMemo(() => serializeHyperframesPrompt(draft), [draft]);
  const workflow = HYPERFRAMES_WORKFLOW_MATRIX.find((entry) => entry.id === draft.workflowId)
    ?? HYPERFRAMES_WORKFLOW_MATRIX[0];

  async function refreshRuntime() {
    setRuntimeBusy("status");
    try {
      const response = await fetch("/api/hyperframes/runtime", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as RuntimeResponse;
      if (!response.ok || !payload.ok || !payload.runtime) throw new Error(payload.error || "Renderer status failed.");
      setRuntimeStatus(payload.runtime);
      setRuntimeError("");
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : "Renderer status failed.");
    } finally {
      setRuntimeBusy(null);
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void refreshRuntime(), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function changeRuntime(action: "install" | "uninstall") {
    setRuntimeBusy(action);
    setRuntimeError("");
    try {
      const response = await fetch("/api/hyperframes/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm: true }),
      });
      const payload = await response.json().catch(() => ({})) as RuntimeResponse;
      if (!response.ok || !payload.ok || !payload.runtime) throw new Error(payload.error || `Renderer ${action} failed.`);
      setRuntimeStatus(payload.runtime);
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : `Renderer ${action} failed.`);
    } finally {
      setRuntimeBusy(null);
    }
  }

  function chooseWorkflow(workflowId: HyperframesWorkflowId) {
    const next = HYPERFRAMES_WORKFLOW_MATRIX.find((entry) => entry.id === workflowId);
    if (!next) return;
    setDraft((current) => ({
      ...current,
      workflowId,
      decisionSources: updateDecisionSource(current, "route"),
    }));
  }

  function chooseAspectRatio(aspectRatio: HyperframesAspectRatio) {
    const preset = HYPERFRAMES_ASPECT_PRESETS.find((entry) => entry.id === aspectRatio);
    setDraft((current) => ({
      ...current,
      aspectRatio,
      dimensions: preset ? { width: preset.width, height: preset.height } : current.dimensions,
      decisionSources: updateDecisionSource(current, "spec"),
    }));
  }

  function addBeat() {
    setDraft((current) => {
      const startSeconds = current.beats.at(-1)?.endSeconds ?? 0;
      const endSeconds = Math.max(startSeconds + 1, current.durationSeconds);
      return {
        ...current,
        durationSeconds: Math.max(current.durationSeconds, endSeconds),
        beats: [...current.beats, {
          id: `beat-${Date.now()}`,
          startSeconds,
          endSeconds,
          description: "Describe what appears, moves, where it sits, how it looks, and when.",
        }],
        decisionSources: updateDecisionSource(current, "beats"),
      };
    });
  }

  const canRender = Boolean(
    sendPromptMessage
    && !disabled
    && validation.ready
    && runtimeStatus?.ready
    && !runtimeBusy,
  );

  return (
    <section className={styles.card} aria-label="HyperFrames video prompt builder">
      <header className={styles.hero}>
        <span className={styles.icon}><Film aria-hidden="true" /></span>
        <div>
          <p className={styles.eyebrow}>HyperFrames video</p>
          <h2>Turn the request into an editable motion brief</h2>
          <p>Six decisions become one production-ready message. Inferred choices stay editable before anything renders.</p>
        </div>
        <span className={styles.decisionScore}>{validation.explicitDecisionCount}/6 explicit</span>
      </header>

      <div className={styles.decisionGrid}>
        <section className={styles.decision}>
          <div className={styles.decisionHeading}><span>1</span><h3>Route</h3></div>
          <select value={draft.workflowId} onChange={(event) => chooseWorkflow(event.currentTarget.value as HyperframesWorkflowId)} disabled={disabled}>
            {HYPERFRAMES_WORKFLOW_MATRIX.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
          <p>{workflow.description}</p>
        </section>

        <section className={styles.decision}>
          <div className={styles.decisionHeading}><span>2</span><h3>Format</h3></div>
          <div className={styles.formatRow}>
            <label>
              <span>Duration</span>
              <span className={styles.numberField}>
                <input
                  type="number"
                  min="1"
                  max="3600"
                  step="1"
                  value={draft.durationSeconds}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    durationSeconds: Number(event.currentTarget.value),
                    decisionSources: updateDecisionSource(current, "spec"),
                  }))}
                  disabled={disabled}
                />
                <small>sec</small>
              </span>
            </label>
            <label>
              <span>Canvas</span>
              <select value={draft.aspectRatio} onChange={(event) => chooseAspectRatio(event.currentTarget.value as HyperframesAspectRatio)} disabled={disabled}>
                {HYPERFRAMES_ASPECT_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>
          <div className={styles.dimensionRow}>
            <input
              aria-label="Video width"
              type="number"
              min="1"
              value={draft.dimensions.width}
              onChange={(event) => setDraft((current) => ({
                ...current,
                aspectRatio: "custom",
                dimensions: { ...current.dimensions, width: Number(event.currentTarget.value) },
                decisionSources: updateDecisionSource(current, "spec"),
              }))}
              disabled={disabled}
            />
            <span>×</span>
            <input
              aria-label="Video height"
              type="number"
              min="1"
              value={draft.dimensions.height}
              onChange={(event) => setDraft((current) => ({
                ...current,
                aspectRatio: "custom",
                dimensions: { ...current.dimensions, height: Number(event.currentTarget.value) },
                decisionSources: updateDecisionSource(current, "spec"),
              }))}
              disabled={disabled}
            />
            <small>px</small>
          </div>
        </section>

        <section className={`${styles.decision} ${styles.fullWidth}`}>
          <div className={styles.decisionHeading}>
            <span>3</span><h3>Beats</h3>
            <Button type="button" variant="ghost" size="xs" onClick={addBeat} disabled={disabled}><Plus aria-hidden="true" />Add beat</Button>
          </div>
          <div className={styles.beatList}>
            {draft.beats.map((beat, index) => (
              <div className={styles.beat} key={beat.id}>
                <strong>Beat {index + 1}</strong>
                <label><span>From</span><input type="number" step="0.1" min="0" value={beat.startSeconds} onChange={(event) => setDraft((current) => ({
                  ...current,
                  beats: current.beats.map((entry) => entry.id === beat.id ? { ...entry, startSeconds: Number(event.currentTarget.value) } : entry),
                  decisionSources: updateDecisionSource(current, "beats"),
                }))} disabled={disabled} /></label>
                <label><span>To</span><input type="number" step="0.1" min="0" value={beat.endSeconds} onChange={(event) => setDraft((current) => ({
                  ...current,
                  beats: current.beats.map((entry) => entry.id === beat.id ? { ...entry, endSeconds: Number(event.currentTarget.value) } : entry),
                  decisionSources: updateDecisionSource(current, "beats"),
                }))} disabled={disabled} /></label>
                <textarea
                  aria-label={`Beat ${index + 1} description`}
                  value={beat.description}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    beats: current.beats.map((entry) => entry.id === beat.id ? { ...entry, description: event.currentTarget.value } : entry),
                    decisionSources: updateDecisionSource(current, "beats"),
                  }))}
                  disabled={disabled}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove beat ${index + 1}`} onClick={() => setDraft((current) => ({
                  ...current,
                  beats: current.beats.filter((entry) => entry.id !== beat.id),
                  decisionSources: updateDecisionSource(current, "beats"),
                }))} disabled={disabled || draft.beats.length === 1}><Trash2 aria-hidden="true" /></Button>
              </div>
            ))}
          </div>
          <p className={styles.timelineSummary}>Timeline: {draft.beats.map((beat) => `${formatTime(beat.startSeconds)}–${formatTime(beat.endSeconds)}s`).join(" · ")}</p>
        </section>

        <section className={styles.decision}>
          <div className={styles.decisionHeading}><span>4</span><h3>Copy</h3></div>
          <textarea
            value={draft.copy.join("\n")}
            placeholder={'One exact line per row, e.g. Projects'}
            onChange={(event) => setDraft((current) => ({ ...current, copy: lines(event.currentTarget.value), decisionSources: updateDecisionSource(current, "copy") }))}
            disabled={disabled}
          />
          <p>Every line is quoted exactly in the final prompt.</p>
        </section>

        <section className={styles.decision}>
          <div className={styles.decisionHeading}><span>5</span><h3>Motion</h3></div>
          <div className={styles.chips}>
            {HYPERFRAMES_TECHNIQUE_PRESETS.slice(0, 6).map((technique) => {
              const selected = draft.techniques.includes(technique);
              return <button type="button" key={technique} data-selected={selected} onClick={() => setDraft((current) => ({
                ...current,
                techniques: selected ? current.techniques.filter((entry) => entry !== technique) : [...current.techniques, technique],
                decisionSources: updateDecisionSource(current, "technique"),
              }))} disabled={disabled}>{selected ? <Check aria-hidden="true" /> : null}{technique}</button>;
            })}
          </div>
          <textarea value={draft.techniques.join("\n")} aria-label="Motion techniques" onChange={(event) => setDraft((current) => ({ ...current, techniques: lines(event.currentTarget.value), decisionSources: updateDecisionSource(current, "technique") }))} disabled={disabled} />
        </section>

        <section className={styles.decision}>
          <div className={styles.decisionHeading}><span>6</span><h3>Exclude</h3></div>
          <div className={styles.chips}>
            {HYPERFRAMES_NEGATIVE_PRESETS.map((negative) => {
              const selected = draft.negatives.includes(negative);
              return <button type="button" key={negative} data-selected={selected} onClick={() => setDraft((current) => ({
                ...current,
                negatives: selected ? current.negatives.filter((entry) => entry !== negative) : [...current.negatives, negative],
                decisionSources: updateDecisionSource(current, "negatives"),
              }))} disabled={disabled}>{selected ? <Check aria-hidden="true" /> : null}{negative}</button>;
            })}
          </div>
          <textarea value={draft.negatives.join("\n")} aria-label="Things to exclude" onChange={(event) => setDraft((current) => ({ ...current, negatives: lines(event.currentTarget.value), decisionSources: updateDecisionSource(current, "negatives") }))} disabled={disabled} />
        </section>
      </div>

      <section className={styles.promptPreview}>
        <div><span>Final message</span><small>{finalPrompt.length} characters</small></div>
        <p>{finalPrompt}</p>
      </section>

      {validation.errors.length ? (
        <div className={styles.validation} role="alert">
          <CircleAlert aria-hidden="true" />
          <div><strong>Fix the timeline before rendering</strong>{validation.errors.map((error) => <p key={`${error.code}-${error.beatId ?? "prompt"}`}>{error.message}</p>)}</div>
        </div>
      ) : null}

      <section className={styles.runtime} data-ready={runtimeStatus?.ready ? "true" : "false"}>
        <button className={styles.runtimeSummary} type="button" onClick={() => setSetupOpen((open) => !open)} aria-expanded={setupOpen}>
          <span className={styles.runtimeIcon}>{runtimeStatus?.ready ? <ShieldCheck aria-hidden="true" /> : <Film aria-hidden="true" />}</span>
          <span>
            <strong>{runtimeStatus?.ready ? "Pinned renderer ready" : runtimeBusy === "status" ? "Checking renderer" : "Renderer setup needed"}</strong>
            <small>{runtimeStatus?.ready ? `HyperFrames ${runtimeStatus.expectedVersion} · FFmpeg ready · telemetry off` : "Open setup to review prerequisites and provenance."}</small>
          </span>
          <ChevronDown aria-hidden="true" data-open={setupOpen} />
        </button>
        {setupOpen ? (
          <div className={styles.runtimeDetail}>
            {runtimeStatus?.components.map((component) => (
              <div key={component.id} className={statusTone(component)}>
                {component.ready ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
                <span><strong>{component.label}{component.version ? ` · ${component.version}` : ""}</strong><small>{component.detail}</small></span>
              </div>
            ))}
            <p className={styles.provenance}>Installs only audited <code>hyperframes@{runtimeStatus?.expectedVersion ?? "0.7.17"}</code> into HivemindOS-managed tools. The lockfile is integrity-pinned, automatic updates and telemetry are disabled, and app/shared credentials are not passed to setup.</p>
            {runtimeError ? <p className={styles.runtimeError}>{runtimeError}</p> : null}
            <div className={styles.runtimeActions}>
              {!runtimeStatus?.installed ? (
                <Button type="button" onClick={() => void changeRuntime("install")} isLoading={runtimeBusy === "install"} disabled={Boolean(runtimeBusy)}>Install pinned renderer</Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void changeRuntime("uninstall")} isLoading={runtimeBusy === "uninstall"} disabled={Boolean(runtimeBusy)}>Remove renderer</Button>
              )}
              <Button type="button" variant="ghost" onClick={() => void refreshRuntime()} disabled={Boolean(runtimeBusy)}>Check again</Button>
            </div>
          </div>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <p>{runtimeStatus?.ready ? "The click below authorizes the local build, checks, and final render." : "Complete renderer setup before sending the production brief."}</p>
        <Button
          type="button"
          size="lg"
          disabled={!canRender}
          onClick={() => void sendPromptMessage?.(hyperframesRenderRequest(finalPrompt), {
            visiblePrompt: finalPrompt,
            promptResponse: { label: "Sent to HyperFrames", value: finalPrompt },
          })}
        >
          <Film aria-hidden="true" />Render with HyperFrames
        </Button>
      </footer>
    </section>
  );
}

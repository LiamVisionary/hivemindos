"use client";

import React from "react";
import { Panel, SectionLabel, Spinner, Skeleton, SkeletonText } from "./primitives";
import type { CapabilityPromotionDraft } from "@/lib/services/capability-promotion";
import type { FusionSkillResult } from "@/lib/services/fusion/fusion-skill";

type LabSummary = {
  id: string;
  title: string;
  status: string;
  objective: string;
  metricName?: string;
  metricDirection: "increase" | "decrease";
  baselineScore?: number;
  bestScore?: number;
  frontier: Array<{ id: string; title: string; score: number; deltaFromBest: number }>;
  totals: { boardEntries: number; lineageNodes: number; rulings: number; integrityAlerts: number; antiPatterns: number };
};

type LabRecord = {
  challenge: {
    id: string;
    title: string;
    objective: string;
    metricName?: string;
    board: Array<{ id: string; type: string; body: string; createdAt: string }>;
    playbook: { levers: string[]; antiPatterns: string[]; openQuestions: string[] };
  };
  summary: LabSummary;
  promotion: CapabilityPromotionDraft;
};

const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--bg-2)", color: "var(--fg)", padding: "8px 10px", fontSize: 12, outline: "none" };

function ActionButton({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: disabled ? "not-allowed" : "pointer", borderRadius: 8, padding: "7px 11px", border: `1px solid ${primary ? "var(--honey-line)" : "var(--line-2)"}`, background: primary ? "var(--btn-bg)" : "transparent", color: primary ? "var(--btn-fg)" : "var(--fg-2)", fontFamily: "var(--f-display)", fontSize: 11.5, fontWeight: 700, opacity: disabled ? 0.55 : 1 }}>{children}</button>;
}

type LabFusionResponse = {
  ok?: boolean;
  error?: string;
  fusion?: FusionSkillResult;
  receiptRecorded?: boolean;
};

function PromotionCard({ challengeId, promotion }: { challengeId: string; promotion: CapabilityPromotionDraft }) {
  const [preview, setPreview] = React.useState<FusionSkillResult | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [publishedPath, setPublishedPath] = React.useState("");
  const [receiptRecorded, setReceiptRecorded] = React.useState<boolean | null>(null);
  const [fusionError, setFusionError] = React.useState("");
  const tone = promotion.stage === "reviewable" ? "var(--live)" : promotion.stage === "candidate" ? "var(--honey)" : "var(--fg-4)";

  const requestFusion = async (action: "fusion-preview" | "fusion-publish") => {
    const isPublish = action === "fusion-publish";
    if (isPublish) setPublishing(true); else setPreviewing(true);
    setFusionError("");
    if (!isPublish) {
      setPublishedPath("");
      setReceiptRecorded(null);
      setConfirmed(false);
    }
    try {
      const response = await fetch("/api/hivemind-labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, challengeId, confirmed: isPublish ? confirmed : undefined, expectedDraftHash: isPublish ? preview?.draftHash : undefined }),
      });
      const data = await response.json().catch(() => null) as LabFusionResponse | null;
      if (!response.ok || !data?.ok || !data.fusion) throw new Error(data?.error || "Hive Skill Fusion could not prepare this Lab method.");
      setPreview(data.fusion);
      if (isPublish) {
        setPublishedPath(data.fusion.skill.path);
        setReceiptRecorded(data.receiptRecorded !== false);
        setConfirmed(false);
      }
    } catch (cause) {
      setFusionError(cause instanceof Error ? cause.message : "Hive Skill Fusion could not prepare this Lab method.");
    } finally {
      if (isPublish) setPublishing(false); else setPreviewing(false);
    }
  };

  const usedCapabilities = preview?.capabilities.filter((capability) => capability.used) ?? [];
  return (
    <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 10, padding: 11, background: "var(--bg-2)" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--f-display)", fontSize: 12.5 }}>Capability promotion</strong>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: tone, textTransform: "uppercase" }}>{promotion.stage}</span>
        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{promotion.skillSlug}</span>
      </div>
      <div style={{ marginTop: 5, fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.45 }}>{promotion.summary}</div>
      {promotion.blockers.length ? (
        <ul style={{ margin: "8px 0 0", paddingLeft: 17, color: "var(--fg-4)", fontSize: 10.5, lineHeight: 1.5 }}>{promotion.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
      ) : (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--live)" }}>Evidence is ready for human review.</span>
          <ActionButton primary onClick={() => void requestFusion("fusion-preview")} disabled={previewing || publishing}>
            {previewing ? <><Spinner size={11} /> Building preview</> : preview ? "Rebuild fused skill preview" : "Preview fused skill"}
          </ActionButton>
        </div>
      )}
      <div style={{ marginTop: 8, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>Publishing is never automatic.</div>
      {fusionError ? <div style={{ marginTop: 9, color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{fusionError}</div> : null}
      {preview ? (
        <div style={{ marginTop: 12, border: "1px solid var(--honey-line)", borderRadius: 10, padding: 12, background: "var(--honey-soft)" }}>
          <SectionLabel>Hive Skill Fusion · review draft</SectionLabel>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontFamily: "var(--f-display)", fontSize: 15 }}>{preview.skill.name}</strong>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--honey)", textTransform: "uppercase" }}>{preview.change.mode}</span>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{preview.skill.slug}</span>
          </div>
          <div style={{ marginTop: 7, color: "var(--fg-3)", fontSize: 11.5, lineHeight: 1.5 }}>{preview.skill.description}</div>
          <div style={{ marginTop: 9, display: "flex", gap: 10, flexWrap: "wrap", fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
            <span>{preview.fusedCount} selected capabilities</span>
            <span>+{preview.change.addedLines} lines</span>
            <span>−{preview.change.removedLines} lines</span>
            <span>{preview.change.unchangedLines} unchanged</span>
          </div>
          {preview.change.existingPath ? <div style={{ marginTop: 7, color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 9.5, overflowWrap: "anywhere" }}>Existing skill: {preview.change.existingPath}</div> : null}
          {preview.change.warnings.map((warning) => <div key={warning} style={{ marginTop: 7, color: "var(--honey)", fontSize: 10.5, lineHeight: 1.45 }}>{warning}</div>)}
          {usedCapabilities.length ? (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {usedCapabilities.map((capability) => <span key={capability.id} style={{ border: "1px solid var(--line-2)", borderRadius: 999, padding: "3px 7px", background: "var(--bg-2)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 9.5 }}>{capability.label}</span>)}
            </div>
          ) : null}
          <details style={{ marginTop: 11, borderTop: "1px solid var(--line)", paddingTop: 9 }}>
            <summary style={{ cursor: "pointer", color: "var(--fg-2)", fontFamily: "var(--f-display)", fontSize: 11.5, fontWeight: 650 }}>Review generated SKILL.md</summary>
            <pre style={{ margin: "10px 0 0", padding: 10, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg)", color: "var(--fg-3)", fontFamily: "var(--f-mono)", fontSize: 9.5, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.markdown}</pre>
          </details>
          {publishedPath ? (
            <div style={{ marginTop: 11, border: "1px solid color-mix(in srgb, var(--live) 35%, transparent)", borderRadius: 8, padding: 9, color: "var(--live)", fontSize: 10.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
              Shared skill written to {publishedPath}.{receiptRecorded === false ? " The skill was written, but the Lab receipt could not be recorded." : " The Lab promotion receipt was recorded."}
            </div>
          ) : (
            <div style={{ marginTop: 11, display: "grid", gap: 9 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--fg-3)", fontSize: 10.5, lineHeight: 1.45 }}>
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={publishing} style={{ marginTop: 2 }} />
                <span>I reviewed the generated skill, selected capabilities, evaluation evidence, failure modes, and replacement impact. Publish this draft to the shared brain.</span>
              </label>
              <div><ActionButton primary onClick={() => void requestFusion("fusion-publish")} disabled={!confirmed || publishing || preview.change.mode === "unchanged"}>{publishing ? <><Spinner size={11} /> Publishing</> : preview.change.mode === "unchanged" ? "Shared skill already matches" : "Fuse into shared skill"}</ActionButton></div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResultForm({ lab, onSaved }: { lab: LabRecord; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [score, setScore] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [verifier, setVerifier] = React.useState("");
  const [operatingLever, setOperatingLever] = React.useState("");
  const [failureMode, setFailureMode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hivemind-labs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "record-result",
          challengeId: lab.challenge.id,
          title,
          score: Number(score),
          metricName: lab.summary.metricName,
          evidence: evidence.split("\n").map((item) => item.trim()).filter(Boolean),
          verifierName: verifier.trim() || undefined,
          operatingLever: operatingLever.trim() || undefined,
          failureMode: failureMode.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not record the result.");
      setOpen(false);
      setTitle(""); setScore(""); setEvidence(""); setVerifier(""); setOperatingLever(""); setFailureMode("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the result.");
    } finally {
      setBusy(false);
    }
  };
  if (!open) return <ActionButton onClick={() => setOpen(true)}>Record measured result</ActionButton>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--line)", borderRadius: 10, padding: 11, background: "var(--bg-2)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8 }}>
        <input aria-label="Result title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What was tested" style={inputStyle} />
        <input aria-label="Result score" type="number" value={score} onChange={(event) => setScore(event.target.value)} placeholder="Score" style={inputStyle} />
      </div>
      <textarea aria-label="Result evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="One evidence item per line" style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} />
      <input aria-label="Verifier name" value={verifier} onChange={(event) => setVerifier(event.target.value)} placeholder="Verifier name (required for promotion readiness)" style={inputStyle} />
      <input aria-label="Reusable operating lever" value={operatingLever} onChange={(event) => setOperatingLever(event.target.value)} placeholder="Reusable operating lever (required for promotion readiness)" style={inputStyle} />
      <input aria-label="Observed failure mode" value={failureMode} onChange={(event) => setFailureMode(event.target.value)} placeholder="Observed failure mode or anti-pattern (optional)" style={inputStyle} />
      {error ? <div style={{ color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{error}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}><ActionButton onClick={() => setOpen(false)} disabled={busy}>Cancel</ActionButton><ActionButton primary onClick={() => void save()} disabled={busy || !title.trim() || !score.trim()}>{busy ? <><Spinner size={11} /> Saving</> : "Save result"}</ActionButton></div>
    </div>
  );
}

export function HivemindLabsPanel({ companyId, companyName, objective, metricName }: { companyId: string; companyName: string; objective: string; metricName?: string }) {
  const [labs, setLabs] = React.useState<LabRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/hivemind-labs?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; labs?: LabRecord[] } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load Labs.");
      setLabs(Array.isArray(data.labs) ? data.labs : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Labs.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);
  React.useEffect(() => {
    let cancelled = false;
    void fetch(`/api/hivemind-labs?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; labs?: LabRecord[] } | null;
        if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not load Labs.");
        if (!cancelled) setLabs(Array.isArray(data.labs) ? data.labs : []);
      })
      .catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Labs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [companyId]);

  const create = async () => {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/hivemind-labs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", companyId, title: `${companyName} · outcome lab`, objective, metricName }) });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not create the Lab.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the Lab.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <Panel><div role="status" aria-label="Loading Hivemind Labs" style={{ display: "grid", gap: 12 }}><Skeleton width="34%" height={18} /><SkeletonText lines={3} /><Skeleton height={120} /></div></Panel>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Panel>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><SectionLabel>hivemind labs · outcome discovery</SectionLabel><div style={{ fontFamily: "var(--f-display)", fontSize: 19, fontWeight: 600 }}>Turn hypotheses into measured, reusable capability.</div><div style={{ marginTop: 6, color: "var(--fg-3)", fontSize: 12.5, lineHeight: 1.5 }}>Labs reuse Agent Challenges: public-within-the-hive candidates, evidence, verifier rulings, Pareto frontiers, and a reviewed promotion path into skills.</div></div>
          <ActionButton primary onClick={() => void create()} disabled={creating}>{creating ? <><Spinner size={11} /> Creating</> : "Create outcome lab"}</ActionButton>
        </div>
        {error ? <div style={{ marginTop: 10, color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>{error}</div> : null}
      </Panel>
      {!labs.length ? <Panel><div style={{ color: "var(--fg-3)", fontSize: 12.5 }}>No Labs yet. Create one to establish a baseline, compare experiments, and accumulate verified capability.</div></Panel> : labs.map((lab) => (
        <Panel key={lab.challenge.id}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240 }}><SectionLabel>{lab.summary.status} · {lab.summary.metricName ?? "metric"}</SectionLabel><div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 600 }}>{lab.challenge.title}</div><div style={{ marginTop: 5, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.5 }}>{lab.challenge.objective}</div></div>
            <div style={{ display: "flex", gap: 14, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}><span>{lab.summary.totals.lineageNodes} results</span><span>{lab.summary.frontier.length} frontier</span><span>{lab.summary.totals.rulings} rulings</span></div>
          </div>
          {lab.summary.frontier.length ? <div style={{ marginTop: 12, display: "grid", gap: 7 }}>{lab.summary.frontier.map((item) => <div key={item.id} style={{ display: "flex", gap: 9, alignItems: "baseline", border: "1px solid var(--honey-line)", borderRadius: 9, background: "var(--honey-soft)", padding: "8px 10px" }}><strong style={{ color: "var(--honey)", fontFamily: "var(--f-display)" }}>{item.score}</strong><span style={{ color: "var(--fg-2)", fontSize: 11.5 }}>{item.title}</span></div>)}</div> : null}
          {lab.challenge.playbook.levers.length || lab.challenge.playbook.antiPatterns.length ? (
            <div style={{ marginTop: 11, display: "grid", gap: 6, color: "var(--fg-3)", fontSize: 10.5, lineHeight: 1.45 }}>
              {lab.challenge.playbook.levers.map((lever) => <div key={`lever:${lever}`}><strong style={{ color: "var(--live)" }}>Lever:</strong> {lever}</div>)}
              {lab.challenge.playbook.antiPatterns.map((antiPattern) => <div key={`anti:${antiPattern}`}><strong style={{ color: "var(--honey)" }}>Avoid:</strong> {antiPattern}</div>)}
            </div>
          ) : null}
          <div style={{ marginTop: 12 }}><ResultForm lab={lab} onSaved={() => void refresh()} /></div>
          <PromotionCard challengeId={lab.challenge.id} promotion={lab.promotion} />
        </Panel>
      ))}
    </div>
  );
}

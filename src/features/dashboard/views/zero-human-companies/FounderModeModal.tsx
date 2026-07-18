"use client";

import React from "react";
import { Modal } from "./Modals";
import { SectionLabel, Spinner } from "./primitives";
import type { PoolAgent, Theme } from "./types";
import type { FounderBlueprint, FounderBudgetTier, FounderConstraints, FounderPace, FounderPrivacyMode } from "@/lib/types/founder-blueprint";

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--line-2)",
  borderRadius: 10,
  background: "var(--panel-2)",
  color: "var(--fg)",
  fontFamily: "var(--f-body)",
  fontSize: 14,
  padding: "10px 12px",
  outline: "none",
};

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="mono-cap" style={{ color: "var(--fg-4)" }}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={fieldStyle}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Button({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
        borderRadius: 9, padding: "8px 14px", cursor: disabled ? "not-allowed" : "pointer",
        border: `1px solid ${primary ? "var(--honey-line)" : "var(--line-2)"}`,
        background: primary ? "var(--btn-bg)" : "transparent",
        color: primary ? "var(--btn-fg)" : "var(--fg-2)",
        fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 700, opacity: disabled ? 0.55 : 1,
      }}
    >{children}</button>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)", padding: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

function StatusChip({ label, tone = "var(--fg-3)" }: { label: string; tone?: string }) {
  return <span style={{ border: "1px solid var(--line-2)", borderRadius: 999, padding: "3px 8px", fontFamily: "var(--f-mono)", fontSize: 10, color: tone }}>{label}</span>;
}

type FounderTemplateCard = {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  sector: string;
  goalSeed: string;
  budgetTier: string;
  productCount: number;
  skillCount: number;
  setupKeyCount: number;
  requiredSetupKeys: string[];
  hostedRails: Array<{ serviceId: string; label: string }>;
};

export function FounderModeModal({ agentPool, theme, onClose, onCreated }: {
  agentPool: PoolAgent[];
  theme: Theme;
  onClose: () => void;
  onCreated: (companyId: string) => void | Promise<void>;
}) {
  const [goal, setGoal] = React.useState("");
  const [constraints, setConstraints] = React.useState<FounderConstraints>({ privacy: "private-first", budgetTier: "local-free", pace: "week" });
  const [blueprint, setBlueprint] = React.useState<FounderBlueprint | null>(null);
  const [busy, setBusy] = React.useState<"compile" | "found" | null>(null);
  const [error, setError] = React.useState("");
  const [templates, setTemplates] = React.useState<FounderTemplateCard[]>([]);
  const [templateId, setTemplateId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/founder", { cache: "no-store" })
      .then((response) => response.json().catch(() => null))
      .then((data: { ok?: boolean; templates?: FounderTemplateCard[] } | null) => {
        if (!cancelled && data?.ok && Array.isArray(data.templates)) setTemplates(data.templates);
      })
      .catch(() => {
        // Templates are an accelerator, not a dependency — the free-form goal path stays.
      });
    return () => { cancelled = true; };
  }, []);

  const pickTemplate = React.useCallback((card: FounderTemplateCard | null) => {
    setTemplateId(card?.id ?? null);
    if (card) {
      const tierOk = card.budgetTier === "local-free" || card.budgetTier === "starter" || card.budgetTier === "growth" || card.budgetTier === "scale";
      setGoal((current) => (current.trim() ? current : card.goalSeed));
      if (tierOk) setConstraints((current) => ({ ...current, budgetTier: card.budgetTier as FounderBudgetTier }));
    }
  }, []);

  const request = React.useCallback(async (action: "compile" | "found") => {
    setBusy(action);
    setError("");
    try {
      let machines: unknown[] = [];
      try {
        const fleet = await fetch("/api/fleet/discover?fresh=0&includeSnapshots=0", { cache: "no-store" });
        const fleetJson = await fleet.json().catch(() => null) as { machines?: unknown[] } | null;
        if (Array.isArray(fleetJson?.machines)) machines = fleetJson.machines;
      } catch {
        // Fleet is optional; the compiler keeps hosted and marketplace fallbacks.
      }
      const response = await fetch("/api/founder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, goal, constraints, machines, templateId: templateId ?? undefined, agentIds: agentPool.map((agent) => agent.id) }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string; blueprint?: FounderBlueprint; company?: { id?: string } } | null;
      if (!response.ok || !data?.ok || !data.blueprint) throw new Error(data?.error || "Founder Mode could not prepare the blueprint.");
      setBlueprint(data.blueprint);
      if (action === "found" && data.company?.id) await onCreated(data.company.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Founder Mode request failed.");
    } finally {
      setBusy(null);
    }
  }, [agentPool, constraints, goal, onCreated]);

  const footer = blueprint ? (
    <>
      <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>Founding creates the company and its first private Lab. It does not launch autonomous work.</span>
      <Button onClick={() => setBlueprint(null)} disabled={Boolean(busy)}>Back</Button>
      <Button primary onClick={() => void request("found")} disabled={Boolean(busy)}>{busy === "found" ? <><Spinner size={12} /> Founding</> : "Found this company"}</Button>
    </>
  ) : (
    <>
      <span style={{ flex: 1, fontFamily: "var(--f-mono)", fontSize: 10.5, color: "var(--fg-4)" }}>Blueprint generation is read-only. You review everything before a company is created.</span>
      <Button onClick={onClose} disabled={Boolean(busy)}>Cancel</Button>
      <Button primary onClick={() => void request("compile")} disabled={goal.trim().length < 12 || Boolean(busy)}>{busy === "compile" ? <><Spinner size={12} /> Compiling</> : "Compile company blueprint"}</Button>
    </>
  );

  return (
    <Modal title="Founder Mode" subtitle="Turn one outcome into a private, governed AI company" onClose={onClose} width={blueprint ? 980 : 720} theme={theme} footer={footer}>
      {!blueprint ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {templates.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <span className="mono-cap" style={{ color: "var(--fg-4)" }}>start from a template (optional)</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {templates.map((card) => {
                  const selected = templateId === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => pickTemplate(selected ? null : card)}
                      style={{
                        textAlign: "left", cursor: "pointer", borderRadius: 10, padding: "10px 11px",
                        border: `1px solid ${selected ? "var(--honey-line)" : "var(--line)"}`,
                        background: selected ? "var(--honey-soft)" : "var(--panel-2)",
                        display: "flex", flexDirection: "column", gap: 4,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ fontSize: 16 }}>{card.emoji}</span>
                        <strong style={{ fontFamily: "var(--f-display)", fontSize: 12.5, color: "var(--fg)" }}>{card.name}</strong>
                      </span>
                      <span style={{ fontSize: 11, lineHeight: 1.4, color: "var(--fg-3)" }}>{card.tagline}</span>
                      <span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>
                        {card.skillCount} skills · {card.productCount ? `${card.productCount} products · ` : ""}{card.setupKeyCount ? `${card.setupKeyCount} setup keys` : "no keys needed"}
                        {card.hostedRails.length ? ` · hosted: ${card.hostedRails.map((rail) => rail.label).join(", ")}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span className="mono-cap" style={{ color: "var(--honey)" }}>what do you want to make happen?</span>
            <textarea
              autoFocus
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Example: Build a local-business website agency that reaches $10k MRR with reviewable previews and human-approved outreach."
              style={{ ...fieldStyle, minHeight: 120, resize: "vertical", lineHeight: 1.55 }}
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <SelectField label="Privacy" value={constraints.privacy} onChange={(privacy) => setConstraints((current) => ({ ...current, privacy: privacy as FounderPrivacyMode }))} options={[
              { value: "private-first", label: "Private first" },
              { value: "balanced", label: "Balanced routing" },
              { value: "cloud-ok", label: "Cloud allowed" },
            ]} />
            <SelectField label="First milestone budget" value={constraints.budgetTier} onChange={(budgetTier) => setConstraints((current) => ({ ...current, budgetTier: budgetTier as FounderBudgetTier }))} options={[
              { value: "local-free", label: "Owned compute only" },
              { value: "starter", label: "Up to $10" },
              { value: "growth", label: "Up to $50" },
              { value: "scale", label: "Up to $200" },
            ]} />
            <SelectField label="Pace" value={constraints.pace} onChange={(pace) => setConstraints((current) => ({ ...current, pace: pace as FounderPace }))} options={[
              { value: "today", label: "First result today" },
              { value: "week", label: "First result this week" },
              { value: "month", label: "First result this month" },
            ]} />
          </div>
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 13, background: "var(--bg-2)", fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-3)" }}>
            Founder Mode discovers the available crew, capabilities, and compute routes; proposes budgets and approval boundaries; creates an evidence-driven first milestone; and leaves launch under your control.
          </div>
          {error ? <div style={{ color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 11 }}>{error}</div> : null}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div className="mono-cap" style={{ color: "var(--honey)" }}>{blueprint.archetype}{blueprint.templateId ? ` · ${templates.find((card) => card.id === blueprint.templateId)?.name ?? blueprint.templateId}` : ""}</div>
              <h2 style={{ margin: "5px 0 3px", fontFamily: "var(--f-display)", fontSize: 25, color: "var(--fg)" }}>{blueprint.identity.name}</h2>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--fg-3)" }}>{blueprint.identity.blurb}</div>
            </div>
            <StatusChip label={`${blueprint.identity.ticker} · ${blueprint.identity.sector}`} tone="var(--honey)" />
            <StatusChip label={`$${blueprint.budget.firstMilestoneUsd} first milestone`} />
            <StatusChip label={blueprint.constraints.privacy} />
          </div>
          <ReviewCard title="apex goal · first milestone">
            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 600, lineHeight: 1.35 }}>{blueprint.apexGoal.title}</div>
            <div style={{ marginTop: 7, fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>{blueprint.apexGoal.metric} → {blueprint.apexGoal.target}</div>
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--fg-2)" }}>{blueprint.firstMilestone.title}</div>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--fg-3)", fontSize: 12, lineHeight: 1.55 }}>{blueprint.firstMilestone.successCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
          </ReviewCard>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <ReviewCard title={`crew · ${blueprint.crew.length} roles`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{blueprint.crew.map((role) => (
                <div key={role.role} style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 9, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                  <strong style={{ fontFamily: "var(--f-display)", fontSize: 12, color: "var(--honey)" }}>{role.role}</strong>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", lineHeight: 1.45 }}><span style={{ color: role.candidateAgentName ? "var(--fg)" : "var(--danger-2)" }}>{role.candidateAgentName ?? "Needs an agent"}</span> · {role.responsibility}</div>
                </div>
              ))}</div>
            </ReviewCard>
            <ReviewCard title="compute · outcome routes">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{blueprint.computeRoutes.map((route) => (
                <div key={route.id} style={{ border: `1px solid ${route.recommended ? "var(--honey-line)" : "var(--line)"}`, borderRadius: 9, padding: 9, background: route.recommended ? "var(--honey-soft)" : "var(--bg-2)" }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}><strong style={{ fontSize: 12 }}>{route.label}</strong>{route.recommended ? <StatusChip label="recommended" tone="var(--honey)" /> : null}<span style={{ fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>{route.estimatedCost}</span></div>
                  <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.45, color: "var(--fg-3)" }}>{route.rationale}</div>
                </div>
              ))}</div>
            </ReviewCard>
          </div>
          <ReviewCard title="capabilities · readiness & approval gates">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>{blueprint.capabilities.map((capability) => (
              <div key={capability.intent} style={{ border: "1px solid var(--line)", borderRadius: 9, padding: 9 }}>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}><strong style={{ fontSize: 12 }}>{capability.label}</strong><StatusChip label={capability.readiness} tone={capability.readiness === "missing" ? "var(--danger-2)" : capability.readiness === "ready" ? "var(--live)" : "var(--honey)"} />{capability.approvalRequired ? <StatusChip label="approval gated" /> : null}</div>
                {capability.requiredCredentialKeys.length ? <div style={{ marginTop: 5, fontFamily: "var(--f-mono)", fontSize: 9.5, color: "var(--fg-4)" }}>credentials: {capability.requiredCredentialKeys.join(", ")}</div> : null}
              </div>
            ))}</div>
          </ReviewCard>
          <ReviewCard title="proof pack · required before trusted completion">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{blueprint.proofRequirements.map((item) => <StatusChip key={item} label={item} />)}</div>
          </ReviewCard>
          {error ? <div style={{ color: "var(--danger-2)", fontFamily: "var(--f-mono)", fontSize: 11 }}>{error}</div> : null}
        </div>
      )}
    </Modal>
  );
}

"use client";

import React from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge, GitBranch, Lightbulb, Network, RefreshCw, Route, Save, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

import type {
  CompanyFrontierLabPolicy,
  CompanyFrontierLabStage,
  CompanyFrontierLabTaskTier,
} from "@/lib/types/company";
import { Panel, Skeleton, Spinner } from "./primitives";
import styles from "./frontier-lab.module.css";

type Snapshot = {
  monthlyTokenLimit: number;
  settledTokens: number;
  estimatedTokens: number;
  reservedTokens: number;
  remainingTokens: number;
  activeReservations: number;
  settledTasks: number;
  completedTasks: number;
  blockedTasks: number;
  failedTasks: number;
  successRate: number;
  byTier: Record<CompanyFrontierLabTaskTier, { settledTokens: number; reservedTokens: number; tasks: number }>;
  recent: Array<{
    id: string;
    taskId: string;
    tier: CompanyFrontierLabTaskTier;
    model: string;
    status: "reserved" | "settled" | "released";
    usage?: { totalTokens: number };
    reservedTokens: number;
    outcome?: "completed" | "blocked" | "failed";
    estimated?: boolean;
    createdAt: string;
  }>;
  periodStart: string;
};

type Stage = {
  stage: CompanyFrontierLabStage;
  label: string;
  maxParallelTasks: number;
  maxTasksPerCycle: number;
  maxPerMachineConcurrency: number;
  requiredSettledTasks: number;
  requiredSuccessRate: number;
  transition: {
    allowed: boolean;
    reason?: string;
    observedSuccessRate: number;
  };
};

type Payload = {
  ok: boolean;
  error?: string;
  policy: CompanyFrontierLabPolicy;
  defaults: CompanyFrontierLabPolicy;
  snapshot: Snapshot;
  capacity: {
    availableSlots: number;
    stageSlots: number;
    workerSlots: number;
    affordableSlots: number;
    remainingTokens: number;
    blockedReason?: string;
  };
  stages: Stage[];
  readiness: { openAiOAuthConfigured: boolean; nativeHierarchicalExecution: boolean; independentReviewerStaffed: boolean };
  earnedScale: {
    scaleCurve: {
      recommendation: "scale" | "hold" | "reduce" | "collect-evidence";
      confidence: "insufficient" | "directional" | "comparative";
      score: number;
      baselineRuns: number;
      treatmentRuns: number;
      baselineStage?: CompanyFrontierLabStage;
      treatmentStage: CompanyFrontierLabStage;
      reasons: string[];
      evidenceGaps: string[];
      automaticAction: false;
      dimensions: Array<{
        key: "outcome" | "proof" | "latency" | "tokens" | "uniqueContribution" | "duplicationConflict" | "humanIntervention" | "reviewerDisagreement";
        label: string;
        baseline?: number;
        treatment?: number;
        delta?: number;
        direction: "increase" | "decrease";
        status: "improved" | "steady" | "regressed" | "missing";
      }>;
    };
    allocator: {
      mode: "adaptive-local-first" | "frontier-oauth";
      evidenceSamples: number;
      lanes: Array<{ tier: CompanyFrontierLabTaskTier; route: string; intent: string }>;
      checkpoints: Array<{ id: "plan" | "mid-run" | "final-review"; trigger: string; action: string }>;
      escalationTriggers: string[];
    };
    blackboard: {
      activeChallenges: number;
      boardEntries: number;
      lineageNodes: number;
      integrityAlerts: number;
      contributors: number;
      challenges: Array<{ id: string; title: string; objective: string; bestScore?: number; metricName?: string; frontierResults: number; boardEntries: number; contributors: number }>;
    };
    delight: {
      proposals: Array<{ id: string; skillSlug: string; kind: "skill" | "schedule" | "company"; title: string; reason: string; successCount: number; successRate: number; averageScore?: number; scope: "company" | "workspace"; reviewRequired: true }>;
      analyzedEvents: number;
      autoApply: false;
    };
  };
};

const MONTHLY_PRESETS = [1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000];
const TASK_PRESETS = [50_000, 100_000, 250_000, 500_000, 1_000_000];
const TIER_COPY: Record<CompanyFrontierLabTaskTier, { label: string; detail: string }> = {
  scout: { label: "Scout", detail: "Research, triage, planning, and routine synthesis" },
  builder: { label: "Builder", detail: "Implementation, operations, design, and deployment" },
  reviewer: { label: "Reviewer", detail: "Independent QA, evaluation, security, and audit gates" },
};

function tokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString("en-US", { maximumFractionDigits: 0 })}K`;
  return value.toLocaleString("en-US");
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function scaleValue(key: Payload["earnedScale"]["scaleCurve"]["dimensions"][number]["key"], value: number | undefined): string {
  if (value === undefined) return "—";
  if (key === "latency") return value >= 1_000 ? `${(value / 1_000).toFixed(1)}s` : `${Math.round(value)}ms`;
  if (key === "tokens") return tokens(value);
  return `${Math.round(value * 100)}%`;
}

function recommendationLabel(value: Payload["earnedScale"]["scaleCurve"]["recommendation"]): string {
  return value === "collect-evidence" ? "Collect evidence" : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

async function responsePayload(response: Response): Promise<Payload> {
  const payload = await response.json().catch(() => ({})) as Partial<Payload>;
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Frontier Lab request failed.");
  return payload as Payload;
}

export function FrontierLabPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [payload, setPayload] = React.useState<Payload | null>(null);
  const [draft, setDraft] = React.useState<CompanyFrontierLabPolicy | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await responsePayload(await fetch(`/api/companies/${encodeURIComponent(companyId)}/frontier-lab`, { cache: "no-store" }));
      setPayload(next);
      setDraft(next.policy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Frontier Lab.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  React.useEffect(() => {
    let cancelled = false;
    void fetch(`/api/companies/${encodeURIComponent(companyId)}/frontier-lab`, { cache: "no-store" })
      .then(responsePayload)
      .then((next) => {
        if (cancelled) return;
        setPayload(next);
        setDraft(next.policy);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load Frontier Lab.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyId]);

  const update = <K extends keyof CompanyFrontierLabPolicy>(key: K, value: CompanyFrontierLabPolicy[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice("");
  };

  const chooseStage = (stage: Stage) => {
    if (!stage.transition.allowed) return;
    setDraft((current) => current ? {
      ...current,
      stage: stage.stage,
      maxParallelTasks: stage.maxParallelTasks,
      maxTasksPerCycle: stage.maxTasksPerCycle,
      perMachineConcurrency: stage.maxPerMachineConcurrency,
    } : current);
    setNotice("");
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const next = await responsePayload(await fetch(`/api/companies/${encodeURIComponent(companyId)}/frontier-lab`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }));
      setPayload(next);
      setDraft(next.policy);
      setNotice("Frontier Lab policy saved and enforced on new company work.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Frontier Lab.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.stack} aria-label="Loading Frontier Lab">
        <Skeleton height={170} radius={16} />
        <div className={styles.metrics}>{[0, 1, 2, 3].map((key) => <Skeleton key={key} height={102} radius={12} />)}</div>
        <Skeleton height={280} radius={16} />
      </div>
    );
  }

  if (!payload || !draft) {
    return (
      <Panel>
        <div className={styles.empty}>
          <AlertTriangle size={20} />
          <span>{error || "Frontier Lab is unavailable."}</span>
          <button type="button" className={styles.ghostButton} onClick={() => void load()}><RefreshCw size={14} /> Retry</button>
        </div>
      </Panel>
    );
  }

  const usedPct = Math.min(100, (payload.snapshot.settledTokens + payload.snapshot.reservedTokens) / Math.max(1, draft.monthlyTokenLimit) * 100);
  const dirty = JSON.stringify(draft) !== JSON.stringify(payload.policy);

  return (
    <div className={styles.stack}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroBody}>
          <div className={styles.eyebrow}><Sparkles size={13} /> governed intelligence utility</div>
          <div className={styles.heroRow}>
            <div>
              <h2>Frontier Lab</h2>
              <p>Give HivemindOS a goal. It assembles, budgets, runs, and verifies {companyName}&apos;s team—then earns more scale only when the measured outcome improves.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled}
              className={`${styles.switch} ${draft.enabled ? styles.switchOn : ""}`}
              onClick={() => update("enabled", !draft.enabled)}
            >
              <span />{draft.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <div className={styles.trustRow}>
            <span className={payload.readiness.openAiOAuthConfigured ? styles.goodBadge : styles.warnBadge}>
              {payload.readiness.openAiOAuthConfigured ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              OpenAI OAuth {payload.readiness.openAiOAuthConfigured ? "connected" : "required"}
            </span>
            <span className={payload.readiness.nativeHierarchicalExecution ? styles.goodBadge : styles.warnBadge}>
              <ShieldCheck size={13} /> native hierarchical execution
            </span>
            <span className={payload.readiness.independentReviewerStaffed ? styles.goodBadge : styles.warnBadge}>
              <ShieldCheck size={13} /> independent reviewer {payload.readiness.independentReviewerStaffed ? "staffed" : "required"}
            </span>
            <span className={styles.neutralBadge}>No OpenRouter fallback</span>
          </div>
        </div>
      </section>

      {!payload.readiness.openAiOAuthConfigured && draft.enabled ? (
        <div className={styles.warning}><AlertTriangle size={16} /> Connect OpenAI OAuth before saving. Frontier Lab fails closed instead of using a metered API-key or OpenRouter provider.</div>
      ) : null}
      {!payload.readiness.nativeHierarchicalExecution ? (
        <div className={styles.warning}><AlertTriangle size={16} /> Switch this company to native hierarchical Hivemind execution before enabling Frontier Lab so every task is attributable and budgeted.</div>
      ) : null}
      {!payload.readiness.independentReviewerStaffed && draft.enabled ? (
        <div className={styles.warning}><AlertTriangle size={16} /> Staff at least two distinct company agent identities before saving so a worker never reviews its own result.</div>
      ) : null}
      {error ? <div className={styles.error}><AlertTriangle size={16} /> {error}</div> : null}
      {notice ? <div className={styles.notice}><CheckCircle2 size={16} /> {notice}</div> : null}

      <div className={styles.metrics}>
        <Metric icon={<Activity size={16} />} label="Settled this month" value={tokens(payload.snapshot.settledTokens)} detail={payload.snapshot.estimatedTokens ? `${tokens(payload.snapshot.estimatedTokens)} conservatively estimated` : "collector-reported usage"} />
        <Metric icon={<Gauge size={16} />} label="Reserved now" value={tokens(payload.snapshot.reservedTokens)} detail={`${payload.snapshot.activeReservations} active task reservation${payload.snapshot.activeReservations === 1 ? "" : "s"}`} />
        <Metric icon={<Sparkles size={16} />} label="Budgeted slots" value={`${payload.capacity.availableSlots}`} detail="online routing is rechecked at dispatch" />
        <Metric icon={<ShieldCheck size={16} />} label="Settled success" value={`${Math.round(payload.snapshot.successRate * 100)}%`} detail={`${payload.snapshot.completedTasks} complete · ${payload.snapshot.blockedTasks + payload.snapshot.failedTasks} blocked/failed`} />
      </div>

      <Panel>
        <div className={styles.panelHeader}>
          <div>
            <h3>Scale this goal</h3>
            <p>The Scale Curve compares the smaller operating condition with the treatment across outcome, proof, speed, token use, unique contribution, coordination debt, human intervention, and reviewer disagreement.</p>
          </div>
          <span className={`${styles.recommendation} ${styles[`recommendation_${payload.earnedScale.scaleCurve.recommendation.replace("-", "_")}`]}`}>
            <TrendingUp size={13} /> {recommendationLabel(payload.earnedScale.scaleCurve.recommendation)}
          </span>
        </div>
        <div className={styles.scaleSummary}>
          <div><small>Baseline{payload.earnedScale.scaleCurve.baselineStage ? ` · ${payload.earnedScale.scaleCurve.baselineStage}` : " · prior stage"}</small><strong>{payload.earnedScale.scaleCurve.baselineRuns}/3</strong></div>
          <GitBranch size={18} />
          <div><small>Treatment · {payload.earnedScale.scaleCurve.treatmentStage}</small><strong>{payload.earnedScale.scaleCurve.treatmentRuns}/3</strong></div>
          <div><small>Weighted curve</small><strong>{payload.earnedScale.scaleCurve.score >= 0 ? "+" : ""}{Math.round(payload.earnedScale.scaleCurve.score * 100)} pts</strong></div>
          <div><small>Confidence</small><strong>{payload.earnedScale.scaleCurve.confidence}</strong></div>
        </div>
        <div className={styles.curveGrid}>
          {payload.earnedScale.scaleCurve.dimensions.map((dimension) => (
            <div className={`${styles.curveCard} ${styles[`curve_${dimension.status}`]}`} key={dimension.key}>
              <span>{dimension.label}</span>
              <div><small>before</small><strong>{scaleValue(dimension.key, dimension.baseline)}</strong></div>
              <div><small>after</small><strong>{scaleValue(dimension.key, dimension.treatment)}</strong></div>
              <em>{dimension.status === "missing" ? "needs measurement" : dimension.status}</em>
            </div>
          ))}
        </div>
        <div className={styles.scaleReason}>
          <ShieldCheck size={15} />
          <div>
            {payload.earnedScale.scaleCurve.reasons.map((reason) => <p key={reason}>{reason}</p>)}
            {payload.earnedScale.scaleCurve.evidenceGaps.length ? <small>Still needed: {payload.earnedScale.scaleCurve.evidenceGaps.join(" · ")}.</small> : <small>A positive Team curve is required before Frontier expansion; policy and spend never change automatically, and every existing OAuth, token, capacity, and independent-review gate still applies.</small>}
          </div>
        </div>
      </Panel>

      <div className={styles.insightGrid}>
        <Panel>
          <div className={styles.panelHeader}>
            <div><h3>Outcome-aware allocator</h3><p>Spend intelligence where it changes the result, with explicit judgment checkpoints before more work or scale.</p></div>
            <Route size={17} className={styles.headerIcon} />
          </div>
          <div className={styles.laneList}>
            {payload.earnedScale.allocator.lanes.map((lane) => (
              <div className={styles.lane} key={lane.tier}>
                <span>{TIER_COPY[lane.tier].label}</span><strong>{lane.route}</strong><p>{lane.intent}</p>
              </div>
            ))}
          </div>
          <div className={styles.checkpointList}>
            {payload.earnedScale.allocator.checkpoints.map((checkpoint, index) => (
              <div className={styles.checkpoint} key={checkpoint.id}><i>{index + 1}</i><div><strong>{checkpoint.id.replace("-", " ")}</strong><span>{checkpoint.trigger}</span><p>{checkpoint.action}</p></div></div>
            ))}
          </div>
          <small className={styles.sourceNote}>{payload.earnedScale.allocator.evidenceSamples} local outcome-routing sample{payload.earnedScale.allocator.evidenceSamples === 1 ? "" : "s"}; Frontier Lab never substitutes its fixed OAuth ladder.</small>
        </Panel>

        <Panel>
          <div className={styles.panelHeader}>
            <div><h3>Live swarm blackboard</h3><p>Agent Challenges is the shared surface for candidates, findings, runs, results, rulings, integrity alerts, and reusable playbooks.</p></div>
            <Network size={17} className={styles.headerIcon} />
          </div>
          <div className={styles.blackboardStats}>
            <div><strong>{payload.earnedScale.blackboard.activeChallenges}</strong><small>active</small></div>
            <div><strong>{payload.earnedScale.blackboard.boardEntries}</strong><small>entries</small></div>
            <div><strong>{payload.earnedScale.blackboard.lineageNodes}</strong><small>results</small></div>
            <div><strong>{payload.earnedScale.blackboard.contributors}</strong><small>contributors</small></div>
          </div>
          {payload.earnedScale.blackboard.challenges.length ? <div className={styles.challengeList}>{payload.earnedScale.blackboard.challenges.map((challenge) => (
            <div className={styles.challenge} key={challenge.id}>
              <div><strong>{challenge.title}</strong><span>{challenge.objective}</span></div>
              <small>{challenge.frontierResults} frontier · {challenge.boardEntries} entries{challenge.bestScore === undefined ? "" : ` · best ${challenge.bestScore}${challenge.metricName ? ` ${challenge.metricName}` : ""}`}</small>
            </div>
          ))}</div> : <div className={styles.compactEmpty}>No active Agent Challenge yet. Hivemind Labs creates the shared board without opening a second coordination system.</div>}
        </Panel>
      </div>

      <Panel>
        <div className={styles.panelHeader}>
          <div><h3>Delight Miner</h3><p>Repeated, evidence-backed successes become review-gated proposals for a stronger skill, a schedule, or a standing company capability. Nothing auto-applies.</p></div>
          <span className={styles.neutralBadge}><Lightbulb size={13} /> {payload.earnedScale.delight.analyzedEvents} events analyzed</span>
        </div>
        {payload.earnedScale.delight.proposals.length ? <div className={styles.delightGrid}>{payload.earnedScale.delight.proposals.map((proposal) => (
          <div className={styles.delightCard} key={proposal.id}>
            <span>{proposal.kind} proposal · {proposal.scope}</span>
            <strong>{proposal.title}</strong>
            <p>{proposal.reason}</p>
            <small>{proposal.successCount} successes · {Math.round(proposal.successRate * 100)}% accepted{proposal.averageScore === undefined ? "" : ` · ${Math.round(proposal.averageScore * 100)}% avg score`} · review required</small>
          </div>
        ))}</div> : <div className={styles.compactEmpty}>No delight proposal has cleared the three-run, 80%-success evidence floor yet.</div>}
      </Panel>

      <Panel>
        <div className={styles.panelHeader}>
          <div>
            <h3>Monthly intelligence budget</h3>
            <p>Internal token control budget—not a dollar-cost estimate. Active work reserves capacity before inference; actual collector usage settles afterward.</p>
          </div>
          <span className={styles.period}>since {new Date(payload.snapshot.periodStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} UTC</span>
        </div>
        <div className={styles.budgetLine}>
          <span>{tokens(payload.snapshot.settledTokens)} settled + {tokens(payload.snapshot.reservedTokens)} reserved</span>
          <strong>{tokens(Math.max(0, draft.monthlyTokenLimit - payload.snapshot.settledTokens - payload.snapshot.reservedTokens))} remaining</strong>
        </div>
        <div className={styles.progress}><span style={{ width: `${usedPct}%` }} /></div>
        <div className={styles.controlGrid}>
          <SelectControl label="Monthly ceiling" value={draft.monthlyTokenLimit} values={MONTHLY_PRESETS} onChange={(value) => update("monthlyTokenLimit", value)} />
          <SelectControl label="Reservation per task" value={draft.perTaskTokenLimit} values={TASK_PRESETS.filter((value) => value <= draft.monthlyTokenLimit)} onChange={(value) => update("perTaskTokenLimit", value)} />
          <SelectControl label="Parallel tasks" value={draft.maxParallelTasks} values={Array.from({ length: payload.stages.find((item) => item.stage === draft.stage)?.maxParallelTasks ?? 1 }, (_, index) => index + 1)} onChange={(value) => update("maxParallelTasks", value)} format={(value) => String(value)} />
          <SelectControl label="Tasks per cycle" value={draft.maxTasksPerCycle} values={Array.from({ length: payload.stages.find((item) => item.stage === draft.stage)?.maxTasksPerCycle ?? 1 }, (_, index) => index + 1)} onChange={(value) => update("maxTasksPerCycle", value)} format={(value) => String(value)} />
          <SelectControl label="Turns per machine" value={draft.perMachineConcurrency} values={Array.from({ length: payload.stages.find((item) => item.stage === draft.stage)?.maxPerMachineConcurrency ?? 1 }, (_, index) => index + 1)} onChange={(value) => update("perMachineConcurrency", value)} format={(value) => String(value)} />
          <label className={styles.checkControl}>
            <input type="checkbox" checked={draft.elasticWorkers} onChange={(event) => update("elasticWorkers", event.target.checked)} />
            <span><strong>Elastic worker slots</strong><small>Reuse online company identities across bounded task slots.</small></span>
          </label>
        </div>
      </Panel>

      <Panel>
        <div className={styles.panelHeader}>
          <div>
            <h3>Earned scale gates</h3>
            <p>Scale up only after settled outcomes prove the smaller stage. Scale down is always available.</p>
          </div>
          <span className={styles.period}>{payload.snapshot.settledTasks} settled task{payload.snapshot.settledTasks === 1 ? "" : "s"}</span>
        </div>
        <div className={styles.stageGrid}>
          {payload.stages.map((stage) => {
            const selected = draft.stage === stage.stage;
            return (
              <button
                type="button"
                key={stage.stage}
                className={`${styles.stageCard} ${selected ? styles.stageSelected : ""}`}
                disabled={!stage.transition.allowed}
                onClick={() => chooseStage(stage)}
                title={stage.transition.reason}
              >
                <span className={styles.stageTop}><strong>{stage.label}</strong>{selected ? <CheckCircle2 size={15} /> : null}</span>
                <span>{stage.maxParallelTasks} parallel · {stage.maxTasksPerCycle}/cycle · {stage.maxPerMachineConcurrency}/machine</span>
                <small>{stage.requiredSettledTasks === 0 ? "Safe starting stage" : `${stage.requiredSettledTasks} settled at ${Math.round(stage.requiredSuccessRate * 100)}% success`}</small>
                {!stage.transition.allowed ? <em>Locked · {stage.transition.reason}</em> : null}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <div className={styles.panelHeader}>
          <div><h3>Reviewed OAuth model ladder</h3><p>The provider and models are immutable in Frontier Lab policy, so hand-edited records cannot silently route to an expensive provider.</p></div>
          <span className={styles.goodBadge}><ShieldCheck size={13} /> openai-codex</span>
        </div>
        <div className={styles.modelGrid}>
          {(["scout", "builder", "reviewer"] as const).map((tier) => (
            <div key={tier} className={styles.modelCard}>
              <span>{TIER_COPY[tier].label}</span>
              <strong>{draft.models[tier]}</strong>
              <small>{TIER_COPY[tier].detail}</small>
              <div className={styles.tierBar}><i style={{ width: tier === "scout" ? "34%" : tier === "builder" ? "68%" : "100%" }} /></div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className={styles.panelHeader}>
          <div><h3>Recent intelligence settlements</h3><p>Task-scoped reservations and outcomes from the current UTC month.</p></div>
          <button type="button" className={styles.ghostButton} onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        </div>
        {payload.snapshot.recent.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Task</th><th>Tier / model</th><th>Status</th><th>Tokens</th><th>Time</th></tr></thead>
              <tbody>{payload.snapshot.recent.slice(0, 12).map((event) => (
                <tr key={event.id}>
                  <td><code>{event.taskId}</code></td>
                  <td><span>{TIER_COPY[event.tier].label}</span><small>{event.model}</small></td>
                  <td><span className={event.outcome === "completed" ? styles.statusGood : event.status === "reserved" ? styles.statusLive : styles.statusWarn}>{event.outcome ?? event.status}</span></td>
                  <td>
                    {event.status === "released" ? "0" : tokens(event.usage?.totalTokens ?? event.reservedTokens)}
                    {event.status === "released" ? <small>{tokens(event.reservedTokens)} released</small> : event.estimated ? <small>estimated</small> : null}
                  </td>
                  <td>{dateTime(event.createdAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className={styles.empty}>No reservations yet. Launch native company work after enabling Frontier Lab.</div>}
      </Panel>

      <div className={styles.saveBar}>
        <div><strong>{dirty ? "Unsaved policy changes" : "Policy is saved"}</strong><span>{payload.capacity.blockedReason ?? "New tasks will reserve tokens before inference."}</span></div>
        <button type="button" className={styles.saveButton} onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Spinner size={14} /> : <Save size={14} />}{saving ? "Saving" : "Save Frontier Lab"}
        </button>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className={styles.metric}><span className={styles.metricIcon}>{icon}</span><small>{label}</small><strong>{value}</strong><p>{detail}</p></div>;
}

function SelectControl({ label, value, values, onChange, format = tokens }: { label: string; value: number; values: number[]; onChange: (value: number) => void; format?: (value: number) => string }) {
  const options = values.includes(value) ? values : [...values, value].sort((a, b) => a - b);
  return (
    <label className={styles.selectControl}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => <option key={option} value={option}>{format(option)}</option>)}
      </select>
    </label>
  );
}

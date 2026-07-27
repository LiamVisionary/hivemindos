"use client";

import { useCallback, useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { Activity, Beaker, Check, Eye, FileText, GitBranch, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, X } from "lucide-react";

import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type { BrainReviewProposal } from "@/lib/types/brain-review";
import type { ContextXrayManifest, ContextXraySource } from "@/lib/types/context-xray";
import type { HarnessExperimentRecord } from "@/lib/types/harness-experiments";
import type { VisualArtifact, VisualArtifactBlock } from "@/lib/types/visual-artifacts";

type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type AgentNativeInsightsPanelProps = {
  Button: ElementType;
  active: boolean;
  fleetClass: ClassNameBuilder;
  formatRelativeTime: (timestamp: number) => string;
  sharedVault: SharedVaultConfig;
  vaultClass: ClassNameBuilder;
};

type BrainReviewListResponse = {
  ok?: boolean;
  error?: string;
  proposals?: BrainReviewProposal[];
};

type ContextXrayListResponse = {
  ok?: boolean;
  error?: string;
  manifests?: ContextXrayManifest[];
};

type HarnessExperimentListResponse = {
  ok?: boolean;
  error?: string;
  experiments?: HarnessExperimentRecord[];
};

type VisualArtifactListResponse = {
  ok?: boolean;
  error?: string;
  artifacts?: VisualArtifact[];
};

type ReviewActionResponse = {
  ok?: boolean;
  error?: string;
  proposal?: BrainReviewProposal;
  proposals?: BrainReviewProposal[];
  applied?: boolean;
  task?: { id: string; title: string };
  reason?: string;
};

export function AgentNativeInsightsPanel({
  Button,
  active,
  fleetClass,
  formatRelativeTime,
  sharedVault,
  vaultClass,
}: AgentNativeInsightsPanelProps) {
  const [reviews, setReviews] = useState<BrainReviewProposal[]>([]);
  const [manifests, setManifests] = useState<ContextXrayManifest[]>([]);
  const [experiments, setExperiments] = useState<HarnessExperimentRecord[]>([]);
  const [artifacts, setArtifacts] = useState<VisualArtifact[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyReviewId, setBusyReviewId] = useState("");
  const [status, setStatus] = useState("");

  const vaultPath = sharedVault.enabled ? sharedVault.vaultPath : "";
  const selectedManifest = useMemo(
    () => manifests.find((manifest) => manifest.id === selectedManifestId) ?? manifests[0],
    [manifests, selectedManifestId],
  );
  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0],
    [artifacts, selectedArtifactId],
  );
  const pendingReviews = reviews.filter((proposal) => proposal.status === "pending").length;
  const approvedReviews = reviews.filter((proposal) => proposal.status === "approved").length;
  const totalContextTokens = manifests.reduce((sum, manifest) => sum + manifest.totalEstimatedTokens, 0);
  const claimReadyExperiments = experiments.filter((experiment) => experiment.comparison.claimReady).length;

  const refresh = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setStatus("");
    try {
      const visualParams = new URLSearchParams({ limit: "8", public: "1" });
      if (vaultPath) visualParams.set("vaultPath", vaultPath);
      const [reviewData, xrayData, artifactData, experimentData] = await Promise.all([
        fetchJson<BrainReviewListResponse>("/api/brain/review?status=all"),
        fetchJson<ContextXrayListResponse>("/api/context-xray?limit=8"),
        fetchJson<VisualArtifactListResponse>(`/api/visual-artifacts?${visualParams.toString()}`),
        fetchJson<HarnessExperimentListResponse>("/api/harness-experiments?limit=6"),
      ]);
      setReviews(reviewData.proposals ?? []);
      setManifests(xrayData.manifests ?? []);
      setArtifacts(artifactData.artifacts ?? []);
      setExperiments(experimentData.experiments ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Agent-native insights failed to load.");
    } finally {
      setLoading(false);
    }
  }, [active, vaultPath]);

  useEffect(() => {
    if (!active) return undefined;
    const refreshHandle = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(refreshHandle);
  }, [active, refresh]);

  const runReviewAction = async (proposal: BrainReviewProposal, action: "approve" | "reject" | "apply") => {
    setBusyReviewId(`${action}:${proposal.id}`);
    setStatus("");
    try {
      const response = await fetchJson<ReviewActionResponse>("/api/brain/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          id: proposal.id,
          reason: action === "reject" ? "Rejected from the Memory review panel." : undefined,
          vaultPath: action === "apply" && vaultPath ? vaultPath : undefined,
          project: "HivemindOS",
          runtime: "dashboard",
          tags: ["dashboard-review"],
        }),
      });
      setStatus(reviewActionStatus(action, response));
      setReviews(response.proposals ?? updateReviewInPlace(reviews, response.proposal));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${action} failed.`);
    } finally {
      setBusyReviewId("");
    }
  };

  if (!active) return null;

  return (
    <section className={fleetClass("taskPanel", "tabPanel")}>
      <div className={fleetClass("taskPanelHeader")}>
        <div>
          <p className="eyebrow">Agent-native review</p>
          <h2>Memory, context, and harness workbench</h2>
          <p>Review brain writes, inspect context evidence, and compare controlled agent experiments.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
          Refresh
        </Button>
      </div>

      {status ? (
        <p className="mt-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] px-3 py-2 text-xs text-[var(--foreground)]">
          {status}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Pending review" value={String(pendingReviews)} detail={`${approvedReviews} approved and ready to apply`} />
        <MetricCard label="Context manifests" value={String(manifests.length)} detail={`${formatNumber(totalContextTokens)} estimated tokens shown`} />
        <MetricCard label="Harness experiments" value={String(experiments.length)} detail={`${claimReadyExperiments} ready for a comparative claim`} />
        <MetricCard label="Visual artifacts" value={String(artifacts.length)} detail="plans and recaps from vault or local fallback" />
        <MetricCard label="Vault target" value={vaultPath ? "enabled" : "fallback"} detail={vaultPath || "using local HivemindOS state"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="grid content-start gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
          <PanelHeading icon={<ShieldCheck aria-hidden="true" />} eyebrow="Human review" title="Shared Brain proposals" />
          <div className="grid gap-3">
            {reviews.slice(0, 8).map((proposal) => (
              <article key={proposal.id} className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] p-3">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{proposal.title}</strong>
                    <StatusPill tone={proposal.status === "pending" ? "warn" : proposal.status === "applied" ? "good" : proposal.status === "rejected" ? "bad" : "neutral"}>
                      {proposal.status}
                    </StatusPill>
                    <StatusPill tone={proposal.risk === "high" ? "bad" : proposal.risk === "medium" ? "warn" : "good"}>
                      {proposal.risk}
                    </StatusPill>
                  </div>
                  <p className="m-0 text-xs leading-5 text-[var(--muted)]">{proposal.summary}</p>
                  <small className="break-words text-[var(--muted)]">
                    {[proposal.kind, proposal.targetPath, relativeIso(proposal.updatedAt, formatRelativeTime)].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <p className="m-0 whitespace-pre-wrap break-words rounded-md border border-[rgba(148,163,184,0.1)] bg-[rgba(10,14,21,0.38)] p-2 text-xs leading-5 text-[var(--foreground)]">
                  {proposal.proposedContent}
                </p>
                <div className="flex flex-wrap gap-2">
                  {proposal.status === "pending" ? (
                    <>
                      <Button type="button" size="sm" variant="secondary" onClick={() => void runReviewAction(proposal, "approve")} disabled={Boolean(busyReviewId)}>
                        {busyReviewId === `approve:${proposal.id}` ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Check aria-hidden="true" />}
                        Approve
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void runReviewAction(proposal, "reject")} disabled={Boolean(busyReviewId)}>
                        {busyReviewId === `reject:${proposal.id}` ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <X aria-hidden="true" />}
                        Reject
                      </Button>
                    </>
                  ) : null}
                  {proposal.status === "approved" ? (
                    <Button type="button" size="sm" onClick={() => void runReviewAction(proposal, "apply")} disabled={Boolean(busyReviewId)}>
                      {busyReviewId === `apply:${proposal.id}` ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Sparkles aria-hidden="true" />}
                      Apply
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
            {reviews.length ? null : <EmptyState text="No review proposals yet." />}
          </div>
        </section>

        <section className="grid content-start gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
          <PanelHeading icon={<Activity aria-hidden="true" />} eyebrow="Context X-Ray" title="Recent manifests" />
          <div className="grid gap-2">
            {manifests.map((manifest) => (
              <button
                key={manifest.id}
                type="button"
                onClick={() => setSelectedManifestId(manifest.id)}
                className={`rounded-md border p-3 text-left text-xs transition ${selectedManifest?.id === manifest.id ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.1)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] hover:border-[rgba(94,234,212,0.32)]"}`}
              >
                <strong className="block text-sm text-[var(--foreground)]">{manifest.runId || manifest.threadId || manifest.id}</strong>
                <span className="mt-1 block break-words text-[var(--muted)]">
                  {manifest.sources.length} sources · {formatNumber(manifest.totalEstimatedTokens)} tokens · {relativeIso(manifest.createdAt, formatRelativeTime)}
                </span>
              </button>
            ))}
            {manifests.length ? null : <EmptyState text="No Context X-Ray manifests yet." />}
          </div>
          {selectedManifest ? (
            <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] p-3">
              <small className="break-words text-[var(--muted)]">{selectedManifest.id}</small>
              {selectedManifest.redactedLabels?.length ? (
                <StatusPill tone="warn">redacted {selectedManifest.redactedLabels.length}</StatusPill>
              ) : null}
              <div className="grid gap-2">
                {selectedManifest.sources.slice(0, 8).map((source) => <ContextSourceRow source={source} key={source.id} />)}
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid content-start gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
          <PanelHeading icon={<Eye aria-hidden="true" />} eyebrow="Visual artifacts" title="Plans and recaps" />
          <div className="grid gap-2">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                onClick={() => setSelectedArtifactId(artifact.id)}
                className={`rounded-md border p-3 text-left text-xs transition ${selectedArtifact?.id === artifact.id ? "border-[rgba(94,234,212,0.45)] bg-[rgba(20,184,166,0.1)]" : "border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] hover:border-[rgba(94,234,212,0.32)]"}`}
              >
                <strong className="block text-sm text-[var(--foreground)]">{artifact.title}</strong>
                <span className="mt-1 block break-words text-[var(--muted)]">
                  {artifact.kind} · {artifact.blocks.length} blocks · {relativeIso(artifact.updatedAt, formatRelativeTime)}
                </span>
              </button>
            ))}
            {artifacts.length ? null : <EmptyState text="No visual plans or recaps yet." />}
          </div>
          {selectedArtifact ? (
            <div className="grid gap-2 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] p-3">
              <small className="break-words text-[var(--muted)]">
                {[selectedArtifact.id, selectedArtifact.workBoardTaskId, selectedArtifact.queenBeeRunId].filter(Boolean).join(" · ")}
              </small>
              <div className="grid gap-2">
                {selectedArtifact.blocks.slice(0, 4).map((block, index) => <ArtifactBlockPreview block={block} key={`${block.type}:${index}`} />)}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="mt-4 grid content-start gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
        <PanelHeading icon={<Beaker aria-hidden="true" />} eyebrow="Harness experiments" title="Controlled comparisons" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {experiments.map((experiment) => <HarnessExperimentCard experiment={experiment} key={experiment.id} />)}
          {experiments.length ? null : <EmptyState text="No harness experiments recorded yet." />}
        </div>
      </section>
    </section>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(typeof data?.error === "string" ? data.error : `${url} returned HTTP ${response.status}`);
  }
  return data as T;
}

function updateReviewInPlace(reviews: BrainReviewProposal[], proposal?: BrainReviewProposal) {
  if (!proposal) return reviews;
  return reviews.map((candidate) => candidate.id === proposal.id ? proposal : candidate);
}

function reviewActionStatus(action: "approve" | "reject" | "apply", response: ReviewActionResponse) {
  if (action === "apply") {
    if (response.task) return `Autoresearch task queued on the Work Board: ${response.task.title}.`;
    if (response.applied) return "Proposal applied through Shared Brain Memory.";
    return response.reason || "Proposal remains approved for manual application.";
  }
  return action === "approve" ? "Proposal approved." : "Proposal rejected.";
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(10,14,21,0.55)] p-4">
      <p className="eyebrow">{label}</p>
      <strong className="mt-1 block text-2xl font-bold text-[var(--foreground)]">{value}</strong>
      <p className="m-0 mt-1 break-words text-xs text-[var(--muted)]">{detail}</p>
    </article>
  );
}

function PanelHeading({ icon, eyebrow, title }: { icon: ReactNode; eyebrow: string; title: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[rgba(94,234,212,0.22)] bg-[rgba(20,184,166,0.08)] text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="m-0 text-base font-bold">{title}</h3>
      </div>
    </div>
  );
}

function StatusPill({ children, tone }: { children: ReactNode; tone: "good" | "warn" | "bad" | "neutral" }) {
  const className = {
    good: "border-[rgba(34,197,94,0.24)] text-[#bbf7d0]",
    warn: "border-[rgba(251,191,36,0.26)] text-[#fde68a]",
    bad: "border-[rgba(251,113,133,0.26)] text-[#fecdd3]",
    neutral: "border-[rgba(148,163,184,0.18)] text-[var(--muted)]",
  }[tone];
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${className}`}>{children}</span>;
}

function ContextSourceRow({ source }: { source: ContextXraySource }) {
  const lifecycleStages = (["available", "retrieved", "invoked", "relevant"] as const)
    .filter((stage) => Boolean(source.lifecycle?.[`${stage}At`]));
  return (
    <article className="rounded-md border border-[rgba(148,163,184,0.1)] bg-[rgba(10,14,21,0.38)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={source.status === "evicted" ? "neutral" : source.status === "pinned" ? "good" : "warn"}>{source.status}</StatusPill>
        <strong>{source.title}</strong>
      </div>
      <p className="m-0 mt-1 break-words text-[var(--muted)]">
        {[source.kind, source.route, source.path, `${formatNumber(source.tokenEstimate)} tokens`].filter(Boolean).join(" · ")}
      </p>
      {lifecycleStages.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Context lifecycle evidence">
          {lifecycleStages.map((stage) => <StatusPill tone={stage === "relevant" ? "good" : stage === "invoked" ? "warn" : "neutral"} key={stage}>{stage}</StatusPill>)}
        </div>
      ) : null}
      {source.reason ? <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[var(--foreground)]">{source.reason}</p> : null}
    </article>
  );
}

function HarnessExperimentCard({ experiment }: { experiment: HarnessExperimentRecord }) {
  const comparison = experiment.comparison;
  const runSummary = `${comparison.baselineRuns} baseline · ${comparison.treatmentRuns} treatment`;
  const tokenDelta = comparison.promptTokenDelta === null ? "not measured" : `${signedNumber(comparison.promptTokenDelta)} prompt tokens`;
  return (
    <article className="grid gap-3 rounded-md border border-[rgba(148,163,184,0.14)] bg-[rgba(2,6,23,0.32)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={comparison.claimReady ? "good" : "warn"}>{comparison.claimReady ? "claim ready" : "collecting evidence"}</StatusPill>
        <StatusPill tone={experiment.decision === "retain" ? "good" : experiment.decision === "remove" ? "bad" : "neutral"}>{experiment.decision}</StatusPill>
      </div>
      <div>
        <strong className="block text-sm text-[var(--foreground)]">{experiment.contract.title}</strong>
        <p className="m-0 mt-1 text-xs leading-5 text-[var(--muted)]">{experiment.intervention.change}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <HarnessMetric label="Runs" value={runSummary} />
        <HarnessMetric label="Acceptance" value={formatPercentDelta(comparison.acceptanceDelta)} />
        <HarnessMetric label="Tokens" value={tokenDelta} />
        <HarnessMetric label="Proof" value={formatPercentDelta(comparison.proofDelta)} />
      </div>
      {!comparison.claimReady && comparison.claimLimits[0] ? <small className="leading-5 text-[var(--muted)]">{comparison.claimLimits[0]}</small> : null}
    </article>
  );
}

function HarnessMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[rgba(148,163,184,0.1)] px-2 py-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      <span className="mt-0.5 block break-words text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function ArtifactBlockPreview({ block }: { block: VisualArtifactBlock }) {
  const icon = block.type === "diagram" ? <GitBranch aria-hidden="true" /> : <FileText aria-hidden="true" />;
  const content = artifactBlockPreviewContent(block);
  return (
    <article className="rounded-md border border-[rgba(148,163,184,0.1)] bg-[rgba(10,14,21,0.38)] p-2 text-xs">
      <div className="mb-2 flex items-center gap-2 text-[var(--accent-strong)] [&_svg]:h-4 [&_svg]:w-4">
        {icon}
        <strong>{block.type}</strong>
      </div>
      <p className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[var(--muted)]">{content}</p>
    </article>
  );
}

function artifactBlockPreviewContent(block: VisualArtifactBlock) {
  if (block.type === "file-tree") return block.items.slice(0, 6).map((item) => `${item.path}: ${item.note}`).join("\n");
  if (block.type === "diagram") return block.mermaid;
  if (block.type === "table") {
    const header = block.columns.join(" | ");
    const rows = block.rows.slice(0, 6).map((row) => block.columns.map((column) => String(row[column] ?? "")).join(" | "));
    return [block.caption, header, ...rows].filter(Boolean).join("\n");
  }
  if (block.type === "chart") return [block.caption, JSON.stringify(block.spec, null, 2)].filter(Boolean).join("\n");
  if (block.type === "metric") return [block.label, block.value, block.note].filter(Boolean).join("\n");
  return block.markdown;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[rgba(148,163,184,0.22)] p-4 text-center text-sm text-[var(--muted)]">
      {text}
    </div>
  );
}

function relativeIso(value: string | undefined, formatRelativeTime: (timestamp: number) => string) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? formatRelativeTime(timestamp) : value;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(Math.max(0, Math.round(value)));
}

function signedNumber(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${new Intl.NumberFormat().format(rounded)}`;
}

function formatPercentDelta(value: number | null) {
  if (value === null) return "not measured";
  const percentage = Math.round(value * 100);
  return `${percentage > 0 ? "+" : ""}${percentage} pts`;
}

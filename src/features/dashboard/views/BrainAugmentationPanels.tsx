"use client";

import { useMemo, useState } from "react";
import type { Dispatch, ElementType, SetStateAction } from "react";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";
import type { SharedVaultConfig } from "@/lib/types/agent-runtime";
import type {
  BrainGraph,
  BrainGraphNode,
  BrainSkillInventory,
  BrainSkillProviderId,
  BrainSkillProviderInventory,
  BrainSkillSummary,
} from "@/features/dashboard/dashboard-types";
import styles from "./BrainAugmentationPanels.module.css";

const panelClass = (...classes: Array<string | false | null | undefined>) => classes.map((className) => styles[className as string]).filter(Boolean).join(" ");

type DashboardButton = ElementType<any>;
type IconComponent = ElementType<{ "aria-hidden"?: boolean | "true" | "false"; className?: string; size?: number }>;
type ClassNameBuilder = (...names: Array<string | false | null | undefined>) => string;

type BrainAtlasPanelProps = {
  BrainCircuit: IconComponent;
  Button: DashboardButton;
  FileText: IconComponent;
  GitBranch: IconComponent;
  LoaderCircle: IconComponent;
  Network: IconComponent;
  RefreshCcw: IconComponent;
  Search: IconComponent;
  Sparkles: IconComponent;
  brainGraph: BrainGraph | null;
  brainGraphLoading: boolean;
  brainGraphStatus: string;
  formatBrainDate: (value?: string) => string;
  inspectBrainNode: (node: BrainGraphNode) => unknown;
  refreshBrainGraph: (force?: boolean) => unknown;
  selectedAgent?: { id?: string; name?: string } | null;
  setActiveView: (view: string) => void;
  setText: (text: string) => void;
  startAgentChat?: (agentId: string, options?: { fresh?: boolean }) => unknown;
  vaultClass: ClassNameBuilder;
};

type DreamRecommendation = {
  id?: string;
  title?: string;
  detail?: string;
  description?: string;
  command?: string;
  risk?: string;
};

type BrainDreamInboxPanelProps = {
  Button: DashboardButton;
  LoaderCircle: IconComponent;
  RefreshCcw: IconComponent;
  Sparkles: IconComponent;
  gbrainActionStatus: string;
  gbrainBusy: string;
  gbrainStatus: {
    installed?: boolean;
    lastDream?: string;
    error?: string;
    features?: { recommendations?: DreamRecommendation[] };
  } | null;
  runGbrainAction: (action: "dream") => unknown;
  vaultClass: ClassNameBuilder;
};

type BrainSkillRoiPanelProps = {
  Button: DashboardButton;
  Check: IconComponent;
  Download: IconComponent;
  LoaderCircle: IconComponent;
  RefreshCcw: IconComponent;
  Sparkles: IconComponent;
  brainSkillImportProvider: BrainSkillProviderId | "all" | "";
  brainSkills: BrainSkillInventory | null;
  brainSkillsLoading: boolean;
  importBrainSkills: (provider: BrainSkillProviderId | "all") => unknown;
  openSkillBrowser: () => void;
  providerSkillInventories: BrainSkillProviderInventory[];
  refreshBrainSkills: () => unknown;
  setSkillBrowserSearch: Dispatch<SetStateAction<string>>;
  sharedBrainSkills: BrainSkillSummary[];
  sharedVault: SharedVaultConfig;
  vaultClass: ClassNameBuilder;
};

type BrainCluster = {
  key: string;
  label: string;
  nodes: BrainGraphNode[];
  score: number;
  links: number;
  recent: number;
};

type SkillRoiCandidate = {
  id: string;
  name: string;
  slug: string;
  description: string;
  source: string;
  providerId?: BrainSkillProviderId;
  imported: boolean;
  score: number;
  minutes: number;
  reason: string;
};

const DREAM_INBOX_ENABLED_KEY = "hivemindos.brain.dreamInbox.enabled.v1";
const DREAM_INBOX_DEPTH_KEY = "hivemindos.brain.dreamInbox.depth.v1";

function folderSegment(node: BrainGraphNode) {
  const source = node.folder || node.id;
  const segment = source.split("/").find(Boolean);
  return segment || "Root";
}

function nodeScore(node: BrainGraphNode) {
  const modifiedAt = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
  const recent = Number.isFinite(modifiedAt) && modifiedAt > Date.now() - 21 * 24 * 60 * 60 * 1000;
  return (node.incoming + node.outgoing) * 2 + node.accessCount * 4 + (recent ? 8 : 0);
}

function buildBrainClusters(graph: BrainGraph | null): BrainCluster[] {
  const clusters = new Map<string, BrainCluster>();
  for (const node of graph?.nodes ?? []) {
    if (node.id.startsWith("unresolved:")) continue;
    const key = folderSegment(node);
    const cluster = clusters.get(key) ?? { key, label: key, nodes: [], score: 0, links: 0, recent: 0 };
    const recent = Date.parse(node.modifiedAt ?? node.lastAccessedAt ?? "");
    cluster.nodes.push(node);
    cluster.score += nodeScore(node);
    cluster.links += node.incoming + node.outgoing;
    cluster.recent += Number.isFinite(recent) && recent > Date.now() - 21 * 24 * 60 * 60 * 1000 ? 1 : 0;
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

function compactDate(formatBrainDate: (value?: string) => string, value?: string) {
  return value ? formatBrainDate(value) : "No timestamp";
}

export function BrainAtlasPanel({
  BrainCircuit,
  Button,
  FileText,
  GitBranch,
  LoaderCircle,
  Network,
  RefreshCcw,
  Search,
  Sparkles,
  brainGraph,
  brainGraphLoading,
  brainGraphStatus,
  formatBrainDate,
  inspectBrainNode,
  refreshBrainGraph,
  selectedAgent,
  setActiveView,
  setText,
  startAgentChat,
  vaultClass,
}: BrainAtlasPanelProps) {
  const [query, setQuery] = useState("");
  const [selectedClusterKey, setSelectedClusterKey] = useState("");
  const clusters = useMemo(() => buildBrainClusters(brainGraph), [brainGraph]);
  const queryText = query.trim().toLowerCase();
  const filteredClusters = useMemo(() => {
    if (!queryText) return clusters;
    return clusters
      .map((cluster) => ({
        ...cluster,
        nodes: cluster.nodes.filter((node) => [node.label, node.id, node.folder, node.preview, ...(node.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(queryText)),
      }))
      .filter((cluster) => cluster.nodes.length || cluster.label.toLowerCase().includes(queryText));
  }, [clusters, queryText]);
  const selectedCluster = filteredClusters.find((cluster) => cluster.key === selectedClusterKey) ?? filteredClusters[0] ?? null;
  const topNodes = (selectedCluster?.nodes ?? [])
    .slice()
    .sort((a, b) => nodeScore(b) - nodeScore(a) || a.label.localeCompare(b.label))
    .slice(0, 9);

  const askCluster = () => {
    if (!selectedCluster) return;
    const nodeLines = topNodes.slice(0, 5).map((node) => `- ${node.id}: ${node.preview || "No preview loaded."}`).join("\n");
    setText(`Map the "${selectedCluster.label}" brain cluster. Identify stale knowledge, useful links, and the next highest-leverage action.\n\n${nodeLines}`);
    if (selectedAgent?.id && startAgentChat) {
      startAgentChat(selectedAgent.id, { fresh: true });
      return;
    }
    setActiveView("chat");
  };

  return (
    <section className={panelClass("panel")} aria-label="Brain Atlas">
      <div className={panelClass("hero")}>
        <div>
          <p className={panelClass("eyebrow")}>Brain Atlas</p>
          <h3>Clusters, hubs, and stale pockets</h3>
          <p>Read the shared graph as a map: pick a cluster, inspect its strongest notes, then send the cluster to chat for synthesis.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => refreshBrainGraph(true)} disabled={brainGraphLoading}>
          {brainGraphLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
          {brainGraphLoading ? "Refreshing" : "Refresh graph"}
        </Button>
      </div>
      <div className={panelClass("searchRow")}>
        <label className={panelClass("searchBox")}>
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clusters and notes" aria-label="Search Brain Atlas" />
        </label>
        <span>{brainGraph?.nodes.length ?? 0} notes · {brainGraph?.links.length ?? 0} links</span>
      </div>
      {brainGraphLoading && !brainGraph ? (
        <div className={panelClass("statusPill")} role="status" aria-label="Loading Brain Atlas">
          <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} />
          <span>{brainGraphStatus || "Reading shared brain graph."}</span>
        </div>
      ) : null}
      <div className={panelClass("atlasGrid")}>
        <div className={panelClass("clusterRail")}>
          {filteredClusters.slice(0, 10).map((cluster) => (
            <button
              key={cluster.key}
              type="button"
              className={panelClass("clusterCard", selectedCluster?.key === cluster.key && "active")}
              onClick={() => setSelectedClusterKey(cluster.key)}
            >
              <span><BrainCircuit aria-hidden="true" />{cluster.label}</span>
              <strong>{cluster.nodes.length} notes</strong>
              <small>{cluster.links} links · {cluster.recent} recent</small>
            </button>
          ))}
          {!filteredClusters.length && !brainGraphLoading ? <p className={panelClass("empty")}>No clusters match that search.</p> : null}
        </div>
        <div className={panelClass("detailCard")}>
          {selectedCluster ? (
            <>
              <div className={panelClass("detailHead")}>
                <span className={panelClass("tile")}><Network aria-hidden="true" /></span>
                <div>
                  <p className={panelClass("eyebrow")}>Selected cluster</p>
                  <h4>{selectedCluster.label}</h4>
                  <small>{selectedCluster.nodes.length} notes · {selectedCluster.links} graph links</small>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={askCluster}>
                  <Sparkles aria-hidden="true" />
                  Ask cluster
                </Button>
              </div>
              <div className={panelClass("nodeList")}>
                {topNodes.map((node) => (
                  <button key={node.id} type="button" onClick={() => void inspectBrainNode(node)}>
                    <FileText aria-hidden="true" />
                    <span>
                      <strong>{node.label}</strong>
                      <small>{node.folder || node.id}</small>
                    </span>
                    <em><GitBranch aria-hidden="true" />{node.incoming + node.outgoing}</em>
                    <time>{compactDate(formatBrainDate, node.modifiedAt ?? node.lastAccessedAt)}</time>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className={panelClass("empty")}>{brainGraphStatus || "Refresh the graph to build the atlas."}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function recommendationText(recommendation: DreamRecommendation) {
  return [recommendation.description, recommendation.detail, recommendation.command ? `Command: ${recommendation.command}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function BrainDreamInboxPanel({
  Button,
  LoaderCircle,
  RefreshCcw,
  Sparkles,
  gbrainActionStatus,
  gbrainBusy,
  gbrainStatus,
  runGbrainAction,
  vaultClass,
}: BrainDreamInboxPanelProps) {
  const [enabledRaw, rememberEnabled] = useRememberedDashboardValue(DREAM_INBOX_ENABLED_KEY, "false");
  const [depthRaw, rememberDepth] = useRememberedDashboardValue(DREAM_INBOX_DEPTH_KEY, "balanced");
  const [queueBusyId, setQueueBusyId] = useState("");
  const [queueStatus, setQueueStatus] = useState("");
  const enabled = enabledRaw === "true";
  const depth = ["light", "balanced", "deep"].includes(depthRaw) ? depthRaw : "balanced";
  const recommendations = gbrainStatus?.features?.recommendations ?? [];

  const queueRecommendation = async (recommendation: DreamRecommendation, index: number) => {
    const id = recommendation.id || `recommendation-${index}`;
    setQueueBusyId(id);
    setQueueStatus("");
    try {
      const title = recommendation.title || recommendation.command || "Dream recommendation";
      const proposedContent = recommendationText(recommendation) || title;
      const response = await fetch("/api/brain/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          kind: "job",
          title: `Dream Inbox: ${title}`,
          summary: proposedContent,
          proposedContent,
          evidence: [{ sourceType: "agent-run", sourceId: "gbrain-dream", excerpt: proposedContent.slice(0, 500) }],
          risk: recommendation.risk === "high" ? "medium" : "low",
        }),
      });
      const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Could not queue the recommendation.");
      setQueueStatus("Queued for brain review.");
    } catch (error) {
      setQueueStatus(error instanceof Error ? error.message : "Could not queue the recommendation.");
    } finally {
      setQueueBusyId("");
    }
  };

  return (
    <section className={panelClass("panel")} aria-label="Dream Inbox">
      <div className={panelClass("hero")}>
        <div>
          <p className={panelClass("eyebrow")}>Dream Inbox</p>
          <h3>Overnight ideas stay review-gated</h3>
          <p>Dream Inbox is off by default. Opt in to run GBrain dream cycles manually and queue useful recommendations for human review.</p>
        </div>
        <label className={panelClass("switchLine")}>
          <input type="checkbox" checked={enabled} onChange={(event) => rememberEnabled(event.target.checked ? "true" : "false")} />
          <span>{enabled ? "Dream Inbox enabled" : "Dream Inbox off"}</span>
        </label>
      </div>
      <div className={panelClass("dreamControls")} data-disabled={!enabled ? "" : undefined}>
        <div className={panelClass("segmented")} role="group" aria-label="Dream depth">
          {["light", "balanced", "deep"].map((option) => (
            <button key={option} type="button" data-on={depth === option ? "" : undefined} disabled={!enabled} onClick={() => rememberDepth(option)}>
              {option}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="secondary" disabled={!enabled || gbrainBusy === "dream"} onClick={() => runGbrainAction("dream")}>
          {gbrainBusy === "dream" ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Sparkles aria-hidden="true" />}
          {gbrainBusy === "dream" ? "Dreaming" : "Run dream now"}
        </Button>
      </div>
      {gbrainActionStatus ? (
        <div className={panelClass("statusPill")} role="status" aria-live="polite">
          {gbrainBusy ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
          <span>{gbrainActionStatus}</span>
        </div>
      ) : null}
      {queueStatus ? <p className={panelClass("notice")}>{queueStatus}</p> : null}
      <div className={panelClass("recommendationGrid")}>
        {recommendations.length ? recommendations.slice(0, 6).map((recommendation, index) => {
          const id = recommendation.id || `recommendation-${index}`;
          return (
            <article key={id} className={panelClass("recommendationCard")}>
              <span className={panelClass("tile")}><Sparkles aria-hidden="true" /></span>
              <div>
                <strong>{recommendation.title || recommendation.command || "Dream recommendation"}</strong>
                <p>{recommendationText(recommendation) || "Review this idea before it becomes durable work."}</p>
              </div>
              <Button type="button" size="sm" variant="secondary" disabled={!enabled || Boolean(queueBusyId)} onClick={() => void queueRecommendation(recommendation, index)}>
                {queueBusyId === id ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Sparkles aria-hidden="true" />}
                {queueBusyId === id ? "Queueing" : "Queue review"}
              </Button>
            </article>
          );
        }) : (
          <article className={panelClass("recommendationCard")}>
            <span className={panelClass("tile")}><Sparkles aria-hidden="true" /></span>
            <div>
              <strong>No dream recommendations yet</strong>
              <p>{enabled ? "Run a dream cycle to populate this inbox." : "Enable Dream Inbox before running dream cycles."}</p>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function scoreSkill(skill: Pick<BrainSkillSummary, "id" | "name" | "slug" | "description">, source: string, imported: boolean): SkillRoiCandidate {
  const text = `${skill.name} ${skill.slug} ${skill.description}`.toLowerCase();
  const weights = [
    { words: ["automation", "scheduled", "monitor", "watch", "pipeline"], points: 22, minutes: 45, reason: "automation loop" },
    { words: ["github", "code", "test", "debug", "review", "deploy"], points: 18, minutes: 35, reason: "engineering leverage" },
    { words: ["content", "video", "social", "x post", "instagram", "campaign"], points: 16, minutes: 30, reason: "distribution leverage" },
    { words: ["wallet", "payment", "revenue", "growth", "customer"], points: 15, minutes: 25, reason: "commercial leverage" },
    { words: ["brain", "memory", "obsidian", "skill", "workflow"], points: 14, minutes: 25, reason: "brain compounding" },
  ];
  const hits = weights.filter((weight) => weight.words.some((word) => text.includes(word)));
  const score = 35 + hits.reduce((total, hit) => total + hit.points, 0) + (imported ? 10 : 0);
  const minutes = 15 + hits.reduce((total, hit) => total + hit.minutes, 0);
  return {
    id: skill.id || skill.slug,
    name: skill.name || skill.slug,
    slug: skill.slug,
    description: skill.description || "No description yet.",
    source,
    imported,
    score: Math.min(100, score),
    minutes: Math.min(180, minutes),
    reason: hits[0]?.reason ?? "general reuse",
  };
}

export function BrainSkillRoiPanel({
  Button,
  Check,
  Download,
  LoaderCircle,
  RefreshCcw,
  Sparkles,
  brainSkillImportProvider,
  brainSkills,
  brainSkillsLoading,
  importBrainSkills,
  openSkillBrowser,
  providerSkillInventories,
  refreshBrainSkills,
  setSkillBrowserSearch,
  sharedBrainSkills,
  sharedVault,
  vaultClass,
}: BrainSkillRoiPanelProps) {
  const candidates = useMemo(() => {
    const shared = (brainSkills?.shared ?? sharedBrainSkills ?? []).map((skill) => scoreSkill(skill, skill.providerLabel || "Shared brain", true));
    const importable = providerSkillInventories.flatMap((provider) => (
      provider.skills
        .filter((skill) => !skill.imported)
        .map((skill) => ({
          ...scoreSkill(skill, provider.label, false),
          providerId: provider.id,
        }))
    ));
    return [...shared, ...importable].sort((a, b) => b.score - a.score || b.minutes - a.minutes).slice(0, 9);
  }, [brainSkills?.shared, providerSkillInventories, sharedBrainSkills]);
  const totalEstimatedMinutes = candidates.reduce((sum, candidate) => sum + candidate.minutes, 0);

  const openSkill = (candidate: SkillRoiCandidate) => {
    setSkillBrowserSearch(candidate.slug || candidate.name);
    openSkillBrowser();
  };

  return (
    <section className={panelClass("panel")} aria-label="Skill ROI">
      <div className={panelClass("hero")}>
        <div>
          <p className={panelClass("eyebrow")}>Skill ROI</p>
          <h3>Pick the highest-leverage recipes first</h3>
          <p>Estimated value comes from skill metadata and local availability. It is directional, not usage telemetry.</p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={refreshBrainSkills} disabled={brainSkillsLoading}>
          {brainSkillsLoading ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <RefreshCcw aria-hidden="true" />}
          {brainSkillsLoading ? "Scanning" : "Refresh skills"}
        </Button>
      </div>
      <div className={panelClass("roiStats")}>
        <span><Sparkles aria-hidden="true" /><strong>{candidates.length}</strong> ranked skills</span>
        <span><Check aria-hidden="true" /><strong>{Math.round(totalEstimatedMinutes / 60)}</strong> estimated hours/week</span>
        <span><Download aria-hidden="true" /><strong>{brainSkills?.totals?.importable ?? 0}</strong> importable</span>
      </div>
      <div className={panelClass("roiGrid")}>
        {brainSkillsLoading && !candidates.length ? Array.from({ length: 6 }).map((_, index) => (
          <article key={index} className={panelClass("roiCard", "skeleton")} aria-hidden="true">
            <span />
            <b />
            <i />
          </article>
        )) : null}
        {candidates.map((candidate, index) => {
          const pending = candidate.providerId && brainSkillImportProvider === candidate.providerId;
          return (
            <article key={`${candidate.source}:${candidate.id}`} className={panelClass("roiCard")}>
              <div className={panelClass("roiRank")}>{index + 1}</div>
              <div>
                <strong>{candidate.name}</strong>
                <small>{candidate.source} · {candidate.imported ? "shared" : "importable"} · {candidate.reason}</small>
                <p>{candidate.description}</p>
              </div>
              <div className={panelClass("roiMeter")} aria-label={`Estimated ROI ${candidate.score} out of 100`}>
                <span style={{ width: `${candidate.score}%` }} />
              </div>
              <div className={panelClass("roiActions")}>
                <em>{candidate.minutes} min/week estimated</em>
                {candidate.providerId ? (
                  <Button type="button" size="sm" variant="secondary" disabled={!sharedVault.enabled || Boolean(brainSkillImportProvider)} onClick={() => void importBrainSkills(candidate.providerId!)}>
                    {pending ? <LoaderCircle aria-hidden="true" className={vaultClass("spinIcon")} /> : <Download aria-hidden="true" />}
                    {pending ? "Importing" : "Import provider"}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => openSkill(candidate)}>
                    <Sparkles aria-hidden="true" />
                    Open skill
                  </Button>
                )}
              </div>
            </article>
          );
        })}
        {!candidates.length && !brainSkillsLoading ? <p className={panelClass("empty")}>Refresh skills to rank the current shelf.</p> : null}
      </div>
    </section>
  );
}

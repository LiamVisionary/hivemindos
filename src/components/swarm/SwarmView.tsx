// src/components/swarm/SwarmView.tsx
"use client";

import * as React from "react";
import { AgentSelectionModal } from "@/components/agents/AgentSelectionModal";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  buildMiroSharkIntelligence,
  type MiroSharkAnalysisMode,
  type MiroSharkIntelligence,
} from "@/lib/services/miroshark/run-intelligence";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import { RUNTIME_LABELS } from "@/lib/types/agent-runtime";

import { Composer } from "./composer";
import { HeadlinesPanel, MarketPanel, SocialPanel } from "./feeds";
import {
  XThreadView, RedditView, PolymarketView, ResearchView, OpsView, MiroSharkIntegrationView,
} from "./output-views";
import { Runs } from "./runs";
import {
  type SwarmAgent, type SwarmDecision, type SwarmMarket, type SwarmRun, type SwarmSocialPost,
  type SwarmTemplate, type SwarmTemplateField, type TemplateId,
} from "./swarm-data";
import styles from "./swarm-tokens.module.css";

type SwarmAnalysisResult = {
  message?: string;
  notePath?: string;
  intelligence?: MiroSharkIntelligence;
};

type SwarmRuntimeModelSelection = {
  provider: string;
  model: string;
  providers: Array<{
    slug: string;
    name: string;
    models: Array<{ id: string; name?: string }>;
  }>;
};

interface SwarmViewProps {
  runs?: SwarmRun[];
  agents?: SwarmAgent[];
  decisions?: SwarmDecision[];
  market?: SwarmMarket;
  socialPosts?: SwarmSocialPost[];
  templates?: SwarmTemplate[];
  statusLabel?: string;
  selectedRunId?: string;
  archiveLoading?: boolean;
  onSelectRun?: (run: SwarmRun) => void;
  onLaunch?: (template: TemplateId) => void;
  onPickTemplate?: (template: TemplateId) => void;
  draftScenario?: string;
  draftRounds?: number;
  draftPlatform?: string;
  templateFields?: SwarmTemplateField[];
  templateInputs?: Record<string, string>;
  missingTemplateFields?: number;
  runPending?: boolean;
  onDraftScenarioChange?: (value: string) => void;
  onDraftRoundsChange?: (value: number) => void;
  onDraftPlatformChange?: (value: string) => void;
  onTemplateInputChange?: (key: string, value: string) => void;
  onStartRun?: () => void;
  onAskScenario?: () => void;
  onSuggestScenarios?: () => void;
  helperPending?: "ask" | "suggest" | "";
  helperStatus?: string;
  loading?: boolean;
  loadingLabel?: string;
  onPublishX?: (run: SwarmRun) => void;
  publishPending?: boolean;
  publishStatus?: string;
  analysisAgents?: AgentProfile[];
  analysisRuntimeModels?: Partial<Record<AgentRuntime, SwarmRuntimeModelSelection>>;
  selectedAnalysisAgentId?: string;
  analysisPending?: MiroSharkAnalysisMode | "";
  analysisStatus?: string;
  analysisResult?: SwarmAnalysisResult | null;
  onAnalysisAgentChange?: (agentId: string) => void;
  onAnalyzeRun?: (run: SwarmRun, mode: MiroSharkAnalysisMode) => void;
}

const EMPTY_MARKET: SwarmMarket = {
  symbol: "No market data",
  ticks: [],
  ladder: [],
  headlines: [],
};

export function SwarmView({
  runs = [],
  agents = [],
  decisions = [],
  market = EMPTY_MARKET,
  socialPosts = [],
  templates = [],
  statusLabel = "waiting for data",
  selectedRunId,
  archiveLoading = false,
  onSelectRun,
  onLaunch,
  onPickTemplate,
  draftScenario,
  draftRounds,
  draftPlatform,
  templateFields = [],
  templateInputs = {},
  missingTemplateFields = 0,
  runPending = false,
  onDraftScenarioChange,
  onDraftRoundsChange,
  onDraftPlatformChange,
  onTemplateInputChange,
  onStartRun,
  onAskScenario,
  onSuggestScenarios,
  helperPending,
  helperStatus,
  loading = false,
  loadingLabel = "Loading swarm run",
  onPublishX,
  publishPending = false,
  publishStatus,
  analysisAgents = [],
  analysisRuntimeModels,
  selectedAnalysisAgentId,
  analysisPending = "",
  analysisStatus,
  analysisResult,
  onAnalysisAgentChange,
  onAnalyzeRun,
}: SwarmViewProps = {}) {
  const [internalSelectedId, setInternalSelectedId] = React.useState<string>(runs[0]?.id ?? "");
  const [template, setTemplate] = React.useState<TemplateId>(runs[0]?.template ?? templates[0]?.id ?? "custom");
  const requestedSelectedId = selectedRunId !== undefined ? selectedRunId : internalSelectedId;
  const selectedId = requestedSelectedId === ""
    ? ""
    : runs.some((r) => r.id === requestedSelectedId)
      ? requestedSelectedId
      : runs[0]?.id ?? "";
  const run = selectedId ? runs.find((r) => r.id === selectedId) ?? runs[0] ?? null : null;
  const handleSelectRun = React.useCallback((id: string) => {
    setInternalSelectedId(id);
    const r = runs.find((x) => x.id === id);
    if (r) {
      setTemplate(r.template);
      onSelectRun?.(r);
    }
  }, [onSelectRun, runs]);

  const handlePickTemplate = React.useCallback((id: TemplateId) => {
    setTemplate(id);
    setInternalSelectedId("");
    onPickTemplate?.(id);
  }, [onPickTemplate]);

  const handleLaunch = React.useCallback(() => {
    const nextTemplate = templates.some((item) => item.id === template) ? template : templates[0]?.id ?? "custom";
    setTemplate(nextTemplate);
    setInternalSelectedId("");
    onLaunch?.(nextTemplate);
  }, [onLaunch, template, templates]);

  const activeTemplate = run?.template ?? template;
  const isLoading = loading || runPending;

  return (
    <TooltipProvider delayDuration={120}>
      <div className={`${styles.root} relative overflow-hidden`}
        aria-busy={isLoading || undefined}
        style={{
          width: "100%", height: "100%",
          background: "var(--background)", color: "var(--foreground)",
          fontFamily: "var(--f-display), system-ui, sans-serif",
          display: "grid", gridTemplateRows: "minmax(0, 1fr)",
        }}>
        {/* Backdrop wash */}
        <div aria-hidden className="absolute inset-0 pointer-events-none" style={{
          background:
            "radial-gradient(circle at 50% 28%, rgba(255,212,90,0.10), transparent 50%)," +
            "radial-gradient(circle at 80% 80%, rgba(45,212,191,0.08), transparent 50%)",
        }} />
        <svg aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.08 }}>
          <defs>
            <pattern id="swarmBgHex" width="48" height="55" patternUnits="userSpaceOnUse">
              <polygon points="24,1 47,14 47,40 24,53 1,40 1,14"
                fill="none" stroke="rgba(255,212,90,0.4)" strokeWidth={0.5} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#swarmBgHex)" />
        </svg>

        {/* ===== BODY ===== */}
        <div className="relative z-10 grid" style={{
          gridTemplateColumns: "300px minmax(0, 1fr) 320px", minHeight: 0,
        }}>
          <Runs
            runs={runs}
            selectedId={selectedId}
            loading={archiveLoading}
            onSelect={handleSelectRun}
            onLaunch={handleLaunch}
          />

          {/* CENTER — theater + feeds (varies by template) */}
          <section className="grid overflow-auto" style={{
            minWidth: 0, minHeight: 0, padding: "20px 28px 28px",
            gap: 16, gridTemplateColumns: "minmax(0, 1fr)", alignContent: "start",
          }}>
            {isLoading ? (
              <LoadingStage label={loadingLabel} />
            ) : run ? (
              <CenterStage
                run={run}
                agents={agents}
                decisions={decisions}
                market={market}
                socialPosts={socialPosts}
                onPublishX={() => onPublishX?.(run)}
                publishPending={publishPending}
                publishStatus={publishStatus}
                analysisAgents={analysisAgents}
                analysisRuntimeModels={analysisRuntimeModels}
                selectedAnalysisAgentId={selectedAnalysisAgentId}
                analysisPending={analysisPending}
                analysisStatus={analysisStatus}
                analysisResult={analysisResult}
                onAnalysisAgentChange={onAnalysisAgentChange}
                onAnalyzeRun={(mode) => onAnalyzeRun?.(run, mode)}
              />
            ) : (
              <EmptyStage statusLabel={statusLabel} />
            )}
          </section>

          <Composer
            templates={templates}
            activeTemplate={activeTemplate}
            onPickTemplate={handlePickTemplate}
            run={run}
            agents={agents}
            draftScenario={draftScenario}
            draftRounds={draftRounds}
            draftPlatform={draftPlatform}
            templateFields={templateFields}
            templateInputs={templateInputs}
            missingTemplateFields={missingTemplateFields}
            runPending={runPending}
            onDraftScenarioChange={onDraftScenarioChange}
            onDraftRoundsChange={onDraftRoundsChange}
            onDraftPlatformChange={onDraftPlatformChange}
            onTemplateInputChange={onTemplateInputChange}
            onStartRun={onStartRun}
            onAskScenario={onAskScenario}
            onSuggestScenarios={onSuggestScenarios}
            helperPending={helperPending}
            helperStatus={helperStatus}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function CenterStage({
  run,
  agents,
  decisions,
  market,
  socialPosts,
  onPublishX,
  publishPending,
  publishStatus,
  analysisAgents,
  analysisRuntimeModels,
  selectedAnalysisAgentId,
  analysisPending,
  analysisStatus,
  analysisResult,
  onAnalysisAgentChange,
  onAnalyzeRun,
}: {
  run: SwarmRun;
  agents: SwarmAgent[];
  decisions: SwarmDecision[];
  market: SwarmMarket;
  socialPosts: SwarmSocialPost[];
  onPublishX: () => void;
  publishPending: boolean;
  publishStatus?: string;
  analysisAgents: AgentProfile[];
  analysisRuntimeModels?: Partial<Record<AgentRuntime, SwarmRuntimeModelSelection>>;
  selectedAnalysisAgentId?: string;
  analysisPending: MiroSharkAnalysisMode | "";
  analysisStatus?: string;
  analysisResult?: SwarmAnalysisResult | null;
  onAnalysisAgentChange?: (agentId: string) => void;
  onAnalyzeRun?: (mode: MiroSharkAnalysisMode) => void;
}) {
  const canPublish = run.integrationItems?.some((item) => item.id === "miroshark-integration-draft") ?? false;
  const publishBadge = canPublish ? (
    <button onClick={onPublishX} disabled={publishPending} className="uppercase font-bold cursor-pointer"
      style={{
        padding: "6px 14px", borderRadius: 999, border: 0,
        background: "#1d9bf0", color: "#fff",
        fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.08,
        opacity: publishPending ? 0.7 : 1,
      }}>{publishPending ? "publishing..." : "publish simulation"}</button>
  ) : null;
  const intelligence = buildMiroSharkIntelligence(run, market);
  const analysisPanel = (
    <RunIntelligencePanel
      intelligence={intelligence}
      agents={analysisAgents}
      runtimeModelsByRuntime={analysisRuntimeModels}
      selectedAgentId={selectedAnalysisAgentId}
      pending={analysisPending}
      status={analysisStatus}
      result={analysisResult}
      onAgentChange={onAnalysisAgentChange}
      onAnalyze={onAnalyzeRun}
    />
  );
  const wrap = (title: string, tone: string, children: React.ReactNode, badge?: React.ReactNode, minHeight = 600) => (
    <div className="relative grid"
      style={{
        borderRadius: 14, border: "1px solid rgba(148,163,184,0.16)",
        background: `radial-gradient(ellipse at center, ${tone}, transparent 60%), var(--panel-bg)`,
        padding: "88px 18px 22px", minHeight,
        alignItems: "start", justifyItems: "center",
      }}>
      <div className="absolute grid" style={{
        top: 14, left: 16, right: 16, gap: 14,
        gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start",
      }}>
        <div className="grid" style={{ minWidth: 0, gap: 6 }}>
          <div className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
            <span className={`${styles.dot} ${styles.dotLive}`} style={{ color: "var(--accent)", flex: "0 0 auto" }} />
            <span className={styles.monoCap} style={{ color: "var(--hex-active-border)", lineHeight: 1.4 }}>{title}</span>
          </div>
          <span className={styles.monoCap} style={{
            color: "var(--muted)", lineHeight: 1.45,
            overflowWrap: "anywhere", wordBreak: "break-word",
          }}>{run.title}</span>
        </div>
        <div className="flex items-center justify-end" style={{ gap: 6, minWidth: "max-content" }}>{badge}</div>
      </div>
      {children}
    </div>
  );

  switch (run.template) {
    case "x-thread":
      return (
        <>
          {wrap(
            "publisher · draft ready", "rgba(29,155,240,0.10)",
            <XThreadView run={run} />,
            publishBadge,
          )}
          {analysisPanel}
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
    case "reddit-narrative":
      return (
        <>
          {wrap("reddit · narrative cascade", "rgba(255,69,0,0.10)", <RedditView run={run} />, publishBadge)}
          {analysisPanel}
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
    case "research-swarm":
      return (
        <>
          {wrap("research · consensus brief", "rgba(94,234,212,0.10)", <ResearchView run={run} />, publishBadge)}
          {analysisPanel}
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
    case "ops":
      return (
        <>
          {wrap("ops · storm console", "rgba(251,113,133,0.10)", <OpsView run={run} />, publishBadge)}
          {analysisPanel}
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
    case "polymarket":
      return (
        <>
          {wrap("polymarket · result board", "rgba(94,234,212,0.08)", <PolymarketView run={run} market={market} />, publishBadge)}
          {analysisPanel}
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
    case "market-maker":
    case "custom":
    default:
      return (
        <>
          {wrap(
            "simulation · overview", "rgba(255,212,90,0.06)",
            <SimulationOverview run={run} agents={agents} decisions={decisions} market={market} socialPosts={socialPosts} />,
            publishBadge,
            0,
          )}
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16 }}>
            <MarketPanel data={market} />
            <SocialPanel posts={socialPosts} />
          </div>
          {analysisPanel}
          <HeadlinesPanel headlines={market.headlines} />
          <MiroSharkIntegrationView run={run} onPublish={onPublishX} publishPending={publishPending} publishStatus={publishStatus} />
        </>
      );
  }
}

function splitOverviewText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return { title: "Simulation overview", body: "" };
  const sentenceMatch = trimmed.match(/^(.+?[.!?])\s+(.+)$/s);
  if (sentenceMatch) {
    return {
      title: sentenceMatch[1].trim(),
      body: sentenceMatch[2].trim(),
    };
  }
  const maxTitleLength = 96;
  if (trimmed.length <= maxTitleLength) return { title: trimmed, body: "" };
  const splitAt = trimmed.lastIndexOf(" ", maxTitleLength);
  return {
    title: `${trimmed.slice(0, splitAt > 40 ? splitAt : maxTitleLength).trim()}...`,
    body: trimmed.slice(splitAt > 40 ? splitAt : maxTitleLength).trim(),
  };
}

function RunIntelligencePanel({
  intelligence,
  agents,
  runtimeModelsByRuntime,
  selectedAgentId,
  pending,
  status,
  result,
  onAgentChange,
  onAnalyze,
}: {
  intelligence: MiroSharkIntelligence;
  agents: AgentProfile[];
  runtimeModelsByRuntime?: Partial<Record<AgentRuntime, SwarmRuntimeModelSelection>>;
  selectedAgentId?: string;
  pending: MiroSharkAnalysisMode | "";
  status?: string;
  result?: SwarmAnalysisResult | null;
  onAgentChange?: (agentId: string) => void;
  onAnalyze?: (mode: MiroSharkAnalysisMode) => void;
}) {
  const [agentPickerOpen, setAgentPickerOpen] = React.useState(false);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const actions: Array<{ mode: MiroSharkAnalysisMode; label: string }> = [
    { mode: "risks", label: "Find risks" },
    { mode: "public-reaction", label: "Public reaction" },
    { mode: "market", label: "Market verdict" },
    { mode: "follow-up", label: "Follow-up plan" },
  ];
  if (pending) {
    return <AnalysisSequence mode={pending} agentName={selectedAgent?.name} status={status} />;
  }
  return (
    <section style={{
      borderRadius: 14, border: "1px solid rgba(148,163,184,0.16)",
      background: "var(--panel-bg)", color: "var(--foreground)",
      padding: 18, display: "grid", gap: 14,
    }}>
      <div className="flex flex-wrap items-start justify-between" style={{ gap: 12 }}>
        <div>
          <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>Run intelligence</div>
          <h2 className="font-bold" style={{ margin: "4px 0 0", fontFamily: "var(--f-display)", fontSize: 22 }}>
            {intelligence.verdict}
          </h2>
        </div>
        {agents.length ? (
          <div className="grid" style={{ gap: 4, width: "fit-content", maxWidth: "100%" }}>
            <span className={styles.monoCap} style={{ color: "var(--muted)" }}>Agent</span>
            <div className="grid" style={{ gridTemplateColumns: "max-content max-content", gap: 8, alignItems: "center", maxWidth: "100%" }}>
              <button
                type="button"
                onClick={() => setAgentPickerOpen(true)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 14,
                  width: "max-content", maxWidth: 320,
                  borderRadius: 10, border: "1px solid rgba(148,163,184,0.22)",
                  background: "var(--code-bg)", color: "var(--foreground)",
                  padding: "8px 10px", fontFamily: "var(--f-mono)", fontSize: 12,
                  cursor: "pointer", textAlign: "left",
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {selectedAgent?.name ?? "Choose agent"}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase" }}>
                  {selectedAgent ? RUNTIME_LABELS[selectedAgent.runtime] : "Select"}
                </span>
              </button>
              <button
                type="button"
                disabled={false}
                onClick={() => onAnalyze?.("verdict")}
                className="uppercase font-bold cursor-pointer"
                style={{
                  padding: "8px 13px", borderRadius: 999, border: 0,
                  background: "#1d9bf0", color: "#fff",
                  opacity: 1,
                  fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.06,
                }}
              >
                Analyze Simulation
              </button>
            </div>
            <AgentSelectionModal
              open={agentPickerOpen}
              agents={agents}
              runtimeModelsByRuntime={runtimeModelsByRuntime}
              selectedAgentId={selectedAgent?.id}
              title="Choose Analysis Agent"
              description="Pick the agent that should judge this simulation. Search covers name, worker class, skills, runtime, provider, model, and suited-for prompt."
              onClose={() => setAgentPickerOpen(false)}
              onSelect={(agentId) => {
                onAgentChange?.(agentId);
                setAgentPickerOpen(false);
              }}
            />
          </div>
        ) : null}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        <SignalCard label="quality" value={`${intelligence.qualityScore}/100`} detail={intelligence.qualityLabel} />
        <SignalCard label="social" value={intelligence.socialRead.split(":")[0]} detail={intelligence.socialRead} />
        <SignalCard label="market" value={intelligence.marketRead.includes("YES") ? intelligence.marketRead.match(/YES \d+%/)?.[0] ?? "available" : "missing"} detail={intelligence.marketRead} />
        <SignalCard label="risk" value={intelligence.riskRead.split(":")[0]} detail={intelligence.riskRead} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
        <ClaimList title="Support signals" claims={intelligence.proClaims} />
        <ClaimList title="Objections" claims={intelligence.conClaims} />
      </div>
      <div className="flex flex-wrap" style={{ gap: 8 }}>
        <span className={styles.monoCap} style={{ color: "var(--muted)", alignSelf: "center" }}>Deep dives</span>
        {actions.map((action) => (
          <button
            key={action.mode}
            type="button"
            disabled={false}
            onClick={() => onAnalyze?.(action.mode)}
            className="uppercase font-bold cursor-pointer"
            style={{
              padding: "7px 11px", borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.22)",
              background: "transparent",
              color: "var(--hex-honey-border)",
              opacity: 1,
              fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: 0.06,
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {status || result?.notePath ? (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45 }}>
          {status || result?.message}
          {result?.notePath ? ` Saved: ${result.notePath}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function AnalysisSequence({ mode, agentName, status }: { mode: MiroSharkAnalysisMode; agentName?: string; status?: string }) {
  const modeLabel = mode.replace(/-/g, " ");
  const steps = [
    "Locking run snapshot",
    "Indexing posts and market ticks",
    agentName ? `Routing verdict to ${agentName}` : "Routing verdict to selected agent",
    "Scoring risk and support signals",
    "Writing Obsidian analysis packet",
  ];
  return (
    <section className={styles.analysisSequence}>
      <div className={styles.analysisHalo} aria-hidden="true" />
      <div className={styles.analysisCore}>
        <div className={styles.analysisScanner} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>Analyzing simulation</div>
          <h2>{modeLabel}</h2>
          <p>{status || "Running the selected agent through the simulation evidence stack."}</p>
        </div>
      </div>
      <ol className={styles.analysisSteps}>
        {steps.map((step, index) => (
          <li key={step} style={{ animationDelay: `${index * 130}ms` }}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step}</strong>
            <i />
          </li>
        ))}
      </ol>
    </section>
  );
}

function SignalCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
      background: "var(--panel-bg-soft)", minWidth: 0,
    }}>
      <div className={styles.monoCap} style={{ color: "var(--muted)" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 4, color: "var(--foreground)", fontSize: 15 }}>{value}</strong>
      <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 11.5, lineHeight: 1.35 }}>{detail}</p>
    </div>
  );
}

function ClaimList({ title, claims }: { title: string; claims: string[] }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
      background: "var(--panel-bg-soft)",
    }}>
      <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>{title}</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--foreground)", fontSize: 12.5, lineHeight: 1.45 }}>
        {claims.map((claim, index) => <li key={`${title}-${index}`}>{claim}</li>)}
      </ul>
    </div>
  );
}

function SimulationOverview({
  run,
  agents,
  decisions,
  market,
  socialPosts,
}: {
  run: SwarmRun;
  agents: SwarmAgent[];
  decisions: SwarmDecision[];
  market: SwarmMarket;
  socialPosts: SwarmSocialPost[];
}) {
  const latestDecision = decisions[0];
  const overview = splitOverviewText(run.scenario || run.title);
  const summary = overview.body || (run.summary && run.summary !== overview.title
    ? run.summary
    : "Review the generated posts, market snapshot, and output payloads below.");
  return (
    <div className="grid" style={{ width: "min(920px, 100%)", gap: 14 }}>
      <div className="grid" style={{ gap: 8 }}>
        <div className={styles.monoCap} style={{ color: "var(--hex-honey-border)" }}>
          {run.platform ?? "multi-surface"} simulation
        </div>
        <h2 className="font-bold" style={{
          margin: 0, fontFamily: "var(--f-display)",
          fontSize: "clamp(22px, 2.2vw, 30px)",
          letterSpacing: 0, color: "var(--foreground)", lineHeight: 1.12,
          maxWidth: 760,
        }}>
          {overview.title}
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5, lineHeight: 1.5, maxWidth: 820 }}>
          {summary.length > 260 ? `${summary.slice(0, 260).trim()}...` : summary}
        </p>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 2 }}>
        <BigStat n={agents.length || run.agents} label="agents" tone="cyan" />
        <BigStat n={socialPosts.length || run.posts} label="posts" />
        <BigStat n={market.ticks.length} label="price ticks" tone="honey" />
        <BigStat n={run.integrationItems?.length ?? 0} label="outputs" />
      </div>
      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
        <section style={{
          padding: 14, borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
          background: "var(--panel-bg-soft)",
        }}>
          <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>latest activity</div>
          <p style={{ margin: "8px 0 0", color: "var(--foreground)", fontSize: 14, lineHeight: 1.5 }}>
            {latestDecision ? `${latestDecision.action}: ${latestDecision.detail}` : "No timeline decisions were returned for this run."}
          </p>
        </section>
        <section style={{
          padding: 14, borderRadius: 10, border: "1px solid rgba(148,163,184,0.16)",
          background: "var(--panel-bg-soft)",
        }}>
          <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>market snapshot</div>
          <p style={{ margin: "8px 0 0", color: "var(--foreground)", fontSize: 14, lineHeight: 1.5 }}>
            {market.ticks.length
              ? `${market.symbol}: latest YES ${(market.ticks[market.ticks.length - 1] * 100).toFixed(0)}%`
              : "No market price snapshot was returned for this run."}
          </p>
        </section>
      </div>
    </div>
  );
}

function EmptyStage({ statusLabel }: { statusLabel: string }) {
  return (
    <div className="grid place-items-center text-center"
      style={{
        borderRadius: 14, border: "1px solid rgba(148,163,184,0.16)",
        background: "var(--panel-bg)", minHeight: 540, padding: 28,
      }}>
      <div>
        <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>MiroShark {statusLabel}</div>
        <h2 className="font-bold" style={{ margin: "10px 0 6px", fontFamily: "var(--f-display)", fontSize: 28 }}>
          No swarm runs loaded
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", maxWidth: 460 }}>
          Connect MiroShark or load a saved simulation to populate the theater with real runs, agents, posts, and events.
        </p>
      </div>
    </div>
  );
}

function LoadingStage({ label }: { label: string }) {
  return (
    <div className={styles.loadingStage}>
      <div className={styles.loadingCard}>
        <div className={styles.loadingComb} aria-hidden="true">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} style={{ animationDelay: `${index * 90}ms` }} />
          ))}
        </div>
        <div className={styles.monoCap} style={{ color: "var(--hex-active-border)" }}>
          MiroShark is working
        </div>
        <h2>{label}</h2>
        <p>
          Preparing the theater, run shelf, and output surfaces for the latest simulation data.
        </p>
        <div className={styles.loadingRail} aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}

function BigStat({ n, label, tone }: { n: number; label: string; tone?: "cyan" | "honey" | "danger" }) {
  const color =
    tone === "cyan"   ? "var(--hex-active-border)" :
    tone === "honey"  ? "var(--hex-honey-border)" :
    tone === "danger" ? "var(--danger)" :
                        "var(--foreground)";
  return (
    <div className="text-right">
      <div className="font-bold" style={{
        fontFamily: "var(--f-display)", fontSize: 36, color, lineHeight: 1, letterSpacing: -1,
      }}>{n}</div>
      <div className={styles.monoCap} style={{ color: "var(--muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

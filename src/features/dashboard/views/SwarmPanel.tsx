"use client";

/* eslint-disable react-hooks/immutability, react-hooks/purity */

import type { Dispatch, ElementType, SetStateAction } from "react";
import type { AgentProfile, AgentRuntime } from "@/lib/types/agent-runtime";
import type { MiroSharkAnalysisMode } from "@/lib/services/miroshark/run-intelligence";
import type { SwarmAgent, SwarmDecision, SwarmMarket, SwarmRun, SwarmSocialPost, SwarmTemplate, SwarmTemplateField, TemplateId } from "@/components/swarm/swarm-data";
import type { DashboardView, MiroSharkRunResult } from "@/features/dashboard/dashboard-types";

type RuntimeModelSelection = {
  provider: string;
  model: string;
  providers: Array<{ slug: string; name: string; models: Array<{ id: string; name?: string }> }>;
};

type SwarmPanelProps = {
  SwarmView: ElementType;
  activeView: DashboardView;
  allMirosharkTemplates: SwarmTemplate[];
  analyzeMirosharkRun: (run: SwarmRun, mode: MiroSharkAnalysisMode) => void | Promise<void>;
  applyMirosharkTemplate: (template: SwarmTemplate) => void;
  currentSwarmRun: SwarmRun | null;
  displayAgents: AgentProfile[];
  launchMirosharkSwarm: () => void | Promise<void>;
  loadMirosharkArchivedRun: (runId: string) => void | Promise<void>;
  mirosharkAnalysisAgentId: string;
  mirosharkAnalysisPending: MiroSharkAnalysisMode | "";
  mirosharkAnalysisResult: unknown;
  mirosharkAnalysisStatus: string;
  mirosharkArchiveLoading: boolean;
  mirosharkArchiveStatus: string;
  mirosharkExperimentPending: string;
  mirosharkExperimentStatus: string;
  mirosharkHelperPending: "ask" | "suggest" | "";
  mirosharkHelperStatus: string;
  mirosharkMissingTemplateFields: string[];
  mirosharkPlatform: string;
  mirosharkProgressLabel: string;
  mirosharkRounds: number;
  mirosharkRunPending: boolean;
  mirosharkScenario: string;
  mirosharkSelectedTemplate: SwarmTemplate | null;
  mirosharkSelectedTemplateFields: SwarmTemplateField[];
  mirosharkTemplateInputs: Record<string, string>;
  runMirosharkExperiment: (action: string, runId: string) => void | Promise<void>;
  runMirosharkScenarioHelper: (mode: "ask" | "suggest") => void | Promise<void>;
  runtimeModelSelectionsByRuntime: Partial<Record<AgentRuntime, RuntimeModelSelection>>;
  selectedAgent: AgentProfile | null;
  selectedSwarmRunId: string;
  setMirosharkAnalysisAgentId: Dispatch<SetStateAction<string>>;
  setMirosharkPlatform: Dispatch<SetStateAction<MiroSharkRunResult["platform"]>>;
  setMirosharkRounds: Dispatch<SetStateAction<number>>;
  setMirosharkScenario: Dispatch<SetStateAction<string>>;
  startNewMirosharkSimulation: (templateId?: string) => void;
  swarmAgents: SwarmAgent[];
  swarmDecisions: SwarmDecision[];
  swarmMarket: SwarmMarket;
  swarmRuns: SwarmRun[];
  swarmSocialPosts: SwarmSocialPost[];
  swarmStatusLabel: string;
  swarmTemplates: SwarmTemplate[];
  updateMirosharkTemplateInput: (template: SwarmTemplate, key: string, value: string) => void;
};

export function SwarmPanel(props: SwarmPanelProps) {
  const { SwarmView, activeView, allMirosharkTemplates, analyzeMirosharkRun, applyMirosharkTemplate, currentSwarmRun, displayAgents, launchMirosharkSwarm, loadMirosharkArchivedRun, mirosharkAnalysisAgentId, mirosharkAnalysisPending, mirosharkAnalysisResult, mirosharkAnalysisStatus, mirosharkArchiveLoading, mirosharkArchiveStatus, mirosharkExperimentPending, mirosharkExperimentStatus, mirosharkHelperPending, mirosharkHelperStatus, mirosharkMissingTemplateFields, mirosharkPlatform, mirosharkProgressLabel, mirosharkRounds, mirosharkRunPending, mirosharkScenario, mirosharkSelectedTemplate, mirosharkSelectedTemplateFields, mirosharkTemplateInputs, runMirosharkExperiment, runMirosharkScenarioHelper, runtimeModelSelectionsByRuntime, selectedAgent, selectedSwarmRunId, setMirosharkAnalysisAgentId, setMirosharkPlatform, setMirosharkRounds, setMirosharkScenario, startNewMirosharkSimulation, swarmAgents, swarmDecisions, swarmMarket, swarmRuns, swarmSocialPosts, swarmStatusLabel, swarmTemplates, updateMirosharkTemplateInput } = props;
  return (<>
      {activeView === "swarm" ? (
      <section className="h-full min-h-0 overflow-hidden rounded-[18px] border border-[rgba(148,163,184,0.16)] bg-[rgba(5,8,13,0.72)]">
        <SwarmView
          runs={swarmRuns}
          agents={swarmAgents}
          decisions={swarmDecisions}
          market={swarmMarket}
          socialPosts={swarmSocialPosts}
          templates={swarmTemplates}
          statusLabel={swarmStatusLabel}
          selectedRunId={selectedSwarmRunId}
          archiveLoading={mirosharkArchiveLoading}
          onSelectRun={(run: SwarmRun) => {
            if (run.id !== currentSwarmRun?.id) void loadMirosharkArchivedRun(run.id);
          }}
          onLaunch={(templateId: TemplateId) => startNewMirosharkSimulation(templateId)}
          onPickTemplate={(templateId: TemplateId) => {
            const template = allMirosharkTemplates.find((item) => item.id === templateId);
            if (template) applyMirosharkTemplate(template);
          }}
          draftScenario={mirosharkScenario}
          draftRounds={mirosharkRounds}
          draftPlatform={mirosharkPlatform}
          templateFields={mirosharkSelectedTemplateFields}
          templateInputs={mirosharkTemplateInputs}
          missingTemplateFields={mirosharkMissingTemplateFields.length}
          runPending={mirosharkRunPending}
          onDraftScenarioChange={setMirosharkScenario}
          onDraftRoundsChange={setMirosharkRounds}
          onDraftPlatformChange={(platform: string) => {
            if (platform === "twitter" || platform === "reddit" || platform === "parallel" || platform === "polymarket") {
              setMirosharkPlatform(platform);
            }
          }}
          onTemplateInputChange={(key: string, value: string) => {
            if (mirosharkSelectedTemplate) updateMirosharkTemplateInput(mirosharkSelectedTemplate, key, value);
          }}
          onStartRun={() => void launchMirosharkSwarm()}
          onAskScenario={() => void runMirosharkScenarioHelper("ask")}
          onSuggestScenarios={() => void runMirosharkScenarioHelper("suggest")}
          helperPending={mirosharkHelperPending}
          helperStatus={mirosharkHelperStatus}
          loading={mirosharkRunPending || mirosharkArchiveStatus === "Loading saved run..."}
          loadingLabel={mirosharkArchiveStatus === "Loading saved run..." ? "Loading saved run" : mirosharkProgressLabel}
          onPublishX={(run: SwarmRun) => void runMirosharkExperiment("publish", run.id)}
          publishPending={mirosharkExperimentPending === "publish"}
          publishStatus={mirosharkExperimentStatus}
          analysisAgents={displayAgents}
          analysisRuntimeModels={runtimeModelSelectionsByRuntime}
          selectedAnalysisAgentId={mirosharkAnalysisAgentId || selectedAgent?.id}
          analysisPending={mirosharkAnalysisPending}
          analysisStatus={mirosharkAnalysisStatus}
          analysisResult={mirosharkAnalysisResult}
          onAnalysisAgentChange={setMirosharkAnalysisAgentId}
          onAnalyzeRun={(run: SwarmRun, mode: MiroSharkAnalysisMode) => void analyzeMirosharkRun(run, mode)}
        />
      </section>
      ) : null}

  </>);
}

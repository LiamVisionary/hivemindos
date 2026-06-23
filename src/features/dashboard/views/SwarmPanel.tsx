"use client";

/* SwarmPanel — the Work → Simulation route.

   Renders the redesigned Simulation UI (@/components/simulation) fed with REAL
   MiroShark data: swarmRuns/currentRun/market/agents/decisions are adapted into
   the UI's SimDataset, and the operational seams (select / launch / publish) are
   wired to the live MiroShark controller handlers. No demo data. */

import React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SwarmAgent, SwarmDecision, SwarmMarket, SwarmRun } from "@/components/swarm/swarm-data";
import {
  SimDataProvider, SimulationView, buildSimDataset, type Run, type SimDataset, type SimLaunchPayload,
} from "@/components/simulation";
import type { DashboardView, MiroSharkRunResult } from "@/features/dashboard/dashboard-types";

type MiroSharkPlatform = MiroSharkRunResult["platform"];

type SwarmPanelProps = {
  setActiveView: Dispatch<SetStateAction<DashboardView>>;
  // live data
  swarmRuns: SwarmRun[];
  currentSwarmRun: SwarmRun | null;
  swarmMarket: SwarmMarket;
  swarmAgents: SwarmAgent[];
  swarmDecisions: SwarmDecision[];
  swarmStatusLabel: string;
  selectedSwarmRunId: string;
  // status / loading
  mirosharkRunPending: boolean;
  mirosharkProgressLabel: string;
  mirosharkArchiveStatus: string;
  // composer draft state (read back to know when a deferred launch is ready)
  mirosharkScenario: string;
  // handlers
  loadMirosharkArchivedRun: (runId: string) => void | Promise<void>;
  startNewMirosharkSimulation: (templateId?: string) => void;
  launchMirosharkSwarm: () => void | Promise<void>;
  setMirosharkScenario: Dispatch<SetStateAction<string>>;
  setMirosharkRounds: Dispatch<SetStateAction<number>>;
  setMirosharkPlatform: Dispatch<SetStateAction<MiroSharkPlatform>>;
  runMirosharkExperiment: (action: "stop" | "inject" | "fork" | "branch" | "publish", runId: string) => void | Promise<void>;
};

function coercePlatform(value: string): MiroSharkPlatform {
  return value === "twitter" || value === "reddit" || value === "parallel" || value === "polymarket"
    ? value
    : "parallel";
}

export function SwarmPanel({
  setActiveView,
  swarmRuns,
  currentSwarmRun,
  swarmMarket,
  swarmAgents,
  swarmDecisions,
  swarmStatusLabel,
  selectedSwarmRunId,
  mirosharkRunPending,
  mirosharkProgressLabel,
  mirosharkArchiveStatus,
  mirosharkScenario,
  loadMirosharkArchivedRun,
  startNewMirosharkSimulation,
  launchMirosharkSwarm,
  setMirosharkScenario,
  setMirosharkRounds,
  setMirosharkPlatform,
  runMirosharkExperiment,
}: SwarmPanelProps) {
  // Deferred launch: launchMirosharkSwarm() reads the controller's scenario from
  // its closure, so we stage the composer state, then fire the launch on the
  // next render once mirosharkScenario reflects the requested scenario (and a
  // fresh launchMirosharkSwarm closure exists). A ref avoids a setState-in-effect.
  const pendingLaunchRef = React.useRef<SimLaunchPayload | null>(null);
  React.useEffect(() => {
    const pending = pendingLaunchRef.current;
    if (pending && mirosharkScenario === pending.scenario) {
      pendingLaunchRef.current = null;
      void launchMirosharkSwarm();
    }
  }, [mirosharkScenario, launchMirosharkSwarm]);

  const base = React.useMemo<Omit<SimDataset, "loading" | "loadingLabel" | "emptyLabel" | "onLaunch" | "onPublish" | "onSelectRun">>(
    () => buildSimDataset({
      runs: swarmRuns,
      currentRun: currentSwarmRun,
      market: swarmMarket,
      agents: swarmAgents,
      decisions: swarmDecisions,
      statusLabel: swarmStatusLabel,
    }),
    [swarmRuns, currentSwarmRun, swarmMarket, swarmAgents, swarmDecisions, swarmStatusLabel],
  );

  const loading = mirosharkRunPending || mirosharkArchiveStatus === "Loading saved run...";

  const dataset: SimDataset = {
    ...base,
    loading,
    loadingLabel: mirosharkArchiveStatus === "Loading saved run..." ? "Loading saved run" : (mirosharkProgressLabel || "MiroShark running"),
    emptyLabel: swarmStatusLabel ? `No swarm runs loaded · ${swarmStatusLabel}` : "No swarm runs loaded",
    onSelectRun: (run: Run) => {
      if (run.id !== currentSwarmRun?.id) void loadMirosharkArchivedRun(run.id);
    },
    onLaunch: (payload: SimLaunchPayload) => {
      startNewMirosharkSimulation(payload.template);
      setMirosharkPlatform(coercePlatform(payload.platform));
      setMirosharkRounds(payload.rounds);
      setMirosharkScenario(payload.scenario); // set last so it wins the batch
      pendingLaunchRef.current = payload;
    },
    onPublish: (run: Run) => { void runMirosharkExperiment("publish", run.id); },
  };

  return (
    <div style={{ height: "100%", overflow: "auto" }} aria-busy={loading || undefined}>
      <SimDataProvider value={dataset}>
        <SimulationView
          initialRunId={selectedSwarmRunId || currentSwarmRun?.id || undefined}
          onSelectMode={(mode) => setActiveView(mode as DashboardView)}
        />
      </SimDataProvider>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AgentProfile } from "@/lib/types/agent-runtime";
import type { AgentSchedule } from "@/features/dashboard/dashboard-types";
import { ONBOARDING_BRAIN_LOOPS, onboardingBrainLoopLabels } from "@/lib/config/brain-loops";
import { pickStrongestModelCandidate } from "@/lib/config/model-strength";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";

export type BrainReadinessStatus =
  | "hidden"
  | "no-queen"
  | "queen-model-unset"
  | "multiple-queens"
  | "loops-off";

export type BrainReadiness = {
  status: BrainReadinessStatus;
  queenName: string;
  queenId: string;
  /** Brain loops that cannot run until the queen issue is fixed. */
  blockedLoops: string[];
  /** multiple-queens only: who the strongest-model auto-crown would pick. */
  strongestName: string;
  busy: boolean;
  notice: string;
  onSetUpQueen: () => void;
  /** multiple-queens only: demote every queen in-session; the crown hook then promotes the strongest. */
  onCrownStrongest: () => void;
  onEnableLoops: () => void;
  onDismissLoops: () => void;
};

const LOOPS_DISMISSED_STATE_KEY = "hivemindos.fleet.brainLoopsCardDismissed.v1";

/**
 * Drives the fleet-view brain-readiness banner: surfaces a missing or
 * unfinished Queen Bee (which blocks the Daily Context / Weekly Synthesis
 * brain loops) and, once a queen works, offers a one-click enable of the
 * seeded Foundation loops bound to her. Enabling is explicit because these
 * loops spend scheduled model tokens.
 */
export function useBrainReadiness(input: {
  hydrated: boolean;
  agents: AgentProfile[];
  setAgents: Dispatch<SetStateAction<AgentProfile[]>>;
  schedules: AgentSchedule[];
  setSchedules: Dispatch<SetStateAction<AgentSchedule[]>>;
  refreshSharedSchedulesFromVault: () => Promise<unknown>;
  upsertSharedSchedule: (schedule: AgentSchedule) => Promise<unknown> | void;
  openQueenSettings: (queen: AgentProfile) => void;
  openQueenCreate: () => void;
}): BrainReadiness {
  const { hydrated, agents, setAgents, schedules, setSchedules, refreshSharedSchedulesFromVault, upsertSharedSchedule, openQueenSettings, openQueenCreate } = input;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [loopsDismissed, rememberLoopsDismissed] = useRememberedDashboardValue(LOOPS_DISMISSED_STATE_KEY, "");
  const schedulesRef = useRef(schedules);
  useEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

  const queens = useMemo(() => agents.filter((agent) => agent.beeRole === "queen"), [agents]);
  const queen = queens[0];
  // Only the dashboard-native runtime needs an explicit provider/model on the
  // profile; runtime-backed agents (Hermes, Aeon, ...) carry their own model
  // selection, so an empty profile model there is not a setup gap.
  const queenModelUnset = Boolean(queen && queen.runtime === "hivemind-os" && !queen.model?.trim() && !queen.provider?.trim());
  const enabledLoopIds = useMemo(() => new Set(
    schedules.filter((schedule) => schedule.enabled).map((schedule) => schedule.id),
  ), [schedules]);
  const loopsAllEnabled = ONBOARDING_BRAIN_LOOPS.every((loop) => enabledLoopIds.has(loop.scheduleId));

  const status: BrainReadinessStatus = !hydrated || agents.length === 0
    ? "hidden"
    : queens.length === 0
      ? "no-queen"
      : queens.length > 1
        ? "multiple-queens"
        : queenModelUnset
          ? "queen-model-unset"
          : !loopsAllEnabled && loopsDismissed !== "1"
            ? "loops-off"
            : "hidden";

  const onSetUpQueen = useCallback(() => {
    if (queen) openQueenSettings(queen);
    else openQueenCreate();
  }, [queen, openQueenSettings, openQueenCreate]);

  // Who the auto-crown would pick once the ambiguous queens are demoted —
  // shown on the multiple-queens action so the outcome is explicit.
  const strongest = useMemo(() => {
    const candidates = agents.filter((agent) => agent.beeRole !== "observer" && agent.beeRole !== "human");
    const named = candidates.find((agent) => /queen/i.test(agent.name));
    if (named) return named;
    const pick = pickStrongestModelCandidate(candidates.map((agent) => ({ key: agent.id, modelId: agent.model })));
    return pick ? candidates.find((agent) => agent.id === pick.key) : undefined;
  }, [agents]);

  // Demote every queen through THIS session's state so the write rides the
  // normal persist path (an external store edit loses to open tabs
  // re-persisting their in-memory agents). The crown hook sees a queenless
  // list on the same render pass and promotes the strongest agent.
  const onCrownStrongest = useCallback(() => {
    setAgents((current) => current.map((agent) => (
      agent.beeRole === "queen" ? { ...agent, beeRole: "worker" } : agent
    )));
  }, [setAgents]);

  const onEnableLoops = useCallback(() => {
    if (!queen || busy) return;
    setBusy(true);
    setNotice("");
    void (async () => {
      try {
        const missing = ONBOARDING_BRAIN_LOOPS.some((loop) => !schedulesRef.current.some((schedule) => schedule.id === loop.scheduleId));
        if (missing) await refreshSharedSchedulesFromVault();
        const now = Date.now();
        const targets = ONBOARDING_BRAIN_LOOPS
          .map((loop) => schedulesRef.current.find((schedule) => schedule.id === loop.scheduleId))
          .filter((schedule): schedule is AgentSchedule => Boolean(schedule));
        if (targets.length === 0) {
          setNotice("Foundation loop templates were not found in the shared vault. Open Schedules to import them.");
          return;
        }
        for (const schedule of targets) {
          if (schedule.enabled && schedule.agentId === queen.id) continue;
          const next = { ...schedule, enabled: true, agentId: queen.id, updatedAt: now };
          setSchedules((current) => current.map((item) => (item.id === next.id ? { ...item, ...next } : item)));
          await upsertSharedSchedule(next);
        }
        const skipped = ONBOARDING_BRAIN_LOOPS.length - targets.length;
        setNotice(skipped > 0
          ? `Enabled ${targets.length} loop${targets.length === 1 ? "" : "s"} on ${queen.name}. ${skipped} template${skipped === 1 ? " was" : "s were"} not found in the vault.`
          : `Enabled ${targets.map((schedule) => schedule.name).join(" and ")} on ${queen.name}.`);
      } finally {
        setBusy(false);
      }
    })();
  }, [queen, busy, refreshSharedSchedulesFromVault, setSchedules, upsertSharedSchedule]);

  const onDismissLoops = useCallback(() => {
    rememberLoopsDismissed("1");
  }, [rememberLoopsDismissed]);

  return {
    status,
    queenName: queen?.name ?? "",
    queenId: queen?.id ?? "",
    blockedLoops: onboardingBrainLoopLabels(),
    strongestName: strongest?.name ?? "",
    busy,
    notice,
    onSetUpQueen,
    onCrownStrongest,
    onEnableLoops,
    onDismissLoops,
  };
}

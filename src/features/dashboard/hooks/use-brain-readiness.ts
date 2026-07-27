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

function isAgentScheduleList(value: unknown): value is AgentSchedule[] {
  return Array.isArray(value) && value.every((item) => (
    item
    && typeof item === "object"
    && typeof (item as AgentSchedule).id === "string"
    && typeof (item as AgentSchedule).name === "string"
  ));
}

function mergeScheduleCandidates(current: AgentSchedule[], incoming: AgentSchedule[]): AgentSchedule[] {
  const byId = new Map(current.map((schedule) => [schedule.id, schedule]));
  for (const schedule of incoming) {
    const existing = byId.get(schedule.id);
    byId.set(schedule.id, {
      ...existing,
      ...schedule,
      lastRunAt: Math.max(existing?.lastRunAt ?? 0, schedule.lastRunAt ?? 0) || undefined,
      lastStatus: schedule.lastStatus ?? existing?.lastStatus,
      lastSummary: schedule.lastSummary ?? existing?.lastSummary,
    });
  }
  return [...byId.values()].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function withSharedScheduleResult(schedule: AgentSchedule, result: unknown): AgentSchedule {
  if (!result || typeof result !== "object") return schedule;
  const record = result as { path?: unknown; folder?: unknown };
  return {
    ...schedule,
    sharedSchedulePath: typeof record.path === "string" ? record.path : schedule.sharedSchedulePath,
    sharedRunFolder: typeof record.folder === "string" ? record.folder : schedule.sharedRunFolder,
  };
}

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
  const [loopsSyncedKey, setLoopsSyncedKey] = useState("");
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
  const loopSyncKey = `${queen?.id ?? ""}:${ONBOARDING_BRAIN_LOOPS.map((loop) => loop.scheduleId).join("|")}`;
  const shouldSyncLoopsBeforePrompt = Boolean(
    hydrated
    && agents.length > 0
    && queens.length === 1
    && !queenModelUnset
    && !loopsAllEnabled
    && loopsDismissed !== "1"
  );
  const loopsSyncPending = shouldSyncLoopsBeforePrompt && loopsSyncedKey !== loopSyncKey;

  useEffect(() => {
    if (!shouldSyncLoopsBeforePrompt || loopsSyncedKey === loopSyncKey) return;
    let cancelled = false;
    void refreshSharedSchedulesFromVault().finally(() => {
      if (cancelled) return;
      setLoopsSyncedKey(loopSyncKey);
    });
    return () => {
      cancelled = true;
    };
  }, [loopSyncKey, loopsSyncedKey, refreshSharedSchedulesFromVault, shouldSyncLoopsBeforePrompt]);

  const status: BrainReadinessStatus = !hydrated || agents.length === 0
    ? "hidden"
    : queens.length === 0
      ? "no-queen"
      : queens.length > 1
        ? "multiple-queens"
        : queenModelUnset
          ? "queen-model-unset"
          : !loopsAllEnabled && loopsDismissed !== "1" && !loopsSyncPending
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
        let availableSchedules = schedulesRef.current;
        if (missing) {
          const refreshed = await refreshSharedSchedulesFromVault();
          if (isAgentScheduleList(refreshed)) {
            availableSchedules = mergeScheduleCandidates(availableSchedules, refreshed);
          }
        }
        const now = Date.now();
        const targets = ONBOARDING_BRAIN_LOOPS
          .map((loop) => availableSchedules.find((schedule) => schedule.id === loop.scheduleId))
          .filter((schedule): schedule is AgentSchedule => Boolean(schedule));
        if (targets.length === 0) {
          setNotice("Foundation loop templates were not found in the shared vault. Open Schedules to import them.");
          return;
        }
        const updates: AgentSchedule[] = [];
        for (const schedule of targets) {
          const alreadyEnabledForQueen = schedule.enabled && schedule.agentId === queen.id;
          const next = alreadyEnabledForQueen ? schedule : { ...schedule, enabled: true, agentId: queen.id, updatedAt: now };
          const result = alreadyEnabledForQueen ? null : await upsertSharedSchedule(next);
          updates.push(withSharedScheduleResult(next, result));
        }
        if (updates.length) {
          schedulesRef.current = mergeScheduleCandidates(schedulesRef.current, updates);
          setSchedules((current) => mergeScheduleCandidates(current, updates));
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

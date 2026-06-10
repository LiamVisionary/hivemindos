"use client";

import { useEffect, useRef } from "react";
import { machineVersionCopy } from "@/features/dashboard/dashboard-display-helpers";
import { useVisibilityAwarePolling } from "@/features/dashboard/hooks/use-visibility-aware-polling";
import type { AppVersion, MachineGroup, MachineUpdateStatus } from "@/features/dashboard/dashboard-types";

const AUTO_UPDATE_TICK_MS = 60_000;
const AUTO_UPDATE_HIDDEN_TICK_MS = 2 * 60_000;
const AUTO_UPDATE_INITIAL_DELAY_MS = 15_000;
// A freshly pushed origin/main commit must sit unchanged this long before the
// fleet converges on it, so a burst of pushes triggers one update, not one per push.
const REMOTE_COMMIT_STABLE_MS = 10 * 60_000;
const RETRY_BACKOFF_MS = 30 * 60_000;
const MAX_ATTEMPTS_PER_COMMIT = 3;
const COMMIT_FIRST_SEEN_STORAGE_KEY = "hivemindos.fleet.autoUpdate.commitFirstSeen.v1";

type CommitFirstSeen = {
  commit: string;
  firstSeenAt: number;
};

function readCommitFirstSeen(): CommitFirstSeen | null {
  try {
    const raw = window.localStorage.getItem(COMMIT_FIRST_SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<CommitFirstSeen> : null;
    if (parsed?.commit && typeof parsed.firstSeenAt === "number") {
      return { commit: parsed.commit, firstSeenAt: parsed.firstSeenAt };
    }
  } catch {
    // Treat unreadable storage as never seen.
  }
  return null;
}

function writeCommitFirstSeen(value: CommitFirstSeen) {
  try {
    window.localStorage.setItem(COMMIT_FIRST_SEEN_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Without storage the stability window restarts each app load, which only delays auto-updates.
  }
}

type FleetAutoUpdateOptions = {
  enabled: boolean;
  paused: boolean;
  machineGroups: MachineGroup[];
  appVersion: AppVersion | null;
  updateStatusByMachine: Record<string, MachineUpdateStatus>;
  runMachineUpdate: (machine: MachineGroup) => void | Promise<void>;
};

/**
 * Keeps remote collectors converged on the latest pushed origin/main commit without
 * manual roster Update presses. Never touches the local machine (machine.self), only
 * acts once the remote commit has been stable for REMOTE_COMMIT_STABLE_MS, updates one
 * machine per tick, and backs off machines whose updates keep failing.
 */
export function useFleetAutoUpdate(options: FleetAutoUpdateOptions) {
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });
  const attemptsRef = useRef(new Map<string, { commit: string; attempts: number; lastAttemptAt: number }>());

  useVisibilityAwarePolling({
    enabled: options.enabled && !options.paused,
    intervalMs: AUTO_UPDATE_TICK_MS,
    hiddenIntervalMs: AUTO_UPDATE_HIDDEN_TICK_MS,
    initialDelayMs: AUTO_UPDATE_INITIAL_DELAY_MS,
    task: async () => {
      const { paused, machineGroups, appVersion, updateStatusByMachine, runMachineUpdate } = latestRef.current;
      if (paused) return;
      const target = appVersion?.latestCommit?.trim();
      if (!target) return;
      const now = Date.now();
      const seen = readCommitFirstSeen();
      if (seen?.commit !== target) {
        writeCommitFirstSeen({ commit: target, firstSeenAt: now });
        return;
      }
      if (now - seen.firstSeenAt < REMOTE_COMMIT_STABLE_MS) return;
      if (Object.values(updateStatusByMachine).some((status) => status.tone === "working")) return;
      // Tailnet sidecar nodes (e.g. the embedded Hivemind Link node) can surface the local
      // machine as a second roster entry that is not flagged `self`. Match on collector
      // machineId and reported appDir so those duplicates stay manual-only too.
      const selfMachineIds = new Set(
        machineGroups
          .filter((candidate) => candidate.self)
          .map((candidate) => candidate.machineId?.trim().toLowerCase())
          .filter(Boolean),
      );
      const selfAppDir = appVersion?.appDir?.trim();
      const machine = machineGroups.find((candidate) => {
        if (candidate.self || candidate.key === "unassigned" || !candidate.online) return false;
        const candidateMachineId = candidate.machineId?.trim().toLowerCase();
        if (candidateMachineId && selfMachineIds.has(candidateMachineId)) return false;
        // The update route runs updates for any locally-present appDir on this host's
        // shell, so a candidate reporting the dashboard's own checkout is the local
        // machine no matter what the tailnet calls it.
        if (selfAppDir && candidate.version?.appDir?.trim() === selfAppDir) return false;
        // "stale" means the collector reports a commit that differs from origin/main;
        // machines with no reported version stay manual-only.
        if (machineVersionCopy(candidate, target)?.state !== "stale") return false;
        const attempt = attemptsRef.current.get(candidate.key);
        if (!attempt || attempt.commit !== target) return true;
        return attempt.attempts < MAX_ATTEMPTS_PER_COMMIT && now - attempt.lastAttemptAt >= RETRY_BACKOFF_MS;
      });
      if (!machine) return;
      const attempt = attemptsRef.current.get(machine.key);
      attemptsRef.current.set(machine.key, {
        commit: target,
        attempts: attempt?.commit === target ? attempt.attempts + 1 : 1,
        lastAttemptAt: now,
      });
      await runMachineUpdate(machine);
    },
  });
}

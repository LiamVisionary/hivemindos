// src/features/dashboard/views/fusion-showcase/use-fusion-stage.ts
// Narrative state machine for the Fusion view:
// idle → sent → thinking → discover → carry → fuse → fused → verify → reveal
"use client";

import { useEffect, useRef, useState } from "react";

export const PHASES = [
  "idle", "sent", "thinking", "discover", "carry", "fuse", "fused", "verify", "reveal",
] as const;
export type Phase = (typeof PHASES)[number];

const SENT_PAUSE_MS = 500;
const THINKING_MS = 2000;
const DISCOVER_MS = 2600;
const DISCOVER_STEP_MS = 200;
const CARRY_MS = 3900;
const FUSE_MS = 2600;
const FUSED_MS = 1600;
const VERIFY_MS = 1700;
const REVEAL_MS = 3600;
const INTRO_MS = SENT_PAUSE_MS + THINKING_MS;
const PROGRESSION = [DISCOVER_MS, CARRY_MS, FUSE_MS, FUSED_MS, VERIFY_MS, REVEAL_MS];

export interface Stage {
  idx: number;
  name: Phase;
  typed: string;
  typing: boolean;
  running: boolean;
  discoveredCount: number;
  /** phase index >= the named phase */
  at: (p: Phase) => boolean;
  /** currently exactly at the named phase */
  is: (p: Phase) => boolean;
}

export function useFusionStage(prompt: string, runId: number, capabilityCount = 10, discoveryReady = true): Stage {
  const [phaseState, setPhaseState] = useState({ runId: 0, value: 0 });
  const [discoveredState, setDiscoveredState] = useState({ runId: 0, value: 0 });
  const introTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const progressTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runStartedAt = useRef(0);

  useEffect(() => {
    introTimers.current.forEach(clearTimeout);
    progressTimers.current.forEach(clearTimeout);
    introTimers.current = [];
    progressTimers.current = [];
    if (runId <= 0) {
      return undefined;
    }
    runStartedAt.current = Date.now();
    introTimers.current.push(setTimeout(() => setPhaseState({ runId, value: 1 }), 0));
    introTimers.current.push(setTimeout(() => setDiscoveredState({ runId, value: 0 }), 0));
    introTimers.current.push(setTimeout(() => setPhaseState({ runId, value: 2 }), SENT_PAUSE_MS));
    return () => {
      introTimers.current.forEach(clearTimeout);
      progressTimers.current.forEach(clearTimeout);
    };
  }, [runId]);

  useEffect(() => {
    progressTimers.current.forEach(clearTimeout);
    progressTimers.current = [];
    if (runId <= 0 || !discoveryReady) return undefined;

    const startDelay = Math.max(0, INTRO_MS - (Date.now() - runStartedAt.current));
    let acc = startDelay;
    progressTimers.current.push(setTimeout(() => setPhaseState({ runId, value: 3 }), acc));
    const discoveredTotal = Math.max(0, capabilityCount);
    for (let i = 0; i < discoveredTotal; i += 1) {
      progressTimers.current.push(setTimeout(() => setDiscoveredState({ runId, value: i + 1 }), acc + i * DISCOVER_STEP_MS));
    }
    PROGRESSION.forEach((ms, index) => {
      acc += ms;
      progressTimers.current.push(setTimeout(() => setPhaseState({ runId, value: index + 4 }), acc));
    });
    return () => progressTimers.current.forEach(clearTimeout);
  }, [capabilityCount, discoveryReady, runId]);

  const phase = phaseState.runId === runId ? phaseState.value : 0;
  const discoveredCount = discoveredState.runId === runId ? discoveredState.value : 0;
  const name = PHASES[phase];
  return {
    idx: phase,
    name,
    typed: runId > 0 ? prompt : "",
    typing: false,
    running: runId > 0 && !["idle", "reveal"].includes(name),
    discoveredCount,
    at: (p: Phase) => phase >= PHASES.indexOf(p),
    is: (p: Phase) => name === p,
  };
}

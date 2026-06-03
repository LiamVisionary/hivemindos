// src/components/fusion/use-fusion-stage.ts
// Looping narrative state machine for the Constellation hero:
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
const DISCOVERED_CAPABILITY_COUNT = 10;
const CARRY_MS = 3900;
const FUSE_MS = 2600;
const FUSED_MS = 1600;
const VERIFY_MS = 1700;
const REVEAL_MS = 3600;
const DURATIONS = [SENT_PAUSE_MS, THINKING_MS, DISCOVER_MS, CARRY_MS, FUSE_MS, FUSED_MS, VERIFY_MS, REVEAL_MS];

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

export function useFusionStage(prompt: string, runId: number): Stage {
  const [phaseState, setPhaseState] = useState({ runId: 0, value: 0 });
  const [discoveredState, setDiscoveredState] = useState({ runId: 0, value: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (runId <= 0) {
      return undefined;
    }
    let acc = 0;
    DURATIONS.forEach((ms, i) => {
      timers.current.push(setTimeout(() => setPhaseState({ runId, value: i + 1 }), acc));
      acc += ms;
    });
    const discoveryStart = SENT_PAUSE_MS + THINKING_MS;
    for (let i = 0; i < DISCOVERED_CAPABILITY_COUNT; i += 1) {
      timers.current.push(setTimeout(() => setDiscoveredState({ runId, value: i + 1 }), discoveryStart + i * DISCOVER_STEP_MS));
    }
    return () => timers.current.forEach(clearTimeout);
  }, [runId]);

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

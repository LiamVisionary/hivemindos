"use client";

import { useSyncExternalStore } from "react";

/**
 * Global store for the live voice-input level meter (18 bands, 0..1).
 *
 * The mic analyser pushes a new bands array ~12x/second while recording. Holding
 * that in DashboardApp root state re-rendered the entire dashboard tree (and every
 * unmemoized panel) 12x/second for the whole recording. Moving it into this tiny
 * external store lets ONLY the <VoiceWaveform/> bars subscribe and re-render at
 * 12fps, leaving the root and panels untouched. There is a single mic at a time,
 * so a single global value is correct (the existing root state was global too).
 */

const BAND_COUNT = 18;
// Stable idle reference: getSnapshot must return the same reference when nothing
// changed, or useSyncExternalStore loops. `current` stays === IDLE until a push.
const IDLE: readonly number[] = Object.freeze(Array(BAND_COUNT).fill(0));

let current: readonly number[] = IDLE;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Push the latest analyser sample (called ~12x/second while recording). */
export function pushVoiceBands(next: number[]): void {
  current = next;
  emit();
}

/** Reset to a flat idle meter (called when recording stops). */
export function resetVoiceBands(): void {
  if (current === IDLE) return;
  current = IDLE;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly number[] {
  return current;
}

function getServerSnapshot(): readonly number[] {
  return IDLE;
}

/** Subscribe a component to the live voice bands. */
export function useVoiceBands(): readonly number[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

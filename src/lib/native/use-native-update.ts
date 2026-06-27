"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForNativeUpdate, installNativeUpdate, updaterErrorText, type UpdateProgress } from "./updater";

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check every 6h while the app stays open

export type NativeUpdatePhase = "idle" | UpdateProgress["phase"];

export type NativeUpdateState = {
  /** A signed newer release is published (packaged builds only). */
  available: boolean;
  /** Target version string, when available. */
  version: string | null;
  /** An install is in progress. */
  busy: boolean;
  phase: NativeUpdatePhase;
  /** Download progress 0-100, or null when the server sent no content length. */
  percent: number | null;
  error: string | null;
  /** Begin download + install + relaunch for the pending update. */
  install: () => void;
};

/**
 * Background update awareness for the main window. Checks once on mount and
 * then periodically; exposes an install action that drives the same signed
 * download/install/relaunch flow as the About window. No-ops in dev/web.
 */
export function useNativeUpdate(): NativeUpdateState {
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<NativeUpdatePhase>("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingUpdate = useRef<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const check = async () => {
      try {
        const update = await checkForNativeUpdate(controller.signal);
        if (cancelled) return;
        pendingUpdate.current = update;
        setAvailable(Boolean(update));
        setVersion(update?.version ?? null);
      } catch {
        // Background check: stay quiet on transient network/endpoint errors.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), RECHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const install = useCallback(() => {
    const update = pendingUpdate.current;
    if (!update || busy) return;
    setBusy(true);
    setError(null);
    setPhase("downloading");
    setPercent(null);
    void (async () => {
      try {
        await installNativeUpdate(update, (progress) => {
          setPhase(progress.phase);
          setPercent(progress.phase === "downloading" ? progress.percent : null);
        });
        // installNativeUpdate relaunches on success and never returns here.
      } catch (err) {
        setBusy(false);
        setPhase("idle");
        setError(updaterErrorText(err, "Update failed."));
      }
    })();
  }, [busy]);

  return { available, version, busy, phase, percent, error, install };
}

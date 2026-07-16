"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";

/**
 * A string value remembered across reloads and app surfaces through the shared
 * dashboard state service (AGENTS.md: browser storage must not hold durable
 * HivemindOS state). Hydrates asynchronously: callers see `initialValue` on
 * the first render(s), then the stored value unless the user already changed
 * it locally this session.
 * The third tuple value reports when hydration has settled; existing callers
 * that only consume the value and setter remain unchanged.
 */
export function useRememberedDashboardValue(stateKey: string, initialValue = "") {
  const [value, setValue] = useState(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const touchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadDashboardStateSnapshot()
      .then((snapshot) => {
        const stored = snapshot[stateKey];
        if (!cancelled && !touchedRef.current && typeof stored === "string" && stored) {
          setValue(stored);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [stateKey]);

  const remember = useCallback(
    (next: string) => {
      touchedRef.current = true;
      setValue(next);
      void saveDashboardStateValue(stateKey, next).catch(() => undefined);
    },
    [stateKey],
  );

  return [value, remember, hydrated] as const;
}

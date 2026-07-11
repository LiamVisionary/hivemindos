"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COMPANION_HOLOGRAM_KEY,
  COMPANION_POPOVER_KEY,
  readCompanionSettings,
  saveCompanionFlag,
  subscribeCompanionState,
  type CompanionSettings,
} from "./companion-install";

const DEFAULT_SETTINGS: CompanionSettings = {
  installed: false,
  popoverEnabled: false,
  hologramEnabled: true,
};

/**
 * Live view of the companion module's settings (installed / popover /
 * hologram), re-read whenever any surface writes a companion flag. Starts at
 * defaults until the dashboard-state snapshot hydrates.
 */
export function useCompanionSettings() {
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_SETTINGS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readCompanionSettings().then((next) => {
        if (cancelled) return;
        setSettings(next);
        setHydrated(true);
      });
    };
    refresh();
    const unsubscribe = subscribeCompanionState(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setPopoverEnabled = useCallback(async (enabled: boolean) => {
    await saveCompanionFlag(COMPANION_POPOVER_KEY, enabled);
  }, []);

  const setHologramEnabled = useCallback(async (enabled: boolean) => {
    await saveCompanionFlag(COMPANION_HOLOGRAM_KEY, enabled);
  }, []);

  return { settings, hydrated, setPopoverEnabled, setHologramEnabled };
}

"use client";

import { useCallback, useMemo } from "react";

import {
  DEFAULT_PINNED_VIEWS,
  parsePinnedUtilities,
  serializePinnedUtilities,
  togglePinnedUtility as togglePinnedUtilityList,
} from "@/features/dashboard/dashboard-navigation";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";

const PINNED_UTILITIES_STATE_KEY = "hivemindos.nav.pinnedUtilities";

/**
 * User-pinned utility views, shared by the nav rail's third section
 * (AppNavShelf) and the More launcher's Pinned row. Persisted as CSV through
 * the shared dashboard-state service (not browser storage), seeded with today's
 * default rail utilities so the shelf is unchanged on first run.
 */
export function usePinnedUtilities() {
  const [pinnedCsv, rememberPinnedCsv] = useRememberedDashboardValue(
    PINNED_UTILITIES_STATE_KEY,
    serializePinnedUtilities(DEFAULT_PINNED_VIEWS),
  );
  const pinnedUtilities = useMemo(() => parsePinnedUtilities(pinnedCsv), [pinnedCsv]);
  const togglePinnedUtility = useCallback(
    (id: DashboardView) => {
      rememberPinnedCsv(serializePinnedUtilities(togglePinnedUtilityList(parsePinnedUtilities(pinnedCsv), id)));
    },
    [pinnedCsv, rememberPinnedCsv],
  );
  return { pinnedUtilities, togglePinnedUtility };
}

"use client";

import { useCallback, useMemo } from "react";

import {
  DEFAULT_PINNED_VIEWS,
  DEFAULT_REMOVED_RAIL_VIEWS,
  computeRailPinnedViews,
  isRemovableRailView,
  parsePinnedUtilities,
  parseRemovedRailViews,
  serializePinnedUtilities,
  serializeRemovedRailViews,
  togglePinnedUtility as togglePinnedUtilityList,
} from "@/features/dashboard/dashboard-navigation";
import type { DashboardView } from "@/features/dashboard/dashboard-types";
import { useRememberedDashboardValue } from "@/lib/services/use-remembered-dashboard-value";

const PINNED_UTILITIES_STATE_KEY = "hivemindos.nav.pinnedUtilities";
const REMOVED_RAIL_STATE_KEY = "hivemindos.nav.removedRailViews";

/**
 * The views pinned to the nav rail's customizable slots, shared by the rail
 * (AppNavShelf) and the More launcher's Pinned row. Two persisted CSVs back it,
 * both through the shared dashboard-state service (not browser storage):
 *  - `pinnedUtilities` — opt-in utilities; absence means "not pinned".
 *  - `removedRailViews` — the opt-out removable Primary/Work views
 *    (Wallets/Trade/Socials/Simulations). New workspaces keep these in More;
 *    pinning one removes it from this list. `togglePinnedUtility` routes to the
 *    right key per view.
 */
export function usePinnedUtilities() {
  const [pinnedCsv, rememberPinnedCsv] = useRememberedDashboardValue(
    PINNED_UTILITIES_STATE_KEY,
    serializePinnedUtilities(DEFAULT_PINNED_VIEWS),
  );
  const [removedCsv, rememberRemovedCsv] = useRememberedDashboardValue(
    REMOVED_RAIL_STATE_KEY,
    serializeRemovedRailViews(DEFAULT_REMOVED_RAIL_VIEWS),
  );
  const pinnedUtilities = useMemo(() => computeRailPinnedViews(pinnedCsv, removedCsv), [pinnedCsv, removedCsv]);
  const togglePinnedUtility = useCallback(
    (id: DashboardView) => {
      if (isRemovableRailView(id)) {
        rememberRemovedCsv(serializeRemovedRailViews(togglePinnedUtilityList(parseRemovedRailViews(removedCsv), id)));
      } else {
        rememberPinnedCsv(serializePinnedUtilities(togglePinnedUtilityList(parsePinnedUtilities(pinnedCsv), id)));
      }
    },
    [pinnedCsv, removedCsv, rememberPinnedCsv, rememberRemovedCsv],
  );
  return { pinnedUtilities, togglePinnedUtility };
}

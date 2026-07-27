"use client";

/* sim-view-context.tsx — lets a deep run-card control (SimControls) ask the
   SimulationView to open the launch composer, seeded from an existing run. This
   is how "Re-run / Retry / Launch run" surface the SAME launch options (Local
   MiroShark vs paid x402) as a fresh run, rather than silently relaunching. A
   separate module so SimulationView and theater.tsx don't import each other. */

import React from "react";
import type { Run } from "./sim-data";

export interface SimViewActions {
  /** Open the composer pre-seeded with this run's scenario, with mode choice. */
  rerun: (run: Run) => void;
}

const SimViewContext = React.createContext<SimViewActions | null>(null);
export const SimViewProvider = SimViewContext.Provider;
export function useSimView(): SimViewActions | null {
  return React.useContext(SimViewContext);
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fleetHiveViewSource = readFileSync("src/components/fleet-hive/FleetHiveView.tsx", "utf8");
const hivePanelSource = readFileSync("src/components/fleet-hive/HivePanel.tsx", "utf8");
const hiveStageSource = readFileSync("src/components/fleet-hive/HiveStage.tsx", "utf8");
const fleetHiveCss = readFileSync("src/components/fleet-hive/fleet-hive.css", "utf8");

assert.match(
  fleetHiveViewSource,
  /\.filter\(\(\[, status\]\) => status === "updating"\)/,
  "Fleet Hive should derive updating machine ids from the canonical machine update status map",
);

const hiveStageCall = fleetHiveViewSource.match(/<HiveStage[\s\S]*?\/>/)?.[0] ?? "";
assert.match(
  hiveStageCall,
  /updatingMachineIds=\{updatingMachineIds\}/,
  "the focused Hive stage should receive machine update state",
);

assert.match(
  hiveStageSource,
  /updatingMachineIds\?\.has\(m\.id\) \?\? false/,
  "each focused Hive machine cell should resolve its own update state",
);
assert.match(
  hiveStageSource,
  /className="fr-machine-update-status" role="status" aria-live="polite"/,
  "updating machine cells should expose a polite live status",
);
assert.match(
  hiveStageSource,
  /<LoaderCircle className="fr-machine-update-spinner animate-spin"[\s\S]*?Updating…/,
  "updating machine cells should render the shared spinner treatment and visible label",
);
assert.match(
  hiveStageSource,
  /\$\{updating \? "updating, " : ""\}/,
  "the machine cell accessible label should include the update state",
);
assert.match(
  fleetHiveCss,
  /\.fr-machine-node-content\[data-updating="true"\]/,
  "updating cells should reserve space for the status without hiding machine text",
);
assert.match(
  fleetHiveCss,
  /\.fr-machine-update-status\s*\{[\s\S]*?color:\s*var\(--live\)/,
  "the update label should use the Fleet live-status token in both themes",
);
assert.match(
  fleetHiveCss,
  /prefers-reduced-motion:[\s\S]*?\.fr-machine-update-spinner \{ animation: none !important; \}/,
  "the update spinner should respect reduced-motion preferences",
);
assert.match(
  fleetHiveViewSource,
  /detail:\s*detail\?\.detail/,
  "the focused Hive panel should receive the actionable machine update detail",
);
assert.match(
  hivePanelSource,
  /update\?\.detail[\s\S]*?aria-live="polite"[\s\S]*?update\.detail/,
  "the focused Hive panel should visibly announce why an update is waiting or failed",
);

console.log("fleet hive machine update status contract ok");

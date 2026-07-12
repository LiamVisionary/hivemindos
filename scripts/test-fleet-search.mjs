import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildFleetFocus,
  buildFleetSearchIndex,
  fleetAgentMatchesFilter,
  fleetMachineNeedsAttention,
  searchFleetIndex,
} from "../src/components/fleet/fleet-search.ts";

const machines = [
  {
    id: "local-mac",
    name: "Liam's MacBook",
    kind: "Laptop",
    role: "Primary",
    os: "macOS 26 · M4 Max",
    location: "Manila",
    city: "Manila",
    ip: "100.x.x.x",
    tailnet: "liams-macbook.tailnet",
    uptime: "online",
    versionState: "current",
    agents: [
      {
        id: "scout",
        name: "Scout",
        runtime: "hermes",
        role: "Research",
        task: "Finding Base ecosystem news",
        provider: "openai",
        model: "gpt-5",
        state: "working",
      },
      {
        id: "writer",
        name: "Honey Writer",
        runtime: "codex",
        role: "Writer",
        task: "Waiting for a brief",
        state: "ready",
      },
    ],
  },
  {
    id: "hel1-2",
    name: "hivemindos-ubuntu-hel1-2",
    kind: "Cloud Server",
    role: "Worker",
    os: "Ubuntu 24.04",
    location: "Helsinki",
    city: "Helsinki",
    ip: "100.y.y.y",
    tailnet: "hel1-2.tailnet",
    uptime: "online",
    versionState: "stale",
    agents: [
      {
        id: "probe",
        name: "Fleet Probe",
        runtime: "aeon",
        role: "QA",
        task: "Collector needs repair",
        state: "failed",
      },
    ],
  },
];

const index = buildFleetSearchIndex(machines);
assert.equal(index.length, 5, "index should contain every machine and agent");

const scout = searchFleetIndex(index, "scout");
assert.equal(scout[0]?.key, "agent:scout", "an exact agent-name match should rank first");
assert.match(scout[0]?.detail ?? "", /Liam's MacBook/, "agent result should name its parent machine");

const taskMatch = searchFleetIndex(index, "base ecosystem");
assert.equal(taskMatch[0]?.key, "agent:scout", "agent tasks should be searchable");

const runtimeMatch = searchFleetIndex(index, "aeon helsinki");
assert.equal(runtimeMatch[0]?.key, "agent:probe", "runtime and parent-machine metadata should combine in search");

const machineMatch = searchFleetIndex(index, "hivemindos ubuntu");
assert.equal(machineMatch[0]?.key, "machine:hel1-2", "machine names should rank ahead of secondary agent matches");

assert.equal(fleetMachineNeedsAttention(machines[1]), true, "stale or failed machines need attention");
assert.equal(fleetAgentMatchesFilter(machines[0].agents[0], "working"), true);
assert.equal(fleetAgentMatchesFilter(machines[0].agents[1], "working"), false);

const machineFocus = buildFleetFocus(machines, index, "liam's macbook", "all");
assert.deepEqual(machineFocus.machineIds, ["local-mac"], "matching a machine should focus its cluster");
assert.deepEqual(machineFocus.agentIds.sort(), ["scout", "writer"], "matching a machine should include all of its agents");

const agentFocus = buildFleetFocus(machines, index, "fleet probe", "all");
assert.deepEqual(agentFocus.machineIds, ["hel1-2"], "matching an agent should retain parent-machine context");
assert.deepEqual(agentFocus.agentIds, ["probe"]);

const workingFocus = buildFleetFocus(machines, index, "", "working");
assert.deepEqual(workingFocus.machineIds, ["local-mac"]);
assert.deepEqual(workingFocus.agentIds, ["scout"]);

const attentionFocus = buildFleetFocus(machines, index, "", "attention");
assert.deepEqual(attentionFocus.machineIds, ["hel1-2"]);
assert.deepEqual(attentionFocus.agentIds, ["probe"]);

const commandPaletteSource = readFileSync(new URL("../src/features/dashboard/views/DashboardCommandPalette.tsx", import.meta.url), "utf8");
assert.match(commandPaletteSource, /target: \{ view: "agents", agentId: agent\.id \}/, "global agent search should locate in Fleet");
assert.doesNotMatch(commandPaletteSource, /displayAgents\.slice\(0, 24\)/, "global agent search should not hide agents beyond the first 24");

const hiveViewSource = readFileSync(new URL("../src/components/fleet-hive/FleetHiveView.tsx", import.meta.url), "utf8");
assert.match(hiveViewSource, /DASHBOARD_TARGET_APPLIED_EVENT/, "Fleet Hive should receive command-palette and deep-link targets");

const fleetFinderSource = readFileSync(new URL("../src/components/fleet-hive/FleetFinder.tsx", import.meta.url), "utf8");
assert.match(fleetFinderSource, /onOpenChange\(false\);\s*inputRef\.current\?\.blur\(\);/, "clicking outside should close and defocus the finder");

const fleetHiveCss = readFileSync(new URL("../src/components/fleet-hive/fleet-hive.css", import.meta.url), "utf8");
assert.match(fleetHiveCss, /\.fr-root \.fr-finder > input:focus-visible \{ outline: none; \}/, "the finder shell, not its inner input rectangle, should own focus styling");

const hivePanelSource = readFileSync(new URL("../src/components/fleet-hive/HivePanel.tsx", import.meta.url), "utf8");
assert.match(hivePanelSource, /className="fr-agent-task"/, "the selected-agent task should use the wrapping detail-card class");
assert.match(
  fleetHiveCss,
  /\.fr-agent-task\s*\{[^}]*overflow-wrap:\s*anywhere;/s,
  "long selected-agent task text should wrap inside the Fleet detail panel",
);

console.log("fleet search ranking, focus filters, global routing, and finder dismissal ok");

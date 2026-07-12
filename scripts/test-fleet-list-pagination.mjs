import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  FLEET_AGENT_PAGE_SIZE,
  fleetAgentsForDisplay,
  nextFleetAgentLimit,
} from "../src/components/fleet/list-view-pagination.ts";

const agents = Array.from({ length: 11 }, (_, index) => `agent-${index + 1}`);

assert.equal(FLEET_AGENT_PAGE_SIZE, 3);
assert.deepEqual(fleetAgentsForDisplay(agents), agents.slice(0, 3));
assert.deepEqual(fleetAgentsForDisplay(agents, nextFleetAgentLimit()), agents.slice(0, 6));
assert.deepEqual(fleetAgentsForDisplay(agents, Number.POSITIVE_INFINITY), agents);
assert.deepEqual(fleetAgentsForDisplay(agents.slice(0, 3)), agents.slice(0, 3));

const listViewSource = readFileSync("src/components/fleet/list-view.tsx", "utf8");
assert.match(listViewSource, /visibleAgents\.map\(\(a\) =>/);
assert.match(listViewSource, /onClick=\{\(\) => showMoreAgents\(m\.id\)\}/);
assert.match(listViewSource, /onClick=\{\(\) => showAllAgents\(m\.id\)\}/);
assert.ok(listViewSource.indexOf("Show more") < listViewSource.indexOf("Show all"));
assert.match(
  listViewSource,
  /Number\(isFleetMachineMobile\(left\.machine\)\) - Number\(isFleetMachineMobile\(right\.machine\)\)/,
);

console.log("fleet list agent pagination ok");

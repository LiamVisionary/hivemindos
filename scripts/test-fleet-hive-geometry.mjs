import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  axialToPixel,
  axialToPixelWithStep,
} from "../src/components/fleet/hex-math.ts";
import {
  AGENT_SIZE,
  CELL,
  FR_HEX_CLIP,
  MACHINE_SIZE,
  QX,
  QY,
  frAddMachinePos,
  frBuildLayout,
} from "../src/components/fleet-hive/hive-geometry.ts";

const sharedProjection = axialToPixelWithStep(1, -1);
assert.deepEqual(axialToPixel(1, -1), sharedProjection, "classic axialToPixel should delegate to the shared projection helper");

const machines = [
  machine("this-mac", "Hivemind Agent T", "Primary", [
    agent("hermes", "Hermes Agent01", "working"),
    agent("sovereign", "Swarm Sovereign", "scheduled"),
    agent("brain", "Brain Sync", "ready"),
  ]),
  machine("octavia", "Octavia Butler", "Worker", [
    agent("ida", "Ida B Wells", "working"),
    agent("ubuntu", "ubuntu helper", "ready"),
    agent("gwen", "Gwen Runner", "scheduled"),
  ]),
  machine("atlas", "atlas", "Worker", [
    agent("openclaw", "OpenClaw", "ready"),
    agent("codex", "Codex", "working"),
  ]),
  machine("nimbus", "nimbus", "Worker", [
    agent("aeon", "AEON", "scheduled"),
    agent("miro", "MiroShark", "ready"),
    agent("queen-aide", "Queen Aide", "ready"),
  ]),
  machine("edge", "edge", "Worker", [
    agent("link", "Link Agent", "ready"),
    agent("probe", "Probe Agent", "failed"),
  ]),
];

const layout = frBuildLayout(machines);
const cells = [
  { id: "queen", center: { x: QX, y: QY }, size: 150 },
  { id: "add-machine", center: frAddMachinePos(machines), size: MACHINE_SIZE },
];

for (const hiveMachine of machines) {
  const machineLayout = layout[hiveMachine.id];
  assert.ok(machineLayout, `missing layout for ${hiveMachine.id}`);
  cells.push({ id: `${hiveMachine.id}:machine`, center: machineLayout.pos, size: MACHINE_SIZE });
  cells.push({ id: `${hiveMachine.id}:add`, center: machineLayout.addPos, size: AGENT_SIZE });
  for (const { agent: hiveAgent, pos } of machineLayout.agents) {
    cells.push({ id: `${hiveMachine.id}:${hiveAgent.id}`, center: pos, size: AGENT_SIZE });
  }
}

for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
    const left = cells[leftIndex];
    const right = cells[rightIndex];
    assert.equal(
      polygonsOverlap(hexPolygon(left), hexPolygon(right)),
      false,
      `${left.id} overlaps ${right.id}`,
    );
  }
}

assert.ok(FR_HEX_CLIP.includes("polygon("), "fleet hive cell clip path remains polygon-based");
assert.ok(CELL > 0, "fleet hive cell size is positive");

const hiveStageSource = readFileSync("src/components/fleet-hive/HiveStage.tsx", "utf8");
assert.doesNotMatch(
  hiveStageSource,
  /FleetSelectionTooltipContent/,
  "new Hive stage should keep hover tooltips lightweight instead of mounting the classic action panel",
);
assert.match(
  hiveStageSource,
  /TooltipTrigger asChild/,
  "new Hive cells should be Radix tooltip triggers for small hover labels",
);
assert.match(
  hiveStageSource,
  /<TooltipContent>{agent\.name}<\/TooltipContent>/,
  "agent cells should show a small name tooltip",
);
assert.match(
  hiveStageSource,
  /<TooltipContent>{m\.name}<\/TooltipContent>/,
  "machine cells should show a small name tooltip",
);
const fleetHiveViewSource = readFileSync("src/components/fleet-hive/FleetHiveView.tsx", "utf8");
const hiveStageCall = fleetHiveViewSource.match(/<HiveStage[\s\S]*?\/>/)?.[0] ?? "";
assert.doesNotMatch(hiveStageCall, /selectionTooltipKey=/, "HiveStage should not receive rich selection tooltip state");

console.log(`fleet hive geometry + simple tooltip wiring ok: ${cells.length} cells checked`);

function machine(id, name, role, agents) {
  return {
    id,
    name,
    role,
    kind: "Desktop",
    status: "online",
    cpu: 0,
    mem: 0,
    disk: 0,
    agents,
  };
}

function agent(id, name, state) {
  return {
    id,
    name,
    role: "Worker bee",
    runtime: "Codex",
    state,
  };
}

function hexPolygon(cell) {
  const s = cell.size;
  const x = cell.center.x;
  const y = cell.center.y;
  return [
    [x, y - 0.49 * s],
    [x + 0.43 * s, y - 0.25 * s],
    [x + 0.43 * s, y + 0.25 * s],
    [x, y + 0.49 * s],
    [x - 0.43 * s, y + 0.25 * s],
    [x - 0.43 * s, y - 0.25 * s],
  ];
}

function polygonsOverlap(left, right) {
  const axes = [...polygonAxes(left), ...polygonAxes(right)];
  return axes.every((axis) => {
    const leftProjection = projectPolygon(left, axis);
    const rightProjection = projectPolygon(right, axis);
    return leftProjection.max > rightProjection.min + 0.001
      && rightProjection.max > leftProjection.min + 0.001;
  });
}

function polygonAxes(points) {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const edge = [next[0] - point[0], next[1] - point[1]];
    const normal = [-edge[1], edge[0]];
    const length = Math.hypot(normal[0], normal[1]) || 1;
    return [normal[0] / length, normal[1] / length];
  });
}

function projectPolygon(points, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const projection = point[0] * axis[0] + point[1] * axis[1];
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

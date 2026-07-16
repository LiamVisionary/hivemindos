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
  MACHINE_AGENT_GUTTER,
  MACHINE_SIZE,
  QX,
  QY,
  frBuildLayout,
  frPhonePlaceholderPos,
} from "../src/components/fleet-hive/hive-geometry.ts";
import {
  frBuildLegacyLayout,
} from "../src/components/fleet-hive/hive-legacy-geometry.ts";

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
  { id: "phone-placeholder", center: frPhonePlaceholderPos(machines, layout), size: MACHINE_SIZE },
];

for (const hiveMachine of machines) {
  const machineLayout = layout[hiveMachine.id];
  assert.ok(machineLayout, `missing layout for ${hiveMachine.id}`);
  cells.push({ id: `${hiveMachine.id}:machine`, center: machineLayout.pos, size: MACHINE_SIZE });
  for (const { agent: hiveAgent, pos } of machineLayout.agents) {
    const centerDistance = Math.hypot(pos.x - machineLayout.pos.x, pos.y - machineLayout.pos.y);
    assert.ok(
      centerDistance >= 0.43 * (MACHINE_SIZE + AGENT_SIZE) + MACHINE_AGENT_GUTTER - 0.001,
      `${hiveMachine.id}:${hiveAgent.id} should keep the machine-agent gutter`,
    );
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
assert.ok(MACHINE_SIZE > AGENT_SIZE, "machine nodes should be larger than agent nodes");
assert.ok(MACHINE_SIZE / AGENT_SIZE <= 1.2, "machine and agent sizes should keep expanded clusters cohesive");
assert.equal(MACHINE_AGENT_GUTTER, 10, "selected clusters should keep a visible ten-pixel machine gutter");

const legacyLayout = frBuildLegacyLayout(machines);
for (const hiveMachine of machines) {
  assert.equal(
    legacyLayout[hiveMachine.id].agents.length,
    hiveMachine.agents.length,
    `Reveal all should render every agent on ${hiveMachine.id}`,
  );
  assert.ok(legacyLayout[hiveMachine.id].addPos, `Reveal all should retain the add-agent cell for ${hiveMachine.id}`);
}

const hiveStageSource = readFileSync("src/components/fleet-hive/HiveStage.tsx", "utf8");
const legacyHiveStageSource = readFileSync("src/components/fleet-hive/LegacyHiveStage.tsx", "utf8");
const beeRoleIconsSource = readFileSync("src/lib/config/bee-role-icons.ts", "utf8");
for (const [label, source] of [
  ["focused Hive stage", hiveStageSource],
  ["Reveal all Hive stage", legacyHiveStageSource],
]) {
  assert.match(source, /beeRoleIconPath/, `${label} should use the canonical cache-busted bee icon helper`);
  assert.match(source, /queenBeeSrc = beeRoleIconPath\("queen"\)/, `${label} should never load the Queen from a stale bare asset URL`);
  assert.doesNotMatch(source, /queenBeeSrc = "\/icons\/queen-bee-v2\.png"/, `${label} should not bypass Queen asset versioning`);
}
assert.match(
  beeRoleIconsSource,
  /BEE_ICON_ASSET_VERSION = "20260714-gold-queen-bee"/,
  "the canonical bee URL should invalidate WebView caches after the gold Queen artwork replacement",
);
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
  /expandedMachineIds\.has\(m\.id\)/,
  "only active machine clusters should render their agent nodes",
);
assert.match(hiveStageSource, /className="fr-node-name"/, "node names should render horizontally inside cells");
assert.doesNotMatch(
  hiveStageSource,
  /AgentEdgeName|AddAgentCell|workerBeeSrc|agent\.iconSrc/,
  "the map should avoid angled labels, spatial add cells, and repeated character portraits",
);
const fleetHiveViewSource = readFileSync("src/components/fleet-hive/FleetHiveView.tsx", "utf8");
const hiveStageCall = fleetHiveViewSource.match(/<HiveStage[\s\S]*?\/>/)?.[0] ?? "";
assert.doesNotMatch(hiveStageCall, /selectionTooltipKey=/, "HiveStage should not receive rich selection tooltip state");
assert.match(fleetHiveViewSource, />\s*New machine\s*</, "New machine should live in the view toolbar");
assert.match(fleetHiveViewSource, /aria-pressed={revealAll}/, "the full-hive control should expose its toggle state");
assert.match(fleetHiveViewSource, /"Reveal all"/, "the toolbar should expose the full pre-redesign hive");
assert.match(fleetHiveViewSource, /<LegacyHiveStage/, "Reveal all should render the isolated legacy stage");
assert.match(fleetHiveViewSource, /onSelect={selectHiveNode}/, "Hive selections should use the cluster-aware viewport handler");
assert.match(fleetHiveViewSource, /layout\[machineId\]\?\.pos/, "expanded clusters should center on their machine anchor");

const fleetHiveCss = readFileSync("src/components/fleet-hive/fleet-hive.css", "utf8");
assert.match(fleetHiveCss, /\.fr-node-status/, "semantic node status dots should be styled");
assert.doesNotMatch(fleetHiveCss, /--fr-label-halo|--fr-label-weight/, "outlined diagonal-label tokens should be removed");
const nodeStatusRule = fleetHiveCss.match(/\.fr-node-status\s*{[\s\S]*?}/)?.[0] ?? "";
assert.match(nodeStatusRule, /top:\s*20px/, "agent status dots should be inset below the sloped outline");
assert.match(nodeStatusRule, /right:\s*20px/, "agent status dots should be inset from the sloped outline");
const machineStatusRule = fleetHiveCss.match(/\.fr-machine-node-content \.fr-node-status\s*{[\s\S]*?}/)?.[0] ?? "";
assert.match(machineStatusRule, /top:\s*27px/, "machine status dots should be inset below the sloped outline");
assert.match(machineStatusRule, /right:\s*27px/, "machine status dots should be inset from the sloped outline");
const machineContentRule = [...fleetHiveCss.matchAll(/\.fr-machine-node-content\s*{[\s\S]*?}/g)]
  .map((match) => match[0])
  .find((rule) => rule.includes("grid-template-rows")) ?? "";
assert.match(machineContentRule, /grid-template-rows:\s*28px auto 9px/, "machine content should reserve rows inside the hex");
assert.match(machineContentRule, /align-content:\s*center/, "wrapped machine content should stay vertically contained");
const queenGlowRule = fleetHiveCss.match(/(?:^|\n)\.fr-queen-glow\s*{[\s\S]*?}/)?.[0] ?? "";
assert.doesNotMatch(queenGlowRule, /animation:/, "Queen's halo should stay quiet at rest");

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

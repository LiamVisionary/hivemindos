import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_QUEEN_BEE_NAME,
  DEFAULT_QUEEN_BEE_PERSONALITY,
  queenBeeNameOrDefault,
  queenBeePersonalityOrDefault,
} from "../src/lib/config/queen-bee-personality.ts";
import { parseStoredAgents } from "../src/features/dashboard/dashboard-storage.ts";

assert.equal(DEFAULT_QUEEN_BEE_NAME, "Solara");
assert.match(DEFAULT_QUEEN_BEE_PERSONALITY, /\bSolara\b/);
assert.equal(queenBeeNameOrDefault("Hermes Lead"), "Solara");
assert.equal(queenBeeNameOrDefault("Queen Bee"), "Solara");
assert.equal(queenBeeNameOrDefault("Hermes Lead", true), "Hermes Lead");
assert.equal(queenBeeNameOrDefault("Aurora"), "Aurora");
assert.equal(
  queenBeePersonalityOrDefault(DEFAULT_QUEEN_BEE_PERSONALITY.replace("Solara", "Queen Bee")),
  DEFAULT_QUEEN_BEE_PERSONALITY,
  "the legacy built-in queen personality should migrate to Solara",
);

const storedQueen = {
  id: "hermes-lead",
  name: "Hermes Lead",
  runtime: "hermes",
  gatewayUrl: "",
  beeRole: "queen",
};
const migratedQueen = parseStoredAgents({
  "hivemindos.agentProfiles.v1": JSON.stringify([storedQueen]),
})[0];
assert.equal(migratedQueen.name, "Solara", "the legacy default should migrate through the real dashboard hydration path");

const customizedQueen = parseStoredAgents({
  "hivemindos.agentProfiles.v1": JSON.stringify([{ ...storedQueen, queenNameCustomized: true }]),
})[0];
assert.equal(customizedQueen.name, "Hermes Lead", "an explicit user rename must survive normalization");

const hiveStageSource = readFileSync("src/components/fleet-hive/HiveStage.tsx", "utf8");
assert.match(
  hiveStageSource,
  /\{queenName\}<\/div>[\s\S]*?>Queen<\/div>[\s\S]*?>orchestrator<\/div>/,
  "the Fleet Hive center cell should show name, Queen role, then orchestrator",
);
assert.match(hiveStageSource, /aria-label=\{`\$\{queenName\}, Queen orchestrator`\}/);

const fleetHiveSource = readFileSync("src/components/fleet-hive/FleetHiveView.tsx", "utf8");
assert.match(fleetHiveSource, /<HiveStage[\s\S]*?queenName=\{queenName\}/);
assert.match(fleetHiveSource, /<HivePanel[\s\S]*?queenName=\{queenName\}/);

const agentsPanelSource = readFileSync("src/features/dashboard/views/AgentsPanel.tsx", "utf8");
assert.match(agentsPanelSource, /queenName:\s*queenAgent\?\.name\s*\?\?\s*DEFAULT_QUEEN_BEE_NAME/);

const agentControllerSource = readFileSync("src/features/dashboard/hooks/use-agent-controller.tsx", "utf8");
assert.match(agentControllerSource, /queenNameCustomized:\s*true/, "queen renames should be marked as explicit user choices");

const queenCrownSource = readFileSync("src/features/dashboard/hooks/use-queen-crown.ts", "utf8");
assert.match(queenCrownSource, /queenBeeNameOrDefault\(agent\.name, agent\.queenNameCustomized\)/);

const dashboardAppSource = readFileSync("src/features/dashboard/DashboardApp.tsx", "utf8");
assert.match(
  dashboardAppSource,
  /const queenName = displayAgents\.find\(\(agent\) => agent\.beeRole === "queen"\)\?\.name \?\? DEFAULT_QUEEN_BEE_NAME/,
  "shared Queen chat should derive its name from the editable Queen profile",
);
assert.equal(
  dashboardAppSource.match(/queenName=\{queenName\}/g)?.length,
  2,
  "the canonical Queen name should feed both the transcript and persistent composer",
);

const queenVoiceOverlaySource = readFileSync("src/features/queen-voice/QueenBeeVoiceOverlay.tsx", "utf8");
assert.match(queenVoiceOverlaySource, /turn\.who === "queen" \? queenName : "You"/);
assert.match(queenVoiceOverlaySource, /<TranscriptTurns[\s\S]*?queenName=\{queenName\}/);

const persistentHiveChatSource = readFileSync("src/features/queen-voice/PersistentHiveChat.tsx", "utf8");
assert.match(persistentHiveChatSource, /`Ask \$\{queenName\} about this brain\.\.\.`/);

for (const sourcePath of [
  "src/app/api/queen-bee/route.ts",
  "src/features/dashboard/views/MessagingChannelsPanel.tsx",
  "src/features/queen-voice/QueenBeeVoiceOverlay.tsx",
  "src/lib/services/messaging/channels.ts",
  "src/lib/services/messaging/escalation-notify.ts",
]) {
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /DEFAULT_QUEEN_BEE_NAME/, `${sourcePath} should use the canonical Queen name default`);
}

console.log("queen bee default name + editable Fleet Hive and shared chat identity ok");

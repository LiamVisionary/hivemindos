#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  contentHasLeakedToolCallMarker,
  extractLeakedToolCalls,
  stripLeakedToolCallMarkup,
} = await import("../src/lib/services/chat/leaked-tool-call-markup.ts");

const leaked = `<|tool_call>call:run_command
{
  args: [
    '-n',
    '20',
    '-o',
    'n',
    '2',
    '1000000000000',
    '-name',
    <|"|>*.jpg','*.png','*.jpeg<|"|>
  ],
  command: <|"|>find<|"|>,
  reason: <|"|>Locate where the actual images live on the filesystem.<|"|>
}<tool_call|>`;

assert.equal(contentHasLeakedToolCallMarker(leaked), true);
assert.equal(stripLeakedToolCallMarkup(leaked), "");

const calls = extractLeakedToolCalls(leaked);
assert.equal(calls.length, 1);
assert.equal(calls[0].name, "run_command");

const args = JSON.parse(calls[0].arguments);
assert.equal(args.command, "find");
assert.deepEqual(args.args, [
  "-n",
  "20",
  "-o",
  "n",
  "2",
  "1000000000000",
  "-name",
  "*.jpg','*.png','*.jpeg",
]);
assert.equal(args.reason, "Locate where the actual images live on the filesystem.");

const prose = "I'll inspect that now.\n\n" + leaked;
assert.equal(stripLeakedToolCallMarkup(prose), "I'll inspect that now.");

const leakedCapabilityCall = `<|tool_call>call:invoke_hive_capability
{
  method: <|"|>GET<|"|>,
  operation: <|"|>invoke<|"|>,
  path: <|"|>/api/skills/skill-skill-skill<|"|>,
  prompt: <|"|>describe video generation skill and give me the method and path to generate video from an image, including the prompt I should send for a bee flying<|"|>,
  skill: <|"|>skill:packaged:optional:media/hivemindos/launch-video-hyperframes<|"|>,
  skillName: <|"|>launch-video-hyperframes<|"|>,
  serviceKind: <|"|>skill<|"|>,
  surface: <|"|>skill<|"|>
}<tool_call|>`;

const capabilityCalls = extractLeakedToolCalls(leakedCapabilityCall);
assert.equal(capabilityCalls.length, 1);
assert.equal(capabilityCalls[0].name, "invoke_hive_capability");
assert.deepEqual(JSON.parse(capabilityCalls[0].arguments), {
  method: "GET",
  operation: "invoke",
  path: "/api/skills/skill-skill-skill",
  prompt: "describe video generation skill and give me the method and path to generate video from an image, including the prompt I should send for a bee flying",
  skill: "skill:packaged:optional:media/hivemindos/launch-video-hyperframes",
  skillName: "launch-video-hyperframes",
  serviceKind: "skill",
  surface: "skill",
});

console.log("chat leaked tool-call markup checks passed");

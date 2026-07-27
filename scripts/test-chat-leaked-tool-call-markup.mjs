#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  contentHasLeakedToolCallMarker,
  extractLeakedToolCalls,
  stripLeakedToolCallMarkup,
} = await import("../src/lib/services/chat/leaked-tool-call-markup.ts");
const channelMarkup = await import("../src/lib/services/chat/channel-markup.ts");
const { routeChannelMarkupText } = channelMarkup;

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

const legacyAssistantMessage = `<think>
The user said hi, so I should answer with a concise greeting.
</think>

Hi! I'm here to help.`;
assert.deepEqual(routeChannelMarkupText(legacyAssistantMessage), {
  content: "\n\nHi! I'm here to help.",
  thinking: "\nThe user said hi, so I should answer with a concise greeting.\n",
});
assert.equal(
  channelMarkup.visibleChannelMarkupText?.(legacyAssistantMessage),
  "\n\nHi! I'm here to help.",
  "visible legacy chat text should exclude the model's private reasoning",
);

const chatComposerSource = await readFile(
  new URL("../src/features/chat/chat-composer.tsx", import.meta.url),
  "utf8",
);
assert.match(
  chatComposerSource,
  /visibleChannelMarkupText\(message\.content\)/,
  "archived assistant messages should route legacy reasoning markup before display",
);

const chatTreeSource = await readFile(
  new URL("../src/features/dashboard/hooks/use-chat-tree-controller.tsx", import.meta.url),
  "utf8",
);
assert.match(
  chatTreeSource,
  /function chatSearchContent[\s\S]{0,240}stripJsonRenderPayload\(chatVisibleContent\(message\)\)/,
  "chat search should not index legacy reasoning markup",
);
assert.match(
  chatTreeSource,
  /function chatPreviewContent[\s\S]{0,160}stripJsonRenderPayload\(chatVisibleContent\(message\)\)/,
  "chat previews should not display legacy reasoning markup",
);

console.log("chat leaked tool-call markup checks passed");

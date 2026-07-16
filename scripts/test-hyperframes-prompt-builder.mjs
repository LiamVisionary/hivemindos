#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

process.env.NODE_ENV = "production";
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const promptModule = await import("../src/lib/services/chat/hyperframes-prompt.ts").catch(() => null);
assert.equal(typeof promptModule?.parseHyperframesPrompt, "function", "HyperFrames needs a six-decision prompt parser");
assert.equal(typeof promptModule?.serializeHyperframesPrompt, "function", "HyperFrames needs one canonical natural-language prompt serializer");
assert.equal(typeof promptModule?.validateHyperframesPrompt, "function", "HyperFrames needs deterministic beat and decision validation");

assert.equal(promptModule.HYPERFRAMES_WORKFLOW_MATRIX.length, 11, "the workflow matrix should cover every bundled HyperFrames route");
assert.equal(new Set(promptModule.HYPERFRAMES_WORKFLOW_MATRIX.map((workflow) => workflow.id)).size, 11, "workflow ids must remain unique");

const fullPrompt = `/motion-graphics Make a 6-second 1080×1080 video. A macOS-style desktop
folder sits centered on a warm paper-yellow desktop. Beat 1 (0–2s): an
oversized black Mac cursor glides in from the bottom-right and comes to
rest on the folder. Beat 2 (2–3s): it double-clicks — the folder lid tips
open in faithful Apple style with a soft squash-and-settle. Beat 3 (3–6s):
three document icons fan out of the folder and settle in a neat row above
it, each casting a soft shadow; then the row settles into a slow, subtle
drift. Label under the folder: "Projects". No narration, no image or
media files.`;

const parsed = promptModule.parseHyperframesPrompt(fullPrompt);
assert.equal(parsed.workflowId, "motion-graphics");
assert.equal(parsed.durationSeconds, 6);
assert.equal(parsed.aspectRatio, "square");
assert.deepEqual(parsed.dimensions, { width: 1080, height: 1080 });
assert.equal(parsed.beats.length, 3);
assert.deepEqual(parsed.beats.map((beat) => [beat.startSeconds, beat.endSeconds]), [[0, 2], [2, 3], [3, 6]]);
assert.match(parsed.beats[1].description, /double-clicks/);
assert.deepEqual(parsed.copy, ["Projects"]);
assert.ok(parsed.techniques.some((technique) => /squash/i.test(technique)));
assert.ok(parsed.techniques.some((technique) => /drift/i.test(technique)));
assert.ok(parsed.negatives.some((negative) => /narration/i.test(negative)));
assert.ok(parsed.negatives.some((negative) => /media files/i.test(negative)));
assert.deepEqual(Object.values(parsed.decisionSources), ["provided", "provided", "provided", "provided", "provided", "provided"]);

const validation = promptModule.validateHyperframesPrompt(parsed);
assert.equal(validation.ready, true);
assert.equal(validation.errors.length, 0);
assert.equal(validation.explicitDecisionCount, 6);

const serialized = promptModule.serializeHyperframesPrompt(parsed);
assert.match(serialized, /^\/motion-graphics Make a 6-second 1080×1080 video\./);
assert.match(serialized, /Beat 1 \(0–2s\):/);
assert.match(serialized, /"Projects"/);
assert.match(serialized, /No narration/i);
assert.ok(serialized.indexOf("Beat 1") < serialized.indexOf('"Projects"'), "beats should precede exact copy");
assert.ok(serialized.lastIndexOf("No ") > serialized.indexOf('"Projects"'), "negative constraints should close the prompt");

const lazy = promptModule.parseHyperframesPrompt("make an animation of a computer folder opening");
assert.equal(lazy.workflowId, "motion-graphics", "a short motion-first request should infer the focused workflow");
assert.equal(lazy.beats.length, 1, "the builder should create an editable starter beat instead of an empty form");
assert.equal(lazy.decisionSources.route, "inferred");
assert.equal(lazy.decisionSources.beats, "inferred");
assert.ok(promptModule.validateHyperframesPrompt(lazy).explicitDecisionCount < 6);

const concise = promptModule.parseHyperframesPrompt("Make a 4-second square HyperFrames motion graphic of a honey cell opening. No narration.");
assert.doesNotMatch(concise.beats[0].description, /no narration/i, "negative constraints should not be duplicated inside an inferred beat");
assert.deepEqual(concise.negatives, ["No narration"]);

const vertical = promptModule.parseHyperframesPrompt("/product-launch-video Make a 15-second launch video for TikTok. No stock footage.");
assert.equal(vertical.aspectRatio, "vertical");
assert.deepEqual(vertical.dimensions, { width: 1080, height: 1920 });

const brokenTimeline = {
  ...parsed,
  beats: [
    { id: "beat-1", startSeconds: 0, endSeconds: 2, description: "First" },
    { id: "beat-2", startSeconds: 3, endSeconds: 7, description: "Second" },
  ],
};
const brokenValidation = promptModule.validateHyperframesPrompt(brokenTimeline);
assert.ok(brokenValidation.errors.some((error) => error.code === "beat-gap"));
assert.ok(brokenValidation.errors.some((error) => error.code === "beat-out-of-bounds"));

const renderRequest = promptModule.hyperframesRenderRequest(serialized);
assert.equal(promptModule.isHyperframesRenderRequest(renderRequest), true);
assert.equal(promptModule.isHyperframesRenderRequest(serialized), false);
assert.equal(promptModule.visibleHyperframesPrompt(renderRequest), serialized);

const generatedMedia = await import("../src/features/dashboard/chat-generated-media.ts").catch(() => null);
assert.equal(typeof generatedMedia?.generatedMediaCardFromAssistantText, "function", "chat should recognize a rendered HyperFrames video path");
const videoCard = generatedMedia.generatedMediaCardFromAssistantText(
  "Rendered the final video to /Users/example/project/videos/folder-motion/renders/video.mp4",
  123,
);
assert.equal(videoCard?.kind, "video");
assert.equal(videoCard?.artifacts?.[0]?.kind, "video");
assert.match(videoCard?.artifacts?.[0]?.url ?? "", /api\/chat\/generated-media\?path=/);

const runtimeModule = await import("../src/lib/services/hyperframes-runtime.ts").catch(() => null);
assert.equal(runtimeModule?.HYPERFRAMES_RUNTIME_VERSION, "0.7.17", "renderer version must match the audited bundled-skill commit");
assert.equal(runtimeModule?.HYPERFRAMES_RUNTIME_PACKAGE_INTEGRITY, "sha512-fc7WOk5NRa2w+ciShWNPVVvU8MfP7DkjGXCy2FI3RpiuqQ8sZWz2sO9w5jL1Uu7z69CasYnVL1ca/k/MIfCBeg==");
const managedPaths = runtimeModule.hyperframesManagedRuntimePaths("/tmp/hive-home", "linux");
assert.equal(managedPaths.root, "/tmp/hive-home/.hivemindos/tools/hyperframes");
assert.equal(managedPaths.cliEntrypoint, "/tmp/hive-home/.hivemindos/tools/hyperframes/node_modules/hyperframes/dist/cli.js");

const capabilityApproval = await import("../src/lib/services/chat/capability-approval.ts");
assert.equal(
  capabilityApproval.requiresCapabilityApproval("Use HyperFrames to make a 6-second square animation, no narration."),
  false,
  "explicit HyperFrames requests should reach the six-decision card instead of the generic capability-plan preflight",
);

const semanticRuntimeRoute = await import("../src/app/api/chat/agent-runtime/semantic-video-runtime-route.ts");
const guidedRoute = await semanticRuntimeRoute.resolveSemanticVideoRuntimeRoute({
  enabled: true,
  url: "http://classifier.invalid/v1/chat/completions",
  headers: {},
  model: "test",
  messages: [{ role: "user", content: "Use HyperFrames to make a 6-second square animation, no narration." }],
  toolDefinitions: [],
});
assert.equal(guidedRoute.guideHyperframesPrompt, true, "an explicit actionable HyperFrames request should open the editor without classifier latency");
assert.deepEqual(guidedRoute.decision, { intent: "create_html", confidence: 1 });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routeSource = readFileSync(join(root, "src/app/api/hyperframes/runtime/route.ts"), "utf8");
assert.match(routeSource, /requireAuth/, "renderer setup must require dashboard authentication");
assert.match(routeSource, /body\.confirm === true/, "renderer installation must require explicit confirmation");
assert.match(routeSource, /okJson/, "renderer setup must use the canonical API envelope");
assert.match(routeSource, /uninstallHyperframesRuntime/, "renderer setup must provide a reversible uninstall action");

const cardSource = readFileSync(join(root, "src/features/dashboard/views/chat/HyperframesPromptBuilder.tsx"), "utf8");
for (const label of ["Route", "Format", "Beats", "Copy", "Motion", "Exclude"]) {
  assert.match(cardSource, new RegExp(`>${label}<`), `the guided card should expose the ${label} decision`);
}
assert.match(cardSource, /Render with HyperFrames/);
assert.match(cardSource, /Install pinned renderer/);
assert.match(cardSource, /visiblePrompt:/, "the hidden render marker must not leak into the visible chat message");

console.log("HyperFrames guided prompting, setup, routing, and rendered-video handoff checks passed.");

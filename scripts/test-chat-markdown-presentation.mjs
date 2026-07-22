#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatRouteMarkdown } from "../src/features/dashboard/ChatRouteMarkdown.tsx";
import { parseChatCompletionPresentation } from "../src/features/dashboard/chat-completion-presentation.ts";
import {
  isAssistantColonSectionHeading,
  stripHermesInlineDiffPreviews,
  stripHermesInternalToolNarration,
} from "../src/lib/services/chat/hermes-cli-output.ts";
import { normalizeMacOpenApplications } from "../src/lib/services/deliverable-open-apps.ts";
import { downloadRemoteDeliverable } from "../src/lib/services/deliverable-download.ts";
import {
  bankrActionResultMessage,
  executeBankrAction,
} from "../src/lib/services/bankr-actions.ts";

const root = process.cwd();
const rendererSource = readFileSync(join(root, "src/features/dashboard/ChatMarkdown.tsx"), "utf8");
const processPanelSource = readFileSync(
  join(root, "src/features/dashboard/views/chat/AgentProcessPanel.tsx"),
  "utf8",
);
const presentationStyles = readFileSync(
  join(root, "src/features/dashboard/ChatMarkdownPresentation.module.css"),
  "utf8",
);
const artifactOpenSource = readFileSync(
  join(root, "src/features/dashboard/ChatArtifactOpenControl.tsx"),
  "utf8",
);
const artifactMenuStyles = readFileSync(
  join(root, "src/features/dashboard/views/chat/exchange/chat-exchange-markdown.css"),
  "utf8",
);
const chatComposerSource = readFileSync(join(root, "src/features/chat/chat-composer.tsx"), "utf8");
const deliverableRouteSource = readFileSync(
  join(root, "src/app/api/kanban/deliverable/route.ts"),
  "utf8",
);
const nativeSource = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const nativeOpenInSource = readFileSync(join(root, "src-tauri/src/open_in_app.rs"), "utf8");

assert.match(rendererSource, /ChatMarkdownPresentation\.module\.css/);
assert.match(rendererSource, /ChatRouteMarkdown/);
assert.match(rendererSource, /surface === "chat"/);
assert.match(rendererSource, /<HeadingTag/);
assert.match(rendererSource, /standaloneStrongHeading/);
assert.match(rendererSource, /<ul[^>]*className=/);
assert.match(rendererSource, /<ol[^>]*className=/);
assert.doesNotMatch(rendererSource, /const (?:bullet|ordered)ItemStyle/);
assert.doesNotMatch(rendererSource, /role="list(?:item)?"/);

assert.match(processPanelSource, /worked · \{stepCount\} step/);
assert.match(processPanelSource, /className="cx-tl-line"/);
assert.match(processPanelSource, /className="cx-tl-step"/);
assert.doesNotMatch(processPanelSource, /HiveChatView\.module\.css/);
assert.match(chatComposerSource, /stripHermesInlineDiffPreviews/);

const hermesDiffPreview = [
  "  ┊ review diff",
  "a/index.html → b/index.html",
  "@@ -1,2 +1,2 @@",
  "-<title>Starter</title>",
  "+<title>Flappy Bird</title>",
  "… omitted 12 diff line(s)",
].join("\n");
assert.equal(
  stripHermesInlineDiffPreviews(hermesDiffPreview),
  "",
  "Hermes inline edit previews are live tool progress, not assistant chat text",
);
const completedHermesOutput = stripHermesInlineDiffPreviews(`${hermesDiffPreview}\nDone. The Flappy Bird clone is ready.\n\nVerification\n- Syntax check passed.`);
assert.match(completedHermesOutput, /^Done\. The Flappy Bird clone is ready\./);
assert.match(completedHermesOutput, /Syntax check passed/);
assert.doesNotMatch(completedHermesOutput, /review diff|a\/index\.html|@@ -1,2/);

const internalHermesPreamble = "That subagent only had web_search (I scoped it too narrowly), so its negative result is meaningless — it couldn't see my actual tool list. I can confirm directly: my own schema has `patch`, `write_file`, `terminal`, and `browser` available, and `invoke_hive_capability` is NOT among them. So writing directly to the assigned directory with `write_file` (which succeeded) is the correct path here. The Chat Preview runtime will pick up the files in that directory.";
const cleanedHermesNarration = stripHermesInternalToolNarration(`${internalHermesPreamble}\n\nThe build is complete and verified.\n\nNotes:\n- \`invoke_hive_capability\` is not exposed as a callable tool; I wrote the files directly.`);
assert.match(cleanedHermesNarration, /^The build is complete and verified\./);
assert.doesNotMatch(cleanedHermesNarration, /subagent|tool list|invoke_hive_capability|callable tool/i);
assert.equal(isAssistantColonSectionHeading("What it does:", "- Canvas game"), true);
assert.equal(isAssistantColonSectionHeading("Verification performed (real tool output, not claimed):", "- Syntax passed"), true);
assert.equal(isAssistantColonSectionHeading("Location:", "/tmp/example"), false);
assert.match(chatComposerSource, /isAssistantColonSectionHeading/);
assert.match(chatComposerSource, /### \$\{trimmed\.slice\(0, -1\)\.trim\(\)\}/);

assert.match(presentationStyles, /\.root\s+\.heading/);
assert.match(presentationStyles, /\.root\s+\.listItem/);
assert.match(presentationStyles, /\.listItem::marker/);
assert.doesNotMatch(presentationStyles, /\.listItem[^}]*border-radius/s);

assert.match(artifactOpenSource, /DropdownMenuSub/);
assert.match(artifactOpenSource, />Open folder</);
assert.match(artifactOpenSource, />Open in…</);
assert.match(artifactOpenSource, /loadDeliverableOpenCapabilities/);
assert.match(artifactOpenSource, /fr-chat-artifact-open-in-trigger/);
assert.match(artifactOpenSource, /sideOffset=\{1\}/);
assert.match(artifactOpenSource, />Download to this device</);
assert.match(artifactOpenSource, /downloadDeliverableToDevice/);
assert.match(artifactOpenSource, /loadDeliverableAvailability/);
assert.match(artifactMenuStyles, /\.fr-chat-artifact-open-menu\s*\{[^}]*border:\s*0\s*!important/s);
assert.match(artifactMenuStyles, /background:\s*var\(--button-popover\)\s*!important/);
assert.match(artifactMenuStyles, /\.fr-chat-artifact-open-in-trigger\[data-state="open"\]::before/);
assert.match(deliverableRouteSource, /discoverDeliverableOpenApps/);
assert.match(deliverableRouteSource, /downloadRemoteDeliverable/);
assert.match(deliverableRouteSource, /resolveLocalDeliverableFile/);
assert.match(nativeSource, /open_in_app::list_open_in_apps/);
assert.match(nativeOpenInSource, /fn list_open_in_apps/);
assert.match(nativeOpenInSource, /dynamic_bundle_id/);

const normalizedApps = normalizeMacOpenApplications([
  { name: "Visual Studio Code", bundleId: "com.microsoft.VSCode", path: "/Applications/Visual Studio Code.app" },
  { name: "Xcode", bundleId: "com.apple.dt.Xcode", path: "/Applications/Xcode.app" },
  { name: "TextEdit", bundleId: "com.apple.TextEdit", path: "/System/Applications/TextEdit.app" },
  { name: "Notes", bundleId: "com.apple.Notes", path: "/System/Applications/Notes.app" },
  { name: "Instruments", bundleId: "com.apple.dt.Instruments", path: "/Applications/Xcode.app/Contents/Applications/Instruments.app" },
  { name: "Google Chrome for Testing", bundleId: "com.google.chrome.for.testing", path: "/Users/example/Library/Caches/chrome.app" },
], "com.apple.dt.Xcode");
assert.deepEqual(normalizedApps, [
  { id: "bundle:com.apple.dt.Xcode", name: "Xcode", isDefault: true },
  { id: "bundle:com.microsoft.VSCode", name: "Visual Studio Code", isDefault: false },
  { id: "bundle:com.apple.TextEdit", name: "TextEdit", isDefault: false },
]);

const downloadRoot = await mkdtemp(join(tmpdir(), "hivemindos-chat-download-"));
try {
  const fetchedUrls = [];
  const fetcher = async (url) => {
    fetchedUrls.push(String(url));
    return new Response("remote artifact\n", {
      headers: { "content-length": "16", "content-type": "text/plain" },
    });
  };
  const firstDownload = await downloadRemoteDeliverable({
    collectorUrl: "http://127.0.0.1:8787",
    fetcher,
    machineName: "example-device",
    remotePath: "/root/workspace/report.txt",
    targetDirectory: downloadRoot,
  });
  const secondDownload = await downloadRemoteDeliverable({
    collectorUrl: "http://127.0.0.1:8787",
    fetcher,
    machineName: "example-device",
    remotePath: "/root/workspace/report.txt",
    targetDirectory: downloadRoot,
  });
  assert.equal(await readFile(firstDownload.path, "utf8"), "remote artifact\n");
  assert.equal(await readFile(secondDownload.path, "utf8"), "remote artifact\n");
  assert.match(firstDownload.path, /report\.txt$/);
  assert.match(secondDownload.path, /report \(1\)\.txt$/);
  assert.match(fetchedUrls[0], /\/_hivemind\/file\?path=%2Froot%2Fworkspace%2Freport\.txt$/);
  await assert.rejects(
    downloadRemoteDeliverable({
      collectorUrl: "http://127.0.0.1:8787",
      fetcher: async () => new Response("not found", { status: 404 }),
      machineName: "older-device",
      remotePath: "/root/workspace/report.txt",
      targetDirectory: downloadRoot,
    }),
    /Update HivemindOS Link on that machine/,
  );
} finally {
  await rm(downloadRoot, { recursive: true, force: true });
}

const completionFixture = `Completed Work Board task t_example_completion and recorded it as done.

Deliverables:
- Implemented report generator:
- /root/workspace/example-project/scripts/report_generator.py
- Added tests:
  /root/workspace/example-project/tests/test_report_generator.py
- Produced deployable sample bundle:
  /root/Documents/Obsidian/example-vault/Operations/Work Board/artifacts/t_example_completion/generated/sample-business/index.html

Evidence:
- Generated the sample bundle from verified inputs.
- Governance: $0 spend and 0 external actions.

Test output:
python3 -m unittest tests.test_report_generator -v

test_generates_report ... ok
test_rejects_unverified_inputs ... ok

----------------------------------------------------------------------
Ran 2 tests in 0.001s

OK

\`\`\`loop-receipts
[{"gateId":"example-outcome","status":"passed","summary":"The generated report passed its outcome gate.","evidence":["/root/workspace/example-project/RESULT.md"]}]
\`\`\``;

const parsedCompletion = parseChatCompletionPresentation(completionFixture);
assert.ok(parsedCompletion);
assert.equal(parsedCompletion.taskId, "t_example_completion");
assert.deepEqual(parsedCompletion.artifacts.map((artifact) => artifact.label), [
  "Implemented report generator",
  "Added tests",
  "Produced deployable sample bundle",
]);
assert.equal(parsedCompletion.evidence.length, 2);
assert.equal(parsedCompletion.verification?.summary, "2 tests passed");
assert.equal(parsedCompletion.receipts.length, 1);
assert.equal(parsedCompletion.receipts[0].status, "passed");
assert.equal(parsedCompletion.receipts[0].label, "Outcome verified");

const completionMarkup = renderToStaticMarkup(createElement(ChatRouteMarkdown, { text: completionFixture }));
assert.match(completionMarkup, /data-testid="chat-task-completion"/);
assert.match(completionMarkup, />Task completed</);
assert.match(completionMarkup, />Deliverables</);
assert.match(completionMarkup, />Show full path</);
assert.match(completionMarkup, /aria-label="Open report_generator\.py"/);
assert.match(completionMarkup, /aria-label="More ways to open report_generator\.py"/);
assert.doesNotMatch(completionMarkup, /Copy Implemented report generator path/);
assert.match(completionMarkup, />2 tests passed</);
assert.match(completionMarkup, />Show receipt</);
assert.match(completionMarkup, />Show raw report</);
assert.doesNotMatch(completionMarkup, /role="list"/);

const gfmMarkup = renderToStaticMarkup(createElement(ChatRouteMarkdown, {
  text: "## Release notes\n\n- First item\n- Second item\n\n| Check | Result |\n| --- | --- |\n| Typecheck | Passed |",
}));
assert.match(gfmMarkup, /<h2>Release notes<\/h2>/);
assert.match(gfmMarkup, /<ul>/);
assert.match(gfmMarkup, /<table>/);

const receipt = bankrActionResultMessage({
  ok: true,
  intent: "hyperliquid",
  readOnly: true,
  status: "completed",
  jobId: "job_private_diagnostic",
  threadId: "thr_private_diagnostic",
  summary: "A clean, human-readable answer.",
});

assert.equal(receipt, "### Bankr · Hyperliquid\n\nA clean, human-readable answer.");
assert.doesNotMatch(receipt, /Status|job_private_diagnostic|thr_private_diagnostic/);

const longResponse = "x".repeat(4_500);
const executed = await executeBankrAction(
  { intent: "agent-job", prompt: "check the completed job", readOnly: true, jobId: "job_test" },
  {
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({ status: "completed", response: longResponse })),
  },
);
assert.equal(executed.summary, longResponse, "ordinary Bankr research answers must not be cut off at 2,000 characters");

console.log("Chat markdown presentation tests passed.");

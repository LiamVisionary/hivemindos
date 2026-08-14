#!/usr/bin/env node
// Guards the chat App workspace (the Replit-style split pane): browser-chrome
// preview with SSRF-gated probe + warm-up polling, in-pane restart, read-only
// Code tab, embedded Console, temporary-deploy share flow, and the layout
// contract in chat-exchange.css. Text-based like the other chat guards.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const workspace = await read("src/features/dashboard/views/chat/exchange/AppWorkspace.tsx");
const hook = await read("src/features/dashboard/views/chat/exchange/use-thread-app-preview.ts");
const panel = await read("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx");
const controller = await read("src/features/dashboard/hooks/use-status-chat-input-controller.tsx");
const shelf = await read("src/features/dashboard/views/chat/exchange/ContextShelf.tsx");
const thread = await read("src/features/dashboard/views/chat/exchange/MessageThread.tsx");
const drawer = await read("src/features/dashboard/views/chat/exchange/ChatTerminalDrawer.tsx");
const processPanel = await read("src/features/dashboard/views/chat/AgentProcessPanel.tsx");
const exchangeCss = await read("src/features/dashboard/views/chat/exchange/chat-exchange.css");
const workspaceCss = await read("src/features/dashboard/views/chat/exchange/chat-workspace.css");
const sidebar = await read("src/features/dashboard/views/chat/exchange/ChatSidebar.tsx");
// The header band, agent picker, and floating cluster live in their own sheet
// (chat-exchange.css hit the 1500-line ratchet); the layout tokens they read
// stay on .fr-chat-root in chat-exchange.css.
const headerCss = await read("src/features/dashboard/views/chat/exchange/chat-exchange-header.css");

// --- preview frame: probe-gated, sandboxed, warm-up polls instead of lying ---
assert.match(workspace, /\/api\/chat\/preview\?/, "the workspace preview must probe the SSRF-gated route before mounting an iframe");
assert.match(workspace, /sandbox="allow-scripts allow-same-origin allow-forms"/, "the preview iframe must keep its sandbox attributes");
assert.match(workspace, /referrerPolicy="no-referrer"/, "the preview iframe must keep no-referrer");
assert.match(workspace, /WARMUP_PROBE_ATTEMPTS/, "a dead probe during dev-server warm-up must re-poll instead of settling dead");
assert.match(workspace, /expectLive && attempts < WARMUP_PROBE_ATTEMPTS/, "warm-up polling must be bounded and gated on the project actually reporting running");
assert.doesNotMatch(workspace, /aspectRatio.*9\s*\/\s*16|"9 \/ 16"/, "the workspace frame must fill the pane — no phone-shaped 9:16 preview");

// --- lifecycle honesty: restart lives in the dead state, steps are real ---
assert.match(workspace, /onEnsurePreview/, "the dead preview state must offer the restart affordance in place");
assert.match(workspace, /Start app/, "a stopped app must show a Start button, not a dead pane");
assert.match(hook, /phase: "checking"/, "ensure must report the checking phase");
assert.match(hook, /phase: "installing"/, "install must report its phase");
assert.match(hook, /phase: "starting"/, "start must report its phase");
assert.ok(
  hook.indexOf('phase: "checking"') < hook.indexOf('phase: "installing"')
  && hook.indexOf('phase: "installing"') < hook.indexOf('phase: "starting"'),
  "preview phases must report in lifecycle order: checking → installing → starting",
);
assert.match(hook, /APP_BUILDER_CONFIRMATIONS\.stopRuntime/, "stop must use the contract's stopRuntime confirmation");
assert.doesNotMatch(hook, /"CONFIRM_APP/, "confirmation tokens must come from the contract, never string literals");

// --- code tab: read-only over files_tree/files_read ---
assert.match(workspace, /"files_tree"/, "the Code tab must list files through files_tree");
assert.match(workspace, /"files_read"/, "the Code tab must read files through files_read");
assert.doesNotMatch(workspace, /files_write|files_delete|files_rename/, "the workspace UI is read-only — file writes stay with the agent");

// --- deploy: contract confirmation only, real URL required ---
assert.match(workspace, /"test_deploy"/, "Share must use the temporary-deploy action");
assert.match(workspace, /APP_BUILDER_CONFIRMATIONS\.temporaryDeploy/, "Share must use the contract's temporaryDeploy confirmation");
assert.doesNotMatch(workspace, /"CONFIRM_/, "no literal confirmation strings in the workspace");
assert.match(workspace, /deploy finished without a preview URL|deploymentUrl/, "the deploy flow must surface the real deployment URL");

// --- browser chrome + target picker ---
assert.match(workspace, /data-device=\{device\}/, "the device-width toggle must drive the frame holder");
assert.match(workspace, /targets\.length > 1/, "multiple preview targets must render a target picker");
assert.match(workspace, /openExternalUrl/, "the chrome must offer open-in-browser through the shared helper");

// --- shelf no longer holds a preview; workspace owns it ---
assert.doesNotMatch(shelf, /<iframe|PreviewFrame|previewTargets/, "ContextShelf must not embed previews anymore — AppWorkspace owns them");
assert.match(panel, /useThreadAppPreview\(/, "the panel must drive preview lifecycle through the extracted hook");
assert.match(panel, /data-workspace-open=\{workspaceOpen/, "the layout must expose the workspace-open state to CSS");
assert.match(panel, /"chat\.workspace\.width"/, "the workspace width must persist through dashboard state, not browser storage");
assert.match(panel, /onOpenAppWorkspace=\{openThreadWorkspace\}/, "the thread must be able to open the workspace from an app card");

// Approval allocates the project directory so the worker has somewhere to
// build, but it must not steal half the chat for an empty scaffold. Only a
// successfully completed worker turn may auto-open and start the preview.
const capabilitySubmitBlock = panel.slice(
  panel.indexOf("async function submitCapabilityPlan"),
  panel.indexOf("const sourceMachine", panel.indexOf("async function submitCapabilityPlan")),
);
const capabilityWorkerIndex = capabilitySubmitBlock.indexOf("await sendPromptMessage");
const capabilityAutoOpenIndex = capabilitySubmitBlock.indexOf("setWorkspaceOpen(true)");
assert.ok(capabilityWorkerIndex >= 0 && capabilityAutoOpenIndex > capabilityWorkerIndex, "capability approval must run the worker before auto-opening the App workspace");
assert.match(capabilitySubmitBlock, /appRunOutcome === "completed"/, "failed, interrupted, or question-paused app turns must keep the workspace closed");
assert.match(controller, /return runChatMessage\(chatTurn\)/, "the chat controller must propagate the runtime outcome to the approval UI");
assert.match(controller, /async function sendPromptMessage[\s\S]*?return submitChatPrompt\(/, "sendPromptMessage must return the propagated runtime outcome instead of discarding it");
assert.match(controller, /return assistantIssue \? "failed" : sawAgentPrompt \? "active" : "completed"/, "runtime completion must distinguish successful, failed, and question-paused turns");

// --- app card in the thread ---
assert.match(thread, /AppArtifactCard/, "an assistant message with an appArtifact must render the app card");
assert.match(thread, /appArtifact \? <AppArtifactCard/, "the app card renders from the message's real artifact");

// --- console: same real shell, embeddable ---
assert.match(drawer, /variant = "drawer"/, "the terminal drawer must keep its floating default");
assert.match(drawer, /"embedded"/, "the terminal drawer must support the workspace's embedded variant");

// --- process timeline: app-builder file tools read as file activity ---
assert.match(processPanel, /Edited app file/, "files_write events must read as file edits in the timeline");

// --- layout contract ---
// The chat controls stay pinned top-right at every workspace width and above
// the ≤980px overlay, so the eye toggle always stays reachable.
assert.match(headerCss, /\.cx-header-float \{[^}]*z-index: 110/, "the floating header controls must stay pinned above the workspace overlay");
assert.doesNotMatch(headerCss, /\.cx-header-float[^{]*\{[^}]*transition: right/, "the pinned floating controls must not slide with the workspace width");
assert.match(panel, /const toggleThreadWorkspace = useCallback/, "the eye button must toggle the workspace");
assert.match(panel, /onClick=\{toggleThreadWorkspace\}/, "the eye button must use the toggle so a second press closes the workspace");
assert.match(headerCss, /\.cx-header-float \{[^}]*top: calc\(\(var\(--cx-header-h\) - 34px\) \/ 2\)/, "the pinned cluster must center inside the header bar");
for (const sheet of [exchangeCss, headerCss]) {
  assert.doesNotMatch(sheet, /\[data-workspace-open="true"\] \.cx-header-float/, "no workspace-specific offset should survive the single header bar");
}
// The cluster now lives in the view-wide bar above the workspace, so the pane's
// own toolbar no longer has to keep 208px clear for it.
assert.match(workspaceCss, /\.cx-ws-header \{[^}]*min-height: var\(--cx-header-h\)/, "the workspace toolbar must use the shared bar height");
assert.doesNotMatch(workspaceCss, /\.cx-ws-header \{[^}]*padding-right: var\(--cx-header-pad\)/, "the workspace toolbar must not reserve a cluster that no longer overlays it");

// --- one header across every column ---
// The bar sits ABOVE the column grid, so collapsing the history rail folds away
// only that rail's search and list — the header keeps its title and left edge.
assert.match(exchangeCss, /\.fr-chat-root \{[\s\S]*?--cx-header-h: 56px/, "the header bar height must be a single token");
assert.match(exchangeCss, /\.fr-chat-root \{[\s\S]*?--cx-header-pad: 208px/, "the pinned cluster's reserved footprint must be a single token");
assert.match(exchangeCss, /\.fr-chat-root \{[\s\S]*?--cx-rail-w: 276px/, "the history rail width must be a single token");
assert.match(exchangeCss, /\.fr-chat-layout \{[^}]*grid-template-columns: var\(--cx-rail-w\)/, "the layout grid must read the shared rail width");
assert.match(
  headerCss,
  /\.fr-chat-topbar \{[^}]*min-height: var\(--cx-header-h\)[^}]*border-bottom: 1px solid var\(--line\)[^}]*padding: 0 var\(--cx-header-pad\) 0 0/,
  "the header bar must own the band height, the rule, and the cluster reserve",
);
assert.match(headerCss, /\.fr-chat-topbar-brand \{[^}]*flex: 0 0 var\(--cx-rail-w\)[^}]*border-right: 1px solid var\(--line\)/, "the title block must match the rail width so their dividers line up");
assert.match(headerCss, /\.fr-chat-topbar\[data-rail-collapsed="true"\] \.fr-chat-topbar-brand \{[^}]*flex-basis: auto/, "collapsing the rail must shrink the title block, never hide it");
assert.match(
  panel,
  /<header className="fr-chat-topbar" data-rail-collapsed=\{sidebarCollapsed \? "true" : "false"\}>[\s\S]*?<span className="fr-chat-rail-title">Chat<\/span>[\s\S]*?aria-label="Toggle chat history"[\s\S]*?className="fr-chat-agent-picker"[\s\S]*?<\/header>\n\n        <div\n          ref=\{layoutRef\}/,
  "the rail title, history toggle, and agent picker must share one header ABOVE the column grid",
);

// --- controls that must not move between states ---
// The rail toggle rides with the title (whose width is constant) instead of
// after the title block (whose width tracks the rail), and the picker is
// centred on the bar rather than laid out after them. Both therefore hold one
// position whether the rail, shelf, or workspace is open.
assert.match(
  panel,
  /<div className="fr-chat-topbar-brand">[\s\S]*?<span className="fr-chat-rail-title">Chat<\/span>[\s\S]*?aria-label="Toggle chat history"[\s\S]*?<\/button>\s*<\/div>/,
  "the history toggle must sit inside the title block, next to the word Chat",
);
assert.match(
  headerCss,
  /\.fr-chat-agent-picker \{[^}]*position: absolute[^}]*left: 50%[^}]*transform: translate\(-50%, -50%\)/,
  "the agent picker must be centred on the bar, not laid out in its flex row",
);
assert.match(headerCss, /\.fr-chat-agent-picker \{[^}]*max-width: max\(180px, min\(560px, calc\(100% - var\(--cx-picker-reserve\)\)\)\)/, "the centred picker must stay clear of the title block and the pinned cluster, with a floor for narrow windows");
assert.match(headerCss, /\.fr-chat-topbar \{\s*--cx-picker-reserve: calc\(2 \* var\(--cx-rail-w\) \+ 24px\)/, "the picker's clearance must derive from the rail width, not a hard-coded literal");
assert.doesNotMatch(headerCss, /\[data-rail-collapsed="true"\][^{]*\{[^}]*--cx-picker-reserve/, "collapsing the rail must not change the picker's width — only its surroundings move");
assert.doesNotMatch(headerCss, /\.fr-chat-agent-menu \{[^}]*width: min\(430px, 100%\)/, "the dropdown must not size off the shrink-to-fit picker");
assert.doesNotMatch(sidebar, /fr-chat-rail-header|fr-chat-rail-title/, "the rail must not render its own title any more — the shared header owns it");
assert.doesNotMatch(exchangeCss, /\.fr-chat-shelf::before/, "the shelf's stand-in header band is obsolete under a single bar");
for (const sheet of [exchangeCss, headerCss]) {
  assert.doesNotMatch(sheet, /\.fr-chat-header[\s[{]/, "the per-column chat header is replaced by .fr-chat-topbar");
}
assert.doesNotMatch(panel, /data-float-reserve/, "the reserve moved onto the always-full-width header bar");

// The picker was a two-line block 56px tall, which forced the header taller than
// every other control in it; name + state + meta now share one row.
assert.match(headerCss, /\.fr-chat-agent-copy \{[^}]*display: grid[^}]*grid-template-columns: auto minmax\(0, 1fr\)/, "the agent picker must lay name and meta out on one row, with the meta as the track that truncates first");
assert.match(headerCss, /\.fr-chat-agent-avatar \{[^}]*width: 28px/, "the agent picker avatar must be the compact size");

// The split sheet must stay loaded, and after chat-exchange.css so the tokens
// it reads are already declared, but before the motion sheet that animates the
// same selectors.
assert.match(
  panel,
  /import "\.\/chat-exchange\.css";\nimport "\.\/chat-exchange-header\.css";[\s\S]*?import "\.\/chat-exchange-motion\.css";/,
  "the header sheet must load between chat-exchange.css and the motion sheet",
);
assert.match(panel, /data-sidebar-collapsed=\{sidebarCollapsed/, "the chat-history rail must expose its collapsed state to CSS");
assert.match(panel, /aria-label="Toggle chat history"/, "the header must offer the chat-history collapse toggle");
assert.match(exchangeCss, /\.fr-chat-layout\[data-sidebar-collapsed="true"\]\[data-workspace-open="true"\]/, "a collapsed rail must keep the workspace column sized");
assert.match(exchangeCss, /\.fr-chat-layout\[data-workspace-open="true"\]/, "the layout must size the workspace column");
assert.match(exchangeCss, /clamp\(380px, var\(--cx-ws-w, 46%\), 72%\)/, "the workspace column must clamp its resizable width");
assert.doesNotMatch(exchangeCss, /\.fr-chat-shelf-inner/, "the orphaned shelf-inner rule stays deleted");
assert.match(workspaceCss, /@media \(max-width: 980px\)[\s\S]*?\.cx-ws \{[\s\S]*?position: absolute/, "below 980px the workspace must overlay the chat, not disappear");
assert.doesNotMatch(workspaceCss, /\.cx-ws\s*\{[^}]*display:\s*none/, "the workspace pane itself must never be display:none at any width");

// --- dead predecessors stay deleted ---
assert.ok(!existsSync(new URL("../src/features/dashboard/views/chat/exchange/ContextPanel.tsx", import.meta.url)), "ContextPanel.tsx was dead code and stays deleted");
assert.ok(!existsSync(new URL("../src/features/dashboard/views/chat/exchange/ConversationNav.tsx", import.meta.url)), "ConversationNav.tsx was dead code and stays deleted");

// A thread rehydrated from the runtime session store has no message-level
// appArtifact (it is client-only state), so the workspace must fall back to
// the project identity embedded in the capability continuation prompt.
if (!/latestChatAppArtifact\(renderMessages\)\s*\n?\s*\?\? chatAppArtifactFromCapabilityContext\(/.test(panel)) {
  throw new Error("ChatExchangePanel must derive threadAppArtifact with the capability-context fallback; without it a rehydrated thread shows 'No preview available' for an app that exists on disk.");
}

if (!/\|\| chatAppDirectoryFromTaskRecords\(renderMessages, agentWorkById\[selectedAgent\?\.id\] \?\? \[\], chatWorkingDirectory\)/.test(panel)) {
  throw new Error("ChatExchangePanel must fall back to the runtime task record's project directory; without it a thread whose transcript lost the artifact AND whose merges rewrote the continuation text cannot recover its app.");
}

console.log("chat app workspace checks passed");

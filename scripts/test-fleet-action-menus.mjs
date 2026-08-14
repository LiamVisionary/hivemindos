#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const listView = readFileSync("src/components/fleet/list-view.tsx", "utf8");
const machineActions = readFileSync("src/components/fleet/list-view-machine-actions.tsx", "utf8");
const agentActions = readFileSync("src/components/fleet/list-view-agent-actions.tsx", "utf8");
const styles = readFileSync("src/components/fleet/list-view.module.css", "utf8");
const hivePanel = readFileSync("src/components/fleet-hive/HivePanel.tsx", "utf8");
const hiveActions = readFileSync("src/components/fleet-hive/HivePanelActions.tsx", "utf8");
const hiveStyles = readFileSync("src/components/fleet-hive/hive-panel-actions.module.css", "utf8");
const selectionTooltip = readFileSync("src/components/fleet/selection-tooltip.tsx", "utf8");
const selectionStyles = readFileSync("src/components/fleet/selection-tooltip-actions.module.css", "utf8");
const chatCallSplit = readFileSync("src/components/fleet/chat-call-split-button.tsx", "utf8");

assert.match(listView, /<FleetListMachineActions/);
assert.match(listView, /<FleetListAgentActions/);
assert.doesNotMatch(listView, /\{ id: "call", label: "Call"/);
assert.doesNotMatch(listView, /styles\.addRow/, "the selected machine card must not repeat Add agent below its agent list");

assert.match(machineActions, /className=\{styles\.primaryAction\}[\s\S]*<span>Add agent<\/span>/);
assert.match(machineActions, /className=\{styles\.actionsTrigger\}/);
assert.match(machineActions, /aria-label=\{`Open actions for \$\{machine\.name\}/);
assert.match(machineActions, /<DropdownMenuLabel className=\{styles\.actionMenuSection\}>Needs attention<\/DropdownMenuLabel>/);
assert.match(machineActions, /<DropdownMenuLabel className=\{styles\.actionMenuSection\}>Operate<\/DropdownMenuLabel>/);
assert.match(machineActions, /<DropdownMenuLabel className=\{styles\.actionMenuSection\}>Manage<\/DropdownMenuLabel>/);
assert.match(machineActions, /className=\{styles\.actionCount\}/);
for (const label of ["Settings", "Shell", "Send file", "Rent compute", "Rename", "Code proof"]) {
  assert.ok(machineActions.includes(`label="${label}"`), `machine Actions menu must keep ${label} discoverable`);
}

assert.match(agentActions, /<ChatCallSplitButton/);
assert.match(agentActions, /chatLabel="New chat"/);
assert.match(agentActions, /splitClassName=\{styles\.chatCallSplit\}/);
assert.match(agentActions, /aria-label=\{`Open actions for \$\{agent\.name\}`\}/);
for (const label of ["Wallet", "Settings", "Duplicate", "Remove agent"]) {
  assert.ok(agentActions.includes(`label="${label}"`), `agent Actions menu must keep ${label} discoverable`);
}
assert.doesNotMatch(agentActions, /<AgentMenuItem Icon=\{PhoneCall\}/, "Call belongs in the chat split, not Actions");
assert.match(agentActions, /<DropdownMenuSeparator className=\{styles\.actionMenuSeparator\} \/>[\s\S]*label="Remove agent" danger/);

assert.match(styles, /\.compactActionBar/);
assert.match(styles, /\.chatCallSplit/);
assert.match(styles, /\.callSegment[\s\S]*border-left:/);
assert.match(styles, /\.actionMenuItem\[data-tone="danger"\]/);
assert.match(styles, /\.actionMenuTitle \{[^}]*font-weight: 500;/, "List menu titles should stay restrained");
assert.match(styles, /\.actionMenuItem \{[^}]*font-weight: 400;/, "List menu actions should use regular weight");
assert.match(styles, /:global\(\[data-theme="hive-light"\]\) \.actionMenu/);
assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(hivePanel, /<HiveMachineActions/);
assert.match(hivePanel, /<HiveAgentActions/);
assert.match(hivePanel, /<HiveChatCallSplitButton[\s\S]*name=\{queenName\}/, "Queen Chat should use the same split control");
assert.doesNotMatch(hivePanel, /machine action chips/);
assert.doesNotMatch(hivePanel, /secondary agent actions/);
assert.match(hiveActions, /aria-label=\{`Machine actions for \$\{machine\.name\}`\}/);
assert.match(hiveActions, /aria-label=\{`Agent actions for \$\{agent\.name\}`\}/);
assert.match(hiveActions, /<span>Add agent<\/span>/);
assert.match(hiveActions, /<ChatCallSplitButton/);
assert.match(hiveActions, /splitClassName=\{styles\.chatCallSplit\}/);
assert.match(hiveActions, /<DropdownMenuLabel className=\{styles\.menuSection\}>Needs attention<\/DropdownMenuLabel>/);
assert.match(hiveActions, /<DropdownMenuLabel className=\{styles\.menuSection\}>Operate<\/DropdownMenuLabel>/);
assert.match(hiveActions, /<DropdownMenuLabel className=\{styles\.menuSection\}>Manage<\/DropdownMenuLabel>/);
for (const label of ["Fix sync", "Shell", "Send file", "Rent compute", "Settings", "Code proof"]) {
  assert.ok(hiveActions.includes(`label="${label}"`), `Hive machine Actions menu must keep ${label} discoverable`);
}
for (const label of ["Task chat", "Wallet", "Settings", "Duplicate", "Remove agent"]) {
  assert.ok(hiveActions.includes(`label="${label}"`), `Hive agent Actions menu must keep ${label} discoverable`);
}
assert.doesNotMatch(hiveActions, /<MenuAction Icon=\{PhoneCall\}/, "Call belongs in the Hive chat split, not Actions");
assert.match(hiveStyles, /\.actionsTrigger\[data-attention="true"\]/);
assert.match(hiveStyles, /\.chatCallSplit/);
assert.match(hiveStyles, /\.callSegment[\s\S]*border-left:/);
assert.match(hiveStyles, /\.menuItem\[data-tone="danger"\]/);
assert.match(hiveStyles, /\.menuTitle \{[^}]*font-weight: 500;/, "Hive menu titles should stay restrained");
assert.match(hiveStyles, /\.menuItem \{[^}]*font-weight: 400;/, "Hive menu actions should use regular weight");
assert.match(hiveStyles, /\.menu\[data-slot="dropdown-menu-content"\]/);
assert.match(hiveStyles, /:global\(\[data-theme="hive-light"\]\) \.menu\[data-slot="dropdown-menu-content"\]/);
assert.match(hiveStyles, /animation: none;/, "Hive action menus should open on an immediately opaque surface");
assert.match(hiveStyles, /@media \(prefers-reduced-motion: reduce\)/);

assert.match(selectionTooltip, /<ChatCallSplitButton/);
assert.match(selectionTooltip, /splitClassName=\{splitStyles\.chatCallSplit\}/);
assert.doesNotMatch(selectionTooltip, /id: "call"/, "Classic Fleet call should move into the chat split");
assert.match(selectionStyles, /\.chatCallSplit/);
assert.match(selectionStyles, /\.callSegment[\s\S]*border-left:/);

assert.match(chatCallSplit, /role="group" aria-label=\{`Chat and call \$\{name\}`\}/);
assert.match(chatCallSplit, /className=\{chatClassName\}[\s\S]*className=\{callClassName\}/);
assert.match(chatCallSplit, /chatLabel = "Chat"/);
assert.match(chatCallSplit, /aria-label=\{`Call \$\{name\}`\}/);

console.log("Fleet chat actions use accessible split chat/call controls and compact grouped menus.");

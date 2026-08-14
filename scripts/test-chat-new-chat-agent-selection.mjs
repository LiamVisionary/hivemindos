import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { selectedAgentFreshChatTarget } = await import("../src/features/dashboard/chat-new-chat-target.ts");

const controller = readFileSync(new URL("../src/features/dashboard/hooks/use-chat-tree-controller.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url), "utf8");

const selectedTarget = selectedAgentFreshChatTarget({
  selectedAgentId: "bankr-02",
  selectedAgentCanChat: true,
  machineGroups: [
    { key: "unassigned", agents: [{ id: "codex-engineer" }] },
    { key: "this-mac", agents: [{ id: "hermes-main" }, { id: "bankr-02" }] },
  ],
});
assert.deepEqual(selectedTarget, {
  agentId: "bankr-02",
  workingDirectoryPath: "",
  chatLeafKey: "machine-this-mac-bankr-02",
}, "a stale saved profile and the machine's first agent must never replace the selected agent");
assert.equal(selectedAgentFreshChatTarget({
  selectedAgentId: "aeon",
  selectedAgentCanChat: false,
  machineGroups: [{ key: "this-mac", agents: [{ id: "hermes-main" }, { id: "aeon" }] }],
}), null, "an agent without chat support must not fall back to another agent");

assert.match(
  controller,
  /const startFreshChatInMachine = \(agent: AgentProfile, path\?: string\) => \{[\s\S]*?chatLeafKey: projectPath[\s\S]*?`folder-\$\{machine\.key\}-\$\{chatDedupeKey\(projectPath\)\}-\$\{agent\.id\}`[\s\S]*?`machine-\$\{machine\.key\}-\$\{agent\.id\}`/,
  "fresh chat handlers should keep the machine/folder key paired with the target agent id",
);

assert.match(
  controller,
  /if \(\(!existing\.onStartChat \|\| active\) && onStartChat\) existing\.onStartChat = onStartChat;/,
  "active chat folders should replace a stale first-agent new-chat handler",
);

assert.match(
  controller,
  /const machineChatFolder = \(\) => ensureFolder\([\s\S]*?"Unsorted chats",[\s\S]*?startFreshChatInMachine\(agent\),[\s\S]*?selectedAgentId === agent\.id && selectedChatLeafKey\.startsWith\(`machine-\$\{machine\.key\}-`\),[\s\S]*?\);/,
  "the active Unsorted chats folder should replace the machine's first-agent new-chat handler",
);

assert.match(
  controller,
  /selectedAgentId === agent\.id && Boolean\(selectedChatDirectoryPath && selectedChatDirectoryPath === folderPath\)/,
  "default folder active state should be scoped to the selected agent",
);

assert.match(
  controller,
  /ensureFolder\(workspaceLabelFromPath\(targetProjectPath\), startFreshChatInMachine\(agent, targetProjectPath\), targetProjectPath, true\)/,
  "fresh active placeholder chats should install the selected agent's folder new-chat handler",
);

assert.match(
  controller,
  /selectedAgentId === agent\.id && selectedChatDirectoryPath === taskWorkingDirectory/,
  "task folder active state should be scoped to the selected agent",
);

assert.match(
  controller,
  /selectedAgentId === agent\?\.id && Boolean\(selectedChatDirectoryPath && selectedChatDirectoryPath === customFolder\.path\)/,
  "custom folder active state should be scoped to the selected agent",
);

assert.doesNotMatch(
  controller,
  /if \(!existing\.onStartChat && onStartChat\) existing\.onStartChat = onStartChat;/,
  "folder handlers must not stay pinned to the first agent when another agent's chat is active",
);

assert.match(
  panel,
  /return selectedAgentCanStartFreshChat \? \{ label: folder\.label, onStartChat: startSelectedAgentFreshChat \} : null;/,
  "the primary New chat button should call the selected-agent handler instead of a shared folder callback",
);
assert.match(
  panel,
  /const generalChatTarget = selectedAgentCanStartFreshChat \? \(\) => startSelectedAgentFreshChat\?\.\(\{ general: true \}\) : undefined;/,
  "the General new-chat action should also preserve the selected agent",
);
assert.match(
  controller,
  /\.filter\(\(chat\) => !selectedAgent\?\.id \|\| chat\.agentId === selectedAgent\.id\)[\s\S]*?\.sort\(\(a, b\) => \(b\.updatedAt \?\? 0\) - \(a\.updatedAt \?\? 0\)\)\[0\]/,
  "entering Chat without a leaf should only resume history owned by the selected agent",
);

assert.match(
  controller,
  /Number\(Boolean\(b\.active\)\) - Number\(Boolean\(a\.active\)\)[\s\S]*?\(b\.updatedAt \?\? 0\) - \(a\.updatedAt \?\? 0\)[\s\S]*?a\.title\.localeCompare\(b\.title\)/,
  "active fresh chats should sort above older folder history so the selected row is visible in collapsed folders",
);

console.log("Chat new-chat handlers preserve the active chat agent.");

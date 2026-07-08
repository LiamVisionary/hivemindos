import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller = readFileSync(new URL("../src/features/dashboard/hooks/use-chat-tree-controller.tsx", import.meta.url), "utf8");

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
  controller,
  /Number\(Boolean\(b\.active\)\) - Number\(Boolean\(a\.active\)\)[\s\S]*?\(b\.updatedAt \?\? 0\) - \(a\.updatedAt \?\? 0\)[\s\S]*?a\.title\.localeCompare\(b\.title\)/,
  "active fresh chats should sort above older folder history so the selected row is visible in collapsed folders",
);

console.log("Chat new-chat handlers preserve the active chat agent.");

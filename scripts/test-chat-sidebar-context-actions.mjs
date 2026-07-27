import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [sidebar, panel, controller, types, folderModal] = await Promise.all([
  read("src/features/dashboard/views/chat/exchange/ChatSidebar.tsx"),
  read("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx"),
  read("src/features/dashboard/hooks/use-chat-tree-controller.tsx"),
  read("src/features/dashboard/dashboard-types.ts"),
  read("src/features/dashboard/views/chat/ChatFolderModal.tsx"),
]);

assert.match(sidebar, /prefs\.groupBy === "project" && \(onCreateProject \|\| onImportProject\)/, "the add icon must only appear for the Projects grouping");
assert.match(sidebar, /aria-label="Add a project"/, "the Projects add action must have an accessible label");
assert.match(sidebar, />Create new project<\/span>/, "the Projects menu must offer project creation");
assert.match(sidebar, />Import project<\/span>/, "the Projects menu must offer project import");
assert.match(sidebar, /aria-label="New general chat"/, "General must expose a chat action");
assert.match(sidebar, /className="cx-iconbtn cx-hoverbtn"[\s\S]*aria-label=\{`New chat in \$\{group\.label\}`\}/, "project folders must expose a hover/focus chat action");
assert.match(sidebar, /aria-label=\{`New chat in \$\{group\.label\}`\}[\s\S]*top: 14/, "the folder chat action must share the folder row's optical center");

assert.match(panel, /onStartChat: folder\.onStartChat/, "folder chat callbacks must survive the flattened sidebar row mapping");
assert.match(panel, /onNewGeneralChat=\{generalChatTarget/, "the General chat action must be wired to the unassigned chat target");
assert.match(panel, /onCreateProject=\{createProjectTarget/, "the create-project callback must reach the sidebar");
assert.match(panel, /onImportProject=\{importProjectTarget/, "the import-project callback must reach the sidebar");

assert.match(types, /onCreateProject\?: \(\) => void;/, "chat-tree machines must model project creation explicitly");
assert.match(types, /onImportProject\?: \(\) => void;/, "chat-tree machines must model project import explicitly");
assert.match(controller, /onCreateProject: machine\.self && chatAgents\.length > 0/, "project creation must stay on the local dashboard machine");
assert.match(controller, /onImportProject: chatAgents\.length > 0 \? \(\) => openChatProjectImporter\(machine\)/, "project import must use the project-import callback");
assert.match(controller, /function openChatProjectImporter[\s\S]*chooseDirectoryForMachine\?\./, "project import must use the shared local-or-remote directory picker");
assert.match(controller, /function openChatProjectCreator[\s\S]*setChatFolderDraft/, "project creation must open the established project-folder form");
assert.match(folderModal, /Create a project folder and start a fresh chat there\./, "project creation must use project-specific copy while retaining the established create-and-open behavior");
assert.match(folderModal, />Project name<\/span>/, "the create form must describe the new folder as a project");
assert.match(folderModal, /Create project and open chat/, "the create action must state that it opens the new project's chat");

console.log("chat sidebar contextual action contract passed");

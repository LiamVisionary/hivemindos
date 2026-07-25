#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile("src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", "utf8");
const workspace = await readFile("src/features/dashboard/views/chat/exchange/AppBuilderWorkspace.tsx", "utf8");
const preview = await readFile("src/features/dashboard/views/chat/exchange/ContextShelf.tsx", "utf8");
const styles = await readFile("src/features/dashboard/views/chat/exchange/app-builder-workspace.module.css", "utf8");

assert.match(panel, /<AppBuilderWorkspace/);
assert.doesNotMatch(panel, /Preview · \{previewTargets\[0\]\.name\}/);
assert.match(workspace, /"preview" \| "code"/);
assert.match(workspace, /action: "files_tree"/);
assert.match(workspace, /action: "files_read"/);
assert.match(workspace, /action: "files_write"/);
assert.match(workspace, /APP_BUILDER_CONFIRMATIONS\.writeFile/);
assert.match(workspace, /action: "export_source"/);
assert.match(workspace, /action: "test_deploy"/);
assert.match(workspace, /APP_BUILDER_CONFIRMATIONS\.temporaryDeploy/);
assert.match(workspace, /Ask .* to change this app/);
assert.match(preview, /refreshKey = 0/);
assert.match(preview, /workspace = false/);
assert.match(styles, /\.browserFrame/);
assert.match(styles, /\.assistantRail/);
assert.match(styles, /\.codeWorkspace/);
assert.match(styles, /@media \(max-width: 820px\)/);

console.log("Expanded Chat Preview is wired to the real App Builder workspace actions.");

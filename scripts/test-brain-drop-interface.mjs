#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  documentsFromFileSystemEntries,
  prepareBrainDropDocuments,
} = await import("../src/features/dashboard/views/brain-drop/brain-drop-files.ts");
const { acceptedDocumentExtensions } = await import("../src/lib/services/document-ingestion-capabilities.ts");

assert.equal(acceptedDocumentExtensions().length, 16, "Feed the brain should use the complete 16-extension document pipeline");

const nestedPdf = new File(["pdf"], "Research.pdf", { type: "application/pdf" });
const nestedText = new File(["notes"], "Notes.txt", { type: "text/plain" });
const unsupported = new File(["image"], "Photo.png", { type: "image/png" });

function fileEntry(file) {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file(resolve) {
      resolve(file);
    },
  };
}

function directoryEntry(name, entries) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader() {
      let read = false;
      return {
        readEntries(resolve) {
          if (read) resolve([]);
          else {
            read = true;
            resolve(entries);
          }
        },
      };
    },
  };
}

const recursive = await documentsFromFileSystemEntries([
  directoryEntry("Project", [
    fileEntry(nestedPdf),
    directoryEntry("Drafts", [fileEntry(nestedText), fileEntry(unsupported)]),
  ]),
]);
assert.deepEqual(recursive.map((item) => item.sourceName), [
  "Project/Research.pdf",
  "Project/Drafts/Notes.txt",
  "Project/Drafts/Photo.png",
]);

const prepared = prepareBrainDropDocuments(recursive);
assert.deepEqual(prepared.documents.map((item) => item.sourceName), [
  "Project/Research.pdf",
  "Project/Drafts/Notes.txt",
]);
assert.equal(prepared.skipped, 1, "unsupported dropped files should be reported instead of uploaded");

const root = new URL("..", import.meta.url);
const vaultPanel = readFileSync(new URL("../src/features/dashboard/views/VaultPanel.tsx", import.meta.url), "utf8");
const dashboardApp = readFileSync(new URL("../src/features/dashboard/DashboardApp.tsx", import.meta.url), "utf8");
const dashboardServer = readFileSync(new URL("../src/app/DashboardServerHome.tsx", import.meta.url), "utf8");
const fab = readFileSync(new URL("../src/features/dashboard/views/brain-drop/BrainDropFab.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/features/dashboard/views/brain-drop/brain-drop-fab.module.css", import.meta.url), "utf8");
const nativeClient = readFileSync(new URL("../src/lib/native/brain-drop-files.ts", import.meta.url), "utf8");
const nativeCommand = readFileSync(new URL("../src-tauri/src/brain_drop_files.rs", import.meta.url), "utf8");
const nativeLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const nativeBuild = readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
const nativeCapabilities = readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8");

assert.match(vaultPanel, /<BrainDropFab[\s\S]*?onImported=\{refreshBrainGraph\}/, "Hive Vault should own the Feed the brain FAB");
assert.doesNotMatch(vaultPanel, /id: "brain-drop"|vaultPanelMode === "brain-drop"/, "the standalone Brain Drop subview should be removed");
assert.doesNotMatch(dashboardApp, /DashboardVaultPanelMode = [^;]*"brain-drop"/, "the removed view should leave the typed route family");
assert.doesNotMatch(dashboardServer, /^\s*"brain-drop",$/m, "server deep-link parsing should no longer expose the removed view");
assert.equal(existsSync(new URL("../src/features/dashboard/views/BrainDropPanel.tsx", import.meta.url)), false, "the obsolete full panel should be deleted");

assert.match(fab, /aria-label="Feed text to the brain"/);
assert.match(fab, /aria-label="Feed files to the brain"/);
assert.match(fab, /aria-label="Feed folders to the brain"/);
assert.match(fab, /onClick=\{\(\) => setMenuOpen\(true\)\}/, "the focused plus button should open instead of immediately toggling the menu closed");
assert.match(fab, /action: "capture"/);
assert.match(fab, /\/api\/brain\/imported-sources/);
assert.match(fab, /webkitdirectory/);
assert.match(fab, /multiple/);
assert.match(fab, /listenForTauriComposerDragDrop/);
assert.match(fab, /documentsFromDataTransfer/);
assert.match(fab, /Drop to feed the brain/);
assert.match(styles, /backdrop-filter:\s*blur/);
assert.match(styles, /prefers-reduced-motion/);
assert.match(styles, /\.dropOverlay/);

assert.match(nativeClient, /openNativeBrainDropPaths/);
assert.match(nativeClient, /readNativeBrainDropDocuments/);
assert.match(nativeCommand, /MAX_FILES:\s*usize\s*=\s*20/);
assert.match(nativeCommand, /MAX_FILE_BYTES:\s*u64\s*=\s*16 \* 1024 \* 1024/);
assert.match(nativeCommand, /symlink_metadata/);
assert.match(nativeLib, /brain_drop_files::read_local_brain_drop_documents/);
assert.match(nativeBuild, /"read_local_brain_drop_documents"/);
assert.match(nativeCapabilities, /"allow-read-local-brain-drop-documents"/);

void root;
console.log("Unified Brain Drop FAB, recursive selection, navigation removal, and native drop contracts passed.");

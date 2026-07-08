import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const composer = readFileSync(new URL("../src/features/chat/chat-composer.tsx", import.meta.url), "utf8");
const dropReferences = readFileSync(new URL("../src/features/chat/chat-drop-references.ts", import.meta.url), "utf8");
const references = readFileSync(new URL("../src/features/chat/chat-file-references.ts", import.meta.url), "utf8");
const kanbanTypes = readFileSync(new URL("../src/lib/types/kanban.ts", import.meta.url), "utf8");

assert.match(
  kanbanTypes,
  /referenceKind\?: "file" \| "directory";/,
  "chat attachments should preserve whether a reference points at a file or directory",
);

assert.match(
  references,
  /const referenceKind = source\.referenceKind === "directory" \? "directory" : "file";/,
  "file-reference attachments should read the drag/drop reference kind",
);

assert.match(
  references,
  /mimeType: referenceKind === "directory" \? "inode\/directory" : file\.type \|\| "application\/octet-stream"/,
  "directory references should carry a directory mime marker instead of a generic file type",
);

assert.match(
  dropReferences,
  /webkitGetAsEntry\?: \(\) => \{ isDirectory\?: boolean \} \| null;/,
  "browser drag/drop should read the Chromium entry metadata that distinguishes folders",
);

assert.match(
  dropReferences,
  /entry\?\.isDirectory \? "directory" : "file"/,
  "browser drag/drop files should be annotated as directories when the entry says so",
);

assert.match(
  dropReferences,
  /await listNativeLocalDirectories\(\{ path \}\)/,
  "Tauri path drops should use the existing native directory listing command to detect folders",
);

assert.match(
  composer,
  /if \(attachment\.referenceKind === "directory"\) return "Folder";/,
  "attachment pills and menus should label dropped folders as Folder",
);

assert.match(
  composer,
  /const folders = attachments\.filter\(\(attachment\) => attachment\.referenceKind === "directory"\)\.length;/,
  "attachment summaries should count folder references separately from files",
);

assert.match(
  composer,
  /"Attached file and folder references:"/,
  "model-facing reference text should describe both file and folder references",
);

console.log("Chat folder references are preserved and labeled as folders.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  linkedDirectoriesToChatAttachments,
  messageVisibleAttachments,
} = await import("../src/features/chat/chat-message-attachments.ts");

const fileAttachment = {
  id: "file-1",
  kind: "file",
  name: "notes.txt",
  mimeType: "text/plain",
  size: 42,
  dataUrl: "data:text/plain;base64,bm90ZXM=",
};

const directory = {
  id: "dir-1",
  name: "rename",
  path: "/tmp/rename",
  machineName: "This Mac",
  machineKey: "local",
  lastUsedAt: 1_234,
};

const directoryAttachments = linkedDirectoriesToChatAttachments([directory]);
assert.equal(directoryAttachments.length, 1);
assert.equal(directoryAttachments[0].kind, "file");
assert.equal(directoryAttachments[0].name, "rename");
assert.equal(directoryAttachments[0].mimeType, "inode/directory");
assert.equal(directoryAttachments[0].referenceKind, "directory");
assert.equal(directoryAttachments[0].referenceOnly, true);
assert.equal(directoryAttachments[0].referencePath, "/tmp/rename");
assert.equal(directoryAttachments[0].dataUrl, "");
assert.equal(directoryAttachments[0].size, 0);

const visible = messageVisibleAttachments([fileAttachment], [directory]);
assert.equal(visible.length, 2);
assert.equal(visible[0], fileAttachment);
assert.equal(visible[1].referenceKind, "directory");

const controller = readFileSync(new URL("../src/features/dashboard/hooks/use-status-chat-input-controller.tsx", import.meta.url), "utf8");
assert.match(
  controller,
  /import \{ messageVisibleAttachments \} from "@\/features\/chat\/chat-message-attachments";/,
  "chat send controller should use the shared visible-attachment helper",
);
assert.match(
  controller,
  /const outgoingVisibleAttachments = messageVisibleAttachments\(outgoingAttachments, outgoingDirectories\);/,
  "chat send controller should merge linked directories into display attachments",
);
assert.match(
  controller,
  /attachments:\s*outgoingVisibleAttachments,\s*surface:\s*"chat"/s,
  "optimistic user messages should carry visible attachments into the thread",
);

const composer = readFileSync(new URL("../src/features/chat/chat-composer.tsx", import.meta.url), "utf8");
assert.match(
  composer,
  /Number\.isFinite\(attachment\.size\) && attachment\.size > 0/,
  "reference-only directory attachments should not be described as fake one-kilobyte files",
);

console.log("chat visible attachment checks passed");

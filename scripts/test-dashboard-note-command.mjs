#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { captureObsidianNote } = await import("../src/lib/services/obsidian/note-capture.ts");
const { CHAT_SLASH_COMMANDS, filterChatSlashCommands } = await import("../src/features/chat/hermes-slash-commands.ts");
const {
  handleDashboardNoteCommand,
  parseDashboardNoteCommand,
} = await import("../src/features/dashboard/hooks/dashboard-note-command.ts");

assert.equal(parseDashboardNoteCommand("/note remember the milk"), "remember the milk");
assert.equal(parseDashboardNoteCommand("/note\nline one\nline two"), "line one\nline two");
assert.equal(parseDashboardNoteCommand("/note"), "");
assert.equal(CHAT_SLASH_COMMANDS.some((command) => command.name === "note"), true);
assert.deepEqual(filterChatSlashCommands(CHAT_SLASH_COMMANDS, "note").map((command) => command.name), ["note"]);

const vault = await mkdtemp(join(tmpdir(), "hivemindos-note-vault-"));
try {
  const note = await captureObsidianNote({
    vaultPath: vault,
    inboxFolder: "Intake",
    content: "Remember the milk\n\nAnd the coffee.",
    now: new Date("2026-07-06T10:11:12.345Z"),
  });
  assert.equal(note.title, "Remember the milk");
  assert.equal(note.notePath, "Intake/2026-07-06/2026-07-06-101112-remember-the-milk.md");
  const markdown = await readFile(join(vault, note.notePath), "utf8");
  assert.match(markdown, /source: "dashboard-slash-command"/);
  assert.match(markdown, /tags: \["hivemindos-note"\]/);
  assert.match(markdown, /^# Remember the milk/m);
  assert.match(markdown, /And the coffee\./);

  await assert.rejects(
    captureObsidianNote({
      vaultPath: vault,
      inboxFolder: "../Outside",
      content: "bad path",
    }),
    /relative path inside the shared vault/,
  );

  let capturedRequest = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    capturedRequest = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      ok: true,
      note: {
        vaultPath: vault,
        notePath: "Intake/2026-07-06/2026-07-06-101112-dashboard-note.md",
        title: "Dashboard note",
        createdAt: "2026-07-06T10:11:12.345Z",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const messagesByKey = { "agent:leaf": [] };
  let preview = { agentId: "agent", leafKey: "leaf", messages: [] };
  let clearedText = "still-here";
  await handleDashboardNoteCommand({
    prompt: "/note Dashboard note",
    selectedAgent: { id: "agent" },
    selectedChatLeafKey: "leaf",
    selectedStorageKey: "agent:leaf",
    sharedVault: { vaultPath: vault, inboxFolder: "Intake" },
    appendMessage(agentId, message, storageKey = "agent:leaf") {
      assert.equal(agentId, "agent");
      messagesByKey[storageKey] = [...(messagesByKey[storageKey] ?? []), message];
    },
    appendPreviewMessages(agentId, leafKey, messages) {
      assert.equal(agentId, "agent");
      assert.equal(leafKey, "leaf");
      preview = { ...preview, messages: [...preview.messages, ...messages] };
    },
    setText(value) {
      clearedText = value;
    },
    setAttachmentError(value) {
      assert.equal(value, "");
    },
    setAttachmentMenuOpen(value) {
      assert.equal(value, false);
    },
    setMessagesByAgent(updater) {
      Object.assign(messagesByKey, updater(messagesByKey));
    },
    setSelectedChatPreview(updater) {
      preview = updater(preview);
    },
  });
  globalThis.fetch = originalFetch;

  assert.equal(clearedText, "");
  assert.equal(capturedRequest.url, "/api/obsidian/note");
  assert.deepEqual(capturedRequest.body, {
    action: "capture",
    vaultPath: vault,
    inboxFolder: "Intake",
    content: "Dashboard note",
  });
  assert.match(messagesByKey["agent:leaf"].at(-1).content, /Saved to the shared brain/);
  assert.match(messagesByKey["agent:leaf"].at(-1).content, /Intake\/2026-07-06\/2026-07-06-101112-dashboard-note\.md/);
  assert.match(preview.messages.at(-1).content, /Saved to the shared brain/);
} finally {
  await rm(vault, { recursive: true, force: true });
}

console.log("Dashboard /note command parser, note capture, and chat receipt checks passed.");

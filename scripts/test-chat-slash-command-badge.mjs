import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { parseUserSlashCommandDisplay } = await import(
  "../src/features/queen-voice/queen-command-display.ts"
);
const thread = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/MessageThread.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/chat-exchange.css", import.meta.url),
  "utf8",
);

assert.deepEqual(
  parseUserSlashCommandDisplay("/transcript\nhttps://x.com/user/status/1"),
  { name: "transcript", suffix: "\nhttps://x.com/user/status/1" },
  "the shared parser should preserve the original line break and arguments",
);
assert.match(thread, /parseUserSlashCommandDisplay/, "Chat should reuse the canonical slash-command parser");
assert.match(thread, /function UserMessageContent/, "Chat should render user command content through a focused component");
assert.match(thread, /fr-chat-command-badge/, "Chat should render the command name as a badge");
assert.match(styles, /\.fr-chat-user-command\.is-stacked/, "newline-separated command arguments should keep their stacked layout");
assert.match(styles, /\.fr-chat-command-badge\s*\{/, "the Chat badge should have a scoped style");
assert.match(styles, /data-theme="hive-light"[^\n]*\.fr-chat-command-badge/, "the Chat badge should remain legible in light mode");

console.log("test-chat-slash-command-badge: Chat user bubbles badge slash commands and preserve arguments");

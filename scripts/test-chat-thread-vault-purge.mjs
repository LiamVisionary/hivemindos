#!/usr/bin/env node
// Hermetic test for the shared-vault half of deleting a chat thread: the
// conversation notes under Memory/Conversations, their Conversations Index
// rows, and the generated Full Vault Search Index rows.
//
// Everything runs against a throwaway vault in tmp. NEVER call
// deleteConversationNotesForThread without an explicit `vaultPath`, and never
// name a fixture directory `hivemindos-vault`: resolveObsidianVaultPath treats
// any path ending in `/hivemindos-vault` (or a missing one) as an auto-detect
// hint and would discover — and then purge — the developer's real vault.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));
const {
  conversationIndexLinesWithoutThread,
  conversationNoteChatStorageKey,
  isPurgeableConversationNotePath,
  deleteConversationNotesForThread,
} = await import("../src/lib/services/obsidian/conversation-notes.ts");
const { fullVaultIndexLinesWithoutPaths } = await import("../src/lib/services/obsidian/full-vault-search-index.ts");

const KEY_A = "hermes-scout-a55e2a::folder-abc";
const KEY_B = "hermes-scout-a55e2a::folder-xyz";
// Three `..` — two only pop `Memory/Conversations` and land back at the vault
// root, which would make the sentinel assertion below vacuously true.
const TRAVERSAL = "Memory/Conversations/../../../sentinel.md";

// --- conversationNoteChatStorageKey ----------------------------------------
const note = (key) => [
  "---",
  "type: conversation",
  'sessionId: "s1"',
  ...(key === undefined ? [] : [`chatStorageKey: ${JSON.stringify(key)}`]),
  "---",
  "",
  "# conversation",
].join("\n");

assert.equal(conversationNoteChatStorageKey(note(KEY_A)), KEY_A);
assert.equal(conversationNoteChatStorageKey(note(undefined)), undefined);
// The writer omits the line for empty keys, but a hand-written "" must not match either.
assert.equal(conversationNoteChatStorageKey(note("")), undefined);
assert.equal(conversationNoteChatStorageKey("no frontmatter here"), undefined);
// A `chatStorageKey:` in the body, past the closing fence, is not frontmatter.
assert.equal(conversationNoteChatStorageKey('---\ntype: x\n---\n\nchatStorageKey: "spoofed"\n'), undefined);

// --- isPurgeableConversationNotePath (the untrusted-input guard) ------------
assert.equal(isPurgeableConversationNotePath("Memory/Conversations/agent/a.md"), true);
assert.equal(isPurgeableConversationNotePath(TRAVERSAL), false);
assert.equal(isPurgeableConversationNotePath("Memory/Conversations/../secrets.md"), false);
assert.equal(isPurgeableConversationNotePath("/etc/passwd"), false);
assert.equal(isPurgeableConversationNotePath("/Memory/Conversations/a.md"), false);
assert.equal(isPurgeableConversationNotePath("Memory/Conversations/a.txt"), false);
assert.equal(isPurgeableConversationNotePath("Memory/Distillations/a.md"), false);
assert.equal(isPurgeableConversationNotePath("Memory/Conversations//a.md"), false);
assert.equal(isPurgeableConversationNotePath(""), false);

// --- conversationIndexLinesWithoutThread ------------------------------------
const row = (key, notePath, sessionId) => JSON.stringify({
  timestamp: "2026-07-10T00:00:00.000Z",
  action: "conversation",
  sessionId,
  chatStorageKey: key,
  notePath,
});
const CORRUPT = "{ this is not json";
const rawIndex = [
  row(KEY_A, "Memory/Conversations/agent-a/one-s1.md", "s1"),
  row(KEY_B, "Memory/Conversations/agent-b/three-s3.md", "s3"),
  CORRUPT,
  row("", "Memory/Conversations/agent-c/orphan-s4.md", "s4"),
  row(KEY_A, TRAVERSAL, "s5"),
].join("\n") + "\n";

const filtered = conversationIndexLinesWithoutThread(rawIndex, KEY_A);
assert.equal(filtered.removed, 2);
assert.deepEqual(filtered.notePaths, ["Memory/Conversations/agent-a/one-s1.md", TRAVERSAL]);
const keptLines = filtered.contents.split("\n").filter(Boolean);
assert.equal(keptLines.length, 3);
assert.ok(keptLines.includes(CORRUPT), "unparseable rows are kept, not discarded");
assert.ok(filtered.contents.endsWith("\n"), "index stays append-safe");

// An empty key matches nothing — otherwise it would sweep every keyless row.
const blank = conversationIndexLinesWithoutThread(rawIndex, "");
assert.equal(blank.removed, 0);
assert.equal(blank.contents, rawIndex);
assert.deepEqual(blank.notePaths, []);
assert.equal(conversationIndexLinesWithoutThread(rawIndex, "   ").removed, 0);

// --- fullVaultIndexLinesWithoutPaths ----------------------------------------
const searchRow = (path) => JSON.stringify({ schema: "hivemindos.full-vault-search.v1", path, excerpt: "secret" });
const rawSearch = [
  searchRow("Memory/Conversations/agent-a/one-s1.md"),
  searchRow("Memory/Distillations/keep.md"),
  CORRUPT,
].join("\n") + "\n";
const prunedSearch = fullVaultIndexLinesWithoutPaths(rawSearch, ["Memory/Conversations/agent-a/one-s1.md"]);
assert.equal(prunedSearch.removed, 1);
assert.ok(prunedSearch.contents.includes("Memory/Distillations/keep.md"));
assert.ok(prunedSearch.contents.includes(CORRUPT));
assert.equal(fullVaultIndexLinesWithoutPaths(rawSearch, []).removed, 0);

// --- End-to-end against a throwaway vault -----------------------------------
const base = await mkdtemp(join(tmpdir(), "hivemind-purge-"));
const root = join(base, "vault"); // deliberately NOT named hivemindos-vault
const sentinel = join(base, "sentinel.md"); // outside the vault; TRAVERSAL aims here
const conversations = join(root, "Memory", "Conversations");
const indexFile = join(root, "Operations", "Brain Services", "Conversations Index.jsonl");
const searchFile = join(root, "Operations", "Brain Services", "Full Vault Search Index.jsonl");

const NOTE_A1 = "Memory/Conversations/agent-a/one-s1.md";
const NOTE_A2 = "Memory/Conversations/agent-a/two-s2.md";
const NOTE_B = "Memory/Conversations/agent-b/three-s3.md";
const NOTE_ORPHAN = "Memory/Conversations/agent-c/orphan-s4.md";

try {
  await mkdir(join(conversations, "agent-a"), { recursive: true });
  await mkdir(join(conversations, "agent-b"), { recursive: true });
  await mkdir(join(conversations, "agent-c"), { recursive: true });
  await mkdir(join(root, "Operations", "Brain Services"), { recursive: true });
  await writeFile(sentinel, "must survive", "utf8");
  // Pin the fixture as genuinely hostile: absent the guard, this row's path
  // resolves onto the sentinel outside the vault. If a future edit weakens
  // TRAVERSAL, this fails rather than silently making the purge test vacuous.
  assert.equal(resolve(root, TRAVERSAL), sentinel);
  assert.ok(relative(root, resolve(root, TRAVERSAL)).startsWith(".."), "TRAVERSAL must escape the vault root");
  await writeFile(join(root, NOTE_A1), note(KEY_A), "utf8");
  await writeFile(join(root, NOTE_A2), note(KEY_A), "utf8");
  await writeFile(join(root, NOTE_B), note(KEY_B), "utf8");
  await writeFile(join(root, NOTE_ORPHAN), note(undefined), "utf8");
  await writeFile(indexFile, [
    row(KEY_A, NOTE_A1, "s1"),
    row(KEY_A, NOTE_A2, "s2"),
    row(KEY_B, NOTE_B, "s3"),
    row("", NOTE_ORPHAN, "s4"),
    row(KEY_A, TRAVERSAL, "s5"),
    row(KEY_A, "/etc/passwd", "s6"),
    CORRUPT,
  ].join("\n") + "\n", "utf8");
  await writeFile(searchFile, [
    searchRow(NOTE_A1),
    searchRow(NOTE_A2),
    searchRow(NOTE_B),
    searchRow(NOTE_ORPHAN),
    searchRow("Memory/Distillations/keep.md"),
  ].join("\n") + "\n", "utf8");

  // A blank key is a no-op even though a keyless note and row exist.
  const noop = await deleteConversationNotesForThread({ chatStorageKey: "  ", vaultPath: root });
  assert.equal(noop.notesDeleted, 0);
  assert.equal(noop.vaultPresent, false, "a blank key short-circuits before touching the vault");
  assert.ok(existsSync(join(root, NOTE_ORPHAN)));

  // A vault that does not exist is a no-op, not an error.
  const absent = await deleteConversationNotesForThread({ chatStorageKey: KEY_A, vaultPath: join(base, "missing-vault") });
  assert.equal(absent.vaultPresent, false);
  assert.equal(absent.notesDeleted, 0);
  assert.ok(existsSync(join(root, NOTE_A1)), "the real fixture vault was untouched");

  const result = await deleteConversationNotesForThread({ chatStorageKey: KEY_A, vaultPath: root });

  assert.equal(result.vaultPresent, true);
  assert.equal(result.notesTargeted, 2);
  assert.equal(result.notesDeleted, 2);
  assert.equal(result.indexRowsRemoved, 4, "two real rows plus the two hostile rows");
  assert.equal(result.searchIndexRowsRemoved, 2);
  assert.deepEqual(result.unsafeNotePathsSkipped, [TRAVERSAL, "/etc/passwd"]);

  // The hostile rows lost their index entries but never unlinked their targets.
  assert.ok(existsSync(sentinel), "a crafted notePath must never escape Memory/Conversations");

  assert.equal(existsSync(join(root, NOTE_A1)), false);
  assert.equal(existsSync(join(root, NOTE_A2)), false);
  assert.ok(existsSync(join(root, NOTE_B)), "another thread's note survives");
  assert.ok(existsSync(join(root, NOTE_ORPHAN)), "a keyless note is not addressable and survives");

  // The emptied agent folder is pruned; folders with notes left are not.
  assert.equal(existsSync(join(conversations, "agent-a")), false);
  assert.ok(existsSync(join(conversations, "agent-b")));

  const indexAfter = await readFile(indexFile, "utf8");
  const rowsAfter = indexAfter.split("\n").filter(Boolean);
  assert.equal(rowsAfter.length, 3);
  assert.ok(indexAfter.includes(NOTE_B));
  assert.ok(indexAfter.includes(NOTE_ORPHAN));
  assert.ok(rowsAfter.includes(CORRUPT));
  assert.equal(indexAfter.includes(TRAVERSAL), false);
  assert.equal(indexAfter.includes(NOTE_A1), false);

  // Search rows for the deleted notes are gone, so recall cannot surface their
  // excerpt before the next TTL rebuild. Unrelated rows stay.
  const searchAfter = await readFile(searchFile, "utf8");
  assert.equal(searchAfter.includes(NOTE_A1), false);
  assert.equal(searchAfter.includes(NOTE_A2), false);
  assert.ok(searchAfter.includes(NOTE_B));
  assert.ok(searchAfter.includes("Memory/Distillations/keep.md"));

  // Re-running is idempotent: nothing left to remove, no error.
  const again = await deleteConversationNotesForThread({ chatStorageKey: KEY_A, vaultPath: root });
  assert.equal(again.notesDeleted, 0);
  assert.equal(again.indexRowsRemoved, 0);
  assert.equal(again.searchIndexRowsRemoved, 0);

  // A note whose index append failed is still purgeable: the folder scan finds
  // it by frontmatter even with no row pointing at it.
  await mkdir(join(conversations, "agent-d"), { recursive: true });
  const unindexed = "Memory/Conversations/agent-d/unindexed-s9.md";
  await writeFile(join(root, unindexed), note(KEY_B), "utf8");
  const byFrontmatter = await deleteConversationNotesForThread({ chatStorageKey: KEY_B, vaultPath: root });
  assert.equal(byFrontmatter.notesDeleted, 2, "the indexed note and the unindexed one");
  assert.equal(existsSync(join(root, unindexed)), false);
  assert.equal(existsSync(join(root, NOTE_B)), false);
} finally {
  await rm(base, { recursive: true, force: true });
}

console.log("chat thread vault purge: OK");

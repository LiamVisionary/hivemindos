#!/usr/bin/env node
import assert from "node:assert/strict";

const {
  deleteChatThread,
  duplicateChatThreadSeed,
  renameChatThread,
  chatTranscriptSourceMessages,
  serializeChatTranscript,
  agentIdFromChatStorageKey,
  applyChatThreadFilters,
  sortChatThreads,
  groupChatThreads,
  CHAT_HISTORY_PAGE_SIZE,
  nextChatHistoryVisibleCount,
} = await import("../src/features/dashboard/views/chat/exchange/chat-thread-actions.ts");

const {
  parseChatViewPreferences,
  serializeChatViewPreferences,
  DEFAULT_CHAT_VIEW_PREFERENCES,
  chatViewPreferencesChanged,
} = await import("../src/features/dashboard/views/chat/exchange/use-chat-view-preferences.ts");

// ---------------------------------------------------------------------------
// deleteChatThread: removes exactly one key, does not mutate the input
// ---------------------------------------------------------------------------
{
  const input = {
    "agent-a": [{ role: "user", content: "hi" }],
    "agent-a::leaf-1": [{ role: "user", content: "second" }],
    "agent-b": [{ role: "user", content: "other" }],
  };
  const snapshot = JSON.stringify(input);
  const next = deleteChatThread(input, "agent-a::leaf-1");

  assert.ok(!("agent-a::leaf-1" in next), "deleted key must be gone");
  assert.deepEqual(Object.keys(next).sort(), ["agent-a", "agent-b"], "exactly one key removed");
  assert.notEqual(next, input, "returns a new record");
  assert.equal(JSON.stringify(input), snapshot, "input record was not mutated");

  // Deleting a missing key returns a copy, still no mutation.
  const missing = deleteChatThread(input, "does-not-exist");
  assert.deepEqual(Object.keys(missing).sort(), ["agent-a", "agent-a::leaf-1", "agent-b"]);
  assert.notEqual(missing, input);
  assert.equal(JSON.stringify(input), snapshot, "input unchanged after missing-key delete");
}

// ---------------------------------------------------------------------------
// duplicateChatThreadSeed: copies messages, distinct testable leaf key
// ---------------------------------------------------------------------------
{
  const messages = [
    { role: "user", content: "first" },
    { role: "assistant", content: "reply" },
  ];
  const input = { "hermes-main::leaf-src": messages };
  const snapshot = JSON.stringify(input);
  const nowMs = 1_700_000_000_000;

  const { seedMessages, leafKey } = duplicateChatThreadSeed(input, "hermes-main::leaf-src", nowMs);

  assert.equal(agentIdFromChatStorageKey("hermes-main::leaf-src"), "hermes-main");
  assert.equal(agentIdFromChatStorageKey("hermes-main"), "hermes-main", "bare storage key -> agent id");
  assert.equal(seedMessages.length, 2, "seeds all messages");
  assert.deepEqual(
    seedMessages.map((m) => m.content),
    ["first", "reply"],
    "content copied verbatim",
  );
  assert.notEqual(seedMessages, messages, "seed array is a fresh array");
  assert.notEqual(seedMessages[0], messages[0], "each message is a fresh object");

  // Fresh leaf must not collide with the source leaf and follows the createChatLeafKey `agent-<id>-...` shape.
  assert.ok(leafKey.startsWith("agent-hermes-main-"), `leaf key is agent-<id>-style, got ${leafKey}`);
  assert.notEqual(leafKey, "leaf-src");
  assert.notEqual(leafKey, "agent-hermes-main", "leaf differs from the bare agent leaf so a new storage key results");

  // Deterministic for a fixed nowMs; different nowMs gives a different leaf.
  const again = duplicateChatThreadSeed(input, "hermes-main::leaf-src", nowMs);
  assert.equal(again.leafKey, leafKey, "same nowMs -> same leaf (deterministic, no Date.now())");
  const later = duplicateChatThreadSeed(input, "hermes-main::leaf-src", nowMs + 1);
  assert.notEqual(later.leafKey, leafKey, "different nowMs -> different leaf");

  // Mutating the duplicate must not reach the source.
  seedMessages[0].content = "MUTATED";
  assert.equal(JSON.stringify(input), snapshot, "source thread untouched by duplicate mutation");
}

// ---------------------------------------------------------------------------
// renameChatThread: writes an override, does not mutate input, clears on empty
// ---------------------------------------------------------------------------
{
  const titles = {
    "agent-a": { title: "Old", generatedAt: 1, mode: "cloud", model: "gpt" },
  };
  const snapshot = JSON.stringify(titles);
  const nowMs = 42;

  const renamed = renameChatThread(titles, "agent-a", "  Brand new name  ", nowMs);
  assert.notEqual(renamed, titles, "returns a new map");
  assert.equal(renamed["agent-a"].title, "Brand new name", "title trimmed + overridden");
  assert.equal(renamed["agent-a"].generatedAt, nowMs, "stamps supplied nowMs");
  assert.equal(renamed["agent-a"].mode, "cloud", "preserves prior mode");
  assert.equal(JSON.stringify(titles), snapshot, "input titles map not mutated");

  // New key with no prior entry gets a valid stored shape (mode local, model marker).
  const added = renameChatThread(titles, "agent-b::leaf", "Second thread", nowMs);
  assert.equal(added["agent-b::leaf"].title, "Second thread");
  assert.equal(added["agent-b::leaf"].mode, "local");
  assert.equal(added["agent-b::leaf"].model, "manual");

  // Empty title clears the override.
  const cleared = renameChatThread(titles, "agent-a", "   ", nowMs);
  assert.ok(!("agent-a" in cleared), "blank title removes the override");
}

// ---------------------------------------------------------------------------
// chatTranscriptSourceMessages: full stored thread wins over a rendered window
// ---------------------------------------------------------------------------
{
  const fullThread = [
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "latest question" },
    { role: "assistant", content: "latest answer" },
  ];
  const renderedWindow = fullThread.slice(-1);
  const source = chatTranscriptSourceMessages(
    { "agent-a::thread": fullThread },
    "agent-a::thread",
    renderedWindow,
  );
  assert.strictEqual(source, fullThread, "copy chat uses the complete stored thread instead of the rendered window");
  assert.equal(
    serializeChatTranscript(source),
    "User: first question\n\nAssistant: first answer\n\nUser: latest question\n\nAssistant: latest answer",
  );
  assert.strictEqual(
    chatTranscriptSourceMessages({}, "agent-a::preview", renderedWindow),
    renderedWindow,
    "transient previews fall back to their rendered messages",
  );
}

// ---------------------------------------------------------------------------
// serializeChatTranscript: skips system + empty, labels roles, uses displayContent, brackets attachments
// ---------------------------------------------------------------------------
{
  const messages = [
    { role: "system", content: "you are helpful" },
    { role: "user", content: "hello there" },
    { role: "assistant", content: "RAW_ASSISTANT" },
    { role: "user", content: "   " }, // empty after trim -> skipped
    { role: "user", content: "look at this", attachments: [{ name: "diagram.png" }, { name: "notes.txt" }] },
    { role: "assistant", content: "", attachments: [{ name: "chart.svg" }] }, // empty text but has attachment
  ];

  const transcript = serializeChatTranscript(messages, {
    agentName: "Nova",
    displayContent: (m) => (m.content === "RAW_ASSISTANT" ? "cleaned reply" : m.content),
  });

  const blocks = transcript.split("\n\n");
  assert.deepEqual(blocks, [
    "User: hello there",
    "Nova: cleaned reply",
    "User: look at this [diagram.png, notes.txt]",
    "Nova: [chart.svg]",
  ]);
  assert.ok(!transcript.includes("you are helpful"), "system message skipped");
  assert.ok(!transcript.includes("RAW_ASSISTANT"), "assistant text goes through displayContent");

  // Default (no displayContent, no agentName): raw content + "Assistant" label.
  const fallback = serializeChatTranscript([
    { role: "user", content: "q" },
    { role: "assistant", content: "a" },
  ]);
  assert.equal(fallback, "User: q\n\nAssistant: a");

  // A thread with only system/empty messages serializes to empty string.
  assert.equal(serializeChatTranscript([{ role: "system", content: "x" }, { role: "user", content: "" }]), "");
}

// ---------------------------------------------------------------------------
// parseChatViewPreferences: defaults on corrupt JSON; per-field validation; round-trip
// ---------------------------------------------------------------------------
{
  // Pin the concrete defaults so a silent change is caught (these compare
  // against the symbol below, which would pass no matter what it held).
  assert.equal(DEFAULT_CHAT_VIEW_PREFERENCES.groupBy, "project", "default grouping is by project");
  assert.equal(DEFAULT_CHAT_VIEW_PREFERENCES.filters.machine, "all", "machine filter sentinel is 'all'");
  assert.equal(DEFAULT_CHAT_VIEW_PREFERENCES.sortBy, "recency", "default sort is recency");

  assert.deepEqual(parseChatViewPreferences("not json {{{"), DEFAULT_CHAT_VIEW_PREFERENCES, "corrupt JSON -> defaults");
  assert.deepEqual(parseChatViewPreferences(""), DEFAULT_CHAT_VIEW_PREFERENCES, "empty -> defaults");
  assert.deepEqual(parseChatViewPreferences("[1,2,3]"), DEFAULT_CHAT_VIEW_PREFERENCES, "array -> defaults");
  assert.deepEqual(parseChatViewPreferences("null"), DEFAULT_CHAT_VIEW_PREFERENCES, "null -> defaults");

  // Corrupt returns are fresh copies, not the shared default object.
  assert.notEqual(parseChatViewPreferences("garbage"), DEFAULT_CHAT_VIEW_PREFERENCES);

  // Bad field types fall back per-field without discarding the good fields.
  const mixed = parseChatViewPreferences(
    JSON.stringify({
      pinned: ["a", 5, "a", "  ", "b"],
      archived: "nope",
      collapsed: { Today: true, Earlier: false, "": true },
      filters: { status: "bogus", machine: 12, activity: "week" },
      groupBy: "date",
      sortBy: "wat",
    }),
  );
  assert.deepEqual(mixed.pinned, ["a", "b"], "pinned deduped + string-filtered");
  assert.deepEqual(mixed.archived, [], "bad archived -> empty list");
  assert.deepEqual(mixed.collapsed, { Today: true }, "only true collapsed entries kept");
  assert.equal(mixed.filters.status, "all", "bad status -> all");
  assert.equal(mixed.filters.machine, "all", "non-string machine -> 'all' sentinel");
  assert.equal(mixed.filters.activity, "week", "valid activity kept");
  assert.equal(mixed.groupBy, "date", "valid groupBy kept");
  assert.equal(mixed.sortBy, "recency", "bad sortBy -> recency");

  // Round-trip is stable.
  const roundTripped = parseChatViewPreferences(serializeChatViewPreferences(mixed));
  assert.deepEqual(roundTripped, mixed, "serialize -> parse round-trips");

  assert.equal(chatViewPreferencesChanged(DEFAULT_CHAT_VIEW_PREFERENCES), false, "defaults are unchanged");
  // viewsChanged tracks only what resetFilters() actually clears.
  assert.equal(
    chatViewPreferencesChanged({ ...DEFAULT_CHAT_VIEW_PREFERENCES, pinned: ["a"] }),
    false,
    "pinning a chat is not a filter change",
  );
  assert.equal(
    chatViewPreferencesChanged({ ...DEFAULT_CHAT_VIEW_PREFERENCES, filters: { status: "active", machine: "all", activity: "all" } }),
    true,
    "a status filter is a filter change",
  );
  assert.equal(chatViewPreferencesChanged(mixed), true, "mutated prefs report changed");
}

// ---------------------------------------------------------------------------
// progressive chat history: starts at five and reveals five more per press
// ---------------------------------------------------------------------------
{
  assert.equal(CHAT_HISTORY_PAGE_SIZE, 5);
  assert.equal(nextChatHistoryVisibleCount(5, 18), 10);
  assert.equal(nextChatHistoryVisibleCount(10, 18), 15);
  assert.equal(nextChatHistoryVisibleCount(15, 18), 18, "the final page is capped at the remaining rows");
  assert.equal(nextChatHistoryVisibleCount(18, 18), 18, "pressing at the end does not exceed the total");
}

// ---------------------------------------------------------------------------
// groupChatThreads: date bucketing at boundaries (Today / This week / Earlier)
// ---------------------------------------------------------------------------
{
  const DAY = 24 * 60 * 60 * 1000;
  // Pick a nowMs well away from local midnight so bucketing is unambiguous.
  const nowMs = new Date("2026-07-10T15:30:00").getTime();
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();
  const weekStartMs = todayStartMs - 6 * DAY;

  const rows = [
    { storageKey: "k-now", agentId: "a", updatedAt: nowMs },
    { storageKey: "k-today-edge", agentId: "a", updatedAt: todayStartMs }, // exactly midnight today -> Today
    { storageKey: "k-yesterday", agentId: "a", updatedAt: todayStartMs - 1 }, // 1ms before today -> This week
    { storageKey: "k-week-edge", agentId: "a", updatedAt: weekStartMs }, // exact week floor -> This week
    { storageKey: "k-earlier", agentId: "a", updatedAt: weekStartMs - 1 }, // just past floor -> Earlier
  ];

  const groups = groupChatThreads(rows, "date", nowMs);
  const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.chats.map((c) => c.storageKey)]));

  assert.deepEqual(groups.map((g) => g.key), ["today", "week", "earlier"], "date groups in fixed order");
  assert.deepEqual(byLabel.Today.sort(), ["k-now", "k-today-edge"], "Today includes midnight boundary");
  assert.deepEqual(byLabel["This week"].sort(), ["k-week-edge", "k-yesterday"], "This week includes week floor + pre-today");
  assert.deepEqual(byLabel.Earlier, ["k-earlier"], "Earlier is strictly before the week floor");

  // Empty buckets are omitted.
  const onlyToday = groupChatThreads([{ storageKey: "x", agentId: "a", updatedAt: nowMs }], "date", nowMs);
  assert.deepEqual(onlyToday.map((g) => g.label), ["Today"]);
}

// ---------------------------------------------------------------------------
// group/filter/sort sanity for the non-date paths
// ---------------------------------------------------------------------------
{
  const rows = [
    { storageKey: "k1", agentId: "a", agentName: "Alpha", machineName: "mac-1", status: "active", updatedAt: 300, workingDirectoryPath: "/Users/x/proj-one" },
    { storageKey: "k2", agentId: "b", agentName: "Beta", machineName: "mac-2", status: "idle", updatedAt: 200, projectLabel: "Proj Two" },
    { storageKey: "k3", agentId: "a", agentName: "Alpha", machineName: "mac-1", status: "idle", updatedAt: 100, workingDirectoryPath: "/Users/x/proj-one/" },
  ];

  // flat
  const flat = groupChatThreads(rows, "flat", 0);
  assert.deepEqual(flat.map((g) => g.key), ["flat"]);
  assert.equal(flat[0].chats.length, 3);

  // project (trailing slash normalizes to same basename)
  const byProject = groupChatThreads(rows, "project", 0);
  const projOne = byProject.find((g) => g.label === "proj-one");
  assert.ok(projOne, "project derived from working directory basename");
  assert.deepEqual(projOne.chats.map((c) => c.storageKey).sort(), ["k1", "k3"]);
  assert.ok(byProject.find((g) => g.label === "Proj Two"), "explicit projectLabel used");

  // machine
  const byMachine = groupChatThreads(rows, "machine", 0);
  assert.deepEqual(byMachine.map((g) => g.label).sort(), ["mac-1", "mac-2"]);

  // agent
  const byAgent = groupChatThreads(rows, "agent", 0);
  assert.deepEqual(byAgent.map((g) => g.label).sort(), ["Alpha", "Beta"]);

  // filters: status
  assert.deepEqual(
    applyChatThreadFilters(rows, { status: "active", machine: "", activity: "all" }, 0).map((r) => r.storageKey),
    ["k1"],
  );
  // filters: machine
  assert.deepEqual(
    applyChatThreadFilters(rows, { status: "all", machine: "mac-2", activity: "all" }, 0).map((r) => r.storageKey),
    ["k2"],
  );
  // filters: activity window (month) relative to nowMs
  const nowMs = 40 * 24 * 60 * 60 * 1000;
  const recent = [
    { storageKey: "r-old", agentId: "a", updatedAt: nowMs - 40 * 24 * 60 * 60 * 1000 },
    { storageKey: "r-new", agentId: "a", updatedAt: nowMs - 5 * 24 * 60 * 60 * 1000 },
  ];
  assert.deepEqual(
    applyChatThreadFilters(recent, { status: "all", machine: "", activity: "month" }, nowMs).map((r) => r.storageKey),
    ["r-new"],
  );

  // sort: recency (newest first) and name (asc)
  assert.deepEqual(sortChatThreads(rows, "recency").map((r) => r.storageKey), ["k1", "k2", "k3"]);
  assert.deepEqual(sortChatThreads(rows, "name").map((r) => r.agentName), ["Alpha", "Alpha", "Beta"]);
  // sort: activity (active first)
  assert.equal(sortChatThreads(rows, "activity")[0].storageKey, "k1");
  // sort does not mutate input
  const order = rows.map((r) => r.storageKey);
  sortChatThreads(rows, "name");
  assert.deepEqual(rows.map((r) => r.storageKey), order, "sort returns a new array, input unchanged");
}

console.log("test-chat-thread-actions: all assertions passed");

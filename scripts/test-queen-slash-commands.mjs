import { register } from "node:module";
import assert from "node:assert/strict";

// Native TS type-stripping + `@/` alias via the shared loader, then dynamic
// import the pure classifier. Run: node scripts/test-queen-slash-commands.mjs
//
// Guards the general slash-command router for the "Ask the hive" pill: EVERY
// "/command" is recognized and routed (transcript / dashboard-drive / clear /
// help / honest-cli / honest-unknown) instead of being forwarded to the Queen
// as conversation. A regression here reintroduces "I can't fetch that directly".
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { classifyQueenSlashCommand } = await import("../src/features/queen-voice/queen-slash-commands.ts");

// Plain text is not a command → the caller runs the normal Queen turn.
for (const text of ["hello", "what's up", "open the work board please", "  ", "", "/", "/ notacommand"]) {
  assert.equal(classifyQueenSlashCommand(text).kind, "none", `not a command: ${JSON.stringify(text)}`);
}

// /transcript → transcript route with the parsed url (empty when none given).
const t1 = classifyQueenSlashCommand("/transcript https://x.com/u/status/1780000000000000001");
assert.equal(t1.kind, "transcript");
assert.equal(t1.url, "https://x.com/u/status/1780000000000000001");
assert.equal(classifyQueenSlashCommand("/transcript").kind, "transcript");
assert.equal(classifyQueenSlashCommand("/transcript").url, "", "bare /transcript prompts for a link");

// Dashboard commands → dashboard route with a natural-language intent for Bee Pilot.
const work = classifyQueenSlashCommand("/work");
assert.equal(work.kind, "dashboard");
assert.equal(work.command.name, "work");
assert.match(work.intent, /work board/i, "intent describes the action");
const note = classifyQueenSlashCommand("/note buy oat milk");
assert.equal(note.kind, "dashboard");
assert.equal(note.intent, "Save a note to the shared brain: buy oat milk", "args fold into the intent");
// aliases resolve (kanban → work board command)
assert.equal(classifyQueenSlashCommand("/kanban").kind, "dashboard");
assert.equal(classifyQueenSlashCommand("/image-gen a honeycomb city").kind, "dashboard");

// Session-local commands.
for (const c of ["/clear", "/new", "/reset"]) assert.equal(classifyQueenSlashCommand(c).kind, "clear", c);
assert.equal(classifyQueenSlashCommand("/help").kind, "help");

// Known Hermes/CLI commands that don't apply to the pill → honest "cli" (not conversational).
const model = classifyQueenSlashCommand("/model gpt-5");
assert.equal(model.kind, "cli");
assert.equal(model.name, "model");
assert.ok(model.description, "carries the command description for an honest reply");
assert.equal(classifyQueenSlashCommand("/goal ship it").kind, "cli");

// Unknown slash → honest "unknown", never forwarded to the Queen as chat.
const unknown = classifyQueenSlashCommand("/definitelynotacommand");
assert.equal(unknown.kind, "unknown");
assert.equal(unknown.name, "definitelynotacommand");

console.log("test-queen-slash-commands: all assertions passed");

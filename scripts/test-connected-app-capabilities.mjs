#!/usr/bin/env node
// Connected-app capability overlay + always-on roster (2026-07-10).
// Locks: (1) app-preferences carries a `capabilities` tag that normalizes
// (lowercase/dedupe/cap) and merges onto discovered apps without touching the
// service; (2) the task-retrieval preflight injects an ALWAYS-ON roster of what
// each connected app does, so an agent knows its fleet's capabilities even when
// the prompt never text-matched a retrieval query (the gap that hid the video
// app from HermesScout).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadModule(relPath, globals, exposeExpr) {
  const source = readFileSync(new URL(relPath, import.meta.url), "utf8");
  const stripped = source
    .replace(/^import[^;]*;/gm, "")
    .replace(/\bexport\s+/g, "") + `\n;globalThis.__mod = ${exposeExpr};`;
  const compiled = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ ...globals });
  vm.runInContext(compiled, context, { filename: relPath });
  return context.__mod;
}

// ---- app-preferences.ts: capabilities normalize + merge ----
const prefs = loadModule(
  "../src/lib/services/fleet/app-preferences.ts",
  { join: (...a) => a.filter(Boolean).join("/"), homedir: () => "/tmp" },
  "{ normalizeAppPreference, applyAppPreferences }",
);

// vm-returned arrays live in another realm (different Array.prototype), so
// spread into host arrays before deep-equal.
const fromArray = prefs.normalizeAppPreference({ appId: "h:1:a", capabilities: ["Video", "video", " Image-To-Video ", ""] });
assert.deepEqual([...fromArray.capabilities], ["video", "image-to-video"], "capabilities lowercase + dedupe + drop empties");

const fromString = prefs.normalizeAppPreference({ appId: "h:1:a", capabilities: "video, image-to-video\nimage" });
assert.deepEqual([...fromString.capabilities], ["video", "image-to-video", "image"], "comma/newline string parses to tags");

const capped = prefs.normalizeAppPreference({ appId: "h:1:a", capabilities: Array.from({ length: 20 }, (_, i) => `cap${i}`) });
assert.equal(capped.capabilities.length, 12, "capabilities capped at 12");

const none = prefs.normalizeAppPreference({ appId: "h:1:a", capabilities: [] });
assert.equal(none.capabilities, undefined, "empty capabilities normalize to undefined (so the record can prune)");

const merged = prefs.applyAppPreferences(
  [{ id: "h:1:a", name: "Media Studio" }],
  [prefs.normalizeAppPreference({ appId: "h:1:a", capabilities: ["video"] })],
);
assert.deepEqual([...merged[0].capabilities], ["video"], "capabilities merge onto the discovered app record");

// ---- task-retrieval-context.ts: always-on roster ----
const trc = loadModule(
  "../src/lib/services/chat/task-retrieval-context.ts",
  {},
  "{ connectedAppsRosterContext }",
);

assert.equal(trc.connectedAppsRosterContext([]), "", "no apps => no roster");
assert.equal(trc.connectedAppsRosterContext(undefined), "", "undefined apps => no roster");

const roster = trc.connectedAppsRosterContext([
  { id: "n:8788:z", name: "Z-Image Studio", machineName: "Liams Macbook Pro Nyc", serviceKind: "api", description: "Next.js control surface for Z-Image and ComfyUI" },
  { id: "n:8789:m", name: "Media Studio", machineName: "Liams Macbook Pro Nyc", serviceKind: "api", capabilities: ["video", "image-to-video"] },
]);
assert.ok(/Connected apps on this fleet/.test(roster), "roster has a header");
assert.ok(/Media Studio \[Liams Macbook Pro Nyc\]: can: video, image-to-video/.test(roster), "capability-tagged app shows its capabilities");
assert.ok(/Z-Image Studio \[Liams Macbook Pro Nyc\]: Next.js control surface/.test(roster), "untagged app falls back to its description");
// The capability-tagged app ranks above the plain image app.
assert.ok(roster.indexOf("Media Studio") < roster.indexOf("Z-Image Studio"), "capability-tagged app ranks first");

// Cap + honest overflow footer.
const many = Array.from({ length: 30 }, (_, i) => ({ id: `h:${i}:a`, name: `App ${i}`, serviceKind: "api" }));
const cappedRoster = trc.connectedAppsRosterContext(many);
const appLines = cappedRoster.split("\n").filter((line) => /^- App /.test(line));
assert.equal(appLines.length, 24, "roster caps app lines at 24");
assert.ok(/…and 6 more connected apps \(ask to list all\)\./.test(cappedRoster), "overflow is disclosed, not silently truncated");

console.log("connected-app-capabilities: OK");

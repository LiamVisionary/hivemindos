#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function functionBody(content, name) {
  const start = content.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing function ${name}`);
  const braceStart = content.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(braceStart + 1, index);
    }
  }
  throw new Error(`Could not parse function body for ${name}`);
}

const source = readFileSync("src/lib/native/queen-voice-events.ts", "utf8");

assert.match(
  source,
  /import \{ createSafeTauriUnlisten \} from "@\/lib\/native\/tauri-event-listeners";/,
  "Queen voice event bridge should import the shared safe Tauri cleanup helper.",
);

for (const name of ["listenForQueenVoiceToggle", "listenForQueenSettingsOpen"]) {
  const body = functionBody(source, name);
  assert.match(
    body,
    /const safeUnlistenTauri = createSafeTauriUnlisten\(unlistenTauri\);/,
    `${name} should guard the Tauri unlisten callback.`,
  );
  assert.match(
    body,
    /safeUnlistenTauri\(\);/,
    `${name} should call the guarded Tauri cleanup.`,
  );
  assert.doesNotMatch(
    body,
    /[^A-Za-z]unlistenTauri\(\);/,
    `${name} must not call the raw Tauri cleanup directly.`,
  );
}

console.log("Queen voice desktop event cleanups use the stale Tauri listener guard.");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url),
  "utf8",
);
const primitives = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/primitives.tsx", import.meta.url),
  "utf8",
);

assert.match(
  panel,
  /const \[shelfOpen, setShelfOpen\] = useState\(false\);/,
  "the chat detail pane should be closed when the chat route first opens",
);

assert.match(
  primitives,
  /failed:\s*\{[^\n]*label:\s*"status check failed"/,
  "a failed agent health probe should describe the probe failure instead of calling the agent blocked",
);
assert.doesNotMatch(
  primitives,
  /failed:\s*\{[^\n]*label:\s*"blocked"/,
  "chat health status must not reuse work-blocked language",
);

console.log("chat detail pane default checks passed");

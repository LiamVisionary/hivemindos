#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx", import.meta.url),
  "utf8",
);

assert.match(
  panel,
  /const \[shelfOpen, setShelfOpen\] = useState\(false\);/,
  "the chat detail pane should be closed when the chat route first opens",
);

console.log("chat detail pane default checks passed");

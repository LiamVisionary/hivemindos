#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const panel = await readFile(join(root, "src/features/dashboard/views/chat/exchange/ChatExchangePanel.tsx"), "utf8");

assert.match(
  panel,
  /const stickyProcessBelongsToCurrentThread = Boolean\(stickyChatProcessTargetKey && processTargetKeys\.has\(stickyChatProcessTargetKey\)\);/,
  "ChatExchangePanel should prove the sticky process target still belongs to the current thread",
);

assert.match(
  panel,
  /currentProcessEvents\.length\s*\?\s*currentProcessEvents\s*:\s*stickyProcessBelongsToCurrentThread\s*\?\s*stickyChatProcess\s*:\s*\[\]/,
  "ChatExchangePanel should not display sticky process events after switching to a thread without that target",
);

assert.match(
  panel,
  /currentProcessEvents\.length\s*\?\s*activeTurnProcessTargetKey\s*:\s*stickyProcessBelongsToCurrentThread\s*\?\s*stickyChatProcessTargetKey\s*:\s*activeTurnProcessTargetKey/,
  "ChatExchangePanel should only target sticky process events at their original current-thread message",
);

console.log("chat process history isolation checks passed");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const drawer = await readFile(
  new URL("../src/features/dashboard/views/chat/exchange/ChatTerminalDrawer.tsx", import.meta.url),
  "utf8",
);

assert.match(
  drawer,
  /source\.addEventListener\(["']terminal["']/,
  "chat terminal must subscribe to the named terminal SSE event",
);

assert.match(
  drawer,
  /Array\.isArray\(payload\.lines\)/,
  "chat terminal must restore the shell API lines array",
);

assert.match(
  drawer,
  /if \(!response\.ok \|\| payload\.ok === false\)/,
  "chat terminal must surface rejected shell commands",
);

console.log("chat terminal drawer checks passed");

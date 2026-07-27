#!/usr/bin/env node

// Stable project-relative entry point for the in-app MCP client. Agent runtime
// configs use the installed executable directly so they do not depend on this
// checkout remaining at the same path.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const installRoot = path.join(os.homedir(), ".hivemindos", "integrations", "notebooklm");
const executable = path.join(
  installRoot,
  "venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "notebooklm-mcp.exe" : "notebooklm-mcp",
);

if (!fs.existsSync(executable)) {
  console.error("NotebookLM is not installed. Open Integrations in HivemindOS to install it first.");
  process.exit(1);
}

const child = spawn(executable, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(installRoot, "playwright") },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(`NotebookLM MCP failed to start: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

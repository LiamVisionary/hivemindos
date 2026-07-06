#!/usr/bin/env node
import { register } from "node:module";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const root = process.cwd();

const {
  AGENT_SHELL_COMMANDS,
  isAllowlistedCommand,
  runAgentCommand,
  runCommandToolDefinition,
} = await import("../src/lib/services/agent-shell/command-tool.ts");

for (const command of [
  "ls",
  "nc",
  "curl",
  "find",
  "cat",
  "pwd",
  "lsof",
]) {
  assert.equal(isAllowlistedCommand(command), true, `${command} should be allowlisted`);
}

for (const command of ["bash", "sh", "zsh", "rm", "mv", "cp", "xargs"]) {
  assert.equal(isAllowlistedCommand(command), false, `${command} should stay blocked`);
}

const definition = runCommandToolDefinition();
const description = definition.function.description;
assert.ok(description.includes("nc"), "tool description should tell models nc is available");
assert.ok(description.includes("ls"), "tool description should tell models ls is available");
assert.ok(description.includes("2>/dev/null"), "tool description should warn against shell redirection");

const pwd = await runAgentCommand({ command: "pwd", cwd: root });
assert.equal(pwd.ok, true, "allowlisted pwd should run");
assert.equal(pwd.stdout?.trim(), root, "pwd should run in the requested cwd");

const blocked = await runAgentCommand({ command: "bash", args: ["-lc", "echo nope"], cwd: root });
assert.equal(blocked.ok, false, "blocked shell should not run");
assert.match(blocked.error || "", /not allowlisted/);
assert.ok(!AGENT_SHELL_COMMANDS.includes("bash"), "bash must not be in the allowlist");

const schedulerRoute = await readFile(join(root, "src/app/api/scheduler/skill-action/route.ts"), "utf8");
assert.ok(
  schedulerRoute.includes('import { isAllowlistedCommand } from "@/lib/services/agent-shell/command-tool";'),
  "scheduler route should import the shared command policy",
);
assert.ok(!schedulerRoute.includes("const SAFE_COMMANDS"), "scheduler route should not keep a duplicate allowlist");

const runtimeStream = await readFile(join(root, "src/app/api/chat/agent-runtime/stream-openai-compatible.ts"), "utf8");
assert.ok(runtimeStream.includes("commandFailureFallbackText"), "chat runtime should use friendly command failure fallbacks");
assert.ok(
  !runtimeStream.includes("Command failed: ${result.error"),
  "chat runtime should not surface raw command failure strings as assistant text",
);

console.log("PASS: agent shell command allowlist and UX contracts are intact.");

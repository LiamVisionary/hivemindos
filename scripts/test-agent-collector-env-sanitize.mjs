#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import vm from "node:vm";

const source = readFileSync("scripts/agent-telemetry-collector.mjs", "utf8");

function includes(haystack, needle, label) {
  assert.ok(haystack.includes(needle), label);
}

includes(source, "const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;", "collector defines a shared env-key validator");
includes(source, "function cleanProcessEnvValue(value)", "collector defines env value sanitizer");
includes(source, "return value.replace(/\\0/g, \"\");", "collector strips NUL bytes from env values");
includes(source, "function sanitizeProcessEnvEntries(value)", "collector sanitizes env maps");
includes(source, "function safeAgentEnv(value) {\n  return sanitizeProcessEnvEntries(value);\n}", "agent-provided env goes through sanitizer");
includes(source, "return sanitizeProcessEnvEntries({\n    ...process.env,", "inherited process env goes through sanitizer");
includes(source, "value = cleanProcessEnvValue(value) ?? \"\";", "fresh shared hive env values go through sanitizer");
includes(source, "...sharedHiveEnv,\n      ...agentEnv,", "spawn env still gives shared env and agent env to Hermes");

const helperStart = source.indexOf("const ENV_KEY_PATTERN");
const helperEnd = source.indexOf("function hermesContextEnv", helperStart);
assert.ok(helperStart > -1 && helperEnd > helperStart, "collector sanitizer helper block should be extractable");

const sandbox = {
  delimiter,
  dirname,
  process: {
    execPath: "/usr/local/bin/node",
    env: {
      PATH: "/usr/bin",
      PUBLIC_PREVIEW_BASE_URL: "https://preview.example.test\0\0",
      "BAD-KEY": "drop-me",
      EMPTY_OK: "",
    },
  },
};
const helpers = vm.runInNewContext(`${source.slice(helperStart, helperEnd)}\n({ cleanProcessEnvValue, sanitizeProcessEnvEntries, safeAgentEnv, runtimeProcessEnv });`, sandbox);
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(helpers.cleanProcessEnvValue("a\0b\0"), "ab", "cleanProcessEnvValue strips embedded NULs");
assert.deepEqual(
  plain(helpers.sanitizeProcessEnvEntries({ GOOD_KEY: "x\0y", "BAD-KEY": "drop", ALSO_GOOD: "" })),
  { GOOD_KEY: "xy", ALSO_GOOD: "" },
  "sanitizeProcessEnvEntries strips NULs and rejects invalid keys",
);
assert.deepEqual(
  plain(helpers.safeAgentEnv({ AGENT_KEY: "ok\0", invalid: 42 })),
  { AGENT_KEY: "ok" },
  "safeAgentEnv sanitizes agent-provided env overlays",
);
const runtimeEnv = helpers.runtimeProcessEnv({ EXTRA_KEY: "z\0z" });
assert.equal(runtimeEnv.PUBLIC_PREVIEW_BASE_URL, "https://preview.example.test", "runtimeProcessEnv sanitizes inherited process env");
assert.equal(runtimeEnv.EXTRA_KEY, "zz", "runtimeProcessEnv sanitizes extra spawn env");
assert.ok(runtimeEnv.PATH.includes("/usr/local/bin"), "runtimeProcessEnv keeps node dirname in PATH");

console.log("agent collector env sanitizer guard passed");

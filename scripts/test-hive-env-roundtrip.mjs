#!/usr/bin/env node
// Round-trip gate for hive-env-add value quoting: every value written through
// any hive-env-add path must read back byte-identical through parse_env_text
// (the parser behind --export-json, tailnet sync, and the dashboard /api/env),
// and the on-disk form must stay parseable by the fleet's dotenv-style readers
// (python-dotenv, @next/env, the JS strip-one-quote-pair parsers). Guards the
// 2026-07-03 bug where quote_env's shlex concatenation ('don'"'"'t') corrupted
// every single-quote-containing value on read-back.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tmp = await mkdtemp(join(tmpdir(), "hive-env-roundtrip-"));
const envFile = join(tmp, ".hivemindos", ".env");

function run(args, input) {
  const result = spawnSync(
    "python3",
    [join(root, "scripts", "hive-env-add"), "--agent-env-file", envFile, "--no-backup", "--no-tailnet-sync", "--no-aeon-auto-sync", ...args],
    {
      cwd: root,
      env: { ...process.env, HOME: tmp, HIVE_ENV_PROJECT_ROOT: root },
      input,
      encoding: "utf8",
    },
  );
  return result;
}

function exportValues() {
  const result = run(["--export-json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).values;
}

try {
  await mkdir(join(tmp, ".hivemindos"), { recursive: true });

  // Values that historically corrupted (single quotes) plus every other
  // special class quote_env branches on.
  const battery = {
    RT_SINGLE_QUOTE: "don't",
    RT_DOUBLE_QUOTE: 'a"b',
    RT_SPACES: "hello world value",
    RT_HASH: "a#b#c",
    RT_DOLLAR: "a$b${c}",
    RT_BACKSLASH: "back\\slash\\x41",
    RT_BACKTICK: "a`b",
    RT_EQUALS: "a=b=c",
    RT_UNICODE: "café-don't-中文",
    RT_MIXED: `it's "quoted" \\ with #hash $dollar`,
    RT_PLAIN: "simple-value",
  };

  // 1. CLI KEY=value path round-trips through --export-json (the parser used
  //    by the dashboard /api/env and tailnet sync).
  for (const [key, value] of Object.entries(battery)) {
    const result = run([`${key}=${value}`]);
    assert.equal(result.status, 0, `write ${key}: ${result.stderr || result.stdout}`);
  }
  let values = exportValues();
  for (const [key, value] of Object.entries(battery)) {
    assert.equal(values[key], value, `CLI round-trip for ${key}`);
  }

  // 2. --stdin path (value travels on stdin, like remote pushes).
  const stdinResult = run(["--stdin", "RT_STDIN"], "stdin-don't-\"mix\"\n");
  assert.equal(stdinResult.status, 0, stdinResult.stderr || stdinResult.stdout);
  assert.equal(exportValues().RT_STDIN, `stdin-don't-"mix"`, "--stdin round-trip");

  // 3. --import-stdin with the exact formats the TS writer
  //    (hive-env-write.ts encodeEnvValue) and the collector's JSON.stringify
  //    peer-push payloads emit.
  const importPayload = [
    `RT_IMPORT_SQ='plain $literal value'`,
    `RT_IMPORT_DQ="imp-don't \\"esc\\" back\\\\slash"`,
    `RT_IMPORT_JSON=${JSON.stringify("json-don't\twith\ttabs")}`,
    "",
  ].join("\n");
  const importResult = run(["--import-stdin"], importPayload);
  assert.equal(importResult.status, 0, importResult.stderr || importResult.stdout);
  values = exportValues();
  assert.equal(values.RT_IMPORT_SQ, "plain $literal value", "single-quoted import round-trip");
  assert.equal(values.RT_IMPORT_DQ, `imp-don't "esc" back\\slash`, "double-quoted escaped import round-trip");
  assert.equal(values.RT_IMPORT_JSON, "json-don't\twith\ttabs", "JSON.stringify import round-trip");

  // 4. Embedded newlines stay on one line and round-trip.
  const nlResult = run(["RT_NEWLINE=line1\nline2"]);
  assert.equal(nlResult.status, 0, nlResult.stderr || nlResult.stdout);
  assert.equal(exportValues().RT_NEWLINE, "line1\nline2", "newline round-trip");

  // 5. On-disk format: no shlex concatenation anywhere, single quotes stored
  //    double-quoted, one line per key.
  const fileText = await readFile(envFile, "utf8");
  assert.ok(!fileText.includes(`'"'"'`), "no shlex concatenation on disk");
  assert.ok(fileText.split("\n").includes(`RT_SINGLE_QUOTE="don't"`), "single-quote value stored double-quoted");
  const keyLines = fileText.split("\n").filter((line) => /^RT_/.test(line));
  assert.equal(keyLines.length, Object.keys(battery).length + 5, "one line per key");

  // 6. Legacy healing: pre-fix concatenated lines read back correctly, and a
  //    same-value write rewrites them into the new format.
  await writeFile(envFile, `RT_LEGACY='don'"'"'t legacy'\n${fileText}`);
  assert.equal(exportValues().RT_LEGACY, "don't legacy", "legacy concatenated value decodes");
  const healResult = run(["RT_LEGACY=don't legacy"]);
  assert.equal(healResult.status, 0, healResult.stderr || healResult.stdout);
  const healedText = await readFile(envFile, "utf8");
  assert.ok(healedText.split("\n").includes(`RT_LEGACY="don't legacy"`), "legacy line healed to double-quoted form");
  assert.ok(!healedText.includes(`'"'"'`), "no concatenation left after heal");

  // 7. Real consumer path: hive-env-run must deliver the exact values into a
  //    child process env (its parser is shlex-based, unlike parse_env_text).
  const probeKeys = ["RT_SINGLE_QUOTE", "RT_DOUBLE_QUOTE", "RT_DOLLAR", "RT_UNICODE", "RT_MIXED", "RT_LEGACY"];
  const probe = spawnSync(
    "python3",
    [join(root, "scripts", "hive-env-run"), "--", "python3", "-c", "import json,os,sys;print(json.dumps({k: os.environ.get(k) for k in sys.argv[1:]}))", ...probeKeys],
    {
      cwd: root,
      env: { ...process.env, HOME: tmp, HIVE_ENV_FILES: envFile },
      encoding: "utf8",
    },
  );
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const probeValues = JSON.parse(probe.stdout);
  assert.equal(probeValues.RT_SINGLE_QUOTE, battery.RT_SINGLE_QUOTE, "hive-env-run single quote");
  assert.equal(probeValues.RT_DOUBLE_QUOTE, battery.RT_DOUBLE_QUOTE, "hive-env-run double quote");
  assert.equal(probeValues.RT_DOLLAR, battery.RT_DOLLAR, "hive-env-run dollar");
  assert.equal(probeValues.RT_UNICODE, battery.RT_UNICODE, "hive-env-run unicode");
  assert.equal(probeValues.RT_MIXED, battery.RT_MIXED, "hive-env-run mixed specials");
  assert.equal(probeValues.RT_LEGACY, "don't legacy", "hive-env-run healed legacy value");

  console.log("PASS hive-env round-trip quoting");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

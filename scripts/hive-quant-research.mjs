#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const runner = await import("../src/lib/services/quant-research/runner.ts");
const policy = await import("../src/lib/services/quant-research/policy.ts");

const args = process.argv.slice(2);
const command = args[0] ?? "policy";

try {
  if (command === "policy") {
    print({ policy: policy.QUANT_RESEARCH_POLICY, roles: policy.QUANT_RESEARCH_ROLE_MATRIX });
  } else if (command === "list") {
    print({ runs: await runner.listQuantResearchRuns({ runRoot: option("--run-root") }) });
  } else if (command === "get") {
    const runId = option("--run-id") ?? args[1];
    if (!runId) throw new Error("get requires --run-id <id>.");
    const run = await runner.getQuantResearchRun(runId, { runRoot: option("--run-root") });
    if (!run) throw new Error(`Quant research run ${runId} was not found.`);
    print({ run });
  } else if (command === "run") {
    const raw = await readRequest(option("--request"));
    const request = JSON.parse(raw);
    const run = await runner.executeQuantResearchRun(request, {
      runRoot: option("--run-root"),
      runId: option("--run-id"),
      concurrency: numericOption("--concurrency"),
    });
    print({ run });
  } else {
    throw new Error("Usage: hive-quant-research.mjs policy | list [--run-root PATH] | get --run-id ID | run [--request FILE] [--run-id ID] [--run-root PATH] [--concurrency N]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function numericOption(name) {
  const value = option(name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be numeric.`);
  return number;
}

async function readRequest(path) {
  const configuredPath = process.env.HIVEMINDOS_QUANT_RESEARCH_REQUEST?.trim();
  if (path || configuredPath) return readFile(path ?? configuredPath, "utf8");
  if (process.stdin.isTTY) throw new Error("run requires --request <file> or JSON on stdin.");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

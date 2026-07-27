#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { buildVisualRecap } = await import("../src/lib/services/visual-recap.ts");

const args = parseArgs(process.argv.slice(2));
const save = args.out === "latest" && !args.dryRun;

try {
  const result = await buildVisualRecap({
    cwd: args.cwd,
    includeUntracked: args.includeUntracked,
    maxFiles: args.maxFiles,
    title: args.title,
    vaultPath: args.vaultPath,
    save,
  });
  const payload = {
    ok: true,
    dryRun: args.dryRun || !save,
    cwd: result.cwd,
    changedFiles: result.changedFiles,
    untrackedFiles: result.untrackedFiles,
    artifact: result.saved?.artifact ?? result.artifactInput,
    storage: result.saved?.storage,
  };
  if (args.json || args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (payload.storage) {
    console.log(`Saved visual recap ${payload.artifact.id} to ${payload.storage.path}`);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "visual recap failed");
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {
    cwd: undefined,
    dryRun: false,
    includeUntracked: true,
    json: false,
    maxFiles: undefined,
    out: undefined,
    title: undefined,
    vaultPath: undefined,
  };
  for (const value of values) {
    if (value === "--dry-run") parsed.dryRun = true;
    else if (value === "--no-untracked") parsed.includeUntracked = false;
    else if (value === "--json") parsed.json = true;
    else if (value.startsWith("--cwd=")) parsed.cwd = value.slice("--cwd=".length);
    else if (value.startsWith("--max-files=")) parsed.maxFiles = Number(value.slice("--max-files=".length));
    else if (value.startsWith("--out=")) parsed.out = value.slice("--out=".length);
    else if (value.startsWith("--title=")) parsed.title = value.slice("--title=".length);
    else if (value.startsWith("--vault-path=")) parsed.vaultPath = value.slice("--vault-path=".length);
  }
  return parsed;
}

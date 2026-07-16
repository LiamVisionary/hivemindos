#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(skillRoot, "scripts/webhook-handler.ts");
const outputPath = resolve(skillRoot, "webhooks/hive-copy-trading/index.ts");
const source = await readFile(sourcePath, "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  ["--yes", "esbuild@0.25.12", sourcePath, "--minify", "--format=esm", "--target=es2022", "--bundle=false"],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || "Webhook build failed.\n");
  process.exit(result.status || 1);
}

const artifact = `// Generated from scripts/webhook-handler.ts with esbuild 0.25.12. Source SHA-256: ${sourceHash}\n${result.stdout.trim()}\n`;
if (Buffer.byteLength(artifact) >= 7_000) {
  throw new Error("Generated webhook exceeds the Bankr deployment request-size safety ceiling.");
}
await writeFile(outputPath, artifact, "utf8");
console.log(`Built ${outputPath} (${Buffer.byteLength(artifact)} bytes).`);

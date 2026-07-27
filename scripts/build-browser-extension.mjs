#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "browser-extension");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const output = outputArgument ? resolve(root, outputArgument.slice("--output=".length)) : join(source, "dist");
const excluded = new Set(["dist", "README.md", "THIRD_PARTY_NOTICES.md", "tests"]);

const relativeOutput = relative(root, output);
if (output === source || relativeOutput.startsWith("..") || isAbsolute(relativeOutput)) {
  throw new Error("Browser-extension output must be a generated directory inside this repository.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (excluded.has(entry.name)) continue;
  await cp(join(source, entry.name), join(output, entry.name), { recursive: entry.isDirectory() });
}

const assets = join(output, "assets");
await mkdir(assets, { recursive: true });
await Promise.all([
  cp(join(root, "public", "favicon-32x32.png"), join(assets, "icon-16.png")),
  cp(join(root, "public", "favicon-32x32.png"), join(assets, "icon-32.png")),
  cp(join(root, "src-tauri", "icons", "64x64.png"), join(assets, "icon-48.png")),
  cp(join(root, "src-tauri", "icons", "128x128.png"), join(assets, "icon-128.png")),
]);

const manifestPath = join(output, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.version_name = `${manifest.version} HivemindOS`;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`HivemindOS Browser extension built at ${output}`);

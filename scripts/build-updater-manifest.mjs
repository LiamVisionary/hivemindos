#!/usr/bin/env node
// Builds the tauri-plugin-updater latest.json manifest from the stable-named
// release assets collected by the cross-platform release workflow. Every
// platform must be present with its .sig — a partial manifest would brick
// updates for the missing platform, so this fails loudly instead.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    console.error(`Missing required argument: ${flag}`);
    process.exit(1);
  }
  return args[index + 1];
}

const version = argValue("--version");
const repository = argValue("--repo");
const assetsDir = argValue("--assets");
const outPath = argValue("--out");

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Version must be semver like 0.2.2, got: ${version}`);
  process.exit(1);
}

const PLATFORM_ASSETS = {
  "darwin-aarch64": "HivemindOS-updater-macos-apple-silicon.app.tar.gz",
  "darwin-x86_64": "HivemindOS-updater-macos-intel.app.tar.gz",
  "windows-x86_64": "HivemindOS-windows-x64-setup.exe",
  "linux-x86_64": "HivemindOS-linux-x64.AppImage",
};

const platforms = {};
const missing = [];

for (const [platform, assetName] of Object.entries(PLATFORM_ASSETS)) {
  const assetPath = join(assetsDir, assetName);
  const signaturePath = `${assetPath}.sig`;
  if (!existsSync(assetPath)) {
    missing.push(assetName);
    continue;
  }
  if (!existsSync(signaturePath)) {
    missing.push(`${assetName}.sig`);
    continue;
  }
  platforms[platform] = {
    signature: readFileSync(signaturePath, "utf8").trim(),
    url: `https://github.com/${repository}/releases/download/v${version}/${assetName}`,
  };
}

if (missing.length > 0) {
  console.error(`Updater assets missing from ${assetsDir}: ${missing.join(", ")}`);
  process.exit(1);
}

const manifest = {
  version,
  notes: `HivemindOS v${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote updater manifest for ${Object.keys(platforms).length} platforms to ${outPath}`);

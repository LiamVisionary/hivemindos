#!/usr/bin/env node
// Drift-guard for the Tauri command ACL surface.
//
// The EMBEDDED desktop build loads its UI from http://127.0.0.1:<port>, which
// Tauri treats as a REMOTE (untrusted) origin. Remote origins can only invoke
// app commands that have a generated `allow-<command>` permission granted by a
// capability. To generate those permissions we declare an app manifest in
// build.rs — but declaring a manifest makes EVERY app command ACL-gated (even
// for local content). So a new #[tauri::command] must appear in THREE places or
// it breaks at runtime ("Command <x> not allowed by ACL"):
//   1. tauri::generate_handler![]      in src-tauri/src/lib.rs
//   2. AppManifest::commands(&[...])    in src-tauri/build.rs
//   3. allow-<kebab-command>            in src-tauri/capabilities/default.json
//
// This script asserts all three stay in lockstep and fails the build with a
// readable diff otherwise, so the per-command tax can never silently bite.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(projectRoot, "src-tauri", "src", "lib.rs");
const buildPath = join(projectRoot, "src-tauri", "build.rs");
const capPath = join(projectRoot, "src-tauri", "capabilities", "default.json");

function fail(msg) {
  console.error(`\n[check-tauri-command-acl] ${msg}\n`);
  process.exit(1);
}

// 1) generate_handler![] — take the last `::` segment of each entry.
function parseGenerateHandler(src) {
  const start = src.indexOf("generate_handler![");
  if (start === -1) fail("could not find generate_handler![ in lib.rs");
  const open = src.indexOf("[", start);
  const close = src.indexOf("]", open);
  if (close === -1) fail("unterminated generate_handler![ block in lib.rs");
  return src
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("::").pop());
}

// 2) build.rs .commands(&[ "a", "b", ... ]) — quoted string literals.
function parseBuildCommands(src) {
  const start = src.indexOf(".commands(&[");
  if (start === -1) fail("could not find .commands(&[ in build.rs (app manifest not declared?)");
  const close = src.indexOf("])", start);
  if (close === -1) fail("unterminated .commands(&[ block in build.rs");
  const block = src.slice(start, close);
  return [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
}

// 3) capabilities/default.json — bare `allow-<kebab>` grants (no plugin colon).
function parseCapabilityGrants(json) {
  const perms = json.permissions || [];
  return perms
    .filter((p) => typeof p === "string" && p.startsWith("allow-") && !p.includes(":"))
    .map((p) => p.slice("allow-".length).replace(/-/g, "_"));
}

const handlerCmds = new Set(parseGenerateHandler(readFileSync(libPath, "utf8")));
const buildCmds = new Set(parseBuildCommands(readFileSync(buildPath, "utf8")));
const capCmds = new Set(parseCapabilityGrants(JSON.parse(readFileSync(capPath, "utf8"))));

function diff(label, a, b, aName, bName) {
  const onlyA = [...a].filter((x) => !b.has(x)).sort();
  const onlyB = [...b].filter((x) => !a.has(x)).sort();
  if (onlyA.length || onlyB.length) {
    const lines = [`MISMATCH: ${label}`];
    if (onlyA.length) lines.push(`  in ${aName} but NOT ${bName}: ${onlyA.join(", ")}`);
    if (onlyB.length) lines.push(`  in ${bName} but NOT ${aName}: ${onlyB.join(", ")}`);
    return lines.join("\n");
  }
  return null;
}

const problems = [
  diff("generate_handler! vs build.rs", handlerCmds, buildCmds, "lib.rs generate_handler!", "build.rs .commands()"),
  diff("build.rs vs capability grants", buildCmds, capCmds, "build.rs .commands()", "capabilities/default.json allow-*"),
].filter(Boolean);

if (problems.length) {
  fail(
    `Tauri command ACL surface is out of sync (${handlerCmds.size} handler / ${buildCmds.size} build.rs / ${capCmds.size} capability):\n\n` +
      problems.join("\n\n") +
      `\n\nA new #[tauri::command] must be added to all three. See the header of this file.`,
  );
}

console.log(`[check-tauri-command-acl] OK — ${handlerCmds.size} commands in lockstep across lib.rs, build.rs, capabilities/default.json`);

#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const sourceArg = readArg("--source");
const targetArg = readArg("--target");
const agent = readArg("--agent");

if (!sourceArg || !targetArg || !agent) {
  console.error("Usage: sync-shared-skill-projections.mjs --source <vault-skills> --target <runtime-skills> --agent <id>");
  process.exit(2);
}

const sourceRoot = resolve(sourceArg);
const targetRoot = resolve(targetArg);

const metadataFile = ".hivemind-skill-source.json";

if (!existsSync(sourceRoot)) {
  process.stdout.write("0\t0\t0\t0\n");
  process.exit(0);
}

function sortedEntries(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function hashDirectory(directory) {
  const hash = createHash("sha256");
  const visit = (current) => {
    for (const entry of sortedEntries(current)) {
      const absolute = join(current, entry.name);
      const rel = relative(directory, absolute).split(sep).join("/");
      if (rel === metadataFile) continue;
      hash.update(entry.isDirectory() ? `d:${rel}\0` : entry.isSymbolicLink() ? `l:${rel}\0` : `f:${rel}\0`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) hash.update(readlinkSync(absolute));
      else hash.update(readFileSync(absolute));
      hash.update("\0");
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function readMetadata(directory) {
  try {
    return JSON.parse(readFileSync(join(directory, metadataFile), "utf8"));
  } catch {
    return null;
  }
}

function isManaged(directory) {
  const metadata = readMetadata(directory);
  return metadata?.managedBy === "hivemindos"
    || ["shared-brain", "bundled", "packaged-auto-install"].includes(metadata?.provider)
    || String(metadata?.providerLabel || "").startsWith("HivemindOS");
}

function writeProjectionMetadata(destination, sourceSkill, sourceChecksum) {
  // Shelf provenance may intentionally be read-only. A runtime projection owns
  // its own marker, so replace the copied source marker instead of trying to
  // overwrite its inode in place.
  rmSync(join(destination, metadataFile), { force: true });
  writeFileSync(join(destination, metadataFile), `${JSON.stringify({
    managedBy: "hivemindos",
    provider: "shared-brain",
    providerLabel: "Shared brain",
    sourcePath: sourceSkill,
    sourceChecksum,
    targetRuntime: agent,
    projection: "primary-overlay",
    syncedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

mkdirSync(targetRoot, { recursive: true });
const sourceSkills = sortedEntries(sourceRoot)
  .filter((entry) => entry.isDirectory() && existsSync(join(sourceRoot, entry.name, "SKILL.md")));
const sourceSlugs = new Set(sourceSkills.map((entry) => entry.name));
let synced = 0;
let unchanged = 0;
let skipped = 0;
let pruned = 0;

for (const entry of sourceSkills) {
  const source = join(sourceRoot, entry.name);
  const sourceSkill = join(source, "SKILL.md");
  const destination = join(targetRoot, entry.name);
  const checksum = hashDirectory(source);

  if (existsSync(destination)) {
    if (!isManaged(destination)) {
      skipped += 1;
      continue;
    }
    const metadata = readMetadata(destination);
    if (metadata?.sourceChecksum === checksum) {
      unchanged += 1;
      continue;
    }
    if (!metadata?.sourceChecksum && lstatSync(destination).isDirectory() && hashDirectory(destination) === checksum) {
      writeProjectionMetadata(destination, sourceSkill, checksum);
      unchanged += 1;
      continue;
    }
    rmSync(destination, { recursive: true, force: true });
  }

  cpSync(source, destination, { recursive: true, force: true, verbatimSymlinks: true });
  writeProjectionMetadata(destination, sourceSkill, checksum);
  synced += 1;
}

// Never prune from an empty or misconfigured shelf. When the shelf is valid,
// remove only directories carrying HivemindOS projection metadata whose source
// belonged to this exact shelf and has since been deleted.
if (sourceSkills.length > 0) {
  for (const entry of sortedEntries(targetRoot)) {
    if (!entry.isDirectory() || sourceSlugs.has(entry.name)) continue;
    const destination = join(targetRoot, entry.name);
    const metadata = readMetadata(destination);
    const sourcePath = String(metadata?.sourcePath || "");
    if (!isManaged(destination) || !sourcePath.startsWith(`${sourceRoot}${sep}`)) continue;
    rmSync(destination, { recursive: true, force: true });
    pruned += 1;
  }
}

process.stdout.write(`${synced}\t${unchanged}\t${skipped}\t${pruned}\n`);

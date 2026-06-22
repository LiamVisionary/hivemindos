// Unit test for scripts/lib/runtime-portable-state.mjs
//
// Verifies the portable-state manifest excludes huge/secret paths, redaction
// strips secrets, pack/unpack round-trips clean (secret-grep), backup/restore
// round-trips, and the 3-way reconcile adopts/keeps/conflicts/deletes correctly.
//
// Run: node scripts/test-runtime-portable-state.mjs

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

// Isolate HOME so backups/sync-state and ~ expansion all land in the sandbox.
const sandbox = await mkdtemp(join(tmpdir(), "hive-rt-test-"));
process.env.HOME = sandbox;
process.env.USERPROFILE = sandbox;

const mod = await import("./lib/runtime-portable-state.mjs");
const {
  walkPortableState,
  packPortableState,
  unpackTarToDir,
  backupPortableState,
  restorePortableState,
  reconcilePortableState,
  scanForSecrets,
  isPortablePath,
  portableStateManifest,
} = mod;

const SECRET = "sk-ant-deadbeefdeadbeefdeadbeefdeadbeef01";
const home = join(sandbox, ".claude");

async function writeFixture(rel, content) {
  const abs = join(home, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.push(relative(root, abs).split(sep).join("/"));
    }
  }
  await walk(root);
  return out.sort();
}

try {
  // --- Fixtures: a realistic ~/.claude with portable + junk + secret files ---
  await writeFixture("skills/foo/SKILL.md", "# Foo skill\n");
  await writeFixture("memory/MEMORY.md", "# memory index\n");
  await writeFixture("CLAUDE.md", "original claude md\n");
  await writeFixture("settings.json", JSON.stringify({ theme: "dark", apiKey: SECRET, nested: { authToken: "xai-aaaaaaaaaaaaaaaaaaaa" } }, null, 2));
  await writeFixture(".credentials.json", JSON.stringify({ token: SECRET }));
  await writeFixture(".env", `ANTHROPIC_API_KEY=${SECRET}\n`);
  await writeFixture("projects/big/transcript.jsonl", "x".repeat(10000));
  await writeFixture("file-history/old.txt", "history");
  await writeFixture("cache/blob.bin", "cache");
  await writeFixture("skills/foo/node_modules/dep/index.js", "module.exports={}");
  await writeFixture("plugins/p/data.json", JSON.stringify({ ok: true }));

  // --- 1. Walker: includes the portable subset, excludes junk + secrets ---
  const walk = await walkPortableState("claude-code", { root: home });
  const rels = walk.files.map((f) => f.rel).sort();
  assert.deepEqual(
    rels,
    ["CLAUDE.md", "memory/MEMORY.md", "plugins/p/data.json", "settings.json", "skills/foo/SKILL.md"],
    `walker returned unexpected set: ${JSON.stringify(rels)}`,
  );
  // Direct predicate checks for the dangerous paths.
  const m = portableStateManifest("claude-code");
  assert.equal(isPortablePath(".credentials.json", m), false, ".credentials.json must be stripped");
  assert.equal(isPortablePath(".env", m), false, ".env must be stripped");
  assert.equal(isPortablePath("projects/big/transcript.jsonl", m), false, "sessions must be excluded");
  assert.equal(isPortablePath("file-history/old.txt", m), false, "file-history must be excluded");
  assert.equal(isPortablePath("skills/foo/node_modules/dep/index.js", m), false, "node_modules must be excluded");
  console.log("✓ walker includes portable subset, excludes junk + secrets");

  // --- 2. Pack → unpack: redacted config, no secret files, secret-grep clean ---
  const pack = await packPortableState("claude-code", { root: home });
  assert.ok(pack.redactions >= 1, "settings.json should have been redacted");
  const unpacked = await unpackTarToDir(pack.tarPath, await mkdtemp(join(tmpdir(), "hive-unpack-")));
  const unpackedFiles = await listFiles(unpacked);
  assert.ok(!unpackedFiles.includes(".credentials.json"), ".credentials.json must NOT be in the archive");
  assert.ok(!unpackedFiles.includes(".env"), ".env must NOT be in the archive");
  assert.ok(unpackedFiles.includes("settings.json"), "settings.json should be in the archive");
  // The packed settings.json must not leak the secret.
  const packedSettings = await readFile(join(unpacked, "settings.json"), "utf8");
  assert.ok(!packedSettings.includes(SECRET), "redacted settings.json must not contain the API key");
  assert.ok(!packedSettings.includes("xai-aaaaaaaaaaaaaaaaaaaa"), "redacted settings.json must not contain the nested token");
  // Secret-grep EVERY archive member.
  for (const rel of unpackedFiles) {
    const hits = scanForSecrets(await readFile(join(unpacked, rel)));
    assert.equal(hits.length, 0, `archive member ${rel} leaked secrets: ${hits.join(", ")}`);
  }
  console.log("✓ pack/unpack redacts config + strips credential files (secret-grep clean)");

  // --- 3. Backup → modify → restore round-trip ---
  const backup = await backupPortableState("claude-code", { root: home });
  assert.ok(existsSync(backup.backupPath), "backup tar should exist");
  await writeFixture("CLAUDE.md", "MUTATED after backup\n");
  await restorePortableState("claude-code", backup.backupPath, { root: home });
  assert.equal((await readFile(join(home, "CLAUDE.md"), "utf8")), "original claude md\n", "restore should bring CLAUDE.md back");
  console.log("✓ backup/restore round-trips the portable subset");

  // --- 4. Reconcile: build a peer snapshot dir and exercise all branches ---
  async function makeSnapshot() {
    const snap = await mkdtemp(join(tmpdir(), "hive-snap-"));
    // snapshot mirrors the portable subset of `home`
    const w = await walkPortableState("claude-code", { root: home });
    for (const f of w.files) {
      const dest = join(snap, f.rel);
      await mkdir(join(dest, ".."), { recursive: true });
      await cp(f.abs, dest);
    }
    return snap;
  }

  // 4a. Fresh sync (no base): remote-only file is adopted, local-only is kept.
  let snap = await makeSnapshot();
  await mkdir(join(snap, "skills", "bar"), { recursive: true });
  await writeFile(join(snap, "skills", "bar", "SKILL.md"), "# bar skill\n"); // remote-only
  await rm(join(snap, "memory", "MEMORY.md"), { force: true }); // absent on remote, present locally
  let r = await reconcilePortableState("claude-code", snap, { root: home, peerLabel: "peerA" });
  assert.ok(r.adopted.includes("skills/bar/SKILL.md"), "remote-only file should be adopted");
  assert.equal(existsSync(join(home, "skills", "bar", "SKILL.md")), true, "adopted file should exist locally");
  assert.equal(existsSync(join(home, "memory", "MEMORY.md")), true, "first-sync must NOT delete a local-only file");
  assert.deepEqual(r.deleted, [], "no deletes on first sync");
  await rm(snap, { recursive: true, force: true });

  // 4b. Propagated delete: with base established, removing on remote deletes locally.
  snap = await makeSnapshot(); // now includes skills/bar locally too
  await rm(join(snap, "skills", "bar", "SKILL.md"), { force: true }); // remote deletes bar
  r = await reconcilePortableState("claude-code", snap, { root: home, peerLabel: "peerA" });
  assert.ok(r.deleted.includes("skills/bar/SKILL.md"), "remote deletion should propagate");
  assert.equal(existsSync(join(home, "skills", "bar", "SKILL.md")), false, "propagated delete should remove the local file");
  await rm(snap, { recursive: true, force: true });

  // 4c. Conflict: both sides edit CLAUDE.md differently → sidecar, local preserved.
  snap = await makeSnapshot();
  await writeFile(join(snap, "CLAUDE.md"), "REMOTE edit\n"); // remote changes
  await writeFixture("CLAUDE.md", "LOCAL edit\n"); // local changes
  r = await reconcilePortableState("claude-code", snap, { root: home, peerLabel: "peerA" });
  assert.ok(r.conflicts.includes("CLAUDE.md"), "concurrent edit should be a conflict");
  assert.equal((await readFile(join(home, "CLAUDE.md"), "utf8")), "LOCAL edit\n", "local edit must be preserved on conflict");
  const homeFiles = await listFiles(home);
  assert.ok(homeFiles.some((f) => /^CLAUDE\.sync-conflict-peerA-.*\.md$/.test(f)), `a conflict sidecar must be written (got ${homeFiles.join(", ")})`);
  await rm(snap, { recursive: true, force: true });

  // 4d. No-op: identical local+remote produces no changes.
  snap = await makeSnapshot();
  r = await reconcilePortableState("claude-code", snap, { root: home, peerLabel: "peerA" });
  assert.deepEqual(r.adopted, [], "no-op pass should adopt nothing");
  assert.deepEqual(r.deleted, [], "no-op pass should delete nothing");
  assert.deepEqual(r.conflicts, [], "no-op pass should conflict on nothing");
  await rm(snap, { recursive: true, force: true });
  console.log("✓ reconcile adopts / keeps / propagates deletes / conflict-copies / no-ops");

  console.log("\nAll runtime-portable-state checks passed.");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

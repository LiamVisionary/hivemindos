#!/usr/bin/env node
// Runtime-state backup + audit CLI.
//
//   node scripts/runtime-state-backup.mjs backup [runtime...]   # snapshot each runtime's portable subset
//   node scripts/runtime-state-backup.mjs audit  [runtime...]   # export each + secret-grep (no writes)
//   node scripts/runtime-state-backup.mjs all    [runtime...]   # backup + audit
//
// Talks to the local collector on 127.0.0.1:8787 (loopback = allowed) so it
// exercises the real endpoints against the real runtime dirs. With no runtime
// args it uses every runtime the collector reports a portable-state manifest for.

import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { unpackTarToDir, scanForSecrets } from "./lib/runtime-portable-state.mjs";

const COLLECTOR = process.env.HIVE_COLLECTOR_URL || "http://127.0.0.1:8787";

async function listRuntimes() {
  const res = await fetch(`${COLLECTOR}/health`, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();
  return data?.capabilities?.runtimeStateRuntimes || [];
}

async function backupOne(runtime) {
  const res = await fetch(`${COLLECTOR}/runtimes/${runtime}/backup-runtime-state`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function auditOne(runtime) {
  const res = await fetch(`${COLLECTOR}/runtimes/${runtime}/export-runtime-state`, {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`export HTTP ${res.status}`);
  const fileCount = Number(res.headers.get("x-hivemind-file-count") || 0);
  const redactions = Number(res.headers.get("x-hivemind-redactions") || 0);
  const buf = Buffer.from(await res.arrayBuffer());
  const tmpTar = join(await mkdtemp(join(tmpdir(), `audit-${runtime}-`)), "state.tar.gz");
  await writeFile(tmpTar, buf);
  const dir = await unpackTarToDir(tmpTar, await mkdtemp(join(tmpdir(), `audit-${runtime}-x-`)));
  const leaks = [];
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const abs = join(d, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else {
        const hits = scanForSecrets(await readFile(abs));
        if (hits.length) leaks.push({ file: relative(dir, abs).split(sep).join("/"), hits: hits.slice(0, 3) });
      }
    }
  }
  await walk(dir);
  await rm(join(tmpTar, ".."), { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
  return { bytes: buf.length, fileCount, redactions, leaks };
}

async function main() {
  const [cmd = "all", ...args] = process.argv.slice(2);
  const runtimes = args.length ? args : await listRuntimes();
  if (!runtimes.length) {
    console.error("No runtimes found (is the collector up on 127.0.0.1:8787?).");
    process.exit(1);
  }
  let anyLeak = false;
  for (const runtime of runtimes) {
    const parts = [];
    try {
      if (cmd === "backup" || cmd === "all") {
        const b = await backupOne(runtime);
        parts.push(`backup ${b.fileCount} files -> ${String(b.backupPath).replace(process.env.HOME || "~", "~")}`);
      }
      if (cmd === "audit" || cmd === "all") {
        const a = await auditOne(runtime);
        const mb = (a.bytes / 1_048_576).toFixed(1);
        if (a.leaks.length) {
          anyLeak = true;
          parts.push(`AUDIT ⚠ ${a.leaks.length} possible secret(s): ${a.leaks.map((l) => l.file).join(", ")}`);
        } else {
          parts.push(`audit clean (${a.fileCount} files, ${mb}MB, ${a.redactions} redacted)`);
        }
      }
      console.log(`✓ ${runtime.padEnd(12)} ${parts.join(" | ")}`);
    } catch (error) {
      console.log(`· ${runtime.padEnd(12)} skipped (${error instanceof Error ? error.message : error})`);
    }
  }
  if (anyLeak) {
    console.error(
      "\n⚠ Secret-grep flagged candidate strings above — review them. Doc placeholders" +
        " (ghp_xxxx, Bearer service-token) and example tokens are expected and benign;" +
        " real credential files are stripped, not redacted-in-place.",
    );
    // Advisory by default; CI/strict callers can fail on any candidate with --strict.
    if (process.argv.includes("--strict")) process.exit(2);
  }
  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

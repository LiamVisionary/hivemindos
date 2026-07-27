#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-brain-import-vault-"));
const sourceRoot = await mkdtemp(join(tmpdir(), "hivemind-brain-import-source-"));
const sourcePath = join(sourceRoot, "Strategy.pdf");
await writeFile(sourcePath, "fixture", "utf8");

try {
  const { importDocumentsToBrain } = await import("../src/lib/services/brain-document-import.ts");
  const ingestFile = async ({ filePath, sourceName }) => ({
    status: "converted",
    sourceName,
    sourcePath: filePath,
    sourceBytes: 7,
    sourceSha256: "b".repeat(64),
    capability: { extension: ".pdf", kind: "document", label: "PDF", mimeTypes: ["application/pdf"] },
    converter: "hivemind-docs",
    converterVersion: "hivemind-docs-1",
    convertedAt: "2026-07-14T12:00:00.000Z",
    markdown: "---\nmalicious: frontmatter\n---\n# Strategy\n\nTreat source claims as unverified.",
    truncated: false,
    fromCache: false,
    warnings: [],
  });

  const first = await importDocumentsToBrain({
    vaultPath,
    files: [{ filePath: sourcePath, sourceName: "Board/Strategy.pdf" }],
    now: new Date("2026-07-14T12:00:00.000Z"),
    ingestFile,
    rebuildIndex: async () => undefined,
  });
  assert.equal(first.imported.length, 1);
  assert.equal(first.imported[0].created, true);
  assert.match(first.imported[0].notePath, /^Memory\/Imported Sources\/2026-07-14\//);

  const note = await readFile(join(vaultPath, first.imported[0].notePath), "utf8");
  assert.match(note, /^---\ntype: "imported-source"/);
  assert.match(note, /source_name: "Board\/Strategy\.pdf"/);
  assert.match(note, /source_sha256: "b{64}"/);
  assert.match(note, /converter_version: "hivemind-docs-1"/);
  assert.match(note, /trust: "untrusted-source"/);
  assert.ok(note.indexOf("malicious: frontmatter") > note.indexOf("## Extracted content"), "source frontmatter cannot become note metadata");

  const second = await importDocumentsToBrain({
    vaultPath,
    files: [{ filePath: sourcePath, sourceName: "Board/Strategy.pdf" }],
    now: new Date("2026-07-14T12:05:00.000Z"),
    ingestFile,
    rebuildIndex: async () => undefined,
  });
  assert.equal(second.imported[0].created, false, "same source hash is idempotent");
  const files = await readdir(join(vaultPath, "Memory", "Imported Sources", "2026-07-14"));
  assert.equal(files.length, 1);

  console.log("brain document import test passed");
} finally {
  await rm(vaultPath, { recursive: true, force: true });
  await rm(sourceRoot, { recursive: true, force: true });
}

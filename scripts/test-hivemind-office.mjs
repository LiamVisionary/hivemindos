#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const {
  applyHivemindOfficeUpdate,
  HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION,
  HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION,
  inspectHivemindOfficeDocument,
  prepareHivemindOfficeUpdate,
} = await import("../src/lib/services/hivemind-office-bridge.ts");
const {
  blockedHivemindOfficeInstall,
  HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT,
  HIVEMIND_OFFICE_SOURCE_ARCHIVE_SHA256,
  readHivemindOfficeInstallableServiceStatus,
} = await import("../src/lib/services/hivemind-office-installable.ts");
const { listHiveActions, listMcpHiveActions } = await import("../src/lib/services/hive-actions/index.ts");

assert.equal(HIVEMIND_OFFICE_AUDITED_SOURCE_COMMIT, "70374e037e1afa97f42948d31df238c0b38250ae");
assert.equal(HIVEMIND_OFFICE_SOURCE_ARCHIVE_SHA256, "aa6f1d98ea96d753928f697dd6b290b5d9d8a33b852053f6a82c5fbe7375aeae");
assert.throws(blockedHivemindOfficeInstall, /automatic install is blocked/i);

const status = await readHivemindOfficeInstallableServiceStatus();
assert.equal(status.id, "hivemind-office");
assert.match(status.provenance?.updatePolicy ?? "", /No mutable-main updates/);
assert.match(status.provenance?.installCommand ?? "", /Blocked until a signed immutable release artifact/);
assert.ok(status.preflight?.some((item) => item.key === "reviewed-release" && !item.ok && item.blocking));
assert.ok(status.securityNotes?.some((note) => /does not run HermesOffice's mutable-main updater/i.test(note)));

const mcpTools = new Map(listMcpHiveActions(listHiveActions()).map((tool) => [tool.name, tool]));
for (const name of [
  "hivemind_office_status",
  "hivemind_office_inspect_document",
  "hivemind_office_open_document",
  "hivemind_office_prepare_update",
  "hivemind_office_apply_update",
]) {
  assert.ok(mcpTools.has(name), `${name} should be exported by the canonical Hive action registry`);
  assert.ok(mcpTools.get(name).title, `${name} should have a title`);
}
assert.equal(mcpTools.get("hivemind_office_status").annotations.readOnlyHint, true);
assert.equal(mcpTools.get("hivemind_office_inspect_document").annotations.readOnlyHint, true);
assert.equal(mcpTools.get("hivemind_office_prepare_update").annotations.readOnlyHint, true);
assert.equal(mcpTools.get("hivemind_office_open_document").annotations.readOnlyHint, false);
assert.equal(mcpTools.get("hivemind_office_apply_update").annotations.destructiveHint, true);
assert.deepEqual(
  mcpTools.get("hivemind_office_apply_update").annotations["hivemindos/confirmation"].tokens,
  [HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION, HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION],
);

const root = await mkdtemp(join(tmpdir(), "hivemind-office-bridge-"));
const outsideRoot = await mkdtemp(join(tmpdir(), "hivemind-office-outside-"));
const originalPath = join(root, "proposal.docx");
const candidatePath = join(root, "proposal-candidate.docx");
const mismatchPath = join(root, "proposal-candidate.xlsx");
const outsidePath = join(outsideRoot, "outside.docx");

try {
  await writeFile(originalPath, "original-v1", "utf8");
  await writeFile(candidatePath, "candidate-v1", "utf8");
  await writeFile(mismatchPath, "candidate-v1", "utf8");
  await writeFile(outsidePath, "outside", "utf8");

  const inspection = await inspectHivemindOfficeDocument({
    path: originalPath,
    includeText: false,
    allowedRoots: [root],
  });
  assert.equal(inspection.name, "proposal.docx");
  assert.equal(inspection.capability.label, "Word");
  assert.match(inspection.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspection.extracted, undefined);

  await assert.rejects(
    inspectHivemindOfficeDocument({ path: outsidePath, includeText: false, allowedRoots: [root] }),
    /outside the local home\/vault boundary/,
  );
  await assert.rejects(
    prepareHivemindOfficeUpdate({ originalPath, candidatePath: mismatchPath, allowedRoots: [root] }),
    /keep the original \.docx format/,
  );

  const copyReview = await prepareHivemindOfficeUpdate({
    originalPath,
    candidatePath,
    allowedRoots: [root],
  });
  assert.equal(copyReview.mode, "copy");
  assert.equal(copyReview.requiredConfirmation, HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION);
  assert.match(copyReview.destinationPath, /proposal \(Hivemind Office Copy\)\.docx$/);
  assert.match(copyReview.reviewFingerprint, /^[a-f0-9]{64}$/);
  assert.ok(copyReview.reviewSteps.some((step) => /Open the candidate/.test(step)));

  const copyInput = {
    originalPath,
    candidatePath,
    destinationPath: copyReview.destinationPath,
    mode: copyReview.mode,
    expectedOriginalSha256: copyReview.original.sha256,
    expectedCandidateSha256: copyReview.candidate.sha256,
    reviewFingerprint: copyReview.reviewFingerprint,
    allowedRoots: [root],
  };
  await assert.rejects(
    applyHivemindOfficeUpdate({ ...copyInput, confirmation: HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION }),
    /requires CONFIRM_HIVEMIND_OFFICE_SAVE_COPY/,
  );
  assert.equal(await readFile(originalPath, "utf8"), "original-v1");
  const copied = await applyHivemindOfficeUpdate({
    ...copyInput,
    confirmation: HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION,
  });
  assert.equal(copied.mode, "copy");
  assert.equal(await readFile(copied.path, "utf8"), "candidate-v1");
  assert.equal(await readFile(originalPath, "utf8"), "original-v1");
  assert.match(copied.recovery, /original was not changed/);

  const staleReview = await prepareHivemindOfficeUpdate({
    originalPath,
    candidatePath,
    destinationPath: join(root, "stale-copy.docx"),
    allowedRoots: [root],
  });
  await writeFile(originalPath, "original-changed-after-review", "utf8");
  await assert.rejects(
    applyHivemindOfficeUpdate({
      originalPath,
      candidatePath,
      destinationPath: staleReview.destinationPath,
      mode: staleReview.mode,
      expectedOriginalSha256: staleReview.original.sha256,
      expectedCandidateSha256: staleReview.candidate.sha256,
      reviewFingerprint: staleReview.reviewFingerprint,
      confirmation: HIVEMIND_OFFICE_SAVE_COPY_CONFIRMATION,
      allowedRoots: [root],
    }),
    /original changed after review/i,
  );
  await assert.rejects(readFile(staleReview.destinationPath, "utf8"), /ENOENT/);

  await writeFile(originalPath, "original-before-replace", "utf8");
  await writeFile(candidatePath, "candidate-replacement", "utf8");
  const replaceReview = await prepareHivemindOfficeUpdate({
    originalPath,
    candidatePath,
    mode: "replace-original",
    allowedRoots: [root],
  });
  assert.equal(replaceReview.requiredConfirmation, HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION);
  const replaced = await applyHivemindOfficeUpdate({
    originalPath,
    candidatePath,
    mode: "replace-original",
    expectedOriginalSha256: replaceReview.original.sha256,
    expectedCandidateSha256: replaceReview.candidate.sha256,
    reviewFingerprint: replaceReview.reviewFingerprint,
    confirmation: HIVEMIND_OFFICE_REPLACE_ORIGINAL_CONFIRMATION,
    allowedRoots: [root],
  });
  assert.equal(await readFile(originalPath, "utf8"), "candidate-replacement");
  assert.equal(await readFile(replaced.backupPath, "utf8"), "original-before-replace");
  assert.match(replaced.recovery, /Restore .*hivemind-office-backup/);
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
}

const routeSource = readFileSync("src/app/api/hivemind-office/route.ts", "utf8");
const installableRouteSource = readFileSync("src/app/api/fleet/apps/installable-services/route.ts", "utf8");
const appCatalogSource = readFileSync("src/features/dashboard/agent-capability-catalog.ts", "utf8");
const myAppsSource = readFileSync("src/features/dashboard/views/MyAppsPanel.tsx", "utf8");
const mcpCatalogSource = readFileSync("src/lib/services/mcp/catalog.ts", "utf8");
assert.match(routeSource, /requireAuth\(request\)/);
assert.match(routeSource, /errorJson\(error\.message, error\.status/);
assert.match(routeSource, /action === "prepare-update"/);
assert.match(routeSource, /applyHivemindOfficeUpdate/);
assert.match(installableRouteSource, /value === "hivemind-office"/);
assert.match(appCatalogSource, /installableServiceId: "hivemind-office"/);
assert.match(myAppsSource, /id === "hivemind-office"[^\n]+"Install blocked"/);
assert.match(myAppsSource, /service\.id === "hivemind-office" && action === "install"/);
assert.match(mcpCatalogSource, /id: "hivemind-office"/);

console.log("Hivemind Office provenance, install block, Hive actions, path boundary, conflict checks, copy-first save, and backup-before-replace tests passed.");

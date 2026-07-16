#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const routeSource = await readFile(new URL("../src/app/api/companies/import/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /guard:allow-hive-action-route[^\n]*human-reviewed local folder import/);

const tempHome = await mkdtemp(join(tmpdir(), "hivemind-company-room-home-"));
const vaultPath = await mkdtemp(join(tmpdir(), "hivemind-company-room-vault-"));
const dataRoomPath = await mkdtemp(join(tmpdir(), "hivemind-company-room-source-"));
process.env.HOME = tempHome;
process.env.NEXT_PUBLIC_OBSIDIAN_VAULT_PATH = vaultPath;
process.env.QUEEN_BEE_AUTONOMOUS_PICKUP = "0";

await mkdir(join(dataRoomPath, "Finance"), { recursive: true });
await writeFile(join(dataRoomPath, "Company Overview.pdf"), "overview", "utf8");
await writeFile(join(dataRoomPath, "Finance", "Forecast.xlsx"), "forecast", "utf8");
await writeFile(join(dataRoomPath, "run-me.exe"), "ignored", "utf8");

const ingestFile = async ({ filePath, sourceName }) => ({
  status: "converted",
  sourceName,
  sourcePath: filePath,
  sourceBytes: sourceName.endsWith(".pdf") ? 8 : 8,
  sourceSha256: sourceName.endsWith(".pdf") ? "c".repeat(64) : "d".repeat(64),
  capability: sourceName.endsWith(".pdf")
    ? { extension: ".pdf", kind: "document", label: "PDF", mimeTypes: ["application/pdf"] }
    : { extension: ".xlsx", kind: "spreadsheet", label: "Excel", mimeTypes: [] },
  converter: "hivemind-docs",
  converterVersion: "hivemind-docs-1",
  convertedAt: "2026-07-14T14:00:00.000Z",
  markdown: sourceName.endsWith(".pdf") ? "# Company overview\n\nA useful but unverified claim." : "## Forecast\n\n| Year | ARR |\n|---|---|\n| 2027 | 10 |",
  truncated: false,
  fromCache: false,
  warnings: [],
});

try {
  const {
    importCompanyFromDataRoom,
    previewCompanyDataRoom,
  } = await import("../src/lib/services/company-data-room-importer.ts");
  const { readCompanies } = await import("../src/lib/services/companies-store.ts");

  const preview = await previewCompanyDataRoom({ dataRoomPath }, { ingestFile });
  assert.equal(preview.documents.length, 2);
  assert.equal(preview.documents.some((document) => document.relativePath === "Finance/Forecast.xlsx"), true);
  assert.equal(preview.documents.some((document) => document.relativePath.endsWith(".exe")), false);

  const first = await importCompanyFromDataRoom({
    dataRoomPath,
    companyName: "Room Company",
    ticker: "ROOM",
    sector: "Research",
    apexGoalTitle: "Review and operationalize the company data room",
  }, { ingestFile, now: new Date("2026-07-14T14:00:00.000Z"), rebuildIndex: async () => undefined });
  assert.equal(first.updatedExisting, false);
  assert.equal(first.company.importedKnowledge?.documents.length, 2);
  assert.equal(first.company.importedKnowledge?.dataRoomPath, await realpath(dataRoomPath));
  assert.equal(first.company.directives?.length ?? 0, 0, "imported source claims do not become standing directives");

  const overview = first.company.importedKnowledge.documents.find((document) => document.sourceName === "Company Overview.pdf");
  assert.ok(overview);
  const note = await readFile(join(vaultPath, overview.notePath), "utf8");
  assert.match(note, /trust: "untrusted-source"/);
  assert.match(note, /company_id:/);
  assert.match(note, /A useful but unverified claim/);

  const second = await importCompanyFromDataRoom({
    dataRoomPath,
    companyName: "Room Company",
    ticker: "ROOM",
    sector: "Research",
    apexGoalTitle: "Review and operationalize the company data room",
  }, { ingestFile, now: new Date("2026-07-14T15:00:00.000Z"), rebuildIndex: async () => undefined });
  assert.equal(second.updatedExisting, true);
  assert.equal(second.company.id, first.company.id);

  const companies = await readCompanies();
  const canonicalDataRoomPath = await realpath(dataRoomPath);
  assert.equal(companies.filter((company) => company.importedKnowledge?.dataRoomPath === canonicalDataRoomPath).length, 1);

  console.log("company data-room import test passed");
} finally {
  await rm(tempHome, { recursive: true, force: true });
  await rm(vaultPath, { recursive: true, force: true });
  await rm(dataRoomPath, { recursive: true, force: true });
}

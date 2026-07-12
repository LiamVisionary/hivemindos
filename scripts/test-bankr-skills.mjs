#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "hivemindos-bankr-skills-"));

async function loadBankrSkills() {
  const sourcePath = new URL("../src/lib/services/bankr-skills.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8"))
    .replace('import { bankrApiKey } from "@/lib/services/bankr-llm";', 'async function bankrApiKey() { return "bk_test"; }');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
    },
  }).outputText;
  const modulePath = join(temporaryDirectory, "bankr-skills.mjs");
  await writeFile(modulePath, transpiled, "utf8");
  return import(pathToFileURL(modulePath).href);
}

const catalog = {
  success: true,
  skills: [
    {
      slug: "bankr",
      name: "bankr",
      provider: "BankrBot",
      description: "Bankr wallet and trading skill.",
      repoUrl: "https://github.com/BankrBot/skills/tree/main/bankr",
      install: { type: "bankr", command: "install bankr" },
      featured: true,
      installCount: 50,
    },
    {
      slug: "0xce370ebcbc655f845df7dfb8c079e75b5ea17d93-trench-radar",
      name: "trench-radar",
      provider: "Community",
      description: "Daily crypto culture digest.",
      repoUrl: "",
      install: {
        type: "agent-skill",
        ownerWallet: "0xce370ebcbc655f845df7dfb8c079e75b5ea17d93",
        slug: "0xce370ebcbc655f845df7dfb8c079e75b5ea17d93-trench-radar",
      },
      installCount: 21,
    },
  ],
};

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

try {
  const bankr = await loadBankrSkills();

  const snapshotCalls = [];
  const snapshot = await bankr.getBankrSkillsSnapshot({
    apiKey: "bk_test",
    fetchImpl: async (url, init) => {
      snapshotCalls.push({ url: String(url), init });
      if (String(url).endsWith("/skills/catalog")) return jsonResponse(catalog);
      return jsonResponse({
        success: true,
        skills: [{
          slug: "trench-radar",
          sourceCatalogSlug: "0xce370ebcbc655f845df7dfb8c079e75b5ea17d93-trench-radar",
        }],
      });
    },
  });
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.skills.length, 2);
  assert.equal(snapshot.installedCount, 1);
  assert.equal(snapshot.installedLimit, 50);
  assert.equal(snapshot.skills[1].displaySlug, "trench-radar");
  assert.equal(snapshot.skills[1].installed, true);
  assert.equal(snapshot.skills[1].publicUrl, "https://bankr.bot/skills/0xce370ebcbc655f845df7dfb8c079e75b5ea17d93/trench-radar");
  assert.equal(snapshotCalls[0].init.headers["X-API-Key"], undefined, "public catalogue must not receive the API key");
  assert.equal(snapshotCalls[1].init.headers["X-API-Key"], "bk_test", "installed-skill read must use the Bankr key");

  const communityCalls = [];
  const installedCommunity = await bankr.installBankrCatalogSkill(catalog.skills[1].slug, {
    apiKey: "bk_test",
    fetchImpl: async (url, init) => {
      communityCalls.push({ url: String(url), init });
      return String(url).endsWith("/skills/catalog") ? jsonResponse(catalog) : jsonResponse({ success: true });
    },
  });
  assert.equal(installedCommunity.installed, true);
  assert.deepEqual(JSON.parse(communityCalls[1].init.body), { catalogSlug: catalog.skills[1].slug });

  const githubCalls = [];
  await bankr.installBankrCatalogSkill("bankr", {
    apiKey: "bk_test",
    fetchImpl: async (url, init) => {
      githubCalls.push({ url: String(url), init });
      return String(url).endsWith("/skills/catalog") ? jsonResponse(catalog) : jsonResponse({ success: true });
    },
  });
  assert.deepEqual(JSON.parse(githubCalls[1].init.body), {
    repoUrl: "https://github.com/BankrBot/skills/tree/main/bankr",
    catalogSlug: "bankr",
    provider: "BankrBot",
  });

  await assert.rejects(
    () => bankr.installBankrCatalogSkill("missing-skill", {
      apiKey: "bk_test",
      fetchImpl: async () => jsonResponse(catalog),
    }),
    /no longer available/,
  );

  const route = await readFile(new URL("../src/app/api/bankr/skills/route.ts", import.meta.url), "utf8");
  assert.match(route, /body\.confirm !== true/, "route must require an explicit install confirmation");
  assert.match(route, /installBankrCatalogSkill\(catalogSlug\)/, "route must install only the server-resolved catalogue slug");
  assert.match(route, /okJson\(/, "route must use the canonical API response envelope");

  console.log("Bankr skills map the live catalogue, mark installed skills, preserve key boundaries, and use the correct import payloads.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}


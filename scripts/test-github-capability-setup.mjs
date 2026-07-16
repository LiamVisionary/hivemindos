#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { builtinModules, register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceExtensions = [".ts", ".tsx", ".mts", ".mjs", ".js"];
const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function runtimeModuleSpecifiers(filePath, source) {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) &&
          !clause.name && clause.namedBindings.elements.every((element) => element.isTypeOnly)) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      if (statement.isTypeOnly) continue;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every((element) => element.isTypeOnly)) continue;
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function resolveProjectModule(parentPath, specifier) {
  let basePath;
  if (specifier.startsWith("@/")) basePath = path.join(repoRoot, "src", specifier.slice(2));
  else if (specifier.startsWith(".")) basePath = path.resolve(path.dirname(parentPath), specifier);
  else return null;

  const candidates = path.extname(basePath)
    ? [basePath]
    : [
        ...sourceExtensions.map((extension) => `${basePath}${extension}`),
        ...sourceExtensions.map((extension) => path.join(basePath, `index${extension}`)),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function browserBoundaryViolations(entryPath) {
  const visited = new Set();
  const violations = [];
  async function visit(filePath, trace) {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    const source = await readFile(filePath, "utf8");
    for (const specifier of runtimeModuleSpecifiers(filePath, source)) {
      if (specifier === "server-only" || nodeBuiltins.has(specifier)) {
        violations.push(`${trace.join(" -> ")} -> ${path.relative(repoRoot, filePath)} imports ${specifier}`);
        continue;
      }
      const resolved = resolveProjectModule(filePath, specifier);
      if (resolved) await visit(resolved, [...trace, path.relative(repoRoot, filePath)]);
    }
  }
  await visit(entryPath, []);
  return violations;
}

const { GITHUB_CAPABILITY_CATALOG, githubCapabilityContextIndexItems } = await import("../src/lib/services/github-capability-catalog.ts");
const { GITHUB_CAPABILITY_INSTALLABLE_IDS } = await import("../src/lib/services/github-capability-installers.ts");
const { CONNECTOR_MANIFESTS_BY_KEY } = await import("../src/lib/services/integrations/connector-manifests.ts");
const { normalizeProviderSetupFields, providerSetupFieldEnv } = await import("../src/lib/services/integrations/provider-setup-fields.ts");
const { listHiveActions } = await import("../src/lib/services/hive-actions/catalog.ts");

const expectedCapabilities = ["yt-dlp", "whisper", "plausible", "appflowy", "n8n", "calcom", "graphify", "trading-agents", "ghost", "medusa", "shopify"];
assert.deepEqual(GITHUB_CAPABILITY_CATALOG.map((item) => item.id), expectedCapabilities, "the reviewed GitHub capability index is complete and ordered");

for (const capability of GITHUB_CAPABILITY_CATALOG) {
  assert.match(capability.sourceUrl, /^https:\/\/github\.com\//, `${capability.id} should retain reviewed GitHub provenance`);
  assert.ok(capability.license, `${capability.id} should disclose its license`);
  assert.ok(capability.setupOptions.length > 0, `${capability.id} should open at least one in-chat setup route`);
}

assert.equal(GITHUB_CAPABILITY_CATALOG.find((item) => item.id === "n8n")?.license, "Sustainable Use License", "n8n is not mislabeled as OSI open source");
assert.match(GITHUB_CAPABILITY_CATALOG.find((item) => item.id === "calcom")?.description ?? "", /personal, non-production/i, "cal.diy's boundary is visible");

const contextItems = githubCapabilityContextIndexItems({});
assert.deepEqual(contextItems.map((item) => item.id), expectedCapabilities.map((id) => `github-capability:${id}`));
assert.ok(contextItems.every((item) => item.tags.includes("availability:setup-required")), "disconnected/uninstalled catalog entries request setup");
const connectedItems = githubCapabilityContextIndexItems({ SHOPIFY_ADMIN_ACCESS_TOKEN: "fixture" });
assert.ok(connectedItems.find((item) => item.id === "github-capability:shopify")?.tags.includes("availability:ready"), "a connected Shopify capability is immediately discoverable as ready");

assert.deepEqual([...GITHUB_CAPABILITY_INSTALLABLE_IDS], ["yt-dlp", "whisper", "graphify", "trading-agents", "appflowy", "ghost"]);
for (const provider of ["plausible", "calcom", "shopify", "medusa"]) {
  assert.ok(CONNECTOR_MANIFESTS_BY_KEY[provider], `${provider} should derive connection UI and context metadata from the connector matrix`);
}

assert.deepEqual(normalizeProviderSetupFields("plausible", {}), { baseUrl: "https://plausible.io" });
assert.deepEqual(normalizeProviderSetupFields("calcom", { baseUrl: "https://calendar.example.test/v2/" }), { baseUrl: "https://calendar.example.test/v2" });
assert.deepEqual(normalizeProviderSetupFields("shopify", { shopDomain: "https://demo-store.myshopify.com/" }), { shopDomain: "demo-store.myshopify.com" });
assert.deepEqual(providerSetupFieldEnv("shopify", { shopDomain: "demo-store.myshopify.com" }), { SHOPIFY_STORE_DOMAIN: "demo-store.myshopify.com" });
assert.throws(() => normalizeProviderSetupFields("shopify", { shopDomain: "shop.example.com" }), /permanent \*\.myshopify\.com domain/);
assert.throws(() => normalizeProviderSetupFields("plausible", { baseUrl: "https://user:secret@example.com" }), /cannot contain credentials/);

const shopifyAction = listHiveActions().find((action) => action.id === "integrations.shopify-read");
assert.ok(shopifyAction, "Shopify should expose a real agent-readable action after connection");
assert.equal(shopifyAction.readOnly, true);
assert.deepEqual(shopifyAction.requiresConnection, ["SHOPIFY_ADMIN_ACCESS_TOKEN"]);
assert.equal(shopifyAction.contextIndex?.route, "/api/integrations/shopify");
const calcomAction = listHiveActions().find((action) => action.id === "integrations.calcom-read");
assert.ok(calcomAction, "Cal.com should expose a real agent-readable scheduling action after connection");
assert.equal(calcomAction.readOnly, true);
assert.equal(calcomAction.contextIndex?.route, "/api/integrations/calcom");
const medusaAction = listHiveActions().find((action) => action.id === "integrations.medusa-read");
assert.ok(medusaAction, "Medusa should expose a real agent-readable Store API action after connection");
assert.equal(medusaAction.readOnly, true);
assert.equal(medusaAction.contextIndex?.route, "/api/integrations/medusa");

const [cardSource, modalSource, connectionSource, routeSource] = await Promise.all([
  readFile(new URL("../src/features/dashboard/views/chat/exchange/CapabilityApprovalCard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/views/chat/exchange/CapabilitySetupModal.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/features/integrations/ConnectionsPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/integrations/shopify/route.ts", import.meta.url), "utf8"),
]);
assert.match(cardSource, /Set up now/);
assert.match(modalSource, /Install & continue/);
assert.match(modalSource, /setupProviderKey=/, "connection setup stays in the chat modal");
assert.match(connectionSource, /setupFields/, "connection modal renders structured provider fields instead of a free-text configuration blob");
assert.doesNotMatch(`${cardSource}\n${modalSource}`, /localStorage|sessionStorage|indexedDB/i, "dismissal and setup state are not hidden in browser-only durable storage");
assert.match(routeSource, /requireAuthContext/, "Shopify reads retain dashboard authentication");

const browserViolations = await browserBoundaryViolations(path.join(repoRoot, "src/features/dashboard/agent-capability-catalog.ts"));
assert.deepEqual(
  browserViolations,
  [],
  `the Agent Tools client catalog must not reach server-only or Node modules:\n${browserViolations.join("\n")}`,
);

console.log("PASS test-github-capability-setup");

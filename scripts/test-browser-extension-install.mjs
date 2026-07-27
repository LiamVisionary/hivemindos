import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareBrowserExtensionInstall,
  readBrowserExtensionInstallStatus,
} from "../src/lib/services/browser-extension-install.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "hivemindos-browser-install-"));
const sourceDir = join(workspace, "source");
const installRoot = join(workspace, "install");
const browserTargets = [{ id: "chrome", label: "Chrome", extensionManagementUrl: "chrome://extensions" }];

async function text(relativePath) {
  return readFile(join(projectRoot, relativePath), "utf8");
}

try {
  await cp(join(projectRoot, "browser-extension", "dist"), sourceDir, { recursive: true });
  const first = await prepareBrowserExtensionInstall({ sourceDir, installRoot, browserTargets });
  assert.equal(first.prepared, true);
  assert.equal(first.available, true);
  assert.equal(first.rollbackAvailable, false);
  assert.equal(first.browsers[0]?.extensionManagementUrl, "chrome://extensions");
  assert.equal(JSON.parse(await readFile(join(first.installPath, "manifest.json"), "utf8")).version, first.version);

  const updatedManifestPath = join(sourceDir, "manifest.json");
  const updatedManifest = JSON.parse(await readFile(updatedManifestPath, "utf8"));
  updatedManifest.version = "9.9.9";
  await writeFile(updatedManifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`);
  const second = await prepareBrowserExtensionInstall({ sourceDir, installRoot, browserTargets });
  assert.equal(second.installedVersion, "9.9.9");
  assert.equal(second.rollbackAvailable, true);
  assert.equal(JSON.parse(await readFile(join(installRoot, "browser-extension.previous", "manifest.json"), "utf8")).version, first.version);

  const status = await readBrowserExtensionInstallStatus({ sourceDir, installRoot, browserTargets });
  assert.equal(status.installPath, join(installRoot, "browser-extension"));
  assert.equal(status.prepared, true);

  const [route, card, panel, browsers, tauriBuild, docs] = await Promise.all([
    text("src/app/api/integrations/browser-extension/route.ts"),
    text("src/features/integrations/BrowserExtensionInstallCard.tsx"),
    text("src/features/integrations/ConnectionsPanel.tsx"),
    text("src/lib/services/system-browsers.ts"),
    text("scripts/tauri-build.mjs"),
    text("docs/for-users/browser-extension.md"),
  ]);
  assert.match(route, /action === "prepare-install"/);
  assert.match(route, /action === "open-extensions"/);
  assert.match(card, /Prepare & open browser/);
  assert.match(card, /Load unpacked/);
  assert.match(panel, /<BrowserExtensionInstallCard \/>/);
  assert.match(browsers, /chrome:\/\/extensions/);
  assert.match(browsers, /openBrowserExtensionsPage/);
  assert.match(browsers, /PROGRAMFILES/);
  assert.match(browsers, /google-chrome-stable/);
  assert.match(tauriBuild, /stageBrowserExtensionResources/);
  assert.match(tauriBuild, /public", "browser-extension/);
  assert.match(docs, /Integrations/);
  assert.match(docs, /Load unpacked/);

  console.log("Browser extension install contract checks passed");
} finally {
  await rm(workspace, { recursive: true, force: true });
}

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const { fetchMiniAppCatalog, parseMiniAppCatalog } = await import(new URL("../src/lib/services/mini-app-catalog.ts", import.meta.url));

const sourceUrl = "https://hivemindos.app/mini-apps/catalog.json";
const fixture = {
  version: 1,
  updatedAt: "2026-07-13T02:32:07+08:00",
  apps: [{
    id: "hive-research",
    name: "Hive Research",
    eyebrow: "Hosted research crew",
    description: "Seven agents build and challenge a token thesis.",
    href: "/research/",
    icon: "/hivemindos-mark-96.png",
    status: "live",
    priceLabel: "Free first run",
    cta: "Open Hive Research",
    tags: ["Base", "Solana", "Ethereum"],
  }],
};

const parsed = parseMiniAppCatalog(fixture, sourceUrl);
assert.equal(parsed.apps[0].url, "https://hivemindos.app/research/", "relative app paths should resolve against the official catalog origin");
assert.equal(parsed.apps[0].iconUrl, "https://hivemindos.app/hivemindos-mark-96.png", "relative icon paths should resolve against the official catalog origin");

let requestedUrl = "";
const fetched = await fetchMiniAppCatalog({
  sourceUrl,
  fetcher: async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "content-type": "application/json" } });
  },
});
assert.equal(requestedUrl, sourceUrl, "desktop catalog client should fetch the shared website manifest");
assert.equal(fetched.apps[0].name, "Hive Research");
assert.throws(() => parseMiniAppCatalog({ ...fixture, version: 2 }, sourceUrl), /unsupported contract version/);
assert.throws(() => parseMiniAppCatalog({ ...fixture, apps: [fixture.apps[0], fixture.apps[0]] }, sourceUrl), /Duplicate mini-app id/);
assert.throws(() => parseMiniAppCatalog({ ...fixture, apps: [{ ...fixture.apps[0], href: "javascript:alert(1)" }] }, sourceUrl), /http or https/);

const miniAppsPanel = readFileSync(new URL("../src/features/dashboard/views/MiniAppsPanel.tsx", import.meta.url), "utf8");
assert.match(miniAppsPanel, /src=\{activeApp\.url\}/, "selected mini apps should render from their canonical hosted URL inside HivemindOS");
assert.match(miniAppsPanel, /setActiveAppId\(app\.id\)/, "catalog cards should open the selected app in the embedded view");
assert.match(miniAppsPanel, /openExternalUrl\(activeApp\.url\)/, "embedded apps should retain an external-browser escape hatch");
assert.match(miniAppsPanel, /allow-popups-to-escape-sandbox/, "embedded apps should permit hosted checkout and popup flows");

console.log("Desktop mini-app catalog validation, embedding, and official-source fetch contract pass.");

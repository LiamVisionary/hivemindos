import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url);
const UI_ROOTS = [
  "src/app",
  "src/components",
  "src/features",
  "src/design-system",
  "src/lib",
  "public/design-system",
  "public/app-builder-templates",
];
const UI_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".jsx", ".md", ".ts", ".tsx"]);

// These are the retired light-mode mustard/ochre values that produced the
// muddy selected state, plus the rejected terracotta pass. The established
// dark honey/amber and purpose-built classic-blue surfaces are preserved.
const RETIRED_HEX = [
  "a97209", "b07f1c", "936811", "7c550b", "8c5e0a", "6a4505",
  "d8b468", "956300", "d8a33c", "f2c66c", "fff8df",
  "7d5404", "6f5011", "8a641f",
  "d97a63", "e8a08e", "a6463a", "8f3f32", "f6e6e1", "ecc1b6", "b85742",
];
const RETIRED_RGB = [
  [169, 114, 9], [176, 127, 28], [106, 69, 5],
  [128, 105, 62], [185, 139, 47],
  [217, 122, 99], [232, 160, 142], [184, 87, 66], [143, 63, 50],
];
const retiredHexPattern = new RegExp(`#(?:${RETIRED_HEX.join("|")})(?![0-9a-f])`, "i");
const retiredEncodedHexPattern = new RegExp(`%23(?:${RETIRED_HEX.join("|")})(?![0-9a-f])`, "i");
const retiredRgbPattern = new RegExp(
  `rgba?\\(\\s*(?:${RETIRED_RGB.map((rgb) => rgb.join("\\s*,\\s*")).join("|")})\\s*(?:,|\\))`,
  "i",
);

async function sourceFiles(directory) {
  const absolute = new URL(directory, ROOT);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(absolute.pathname, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(`${directory}/${entry.name}`));
    else if (UI_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = (await Promise.all(UI_ROOTS.map(sourceFiles))).flat();
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    if (retiredHexPattern.test(line) || retiredEncodedHexPattern.test(line) || retiredRgbPattern.test(line)) {
      violations.push(`${relative(new URL(".", ROOT).pathname, file)}:${index + 1}: ${line.trim()}`);
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `retired app accent colors remain:\n${violations.slice(0, 80).join("\n")}${violations.length > 80 ? `\n...and ${violations.length - 80} more` : ""}`,
);

const globals = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
assert.match(globals, /--honey:\s*#ffd45a;/i, "global dark honey should retain the pre-light-redesign amber");
assert.match(globals, /--honey-fill:\s*var\(--honey\);/i, "global dark selected fills should resolve to the original honey accent");
assert.match(globals, /--button-primary:\s*#e7b45c;/i, "global dark primary actions should retain the original amber");
assert.match(globals, /--button-primary-foreground:\s*#1a1305;/i, "global dark primary actions should retain their readable ink");
assert.match(globals, /data-theme="hive-light"[\s\S]*--background:\s*#f5efe6;/i, "light background should match the mobile Hivemind cream");
assert.match(globals, /data-theme="hive-light"[\s\S]*--accent:\s*#8a5a2a;/i, "light app accent should match the mobile Hivemind caramel");
assert.match(globals, /data-theme="hive-light"[\s\S]*--honey-fill:\s*#f0e8d8;/i, "light selected fills should use the mobile tonal surface, not an accent fill");

const fleet = await readFile(new URL("../src/components/fleet-hive/fleet-hive.css", import.meta.url), "utf8");
assert.match(fleet, /--honey:\s*#e7b45c;/i, "Fleet dark accent should retain the original honey amber");
assert.match(fleet, /--honey-2:\s*#f0c879;/i, "Fleet dark accent highlight should retain the original amber");
assert.match(fleet, /--honey-fill:\s*var\(--honey\);/i, "Fleet dark selected fills should resolve to the original honey accent");
assert.match(fleet, /data-fr-theme="light"[\s\S]*--honey:\s*#8a5a2a;/i, "Fleet light legacy accent bridge should use mobile Hivemind caramel");
assert.match(fleet, /data-fr-theme="light"[\s\S]*--honey-fill:\s*#f0e8d8;/i, "Fleet light selected fills should stay tonal and neutral");

const trade = await readFile(new URL("../src/components/trade/trade-desk.css", import.meta.url), "utf8");
assert.match(
  trade,
  /\.dk-seg button\[data-active\][^}]*background:\s*var\(--honey-fill,\s*var\(--panel-2\)\)/i,
  "Trade segmented controls should use the mobile tonal fill token",
);
assert.match(
  trade,
  /data-fr-theme="light"[^}]*\.tk-legrow\s*>\s*\.tk-input[\s\S]*?background:\s*transparent\s*!important/i,
  "Trade light-mode amount inputs should stay transparent inside their leg surface",
);

const tradingWorkspace = await readFile(new URL("../src/components/trade/TradingWorkspace.module.css", import.meta.url), "utf8");
assert.match(
  tradingWorkspace,
  /\.nav button i[^}]*background:\s*var\(--panel-2\)[^}]*color:\s*var\(--fg\)/i,
  "Trade plan counts should use a neutral tonal badge",
);
assert.doesNotMatch(
  tradingWorkspace,
  /\.nav button i[^}]*background:\s*var\(--honey\)/i,
  "Trade plan counts must not use a solid caramel accent fill",
);

const socials = await readFile(new URL("../src/components/socials/socials.css", import.meta.url), "utf8");
assert.match(socials, /data-theme="hive-light"[\s\S]*?--sc-bg:\s*#f5efe6;[\s\S]*?--sc-panel:\s*#f8f4ee;[\s\S]*?--sc-panel-2:\s*#f0e8d8;/i, "Socials light surfaces should match the mobile Hivemind palette");
assert.match(
  socials,
  /data-theme="hive-light"[^}]*\.sc-connect-primary[\s\S]*?background:\s*var\(--sc-panel-2\)\s*!important/i,
  "Socials primary actions should use a neutral tonal fill in light mode",
);

const staticColors = await readFile(new URL("../public/design-system/tokens/colors.css", import.meta.url), "utf8");
assert.match(staticColors, /--honey:\s*#e7b45c;/i, "static dark tokens should retain honey amber");
assert.match(staticColors, /--accent:\s*#e7b45c;/i, "static dark accent should retain honey amber");
assert.match(staticColors, /--honey-fill:\s*var\(--honey\);/i, "static dark selected fills should resolve to honey amber");
assert.match(staticColors, /data-theme="hive-light"[\s\S]*--accent:\s*#8a5a2a;/i, "static light tokens should use mobile Hivemind caramel");

const staticManifest = JSON.parse(await readFile(new URL("../public/design-system/_ds_manifest.json", import.meta.url), "utf8"));
const darkManifestTokens = Object.fromEntries(staticManifest.tokens.filter((token) => !token.scope).map((token) => [token.name, token.value]));
assert.equal(darkManifestTokens["--honey"], "#e7b45c", "static manifest should preserve the dark honey accent");
assert.equal(darkManifestTokens["--accent"], "#e7b45c", "static manifest should preserve the dark primary accent");
assert.equal(darkManifestTokens["--honey-fill"], "var(--honey)", "static manifest should resolve dark selected fills through honey");

const rewardPopup = await readFile(new URL("../src/features/dashboard/progress-rewards/ProgressRewardPopup.module.css", import.meta.url), "utf8");
assert.match(rewardPopup, /\.popup\s*\{[\s\S]*?--honey:\s*#e7b45c;[\s\S]*?--honey-fill:\s*var\(--honey\);[\s\S]*?--on-honey:\s*#1a1305;/i, "reward popup dark actions should use the original amber with readable dark ink");
assert.match(rewardPopup, /data-theme="hive-light"[\s\S]*?--honey-fill:\s*#f0e8d8;\s*--on-honey:\s*#4a3a2a;/i, "reward popup light actions should use the mobile tonal fill and warm ink");
assert.match(rewardPopup, /\.primaryAction\s*\{[^}]*background:\s*var\(--honey-fill,\s*var\(--honey\)\);[^}]*color:\s*var\(--on-honey\);/i, "reward popup primary actions should keep an explicit theme-aware contrast pair");

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

assert.ok(contrastRatio("#e7b45c", "#1a1305") >= 4.5, "dark honey controls need readable dark text");
assert.ok(contrastRatio("#8a5a2a", "#f5efe6") >= 4.5, "light-theme accent text needs AA contrast");
assert.ok(contrastRatio("#4a3a2a", "#f0e8d8") >= 4.5, "tonal selected controls need readable warm-dark text");

console.log(`App accent palette contract passed across ${files.length} UI source files.`);

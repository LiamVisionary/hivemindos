import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [cargo, configText, linkEntitlements, html, css, app, setup, workflow, packageText] = await Promise.all([
  read("src-tauri/Cargo.toml"),
  read("src-tauri/tauri.link.conf.json"),
  read("src-tauri/LinkEntitlements.plist"),
  read("src-tauri/link-static/index.html"),
  read("src-tauri/link-static/styles.css"),
  read("src-tauri/link-static/app.js"),
  read("src-tauri/src/setup.rs"),
  read(".github/workflows/tauri-cross-platform-release.yml"),
  read("package.json"),
]);

const config = JSON.parse(configText);
const packageJson = JSON.parse(packageText);

assert.match(cargo, /\[features\][\s\S]*link-app = \[\]/, "Cargo should expose a dedicated Link build flavor");
assert.equal(config.productName, "HivemindOS Link", "Link bundles should have a clear product name");
assert.equal(config.mainBinaryName, "HivemindOS", "Link config should reuse the signed desktop executable name");
assert.equal(config.identifier, "com.hivemindos.link", "Link must install separately from the complete hub");
assert.equal(config.build.frontendDist, "link-static", "Link should ship its focused static GUI, not the dashboard");
assert.equal(config.bundle.createUpdaterArtifacts, false, "Link should not enter the complete hub updater channel");
assert.deepEqual(config.bundle.externalBin, [], "Link should not bundle complete-hub sidecars");
assert.deepEqual(config.bundle.resources, [], "Link should not bundle complete-hub dashboard resources");
assert.deepEqual(config.plugins["deep-link"].desktop.schemes, [], "Link should not claim the complete hub deep-link scheme");
assert.equal(config.bundle.macOS.entitlements, "LinkEntitlements.plist", "Link should use focused macOS entitlements");
assert.doesNotMatch(linkEntitlements, /audio-input|microphone|allow-jit|unsigned-executable-memory|disable-library-validation/, "Link should not inherit complete-hub runtime entitlements");

assert.match(html, /Link this device to the Hive Fleet/, "the GUI should explain its exact outcome");
assert.match(html, /id="link-device"/, "the primary action should be a GUI button");
assert.match(html, /Collector only · no dashboard/, "the GUI should promise the restricted install mode");
assert.match(html, /open it on your main hub/i, "the GUI should identify where approval happens");
assert.match(html, /<details class="advanced" id="advanced-setup">/, "terminal fallback should live in Advanced setup");
assert.match(html, /Keep this window open until setup finishes/, "the app must not imply a piped setup survives closing it");
assert.doesNotMatch(html, /<details[^>]*\bopen\b/, "Advanced setup should be collapsed by default");
assert.ok(html.indexOf("id=\"link-device\"") < html.indexOf("id=\"advanced-command\""), "the guided action must precede all command-line fallback UI");
assert.doesNotMatch(html, /Fleet Hive/, "the Link GUI should use the Hive Fleet product name");
assert.match(css, /\.primary\s*\{[^}]*width:\s*100%/s, "the guided action should be visually primary");

assert.match(app, /installMode:\s*"collector"/, "the GUI must request collector-only setup");
assert.match(app, /startDashboard:\s*false/, "the GUI must never start a second dashboard");
assert.match(app, /invoke\("native_setup_run"/, "the GUI should run setup itself");
assert.match(app, /listen\("native-setup-progress"/, "the GUI should show native progress instead of a terminal");
assert.match(app, /status\?\.link_status/, "the GUI should detect approval and connection status");
assert.match(app, /navigator\.clipboard\.writeText/, "approval handoff should be one-click copyable");

assert.match(setup, /"collector" => "--collector-only"/, "Unix Link setup must map to collector-only mode");
assert.match(setup, /flags\.push\("-CollectorOnly"\)/, "Windows Link setup must map to CollectorOnly mode");
assert.match(setup, /link_status:\s*read_native_link_status\(\)/, "native status should expose Link approval state");
assert.match(setup, /if !matches!\(host, "127\.0\.0\.1" \| "localhost" \| "\[::1\]"\)/, "Link status reads must remain loopback-only");

assert.equal(packageJson.scripts["tauri:build:link:release"], "tauri build --features link-app --config src-tauri/tauri.link.conf.json", "release builds should expose the Link-only feature flavor");
for (const asset of [
  "HivemindOS-Link-macos-apple-silicon.dmg",
  "HivemindOS-Link-windows-x64-setup.exe",
  "HivemindOS-Link-linux-x64.AppImage",
]) {
  assert.ok(workflow.includes(asset), `release workflow should publish ${asset}`);
}
assert.match(workflow, /Build HivemindOS Link/, "every platform should build the downloadable Link GUI");
assert.match(workflow, /CARGO_TARGET_DIR:\s*src-tauri\/target-link/, "Link and complete-hub bundles should use isolated build outputs");
assert.match(workflow, /link_release_tag:/, "release dispatch should support attaching Link assets to an existing release");
assert.match(workflow, /Attach HivemindOS Link assets to existing release/, "an existing release should have a focused Link-only upload path");
assert.match(workflow, /find release-assets[^\n]*HivemindOS-Link-\*/, "existing-release uploads should select only Link assets");
assert.match(workflow, /gh release upload "\$target_release_tag"[\s\S]*--clobber/, "existing-release uploads should replace only the requested Link assets");
assert.match(workflow, /name: Build updater manifest\s*\n\s*if: github\.event\.inputs\.link_release_tag == ''/, "Link-only attachment must not replace the Complete Hub updater manifest");

console.log("HivemindOS Link GUI contract passed.");

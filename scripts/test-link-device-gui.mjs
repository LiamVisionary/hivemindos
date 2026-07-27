import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [cargo, configText, linkEntitlements, html, css, app, setup, windowsSetup, windowsCollectorSetup, unixCollectorSetup, workflow, packageText, runtimePreparation] = await Promise.all([
  read("src-tauri/Cargo.toml"),
  read("src-tauri/tauri.link.conf.json"),
  read("src-tauri/LinkEntitlements.plist"),
  read("src-tauri/link-static/index.html"),
  read("src-tauri/link-static/styles.css"),
  read("src-tauri/link-static/app.js"),
  read("src-tauri/src/setup.rs"),
  read("setup.ps1"),
  read("scripts/install-telemetry-collector.ps1"),
  read("scripts/install-telemetry-collector.sh"),
  read(".github/workflows/tauri-cross-platform-release.yml"),
  read("package.json"),
  read("scripts/prepare-link-runtime.mjs"),
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
assert.deepEqual(config.bundle.resources, { "link-runtime/": "link-runtime/" }, "Link should bundle only its ready-to-run collector runtime");
assert.deepEqual(config.plugins["deep-link"].desktop.schemes, [], "Link should not claim the complete hub deep-link scheme");
assert.equal(config.bundle.macOS.entitlements, "LinkEntitlements.plist", "Link should use focused macOS entitlements");
assert.doesNotMatch(linkEntitlements, /audio-input|microphone|disable-library-validation/, "Link should not inherit dashboard-only device or native-addon entitlements");
assert.match(linkEntitlements, /allow-jit[\s\S]*allow-unsigned-executable-memory/, "the bundled Node collector needs V8 executable-memory entitlements on macOS");

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
assert.match(app, /statusPending/, "status refreshes should be single-flight so slow native checks cannot backlog and freeze the GUI");
assert.match(app, /if \(state\.statusPending\) return/, "overlapping status refreshes must be skipped");

assert.match(setup, /"collector" => "--collector-only"/, "Unix Link setup must map to collector-only mode");
assert.match(setup, /flags\.push\("-CollectorOnly"\)/, "Windows Link setup must map to CollectorOnly mode");
assert.match(setup, /link_status:\s*read_native_link_status\(\)/, "native status should expose Link approval state");
assert.match(setup, /if !matches!\(host, "127\.0\.0\.1" \| "localhost" \| "\[::1\]"\)/, "Link status reads must remain loopback-only");
assert.match(setup, /pub\(crate\) async fn native_setup_status/, "native status should run asynchronously instead of blocking the Tauri UI thread");
assert.match(setup, /spawn_blocking\(collect_native_setup_status\)/, "blocking port and Link probes should run on Tauri's blocking pool");
assert.match(setup, /cfg!\(feature = "link-app"\)[\s\S]*bundled_link_setup_command/, "the Link build should install its bundled runtime instead of downloading the complete Hub source");

const collectorBranchStart = windowsSetup.indexOf("if ($collectorOnlyMode) {\n  Ensure-Node");
const collectorBranch = collectorBranchStart >= 0
  ? windowsSetup.slice(collectorBranchStart).match(/^if \(\$collectorOnlyMode\) \{[\s\S]*?exit 0\s*\}/)?.[0] ?? ""
  : "";
assert.match(collectorBranch, /install-telemetry-collector\.ps1/, "collector-only Windows setup should install the collector directly");
assert.doesNotMatch(collectorBranch, /Python|Obsidian|GPG|Unison/, "collector-only Windows setup should not install Complete Hub dependencies");
assert.ok(collectorBranchStart >= 0 && collectorBranchStart < windowsSetup.lastIndexOf("\nEnsure-Unison\n"), "collector-only Windows setup must exit before Hub-only dependency calls");
assert.match(windowsCollectorSetup, /PrebuiltLinkBinary/, "Windows runtime setup should accept the Link binary shipped by the GUI installer");
assert.match(windowsCollectorSetup, /NodePath/, "Windows runtime setup should accept the Node executable shipped by the GUI installer");
const windowsLinkRegistrationStart = windowsCollectorSetup.indexOf("$linkRegistration = Register-HivemindLogonLauncher");
const windowsLinkRegistration = windowsLinkRegistrationStart >= 0
  ? windowsCollectorSetup.slice(windowsLinkRegistrationStart, windowsLinkRegistrationStart + 500)
  : "";
assert.match(windowsLinkRegistration, /-RequireInteractive/, "Windows Link must run in the signed-in user's session because tsnet cannot read user policy from an S4U task");
const windowsLinkStart = windowsCollectorSetup.match(
  /if \(\$linkActive\) \{\s+Write-Host "Starting Hivemind Link\.\.\."[\s\S]*?# Poll the control \/health/,
)?.[0] ?? "";
assert.match(windowsLinkStart, /if \(\$linkRegistration\.Kind -eq "ScheduledTask"\) \{\s+\$linkStartedNow = Start-HivemindScheduledTaskNow/, "Windows setup must start the registered interactive Link task instead of launching tsnet from a non-interactive setup session");
assert.match(unixCollectorSetup, /HIVEMINDOS_COLLECTOR_BUNDLED/, "macOS and Linux runtime setup should skip package installation for the bundled collector");
assert.match(unixCollectorSetup, /HIVE_LINK_PREBUILT/, "macOS and Linux runtime setup should use the shipped Link binary instead of installing Go");
assert.match(runtimePreparation, /raw\.githubusercontent\.com\/nodejs\/node\/\$\{process\.version\}\/LICENSE/, "runtime packaging should fetch the exact Node release license when an installer omits it");
assert.match(runtimePreparation, /Node\.js is licensed for use as follows:/, "downloaded Node license text should be validated before it is bundled");
assert.match(await read("uninstall.ps1"), /Remove bundled HivemindOS Link collector runtimes/, "Windows uninstall should offer to remove packaged Link runtimes");
assert.match(await read("uninstall.sh"), /Remove bundled HivemindOS Link collector runtimes/, "macOS and Linux uninstall should offer to remove packaged Link runtimes");

assert.equal(packageJson.scripts["tauri:build:link:release"], "tauri build --features link-app --config src-tauri/tauri.link.conf.json", "release builds should expose the Link-only feature flavor");
for (const asset of [
  "HivemindOS-Link-macos-apple-silicon.dmg",
  "HivemindOS-Link-windows-x64-setup.exe",
  "HivemindOS-Link-linux-x64.AppImage",
]) {
  assert.ok(workflow.includes(asset), `release workflow should publish ${asset}`);
}
assert.match(workflow, /Build HivemindOS Link/, "every platform should build the downloadable Link GUI");
assert.match(workflow, /Prepare HivemindOS Link runtime/, "release jobs should stage a ready-to-run collector, Node, and Link sidecar before bundling the GUI");
assert.match(workflow, /Test HivemindOS Link runtime/, "release jobs should boot-check the exact packaged collector before bundling the GUI");
assert.ok(workflow.indexOf("Import Apple signing certificate") < workflow.indexOf("Prepare HivemindOS Link runtime"), "the packaged macOS runtime should be signed only after the Developer ID certificate is imported");
assert.match(workflow, /Prepare HivemindOS Link runtime[\s\S]*APPLE_SIGNING_IDENTITY:/, "runtime preparation should receive the Developer ID identity on macOS");
assert.match(workflow, /CARGO_TARGET_DIR:\s*\$\{\{ github\.workspace \}\}\/src-tauri\/target-link/, "Link builds should use one workspace-absolute target directory on every runner");
assert.doesNotMatch(workflow, /CARGO_TARGET_DIR:\s*src-tauri\/target-link/, "a relative Link target would be nested below Tauri's src-tauri working directory");
assert.match(workflow, /link_release_tag:/, "release dispatch should support attaching Link assets to an existing release");
assert.match(workflow, /Attach HivemindOS Link assets to existing release/, "an existing release should have a focused Link-only upload path");
assert.match(workflow, /find release-assets[^\n]*HivemindOS-Link-\*/, "existing-release uploads should select only Link assets");
assert.match(workflow, /gh release upload "\$target_release_tag"[\s\S]*--clobber/, "existing-release uploads should replace only the requested Link assets");
assert.match(workflow, /name: Build updater manifest\s*\n\s*if: github\.event\.inputs\.link_release_tag == ''/, "Link-only attachment must not replace the Complete Hub updater manifest");

const windowsSigningLogin = workflow.match(
  /- name: Azure login for Windows signing[\s\S]*?(?=\n\s+- name: Sign Windows installers with Azure Artifact Signing)/,
)?.[0] ?? "";
assert.match(windowsSigningLogin, /allow-no-subscriptions:\s*true/, "Windows signing should permit tenant-only Azure login");
assert.doesNotMatch(windowsSigningLogin, /subscription-id:/, "tenant-only Windows signing must not select an unavailable Azure subscription");
assert.doesNotMatch(workflow, /AZURE_SUBSCRIPTION_ID/, "Windows signing should not require an unused subscription secret");

assert.match(workflow, /allow_unsigned_windows_link:[\s\S]*?default:\s*"false"/, "unsigned Windows Link publishing must be an explicit opt-in");
assert.match(workflow, /ALLOW_UNSIGNED_WINDOWS_LINK:\s*\$\{\{ github\.event\.inputs\.allow_unsigned_windows_link \}\}/, "release validation should receive the unsigned Link opt-in");
assert.match(workflow, /Unsigned Windows Link publishing requires link_release_tag/, "unsigned installers must be forbidden for normal Complete Hub releases");
const unsignedWindowsLinkCondition = "runner.os == 'Windows' && github.event.inputs.link_release_tag != '' && github.event.inputs.allow_unsigned_windows_link == 'true'";
assert.ok(workflow.includes(`name: Verify temporary unsigned Windows Link installers\n        if: ${unsignedWindowsLinkCondition}`), "the explicit unsigned path should verify and acknowledge only Link installers");
assert.match(workflow, /Get-AuthenticodeSignature[\s\S]*SignatureStatus\]::NotSigned/, "temporary unsigned Link assets should be proven unsigned before publication");
const requiredWindowsSigningCondition = `runner.os == 'Windows' && !(${unsignedWindowsLinkCondition.replace("runner.os == 'Windows' && ", "")})`;
assert.equal(workflow.split(`if: ${requiredWindowsSigningCondition}`).length - 1, 5, "all five Windows signing and verification steps should remain mandatory outside the temporary Link-only path");

console.log("HivemindOS Link GUI contract passed.");

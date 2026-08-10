#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const collector = await readFile(new URL("./install-telemetry-collector.sh", import.meta.url), "utf8");
const watchdog = await readFile(new URL("./install-fleet-health-watchdog.sh", import.meta.url), "utf8");
const setup = await readFile(new URL("../setup.sh", import.meta.url), "utf8");

const firewallStart = collector.indexOf("maybe_allow_node_through_macos_firewall() {");
const firewallEnd = collector.indexOf("\n}\n", firewallStart);
assert.ok(firewallStart >= 0 && firewallEnd > firewallStart, "collector should define the macOS firewall helper");
const firewallHelper = collector.slice(firewallStart, firewallEnd);
const nonInteractiveGuard = firewallHelper.search(/! -t 0|! -t 1/);
const firstSudo = firewallHelper.search(/\bsudo\b/);
assert.ok(
  nonInteractiveGuard >= 0 && firstSudo > nonInteractiveGuard,
  "hidden/non-interactive onboarding must skip the optional firewall prompt before any sudo command can block it",
);

assert.match(watchdog, /run_with_timeout\(\)/, "the watchdog installer should own a portable command timeout");
assert.match(watchdog, /launchctl_bounded 5 kickstart -k/, "watchdog launchd kickstart should have a hard upper bound");
assert.doesNotMatch(watchdog, /^\s*launchctl kickstart/m, "watchdog setup must not invoke an unbounded launchd restart");
assert.match(watchdog, /cmp -s \"\$PLIST_NEXT\" \"\$PLIST\"/, "an unchanged running watchdog should not be restarted");

assert.match(collector, /collector_plist_unchanged/, "collector setup should detect an unchanged launchd definition");
assert.match(collector, /collector_service_healthy/, "an unchanged healthy collector should stay online instead of being restarted");
assert.match(collector, /Syncthing macOS LaunchAgent already running/, "local-only reruns should preserve an existing Syncthing service");
assert.match(collector, /Skipping optional Bonjour\/mDNS dependency in background setup/, "hidden onboarding should not block on an optional npm download");
const dependencyInstall = collector.indexOf('"$APP_DIR/scripts/ensure-collector-deps.sh"');
const backgroundSkip = collector.indexOf("Skipping optional Bonjour/mDNS dependency in background setup");
assert.ok(backgroundSkip >= 0 && dependencyInstall > backgroundSkip, "the non-interactive optional-dependency decision should happen before npm can run");

assert.match(setup, /if ! \.\/scripts\/seed-shared-skills\.sh/, "a protected existing skill shelf must not abort core onboarding");
assert.match(setup, /Shared skills: macOS blocked updates to some existing workspace files/, "setup should surface a plain-language repair warning for protected workspace files");
assert.match(setup, /echo "HIVEMINDOS_SETUP_WARNING: \$item" >&2/, "optional warnings should use the unthrottled progress stream");

console.log("native setup install resilience checks passed");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [linkMain, linkFile, installer, collector, sender, nativeSetup, fleetData, dashboardMapper, hivePanel] = await Promise.all([
  readFile(new URL("../cmd/hivemind-linkd/main.go", import.meta.url), "utf8"),
  readFile(new URL("../cmd/hivemind-linkd/file.go", import.meta.url), "utf8"),
  readFile(new URL("./install-telemetry-collector.sh", import.meta.url), "utf8"),
  readFile(new URL("./agent-telemetry-collector.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/fleet/send-file/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src-tauri/src/setup.rs", import.meta.url), "utf8"),
  readFile(new URL("../src/components/fleet/fleet-data.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/features/dashboard/hooks/use-dashboard-derived-state.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/components/fleet-hive/HivePanel.tsx", import.meta.url), "utf8"),
]);

assert.match(
  linkMain,
  /serveFileReceiveReadiness\(fileConfig, false\)/,
  "the peer-facing Link route must never trigger a protected-folder prompt",
);
assert.match(
  linkMain,
  /serveFileReceiveReadiness\(fileConfig, true\)/,
  "the loopback setup route should own protected-folder preparation",
);
assert.match(
  linkFile,
  /downloads_access_not_prepared/,
  "the receiver should fail closed when Downloads was not prepared",
);
assert.match(linkFile, /SHA256:/, "the receiver should return its own SHA-256 receipt");

assert.match(
  installer,
  /HIVEMINDOS_PREPARE_DOWNLOADS_ACCESS:-auto/,
  "the installer should default Downloads preparation based on setup context",
);
assert.match(
  installer,
  /-X POST[\s\S]*\/_hivemind\/file\/readiness\?dir=~\/Downloads/,
  "interactive setup should prepare Downloads through the loopback-only route",
);
assert.match(
  installer,
  /Headless Macs must receive a PPPC profile from device management, then rerun setup with HIVEMINDOS_PREPARE_DOWNLOADS_ACCESS=required/,
  "headless setup should provide managed macOS authorization guidance",
);
assert.match(
  nativeSetup,
  /HIVEMINDOS_PREPARE_DOWNLOADS_ACCESS=required/,
  "native setup should make the one-time Downloads check mandatory",
);

assert.match(
  collector,
  /fileTransfers:\s*process\.platform !== "darwin" \|\| existsSync/,
  "a Mac should advertise file transfer support only after setup prepared Downloads",
);

const remoteSend = sender.slice(sender.indexOf("// Remote machine:"));
const readinessIndex = remoteSend.indexOf("/_hivemind/file/readiness");
const streamIndex = remoteSend.indexOf("const trackedStream = createProgressStream(input)");
assert.ok(readinessIndex >= 0, "the sender should query destination readiness");
assert.ok(
  streamIndex > readinessIndex,
  "the sender must verify readiness before consuming or forwarding the file stream",
);
assert.match(remoteSend, /No file was sent\./, "a rejected preflight should explain that no bytes were sent");
assert.match(remoteSend, /sha256:\s*data\.sha256/, "the sender should surface the receiver's SHA-256 receipt");

assert.match(fleetData, /fileTransfers\?: boolean/, "fleet machine state should preserve file-transfer readiness");
assert.match(
  dashboardMapper,
  /fileTransfers:\s*machine\.capabilities\?\.fileTransfers/,
  "collector readiness should reach the fleet machine model",
);
assert.match(
  hivePanel,
  /disabled=\{m\.source\.fileTransfers === false\}/,
  "Hive Drop should be disabled when setup has not prepared the receiver",
);

console.log("Hive Drop Downloads readiness checks passed");

#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shouldUseTailscaleCliFallback } from "./lib/tailscale-optional.mjs";

assert.equal(
  shouldUseTailscaleCliFallback({ platform: "darwin", env: {} }),
  false,
  "automatic macOS work must not launch Tailscale by default",
);
assert.equal(
  shouldUseTailscaleCliFallback({
    platform: "darwin",
    env: { HIVEMIND_TAILSCALE_CLI_FALLBACK: "1" },
  }),
  true,
  "macOS CLI fallback remains an explicit diagnostic opt-in",
);
assert.equal(
  shouldUseTailscaleCliFallback({ platform: "linux", env: {} }),
  true,
  "headless platforms retain their CLI fallback",
);

const tailnetSelf = readFileSync(
  new URL("./lib/tailnet-self.mjs", import.meta.url),
  "utf8",
);
assert.match(
  tailnetSelf,
  /if \(!shouldUseTailscaleCliFallback\(\)\) throw new Error/,
  "collector identity probes honor the macOS CLI policy",
);

const watchdog = readFileSync(
  new URL("./fleet-health-watchdog.mjs", import.meta.url),
  "utf8",
);
assert.match(
  watchdog,
  /if \(!shouldUseTailscaleCliFallback\(\)\) return \[\];/,
  "dashboard-less Fleet discovery honors the macOS CLI policy",
);

const collector = readFileSync(
  new URL("./agent-telemetry-collector.mjs", import.meta.url),
  "utf8",
);
assert.match(
  collector,
  /const st = await tailscaleStatusJson\(\);/,
  "mDNS metadata uses the guarded shared status lookup",
);

const fleetApps = readFileSync(
  new URL("../src/app/api/fleet/apps/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  fleetApps,
  /async function tailscalePeerIps\(\) \{[\s\S]*?if \(!shouldUseTailscaleCliFallback\(\)\) return \[\];/,
  "startup app discovery does not launch the macOS CLI",
);

const fleetDiscover = readFileSync(
  new URL("../src/app/api/fleet/discover/route.ts", import.meta.url),
  "utf8",
);
assert.match(
  fleetDiscover,
  /async function execTailscaleSsh[\s\S]*?if \(!shouldUseTailscaleCliFallback\(\)\) throw new Error/,
  "automatic bridge repair does not launch Tailscale on macOS",
);

const hiveEnvAdd = readFileSync(
  new URL("./hive-env-add", import.meta.url),
  "utf8",
);
assert.match(
  hiveEnvAdd,
  /def should_use_tailscale_cli\(\) -> bool:/,
  "env replication owns an explicit CLI policy",
);
assert.match(
  hiveEnvAdd,
  /def tailnet_peer_status\([\s\S]*?if not should_use_tailscale_cli\(\):\s*return \[\], \[\]/,
  "automatic env replication skips the macOS CLI",
);

console.log("optional Tailscale policy checks passed");

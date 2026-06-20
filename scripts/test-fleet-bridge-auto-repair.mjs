import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function has(text, needle, label) {
  assert.ok(text.includes(needle), label);
}

const route = source("src/app/api/fleet/discover/route.ts");

has(
  route,
  "type BridgeRepairStatus",
  "fleet discovery exposes bridge repair status",
);
has(
  route,
  "BRIDGE_AUTO_REPAIR_FAILURE_COOLDOWN_MS",
  "auto repair has a failure cooldown",
);
has(
  route,
  "LAST_READY_MACHINE_MS",
  "fleet discovery keeps a short last-ready window",
);
has(
  route,
  "bridgeRepairInFlight",
  "auto repair dedupes in-flight repair attempts",
);
has(
  route,
  "scheduleBridgeAutoRepair(device, options)",
  "failed bridge probes enqueue repair",
);
has(
  route,
  "isBridgeAutoRepairCandidate",
  "auto repair is gated to supported machine types",
);
has(
  route,
  "hasRecentReadyMachine(device)",
  "auto repair does not flap a recently-ready collector",
);
has(
  route,
  "rememberReadyMachines(payload)",
  "fleet discovery remembers known-good agent payloads",
);
has(
  route,
  "tailscaleSshTargets",
  "auto repair reaches machines through Tailscale SSH",
);
has(
  route,
  "systemShortName",
  "auto repair can target the system node for embedded Hivemind Link peers",
);
has(
  route,
  "replace(/^hivemindos-/",
  "auto repair strips the Link-node prefix before Tailscale SSH",
);
has(
  route,
  "com.agent-control-room.telemetry",
  "auto repair restarts the collector launch agent",
);
has(
  route,
  "com.hivemindos.linkd.agent",
  "auto repair restarts the Hivemind Link launch agent",
);
has(
  route,
  "hivemindos-linkd.service",
  "auto repair restarts the Linux Link service",
);
has(
  route,
  "agent-telemetry.service",
  "auto repair restarts the Linux collector service",
);
has(
  route,
  "HIVE_LINK_ENABLED=true ./scripts/install-telemetry-collector.sh",
  "auto repair falls back to reinstalling the existing bridge",
);
has(
  route,
  "probeCollectorCandidates(device",
  "auto repair verifies collector reachability from the dashboard",
);
has(
  route,
  "Automatic agent bridge repair is running.",
  "route returns user-facing running copy",
);

const types = source("src/features/dashboard/dashboard-types.ts");
has(
  types,
  "bridgeRepair?:",
  "dashboard machine types carry bridge repair state",
);
has(
  types,
  '"queued" | "running" | "succeeded" | "failed"',
  "bridge repair status union is typed",
);

console.log("Fleet bridge auto-repair regression checks passed.");

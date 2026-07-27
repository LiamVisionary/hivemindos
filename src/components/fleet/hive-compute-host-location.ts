import type { FleetMachine } from "@/components/fleet/fleet-data";

function normalizeDeviceToken(value: string): string {
  // Drop possessives ("Liam's" → "Liam") so an LM Studio device name and a
  // Tailscale machine name for the same box normalize alike.
  return value.toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function deviceCoreName(value: string): string {
  // LM Studio device names often carry a role suffix ("-Host", ".local") the
  // fleet name lacks — strip it before comparing.
  return normalizeDeviceToken(value.replace(/[\s._-]*(host|local|lan|pc|node)$/i, ""));
}

// Best-effort location for an LM Link host: match the LM Studio device name to a
// non-self fleet machine and borrow its (fleet-derived) location. Returns
// undefined when there is no confident match, or when tied matches disagree on
// location, rather than guessing.
export function resolveLinkHostLocation(deviceName: string | undefined, machines: FleetMachine[] | undefined): string | undefined {
  if (!deviceName || !machines?.length) return undefined;
  const target = deviceCoreName(deviceName);
  if (target.length < 4) return undefined;
  const scored = machines
    .filter((machine) => !/^this\b/i.test((machine.name || "").trim()))
    .map((machine) => {
      const name = normalizeDeviceToken(machine.name || "");
      const tailnet = normalizeDeviceToken(machine.tailnet || "");
      let score = 0;
      if (name === target || tailnet === target) score = 3;
      else if (name.includes(target) || target.includes(name) || tailnet.includes(target)) score = 2;
      return { machine, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return undefined;
  const topScore = scored[0].score;
  const tied = scored.filter((entry) => entry.score === topScore);
  // Prefer the human city label ("New York relay") over the generic location
  // bucket ("Tailscale relay").
  const labels = new Set(
    tied.map((entry) => (entry.machine.city || entry.machine.location || "").trim()).filter(Boolean),
  );
  return labels.size === 1 ? [...labels][0] : undefined;
}
